import { DEFAULT_UNIT } from "../types";

/** 源配方 JSON 中的单个原料 / 产物（物品或流体） */
export interface SourceIngredient {
  type: string;
  id: string;
  quantity: number;
}

/** 源配方 JSON 中的一条配方 */
export interface SourceRecipe {
  category?: string;
  name: string;
  inputs: SourceIngredient[];
  output: SourceIngredient;
  heated?: boolean;
  timeTicks?: number;
  timeSeconds?: number;
}

/** 源配方 JSON 解析结果（一台机器及其全部配方） */
export interface SourceMachine {
  machine: string;
  description: string;
  recipes: SourceRecipe[];
}

/**
 * 解析 Minecraft 配方 JSON（如「大容量发酵罐配方.json」）。
 * 支持结构：{ "机器名": { "说明": "...", "配方列表": [ { "配方名", "分类", "输入", "输出", "加热", "处理时间(秒)" } ] } }
 */
export function parseSourceRecipe(json: unknown): SourceMachine | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const machineKey = Object.keys(root).find(
    (k) =>
      root[k] &&
      typeof root[k] === "object" &&
      Array.isArray((root[k] as any)["配方列表"]),
  );
  if (!machineKey) return null;
  const body = root[machineKey] as Record<string, any>;
  const list = (body["配方列表"] ?? []) as Record<string, any>[];
  const toIngredient = (raw: any): SourceIngredient | null => {
    if (!raw || typeof raw !== "object") return null;
    const id = String(raw["id"] ?? "");
    if (!id) return null;
    return {
      type: String(raw["类型"] ?? "物品"),
      id,
      quantity: Math.max(1, Number(raw["数量"] ?? 1) || 1),
    };
  };
  const recipes: SourceRecipe[] = list
    .map((r): SourceRecipe | null => {
      const inputs = (Array.isArray(r["输入"]) ? r["输入"] : [])
        .map(toIngredient)
        .filter((x): x is SourceIngredient => !!x);
      const output = toIngredient(r["输出"]);
      if (!inputs.length || !output || !r["配方名"]) return null;
      return {
        category: r["分类"] ? String(r["分类"]) : undefined,
        name: String(r["配方名"]),
        inputs,
        output,
        heated: Boolean(r["加热"]),
        timeTicks: r["处理时间(ticks)"]
          ? Number(r["处理时间(ticks)"])
          : undefined,
        timeSeconds: r["处理时间(秒)"]
          ? Number(r["处理时间(秒)"])
          : undefined,
      };
    })
    .filter((x): x is SourceRecipe => !!x);
  if (!recipes.length) return null;
  return {
    machine: machineKey,
    description: String(body["说明"] ?? ""),
    recipes,
  };
}

/** 将 id 转成可读名称（取冒号后段，下划线转空格） */
export function nameFromId(id: string): string {
  const short = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return short.replace(/_/g, " ");
}

/** 根据原料/产物类型得到单位（流体→ml，其他→默认单位） */
export function unitOfIngredient(ing: SourceIngredient): string {
  return ing.type === "流体" ? "ml" : DEFAULT_UNIT;
}
