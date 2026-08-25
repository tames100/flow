import { ref } from 'vue'

export type ContextMenuTarget =
  | { type: 'canvas' }
  | { type: 'node'; nodeId: string; nodeKind: 'item' | 'action' }
  | { type: 'multi-node'; nodeIds: string[]; allKind: 'item' | 'action' | 'mixed' }

/** 全局右键菜单状态（单例） */
const visible = ref(false)
const x = ref(0)
const y = ref(0)
const target = ref<ContextMenuTarget>({ type: 'canvas' })

export function useContextMenu() {
  function open(e: MouseEvent, t: ContextMenuTarget) {
    e.preventDefault()
    e.stopPropagation()
    x.value = e.clientX
    y.value = e.clientY
    target.value = t
    visible.value = true
  }

  function close() {
    visible.value = false
  }

  return { visible, x, y, target, open, close }
}
