import type { Node, Edge } from "@vue-flow/core";

/** 内置加工动作（默认值，用户可在此基础上自定义扩展） */
export const DEFAULT_ACTIONS: string[] = ["合成", "搅拌", "切割", "熔炼"];

/** 默认数量单位 */
export const DEFAULT_UNIT = "个";

/** 内置附加操作 / 附加条件（默认值，用户可在此基础上自定义扩展），如「发酵 -> 需要加热」 */
export const DEFAULT_EXTRAS: string[] = [
  "无需特殊条件",
  "需要加热",
  "需要恒温",
  "需要避光",
  "需要密封",
];

/** 内置数量单位（默认值，画布上出现过的单位会自动并入下拉选项） */
export const DEFAULT_UNITS: string[] = ["个", "ml", "组", "份", "kg"];

/** 节点种类 */
export type NodeKind = "item" | "action";

/**
 * 物品属性：图标 + 文字 + 值 + 说明。
 * 其中图标与说明非必选；在配方追踪中可选中某个属性名，展示其沿加工链的属性值计算过程。
 */
export interface ItemAttribute {
  /** 属性图标（emoji 或图片 url，可选） */
  icon?: string;
  /** 属性名称（如「金币」） */
  name: string;
  /** 属性值（数字或文本，如 2 / 4） */
  value: string | number;
  /** 属性说明（可选） */
  desc?: string;
}

/**
 * 分组：用户自定义的逻辑集合（如「水果」「蔬菜」「绿色」）。
 * 一个节点可归属多个分组；分组可携带若干预设属性，
 * 物品节点选择某分组的属性后会**复制为节点自有属性**（独立可编辑，之后改分组不影响已拷贝的属性）。
 * 加工节点加入分组仅保留归属（groupIds），不继承分组属性。
 */
export interface RecipeGroup {
  id: string;
  name: string;
  /** 分组预设属性（图标 + 名称 + 值 + 说明，可选） */
  attributes?: ItemAttribute[];
}

/** 物品节点数据 */
export interface ItemNodeData {
  kind: "item";
  label: string;
  /** 图片 dataURL 或 url，空字符串表示仅文字 */
  image: string;
  /** 显示模式：仅图片 / 图片+文字 */
  showLabel: boolean;
  /** 数量（如需要多份原料） */
  quantity: number;
  /** 节点解释（展示在节点卡片上） */
  description?: string;
  /** 物品属性列表（图标 + 名称 + 值 + 说明，图标与说明非必选） */
  attributes?: ItemAttribute[];
  /** 所属分组 id 列表（一个节点可归属多个分组） */
  groupIds?: string[];
}

/** 加工动作节点数据 */
export interface ActionNodeData {
  kind: "action";
  label: string;
  action: string;
  /** 加工动作图标图片（dataURL 或 url，空字符串表示用默认图标） */
  image: string;
  /** 节点解释（展示在节点卡片上） */
  description?: string;
  /** 输出单位（加工节点产出物的单位，下游加工节点的输入单位自动继承该值） */
  outputUnit?: string;
  /** 附加操作 / 附加条件（如「发酵」是否需要加热），支持用户自定义 */
  extra?: string;
  /** 所属分组 id 列表（仅保留归属，不继承分组属性） */
  groupIds?: string[];
}

export type RecipeNodeData = ItemNodeData | ActionNodeData;

export type RecipeNode = Node<RecipeNodeData>;
/** 画布连线：unit 为数量单位（默认「个」，遵循加工节点输出单位继承） */
export type RecipeEdge = Edge & { unit?: string };

/** 配方追踪：某种基本原料的需求量 */
export interface MaterialDemand {
  /** 基本原料节点 id */
  id: string;
  name: string;
  /** 需求数量 */
  qty: number;
  /** 单位（取自输入连线的单位，可能为空） */
  unit?: string;
}

/** 表单录入：一条配方 */
export interface RecipeForm {
  inputs: {
    name: string;
    image?: string;
    quantity?: number;
    /** 输入物品解释 */
    description?: string;
    /** 输入物品属性（图标 + 名称 + 值 + 说明，图标与说明非必选） */
    attributes?: ItemAttribute[];
    /** 若来自已有产物节点，记录其节点 id */
    refId?: string;
    /** 该输入物品所属分组 id 列表（一个物品可归属多个分组） */
    groupIds?: string[];
  }[];
  action: string;
  /** 加工动作图标图片 */
  actionImage?: string;
  /** 加工动作解释 */
  actionDescription?: string;
  /** 加工节点输出单位（其产出物的单位，下游输入单位自动继承） */
  actionOutputUnit?: string;
  /** 加工附加操作 / 附加条件（如「发酵」是否需要加热），支持用户自定义 */
  actionExtra?: string;
  /**
   * 若选择了画布中已有的加工节点，记录其节点 id。
   * 配合 reuseActionImage 决定是复用该节点还是新建同名独立节点。
   */
  actionRefId?: string;
  /** 是否复用所选加工节点的图片（true=复用；false=新建节点需用户上传图片） */
  reuseActionImage?: boolean;
  /** 加工节点所属分组 id 列表（仅保留归属，不继承分组属性） */
  actionGroupIds?: string[];
  /**
   * 输出产物（至少一个，可多个）。
   * 多个输入 / 多个输出均映射到同一个加工动作节点，动作与每个输出各连一条边。
   */
  outputs: {
    name: string;
    image?: string;
    /** 输出产物数量 */
    quantity?: number;
    /** 输出产物解释 */
    description?: string;
    /** 输出产物属性（图标 + 名称 + 值 + 说明，图标与说明非必选） */
    attributes?: ItemAttribute[];
    /** 该输出产物所属分组 id 列表（一个产物可归属多个分组） */
    groupIds?: string[];
  }[];
}

/** 画布视图状态（平移偏移 + 缩放），用于完整还原画布状态 */
export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

/** 导出 / 导入 的 JSON 结构 */
export interface RecipeGraphData {
  version: string;
  /** 自定义加工动作列表（与内置动作合并后作为可选动作） */
  actions: string[];
  nodes: RecipeNode[];
  edges: RecipeEdge[];
  /** 画布视图状态（平移 / 缩放）。旧版本数据无此字段时为可选 */
  viewport?: ViewportState;
  /** 用户自定义分组列表（随配方 JSON 一起导入/导出） */
  groups?: RecipeGroup[];
}
