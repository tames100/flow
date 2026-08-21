import { ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import type {
  RecipeEdge,
  RecipeForm,
  RecipeGraphData,
  RecipeNode,
  RecipeNodeData,
} from '../types'
import { useActionTypes } from './useActionTypes'

const STORAGE_KEY = 'vflow_graph_data'

let nodeSeq = 1

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${nodeSeq++}`
}

const nodes = ref<any[]>([])
const edges = ref<any[]>([])

export function useRecipeGraph() {
  const { addNodes, addEdges, removeNodes, removeEdges, setNodes, setEdges, findNode } =
    useVueFlow()
  const { allActions } = useActionTypes()

  /** 自动持久化：任何修改后写入 localStorage */
  function persist() {
    try {
      const payload: RecipeGraphData = {
        version: '1.0',
        actions: allActions(),
        nodes: JSON.parse(JSON.stringify(nodes.value)),
        edges: JSON.parse(JSON.stringify(edges.value)),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch (e) {
      // localStorage 容量超限等异常时静默忽略
      console.warn('自动保存失败', e)
    }
  }

  /** 从 localStorage 恢复（应用启动时调用一次） */
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
  ): RecipeNode {
    return {
      id: genId('item'),
      type: 'item',
      position,
      data: { kind: 'item', label, image, showLabel, quantity: quantity || 1 },
    }
  }

  /** 创建一个动作节点 */
  function createActionNode(
    action: string,
    position = { x: 0, y: 0 },
    image = '',
  ): RecipeNode {
    return {
      id: genId('action'),
      type: 'action',
      position,
      data: { kind: 'action', label: action, action, image },
    }
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
      )
      createdNodes.push(n)
      return { node: n, quantity: inp.quantity ?? 1 }
    })

    const actionNode = createActionNode(
      form.action,
      {
        x: baseX + 220,
        y: baseY + ((inputSources.length - 1) * 90) / 2,
      },
      form.actionImage ?? '',
    )
    createdNodes.push(actionNode)

    const outputNode = createItemNode(form.output.name, form.output.image ?? '', {
      x: baseX + 460,
      y: baseY + ((inputSources.length - 1) * 90) / 2,
    })
    createdNodes.push(outputNode)

    const newEdges: RecipeEdge[] = [
      ...inputSources.map((s) => ({
        id: genId('e'),
        source: s.node.id,
        target: actionNode.id,
        class: 'recipe-edge',
        label: s.quantity > 1 ? `×${s.quantity}` : '',
        labelStyle: { fill: '#409eff', fontWeight: 700, fontSize: '12px' },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
      })),
      {
        id: genId('e'),
        source: actionNode.id,
        target: outputNode.id,
        class: 'recipe-edge',
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

  /** 导出 JSON */
  function exportJSON(): RecipeGraphData {
    const { allActions } = useActionTypes()
    return {
      version: '1.0',
      actions: allActions(),
      nodes: JSON.parse(JSON.stringify(nodes.value)),
      edges: JSON.parse(JSON.stringify(edges.value)),
    }
  }

  /** 导入 JSON（覆盖当前图）。persist=false 时不重复写回（用于启动时从存储恢复） */
  function importJSON(data: RecipeGraphData, persistFlag = true) {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      throw new Error('JSON 结构不合法：缺少 nodes / edges')
    }
    const { mergeImported } = useActionTypes()
    mergeImported(data.actions)
    setNodes(data.nodes)
    setEdges(data.edges)
    nodes.value = JSON.parse(JSON.stringify(data.nodes))
    edges.value = JSON.parse(JSON.stringify(data.edges))
    if (persistFlag) persist()
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

  return {
    nodes,
    edges,
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
    getItemNodes,
  }
}
