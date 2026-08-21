import type { Node, Edge } from '@vue-flow/core'

/** 内置加工动作（默认值，用户可在此基础上自定义扩展） */
export const DEFAULT_ACTIONS: string[] = ['合成', '搅拌', '切割', '熔炼']

/** 节点种类 */
export type NodeKind = 'item' | 'action'

/** 物品节点数据 */
export interface ItemNodeData {
  kind: 'item'
  label: string
  /** 图片 dataURL 或 url，空字符串表示仅文字 */
  image: string
  /** 显示模式：仅图片 / 图片+文字 */
  showLabel: boolean
  /** 数量（如需要多份原料） */
  quantity: number
}

/** 加工动作节点数据 */
export interface ActionNodeData {
  kind: 'action'
  label: string
  action: string
  /** 加工动作图标图片（dataURL 或 url，空字符串表示用默认图标） */
  image: string
}

export type RecipeNodeData = ItemNodeData | ActionNodeData

export type RecipeNode = Node<RecipeNodeData>
export type RecipeEdge = Edge

/** 表单录入：一条配方 */
export interface RecipeForm {
  inputs: { name: string; image?: string; quantity?: number; /** 若来自已有产物节点，记录其节点 id */ refId?: string }[]
  action: string
  /** 加工动作图标图片 */
  actionImage?: string
  /**
   * 若选择了画布中已有的加工节点，记录其节点 id。
   * 配合 reuseActionImage 决定是复用该节点还是新建同名独立节点。
   */
  actionRefId?: string
  /** 是否复用所选加工节点的图片（true=复用；false=新建节点需用户上传图片） */
  reuseActionImage?: boolean
  output: { name: string; image?: string; /** 输出产物数量 */
  quantity?: number }
}

/** 画布视图状态（平移偏移 + 缩放），用于完整还原画布状态 */
export interface ViewportState {
  x: number
  y: number
  zoom: number
}

/** 导出 / 导入 的 JSON 结构 */
export interface RecipeGraphData {
  version: string
  /** 自定义加工动作列表（与内置动作合并后作为可选动作） */
  actions: string[]
  nodes: RecipeNode[]
  edges: RecipeEdge[]
  /** 画布视图状态（平移 / 缩放）。旧版本数据无此字段时为可选 */
  viewport?: ViewportState
}
