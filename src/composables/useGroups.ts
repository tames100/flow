import { ref } from 'vue'
import type { ItemAttribute, RecipeGroup } from '../types'

/**
 * useGroups —— 管理用户自定义分组列表。
 * 分组可携带若干预设属性；物品节点选择某分组的属性后会复制为节点自有属性（独立可编辑）。
 * 分组持久化到 localStorage，并随配方 JSON 导入/导出携带。
 */
const STORAGE_KEY = 'vflow_groups'

let groupSeq = 1
function genId(): string {
  return `grp_${Date.now().toString(36)}_${groupSeq++}`
}

function loadFromStorage(): RecipeGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as RecipeGroup[]
  } catch {
    /* ignore */
  }
  return []
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups.value))
  } catch {
    /* ignore */
  }
}

// 全局共享的分组列表（模块级单例）
const groups = ref<RecipeGroup[]>(loadFromStorage())

export function useGroups() {
  /** 全部分组 */
  function allGroups(): RecipeGroup[] {
    return groups.value
  }

  /** 按 id 取分组 */
  function getGroup(id: string): RecipeGroup | undefined {
    return groups.value.find((g) => g.id === id)
  }

  /** 新增一个分组（返回新分组 id） */
  function addGroup(name: string): string {
    const v = (name || '').trim()
    if (!v) return ''
    const g: RecipeGroup = { id: genId(), name: v, attributes: [] }
    groups.value = [...groups.value, g]
    persist()
    return g.id
  }

  /** 更新分组基础字段（如 name） */
  function updateGroup(id: string, patch: Partial<Pick<RecipeGroup, 'name'>>) {
    const g = getGroup(id)
    if (!g) return
    Object.assign(g, patch)
    groups.value = [...groups.value]
    persist()
  }

  /** 删除一个分组（节点上的 groupIds 引用不做清理，渲染时自动忽略无效 id） */
  function removeGroup(id: string) {
    groups.value = groups.value.filter((g) => g.id !== id)
    persist()
  }

  /** 给分组追加一个属性（返回新属性在分组中的索引） */
  function addAttr(gid: string, attr: ItemAttribute): number {
    const g = getGroup(gid)
    if (!g) return -1
    if (!g.attributes) g.attributes = []
    g.attributes.push({ ...attr })
    groups.value = [...groups.value]
    persist()
    return g.attributes.length - 1
  }

  /** 删除分组内指定索引的属性 */
  function removeAttr(gid: string, idx: number) {
    const g = getGroup(gid)
    if (!g || !g.attributes) return
    g.attributes.splice(idx, 1)
    groups.value = [...groups.value]
    persist()
  }

  /** 更新分组内指定索引的属性字段 */
  function updateAttr(gid: string, idx: number, patch: Partial<ItemAttribute>) {
    const g = getGroup(gid)
    if (!g || !g.attributes || !g.attributes[idx]) return
    Object.assign(g.attributes[idx], patch)
    groups.value = [...groups.value]
    persist()
  }

  /**
   * 用导入的 groups 合并（按 id 去重，保留全部出现过的分组）。
   * 用于导入配方 JSON 时同步分组列表。
   */
  function mergeImported(imported: RecipeGroup[] | undefined) {
    if (!Array.isArray(imported)) return
    const map = new Map<string, RecipeGroup>()
    groups.value.forEach((g) => map.set(g.id, g))
    imported.forEach((g) => {
      if (!g || !g.id) return
      map.set(g.id, g)
    })
    groups.value = [...map.values()]
    persist()
  }

  return {
    groups,
    allGroups,
    getGroup,
    addGroup,
    updateGroup,
    removeGroup,
    addAttr,
    removeAttr,
    updateAttr,
    mergeImported,
  }
}
