import { onBeforeUnmount } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useRecipeGraph } from './useRecipeGraph'

/**
 * useCanvasShortcuts —— 画布快捷键。
 *
 * - 左键拖拽：平移画布（Vue Flow 默认）
 * - 右键点击空白画布：选中全部节点
 * - Delete / Backspace：删除选中的节点或连线
 * - Ctrl/Cmd + A：全选画布节点（及连线）
 * - Ctrl/Cmd + C：复制选中节点   Ctrl/Cmd + V：粘贴（偏移放置）
 * - Esc：取消选中 / 取消高亮
 */
export function useCanvasShortcuts(opts: { onSelectAll: () => void; onEscape: () => void }) {
  const { getNodes, getEdges, removeNodes, removeEdges, updateNode, updateEdge } = useVueFlow()
  const { duplicateNode, persist } = useRecipeGraph()

  let clipboard: { id: string }[] = []

  function isTyping(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
  }

  function onKey(e: KeyboardEvent) {
    if (isTyping(e.target)) return

    const mod = e.ctrlKey || e.metaKey

    // Ctrl/Cmd + A 全选
    if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault()
      getNodes.value.forEach((n) => updateNode(n.id, { selected: true } as any))
      getEdges.value.forEach((ed) => updateEdge(ed as any, { selected: true } as any))
      return
    }

    // Ctrl/Cmd + C 复制选中节点
    if (mod && (e.key === 'c' || e.key === 'C')) {
      const sel = getNodes.value.filter((n) => n.selected)
      clipboard = sel.map((n) => ({ id: n.id }))
      return
    }

    // Ctrl/Cmd + V 粘贴（复制节点偏移放置）
    if (mod && (e.key === 'v' || e.key === 'V')) {
      if (clipboard.length) {
        clipboard.forEach((c) => duplicateNode(c.id))
        persist()
      }
      return
    }

    // Delete / Backspace 删除选中
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const selNodes = getNodes.value.filter((n) => n.selected)
      const selEdges = getEdges.value.filter((ed) => ed.selected)
      if (selNodes.length) removeNodes(selNodes.map((n) => n.id))
      if (selEdges.length) removeEdges(selEdges.map((ed) => ed.id))
      if (selNodes.length || selEdges.length) persist()
      return
    }

    // Esc 取消选中 + 取消高亮
    if (e.key === 'Escape') {
      getNodes.value.forEach((n) => updateNode(n.id, { selected: false } as any))
      getEdges.value.forEach((ed) => updateEdge(ed as any, { selected: false } as any))
      opts.onEscape()
    }
  }

  function onContextMenu(e: MouseEvent) {
    // 右键点击画布空白区域 -> 全选
    const target = e.target as HTMLElement
    if (target && target.classList.contains('vue-flow__pane')) {
      e.preventDefault()
      opts.onSelectAll()
    }
  }

  window.addEventListener('keydown', onKey)
  window.addEventListener('contextmenu', onContextMenu)
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('contextmenu', onContextMenu)
  })
}
