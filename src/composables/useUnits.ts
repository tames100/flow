import { ref } from 'vue'
import { DEFAULT_UNITS } from '../types'

/**
 * useUnits —— 管理可选单位列表（内置 + 用户自定义 + 画布使用中）。
 * 用户可隐藏不需要的内置单位（「个」除外，始终保留）；隐藏后若画布上仍在使用则仍展示。
 * 自定义单位持久化到 localStorage。
 */
const STORAGE_KEY = 'vflow_units'
const HIDDEN_KEY = 'vflow_units_hidden'

function loadCustom(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return []
}

function loadHidden(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return []
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customUnits.value))
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(hiddenUnits.value))
  } catch {
    /* ignore */
  }
}

// 全局共享（模块级单例）
const customUnits = ref<string[]>(loadCustom())
const hiddenUnits = ref<string[]>(loadHidden())

export function useUnits() {
  /**
   * 全部可选单位 = 内置 + 自定义 - 隐藏 + 画布使用中的（即使被隐藏也展示）
   * 「个」始终保留。
   * @param extra 画布上正在使用的单位（从 edges / action 节点收集）
   */
  function allUnits(extra: string[] = []): string[] {
    const set = new Set<string>([...DEFAULT_UNITS, ...customUnits.value])
    hiddenUnits.value.forEach((u) => set.delete(u))
    set.add('个')
    extra.forEach((u) => u && set.add(u))
    return [...set]
  }

  /** 新增一个自定义单位（已存在则忽略） */
  function addUnit(name: string) {
    const v = (name || '').trim()
    if (!v) return
    if (allUnits().includes(v)) return
    customUnits.value = [...customUnits.value, v]
    hiddenUnits.value = hiddenUnits.value.filter((u) => u !== v)
    persist()
  }

  /** 删除/隐藏一个单位（「个」不可删除；画布正在使用的不允许隐藏） */
  function removeUnit(name: string, canvasUnits: string[] = []): boolean {
    if (name === '个') {
      ElMessage.warning('「个」是基本单位，不可删除')
      return false
    }
    if (canvasUnits.includes(name)) {
      ElMessage.warning(`单位「${name}」正在画布上使用，无法删除`)
      return false
    }
    if (!hiddenUnits.value.includes(name)) {
      hiddenUnits.value = [...hiddenUnits.value, name]
    }
    customUnits.value = customUnits.value.filter((u) => u !== name)
    persist()
    return true
  }

  /** 用导入的单位合并（仅同步自定义部分） */
  function mergeImported(units: string[] | undefined) {
    if (!Array.isArray(units)) return
    const merged = new Set<string>([...customUnits.value, ...units])
    customUnits.value = [...merged].filter((u) => !DEFAULT_UNITS.includes(u) && !hiddenUnits.value.includes(u))
    persist()
  }

  return { customUnits, hiddenUnits, allUnits, addUnit, removeUnit, mergeImported }
}
