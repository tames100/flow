import { ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import type { RecipeEdge, RecipeNode } from '../types'

/** 记录高亮前的连线动画状态，清除高亮时恢复（避免用户手动开启的动画被永久关闭） */
const savedAnimated = new Map<string, boolean>()

/**
 * useRecipeHighlight —— 配方链高亮逻辑（单独抽出的 composable）。
 *
 * 核心交互：点击任意【物品节点】，递归向上遍历整张 DAG，
 * 找到该节点完整上游所有依赖（追溯到最顶层原始原料节点），
 * 高亮这条配方链上的所有节点与连线，其余置灰。
 * 点击画布空白区域取消高亮。
 */
export function useRecipeHighlight() {
  const { getNodes, getEdges, updateNode, onPaneClick, findNode } = useVueFlow()

  /** 当前高亮的根节点 id（被点击的节点） */
  const activeNodeId = ref<string | null>(null)
  const isHighlighting = ref(false)

  /**
   * 从目标节点出发，沿入边递归收集其全部上游祖先节点 id。
   * 使用 visited 集合防止 DAG 中多路径汇聚导致的重复遍历。
   */
  function collectUpstream(targetId: string, edges: RecipeEdge[]): Set<string> {
    const upstream = new Set<string>()
    const incoming = new Map<string, string[]>()
    edges.forEach((e) => {
      if (!incoming.has(e.target)) incoming.set(e.target, [])
      incoming.get(e.target)!.push(e.source)
    })

    const stack = [targetId]
    while (stack.length) {
      const cur = stack.pop()!
      for (const src of incoming.get(cur) ?? []) {
        if (!upstream.has(src)) {
          upstream.add(src)
          stack.push(src)
        }
      }
    }
    return upstream
  }

  /** 计算需要高亮的节点与连线 id 集合 */
  function computeHighlightSet(targetId: string, edges: RecipeEdge[]): {
    nodeIds: Set<string>
    edgeIds: Set<string>
  } {
    const all = collectUpstream(targetId, edges)
    all.add(targetId) // 包含点击节点自身

    // 高亮的连线：两端都在高亮节点集合内的边
    const edgeIds = new Set<string>()
    edges.forEach((e) => {
      if (all.has(e.source) && all.has(e.target)) edgeIds.add(e.id)
    })
    return { nodeIds: all, edgeIds }
  }

  /** 应用高亮：设置节点/连线 class */
  function applyHighlight(nodeIds: Set<string>, edgeIds: Set<string>) {
    getNodes.value.forEach((n: RecipeNode) => {
      const highlighted = nodeIds.has(n.id)
      updateNode(n.id, {
        class: highlighted ? 'highlighted' : 'dimmed',
        // 防止置灰节点拦截点击
        selectable: true,
      } as any)
    })
    getEdges.value.forEach((e: RecipeEdge) => {
      const highlighted = edgeIds.has(e.id)
      // 记录高亮前的动画状态（仅首次）
      if (!savedAnimated.has(e.id)) savedAnimated.set(e.id, !!e.animated)
      // 直接修改响应式连线对象，class 即时生效：
      // 高亮链上的边开流动动画；其余无关边停止动画并置灰
      Object.assign(e as any, {
        class: highlighted ? 'recipe-edge highlighted' : 'recipe-edge dimmed',
        animated: highlighted,
      })
    })
  }

  /** 清除高亮：恢复默认 class 与用户设置的动画状态 */
  function clearHighlight() {
    activeNodeId.value = null
    isHighlighting.value = false
    getNodes.value.forEach((n: RecipeNode) => {
      updateNode(n.id, { class: '' } as any)
    })
    getEdges.value.forEach((e: RecipeEdge) => {
      Object.assign(e as any, {
        class: 'recipe-edge',
        animated: savedAnimated.get(e.id) ?? false,
      })
    })
    savedAnimated.clear()
  }

  /** 点击某个节点触发高亮 */
  function highlightFromNode(nodeId: string) {
    const node = findNode(nodeId)
    if (!node) return
    const { nodeIds, edgeIds } = computeHighlightSet(nodeId, getEdges.value as RecipeEdge[])
    applyHighlight(nodeIds, edgeIds)
    activeNodeId.value = nodeId
    isHighlighting.value = true
  }

  // 点击画布空白处取消高亮
  onPaneClick(() => clearHighlight())

  return {
    activeNodeId,
    isHighlighting,
    highlightFromNode,
    clearHighlight,
  }
}
