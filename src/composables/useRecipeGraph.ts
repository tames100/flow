import { ref } from 'vue'
import { useVueFlow, MarkerType } from '@vue-flow/core'
import type {
  MaterialDemand,
  RecipeEdge,
  RecipeForm,
  RecipeGraphData,
  RecipeNode,
  RecipeNodeData,
} from '../types'
import { DEFAULT_UNIT } from '../types'
import { useActionTypes } from './useActionTypes'

const STORAGE_KEY = 'vflow_graph_data'

let nodeSeq = 1

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${nodeSeq++}`
}

/** 解析连线 label 中的数量（如 ×5 ml → 5；无 label 视为 1） */
function qtyFromLabel(label: unknown): number {
  const m = /×(\d+)/.exec(String(label ?? ''))
  return m ? +m[1] : 1
}

/** 解析连线 label 中的单位（如 ×5 ml → 'ml'；无单位返回空串） */
function unitFromLabel(label: unknown): string {
  const m = /×\d+\s*(\S+)/.exec(String(label ?? ''))
  return m ? m[1] : ''
}

/** 生成连线 label：数量 + 单位（有单位或数量 >1 时显示） */
function edgeLabel(qty: number, unit: string): string {
  return qty > 1 || unit ? `×${qty}${unit ? ' ' + unit : ''}` : ''
}

const nodes = ref<any[]>([])
const edges = ref<any[]>([])

export function useRecipeGraph() {
  const {
    addNodes,
    addEdges,
    removeNodes,
    removeEdges,
    setNodes,
    setEdges,
    findNode,
    updateEdge,
    getNodes,
    getEdges,
    viewport,
    setViewport,
  } = useVueFlow()
  const { allActions } = useActionTypes()

  /** 从 VueFlow store 序列化节点：仅保留业务字段，保证 position 始终是最新值 */
  function serializeNodes() {
    return getNodes.value.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      data: JSON.parse(JSON.stringify(n.data ?? {})),
    }))
  }

  /** 从 VueFlow store 序列化连线：仅保留业务字段 */
  function serializeEdges() {
    return getEdges.value.map((e) => {
      const o: Record<string, unknown> = {
        id: e.id,
        source: e.source,
        target: e.target,
      }
      if (e.sourceHandle) o.sourceHandle = e.sourceHandle
      if (e.targetHandle) o.targetHandle = e.targetHandle
      if (e.type) o.type = e.type
      if (e.class) o.class = e.class
      if (e.animated) o.animated = e.animated
      if (e.style) o.style = JSON.parse(JSON.stringify(e.style))
      if (e.markerEnd) o.markerEnd = JSON.parse(JSON.stringify(e.markerEnd))
      if (e.label) o.label = e.label
      if (e.labelStyle) o.labelStyle = e.labelStyle
      if (e.labelBgStyle) o.labelBgStyle = e.labelBgStyle
      if (e.labelBgPadding) o.labelBgPadding = e.labelBgPadding
      if (e.labelBgBorderRadius) o.labelBgBorderRadius = e.labelBgBorderRadius
      // 数量单位（如 '个' / 'ml' / '组'）
      const unit = (e as any).unit
      if (unit) o.unit = unit
      return o
    })
  }

  /** 生成当前画布的完整快照：节点（含最新位置）+ 连线 + 视图状态（平移/缩放） */
  function snapshot(): RecipeGraphData {
    return {
      version: '1.0',
      actions: allActions(),
      nodes: serializeNodes() as unknown as RecipeNode[],
      edges: serializeEdges() as unknown as RecipeEdge[],
      viewport: { x: viewport.value.x, y: viewport.value.y, zoom: viewport.value.zoom },
    }
  }

  /**
   * 自动持久化：从 VueFlow store 读取最新画布状态（节点位置 / 连线 / 视图缩放）写入 localStorage。
   * 任何修改（拖拽、增删、连线、数量编辑）后调用均可保证位置是最新的。
   */
  function persist() {
    try {
      const payload = snapshot()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      // 同步本地副本，保证 getItemNodes / detectCycle / 属性面板数量判断与画布一致
      nodes.value = JSON.parse(JSON.stringify(payload.nodes))
      edges.value = JSON.parse(JSON.stringify(payload.edges))
    } catch (e) {
      // localStorage 容量超限等异常时静默忽略
      console.warn('自动保存失败', e)
    }
  }

  /** 从 localStorage 恢复完整画布状态（含节点位置与视图，应用启动时调用一次） */
  function loadFromStorage(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return false
      const data = JSON.parse(raw) as RecipeGraphData
      if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return false
      importJSON(data, false)
      return true
    } catch {
      return false
    }
  }

  /** 创建一个物品节点 */
  function createItemNode(
    label: string,
    image = '',
    position = { x: 0, y: 0 },
    showLabel = true,
    quantity = 1,
    description = '',
  ): RecipeNode {
    return {
      id: genId('item'),
      type: 'item',
      position,
      data: {
        kind: 'item',
        label,
        image,
        showLabel,
        quantity: quantity || 1,
        description: description || undefined,
      },
    }
  }

  /** 创建一个动作节点 */
  function createActionNode(
    action: string,
    position = { x: 0, y: 0 },
    image = '',
    description = '',
    outputUnit = DEFAULT_UNIT,
  ): RecipeNode {
    return {
      id: genId('action'),
      type: 'action',
      position,
      data: {
        kind: 'action',
        label: action,
        action,
        image,
        description: description || undefined,
        outputUnit: outputUnit || DEFAULT_UNIT,
      },
    }
  }

  /**
   * 解析一条连线（由其 source / target 节点）应使用的单位，遵循继承规则：
   * - 输出边（action → item）：取加工节点的「输出单位」（默认「个」）。
   * - 输入边（item → action）：继承生成该物品节点的上游加工节点输出单位；若物品是基本原料（无上游加工）则默认「个」。
   */
  function resolveUnit(sourceId: string, _targetId: string): string {
    const src = findNode(sourceId)
    if (src?.data?.kind === 'action') {
      return (src.data.outputUnit as string) || DEFAULT_UNIT
    }
    // 输入边：找生成该物品的加工节点
    const producer = getEdges.value.find(
      (e) => e.target === sourceId && findNode(e.source)?.data?.kind === 'action',
    )
    if (producer) {
      return (findNode(producer.source)?.data as any)?.outputUnit || DEFAULT_UNIT
    }
    return DEFAULT_UNIT
  }

  /** 按继承规则重算所有连线的单位并同步 label（用于导入旧数据等场景） */
  function refreshEdgeUnits() {
    getEdges.value.forEach((e) => {
      const unit = resolveUnit(e.source, e.target)
      Object.assign(e, { unit, label: edgeLabel(qtyFromLabel(e.label), unit) })
    })
  }

  /**
   * 加工节点「输出单位」变更后，同步继承关系：
   * - 该加工节点的所有输出边（action → item）单位 = 新输出单位；
   * - 以这些产物为输入的下游加工节点，其输入边单位同样继承为新输出单位。
   * 例如：搅拌输出单位改为 ml → 「搅拌→B」输出边与「B→注液」输入边都变为 ml。
   */
  function syncUnitFromAction(actionId: string) {
    const act = findNode(actionId)
    if (!act) return
    const unit = (act.data as any)?.outputUnit || DEFAULT_UNIT
    getEdges.value.forEach((e) => {
      if (e.source !== actionId) return
      const src = findNode(e.source)
      if (src?.data?.kind !== 'action') return
      Object.assign(e, { unit, label: edgeLabel(qtyFromLabel(e.label), unit) })
      // 下游加工节点的输入边继承同一单位
      getEdges.value.forEach((de) => {
        if (de.source === e.target && findNode(de.target)?.data?.kind === 'action') {
          Object.assign(de, { unit, label: edgeLabel(qtyFromLabel(de.label), unit) })
        }
      })
    })
    persist()
  }

  /**
   * 根据表单生成「输入物品 -> 动作节点 -> 输出物品」的节点与连线。
   * - 若输入项选择了「已有产物」(refId)，则直接复用该节点作为来源（不新建重复物品）。
   * - 数量展示在「输入 -> 动作」的连线上（数量为 1 时不显示）。
   */
  function addRecipeFromForm(form: RecipeForm) {
    const baseX = 80 + (nodes.value.length % 3) * 320
    const baseY = 80 + Math.floor(nodes.value.length / 3) * 320

    const createdNodes: RecipeNode[] = []

    // 解析每个输入：复用已有节点 or 新建
    const inputSources = form.inputs.map((inp, i) => {
      if (inp.refId) {
        const existing = findNode(inp.refId)
        if (existing) {
          return { node: existing, quantity: inp.quantity ?? 1 }
        }
      }
      const n = createItemNode(
        inp.name,
        inp.image ?? '',
        { x: baseX, y: baseY + i * 90 },
        true,
        1,
        inp.description,
      )
      createdNodes.push(n)
      return { node: n, quantity: inp.quantity ?? 1 }
    })

    // 加工动作节点：若选择了已有加工节点且勾选复用图片 -> 复用该节点；否则新建
    let actionNode: any = null
    if (form.actionRefId && form.reuseActionImage) {
      const existing = findNode(form.actionRefId)
      if (existing) actionNode = existing
    }
    if (!actionNode) {
      actionNode = createActionNode(
        form.action,
        {
          x: baseX + 220,
          y: baseY + ((inputSources.length - 1) * 90) / 2,
        },
        form.actionImage ?? '',
        form.actionDescription,
        form.actionOutputUnit,
      )
      createdNodes.push(actionNode)
    }

    const outputNode = createItemNode(
      form.output.name,
      form.output.image ?? '',
      {
        x: baseX + 460,
        y: baseY + ((inputSources.length - 1) * 90) / 2,
      },
      true,
      1,
      form.output.description,
    )
    // 输出数量记录在输出物品节点上（用于动作 -> 输出 连线展示）
    ;(outputNode.data as any).quantity = form.output.quantity ?? 1
    createdNodes.push(outputNode)

    const outQty = form.output.quantity ?? 1
    const actionOutUnit = (actionNode.data as any)?.outputUnit || DEFAULT_UNIT

    const newEdges: RecipeEdge[] = [
      // 输入边：单位遵循继承规则（基本原料默认「个」）
      ...inputSources.map((s) => {
        const unit = resolveUnit(s.node.id, actionNode.id)
        return {
          id: genId('e'),
          source: s.node.id,
          target: actionNode.id,
          class: 'recipe-edge',
          // 默认虚线 + 流动动画（有向图）
          animated: true,
          style: { stroke: '#409eff', strokeWidth: 2, strokeDasharray: '8 4' },
          // 输入边箭头蓝色（指向加工节点）
          markerEnd: { type: MarkerType.ArrowClosed, color: '#409eff', width: 16, height: 16 },
          unit,
          label: edgeLabel(s.quantity ?? 1, unit),
          labelStyle: { fill: '#409eff', fontWeight: 700, fontSize: '12px' },
          labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
        }
      }),
      {
        id: genId('e'),
        source: actionNode.id,
        target: outputNode.id,
        class: 'recipe-edge',
        // 默认虚线 + 流动动画（有向图）
        animated: true,
        style: { stroke: '#e6a23c', strokeWidth: 2, strokeDasharray: '8 4' },
        // 输出边箭头橙色（从加工节点指出），单位 = 加工节点输出单位
        markerEnd: { type: MarkerType.ArrowClosed, color: '#e6a23c', width: 16, height: 16 },
        unit: actionOutUnit,
        label: edgeLabel(outQty, actionOutUnit),
        labelStyle: { fill: '#e6a23c', fontWeight: 700, fontSize: '12px' },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
      },
    ]

    addNodes(createdNodes as any)
    addEdges(newEdges as any)

    // 同步本地 ref
    nodes.value = [...nodes.value, ...(createdNodes as any[])] as RecipeNode[]
    edges.value = [...edges.value, ...(newEdges as any[])] as RecipeEdge[]

    persist()
    return { inputNodes: inputSources.map((s) => s.node), actionNode, outputNode }
  }

  /** 删除节点（连同其相关连线） */
  function deleteNode(id: string) {
    const related = edges.value.filter((e) => e.source === id || e.target === id)
    related.forEach((e) => removeEdges(e.id))
    removeNodes(id)
    nodes.value = nodes.value.filter((n) => n.id !== id)
    edges.value = edges.value.filter((e) => e.source !== id && e.target !== id)
    persist()
  }

  /** 复制节点（仅复制物品/动作节点本身，不复制连线） */
  function duplicateNode(id: string) {
    const node = findNode(id)
    if (!node) return
    const copy: RecipeNode = {
      ...node,
      id: genId(node.type === 'item' ? 'item' : 'action'),
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      data: JSON.parse(JSON.stringify(node.data)) as RecipeNodeData,
    } as RecipeNode
    addNodes([copy] as any)
    nodes.value = [...nodes.value, copy]
    persist()
    return copy
  }

  /**
   * 环检测：DFS 检测有向图中是否存在环（循环依赖）。
   * 返回参与循环的节点 id 数组；无环返回空数组。
   */
  function detectCycle(): string[] {
    const adj = new Map<string, string[]>()
    nodes.value.forEach((n) => adj.set(n.id, []))
    edges.value.forEach((e) => {
      if (adj.has(e.source)) adj.get(e.source)!.push(e.target)
    })

    const WHITE = 0
    const GRAY = 1
    const BLACK = 2
    const color = new Map<string, number>()
    nodes.value.forEach((n) => color.set(n.id, WHITE))
    const stack: string[] = []
    const cycleNodes = new Set<string>()

    let found = false

    function dfs(u: string) {
      if (found) return
      color.set(u, GRAY)
      stack.push(u)
      for (const v of adj.get(u) ?? []) {
        if (found) return
        const c = color.get(v)
        if (c === GRAY) {
          // 找到回边 -> 环
          found = true
          const idx = stack.indexOf(v)
          for (let i = idx; i < stack.length; i++) cycleNodes.add(stack[i])
          return
        } else if (c === WHITE) {
          dfs(v)
        }
      }
      stack.pop()
      color.set(u, BLACK)
    }

    for (const n of nodes.value) {
      if (color.get(n.id) === WHITE) dfs(n.id)
      if (found) break
    }

    return [...cycleNodes]
  }

  /** 导出 JSON：包含完整画布状态（节点位置 / 连线 / 视图缩放） */
  function exportJSON(): RecipeGraphData {
    return snapshot()
  }

  /** 导入 JSON（覆盖当前图）。persist=false 时不重复写回（用于启动时从存储恢复） */
  function importJSON(data: RecipeGraphData, persistFlag = true) {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      throw new Error('JSON 结构不合法：缺少 nodes / edges')
    }
    const { mergeImported } = useActionTypes()
    mergeImported(data.actions)
    setNodes(data.nodes)
    // 统一为有向图 + 默认虚线动画：导入数据若缺少箭头/样式/动画，自动补齐（按方向着色）
    const decoratedEdges = data.edges.map((e) => {
      const srcNode = findNode(e.source)
      const isOut = srcNode?.data?.kind === 'action'
      const color = isOut ? '#e6a23c' : '#409eff'
      // 单位：优先保留导入的手工单位，否则按继承规则解析（默认「个」）
      const unit = (e as any).unit || resolveUnit(e.source, e.target)
      return {
        ...e,
        unit,
        // 无单位数据自动补 label（含继承单位）；已有单位的数据保留原 label
        label: (e as any).unit ? (e as any).label : edgeLabel(qtyFromLabel((e as any).label), unit),
        animated: e.animated ?? true,
        style: e.style ?? { stroke: color, strokeWidth: 2, strokeDasharray: '8 4' },
        markerEnd:
          e.markerEnd ?? {
            type: MarkerType.ArrowClosed,
            color,
            width: 16,
            height: 16,
          },
      }
    }) as RecipeEdge[]
    setEdges(decoratedEdges)
    nodes.value = JSON.parse(JSON.stringify(data.nodes))
    edges.value = JSON.parse(JSON.stringify(decoratedEdges))
    // 完整还原画布视图（平移 / 缩放）；旧版数据无 viewport 时保持默认视图
    if (data.viewport && typeof data.viewport.zoom === 'number') {
      setViewport({ x: data.viewport.x, y: data.viewport.y, zoom: data.viewport.zoom })
    }
    if (persistFlag) persist()
  }

  /**
   * 配方追踪：计算「要产出 targetQty 个目标产物」时，各基本原料的需求量。
   * 基本原料 = 不通过任何加工节点生成（没有任何 action→item 输入边）的源头物品节点。
   * 沿上游按「item → action → item」反向传播，加工节点的输入 / 输出数量取自各连线 label（×N）。
   * 图中存在环时，环上节点的需求传播会截断，但不会死循环。
   */
  function computeBasicMaterials(targetId: string, targetQty: number): MaterialDemand[] {
    const qty = Math.max(1, Math.floor(targetQty || 1))
    const allEdges = getEdges.value as any[]
    const nodeMap = new Map<string, any>()
    getNodes.value.forEach((n) => nodeMap.set(n.id, n))

    // item 的输入边（action → item）与 action 的输入边（item → action）
    const itemIn = new Map<string, any[]>()
    const actionIn = new Map<string, any[]>()

    const push = (m: Map<string, any[]>, k: string, v: any) => {
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(v)
    }

    for (const e of allEdges) {
      const src = nodeMap.get(e.source)
      const tgt = nodeMap.get(e.target)
      if (!src || !tgt) continue
      if (src.data?.kind === 'action' && tgt.data?.kind === 'item') {
        push(itemIn, e.target, e)
      } else if (src.data?.kind === 'item' && tgt.data?.kind === 'action') {
        push(actionIn, e.target, e)
      }
    }

    const demand = new Map<string, number>() // item 需求量
    const demandUnit = new Map<string, string>() // item -> 单位（取自输入连线）
    demand.set(targetId, qty)

    // DFS 后序收集上游 item（含 target），order 中上游在前
    const visited = new Set<string>()
    const order: string[] = []
    const dfs = (itemId: string) => {
      if (visited.has(itemId)) return
      visited.add(itemId)
      for (const edge of itemIn.get(itemId) ?? []) {
        for (const ae of actionIn.get(edge.source) ?? []) dfs(ae.source)
      }
      order.push(itemId)
    }
    dfs(targetId)

    // 第一遍（下游 → 上游）：计算每个加工节点的总生产次数（共享时取最大值）
    const timesMap = new Map<string, number>()
    for (const itemId of [...order].reverse()) {
      const d = demand.get(itemId) ?? 0
      for (const edge of itemIn.get(itemId) ?? []) {
        const actId = edge.source
        const outQty = qtyFromLabel(edge.label)
        const t = Math.ceil(d / outQty)
        timesMap.set(actId, Math.max(timesMap.get(actId) ?? 0, t))
      }
    }

    // 第二遍：按生产次数累加上游原料需求
    for (const itemId of [...order].reverse()) {
      for (const edge of itemIn.get(itemId) ?? []) {
        const actId = edge.source
        const t = timesMap.get(actId) ?? 0
        for (const ae of actionIn.get(actId) ?? []) {
          const need = t * qtyFromLabel(ae.label)
          demand.set(ae.source, (demand.get(ae.source) ?? 0) + need)
          const u = unitFromLabel(ae.label)
          if (u && !demandUnit.has(ae.source)) demandUnit.set(ae.source, u)
        }
      }
    }

    // 仅保留基本原料（无 action → item 输入边）
    const result: MaterialDemand[] = []
    for (const [id, need] of demand) {
      const n = nodeMap.get(id)
      if (!n || n.data?.kind !== 'item') continue
      if ((itemIn.get(id)?.length ?? 0) === 0) {
        result.push({
          id,
          name: (n.data as any).label ?? id,
          qty: need,
          unit: demandUnit.get(id),
        })
      }
    }
    return result
  }

  /** 列出当前画布上已有的物品节点（供配方录入「选择已有产物」使用） */
  function getItemNodes() {
    return nodes.value
      .filter((n) => n.data?.kind === 'item')
      .map((n) => ({
        id: n.id,
        name: (n.data as any).label ?? '',
        image: (n.data as any).image ?? '',
      }))
  }

  /** 列出当前画布上已有的加工动作节点（供配方录入「选择已有加工节点」使用） */
  function getActionNodes() {
    return nodes.value
      .filter((n) => n.data?.kind === 'action')
      .map((n) => ({
        id: n.id,
        name: (n.data as any).label ?? '',
        action: (n.data as any).action ?? '',
        image: (n.data as any).image ?? '',
        outputUnit: (n.data as any)?.outputUnit || DEFAULT_UNIT,
      }))
  }

  return {
    nodes,
    edges,
    updateEdge,
    createItemNode,
    createActionNode,
    addRecipeFromForm,
    deleteNode,
    duplicateNode,
    detectCycle,
    exportJSON,
    importJSON,
    persist,
    loadFromStorage,
    computeBasicMaterials,
    resolveUnit,
    edgeLabel,
    syncUnitFromAction,
    refreshEdgeUnits,
    getItemNodes,
    getActionNodes,
  }
}
