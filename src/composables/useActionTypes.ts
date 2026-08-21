import { ref } from 'vue'
import { DEFAULT_ACTIONS } from '../types'

/**
 * useActionTypes —— 管理加工动作类型列表（内置 + 用户自定义）。
 * 自定义动作持久化到 localStorage，并随配方 JSON 导入/导出携带。
 */
const STORAGE_KEY = 'vflow_action_types'

// 全局共享的自定义动作（不含内置动作）
const customActions = ref<string[]>(loadFromStorage())

function loadFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return []
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customActions.value))
  } catch {
    /* ignore */
  }
}

export function useActionTypes() {
  /** 全部可选动作 = 内置 + 自定义（去重保序） */
  function allActions(): string[] {
    const set = new Set<string>([...DEFAULT_ACTIONS, ...customActions.value])
    return [...set]
  }

  /** 新增一个自定义动作（已存在则忽略） */
  function addAction(name: string) {
    const v = (name || '').trim()
    if (!v) return
    if (allActions().includes(v)) return
    customActions.value = [...customActions.value, v]
    persist()
  }

  /** 删除一个自定义动作（内置动作不可删） */
  function removeAction(name: string) {
    if (DEFAULT_ACTIONS.includes(name)) return
    customActions.value = customActions.value.filter((a) => a !== name)
    persist()
  }

  /** 用导入的 actions 合并（自定义部分覆盖，保留未出现的） */
  function mergeImported(actions: string[] | undefined) {
    if (!Array.isArray(actions)) return
    const merged = new Set<string>([...customActions.value, ...actions])
    customActions.value = [...merged].filter((a) => !DEFAULT_ACTIONS.includes(a))
    persist()
  }

  return { customActions, allActions, addAction, removeAction, mergeImported }
}
