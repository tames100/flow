import type { Node, Edge } from '@vue-flow/core'

/** 加工动作类型 */
export type ActionType = '合成' | '搅拌' | '切割' | '熔炼'

export const ACTION_TYPES: ActionType[] = ['合成', '搅拌', '切割', '熔炼']

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
}

/** 加工动作节点数据 */
export interface ActionNodeData {
  kind: 'action'
  label: ActionType
  action: ActionType
}

export type RecipeNodeData = ItemNodeData | ActionNodeData

export type RecipeNode = Node<RecipeNodeData>
export type RecipeEdge = Edge

/** 表单录入：一条配方 */
export interface RecipeForm {
  inputs: { name: string; image?: string }[]
  action: ActionType
  output: { name: string; image?: string }
}

/** 导出 / 导入 的 JSON 结构 */
export interface RecipeGraphData {
  version: string
  nodes: RecipeNode[]
  edges: RecipeEdge[]
}
