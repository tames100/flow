import { ref, shallowRef } from "vue";
import { useVueFlow, MarkerType } from "@vue-flow/core";
import type {
  ActionNodeData,
  ItemNodeData,
  ItemAttribute,
  MaterialDemand,
  RecipeEdge,
  RecipeForm,
  RecipeGraphData,
  RecipeNode,
  RecipeNodeData,
  CanvasData,
  MultiCanvasGraphData,
} from "../types";
import { DEFAULT_UNIT } from "../types";
import { useActionTypes } from "./useActionTypes";
import { useGroups } from "./useGroups";
import {
  parseSourceRecipe,
  nameFromId,
  unitOfIngredient,
  type SourceIngredient,
  type SourceRecipe,
  type SourceMachine,
} from "./useSourceRecipe";

export type { SourceIngredient, SourceRecipe, SourceMachine };

const STORAGE_KEY = "vflow_graph_data";

let nodeSeq = 1;
let canvasSeq = 1;

function genCanvasId(): string {
  return `cv_${Date.now().toString(36)}_${canvasSeq++}`;
}

/** 属性追踪明细行（某个基本原料对目标属性值的贡献） */
export interface AttributeTraceItem {
  id: string;
  name: string;
  qty: number;
  unit?: string;
  attr?: ItemAttribute;
  /** 数值贡献 = 属性值 × 需求量；属性值非数字时为 null */
  contribution: number | null;
}

/** 属性追踪计算结果 */
export interface AttributeTraceResult {
  name: string;
  /** 目标产物自身定义的同名属性 */
  targetAttr?: ItemAttribute;
  /** 各基本原料贡献明细 */
  items: AttributeTraceItem[];
  /** 计算合计（全部贡献可数值化时有值） */
  total: number | null;
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${nodeSeq++}`;
}

/** 解析连线 label 中的数量（如 ×5 ml → 5；无 label 视为 1） */
function qtyFromLabel(label: unknown): number {
  const m = /×(\d+)/.exec(String(label ?? ""));
  return m ? +m[1] : 1;
}

/** 解析连线 label 中的单位（如 ×5 ml → 'ml'；无单位返回空串） */
function unitFromLabel(label: unknown): string {
  const m = /×\d+\s*(\S+)/.exec(String(label ?? ""));
  return m ? m[1] : "";
}

/** 生成连线 label：数量 + 单位（有单位或数量 >1 时显示） */
function edgeLabel(qty: number, unit: string): string {
  return qty > 1 || unit ? `×${qty}${unit ? " " + unit : ""}` : "";
}

const nodes = ref<any[]>([]);
const edges = ref<any[]>([]);

// 多画布状态（模块级单例）：每个画布独立持有自己的节点 / 连线 / 视图；
// 加工动作类型池（useActionTypes）与分组（useGroups）为全局共享，不属于单个画布。
// 使用 shallowRef：画布内部数据以不可变方式整体替换，无需深层响应式，避免与 RecipeNode 复杂泛型叠加导致类型实例化过深。
const canvases = shallowRef<CanvasData[]>([]);
const activeCanvasId = ref<string>("");

export function useRecipeGraph() {
  const {
    addNodes,
    addEdges,
    removeNodes,
    removeEdges,
    setNodes,
    setEdges,
    findNode,
    updateNode,
    updateEdge,
    getNodes,
    getEdges,
    viewport,
    setViewport,
  } = useVueFlow();
  const { allActions, mergeImported: mergeImportedActions } = useActionTypes();
  const { allGroups, mergeImported: mergeImportedGroups } = useGroups();

  /** 从 VueFlow store 序列化节点：仅保留业务字段，保证 position 始终是最新值 */
  function serializeNodes() {
    return getNodes.value.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      data: JSON.parse(JSON.stringify(n.data ?? {})),
    }));
  }

  /** 从 VueFlow store 序列化连线：仅保留业务字段 */
  function serializeEdges() {
    return getEdges.value.map((e) => {
      const o: Record<string, unknown> = {
        id: e.id,
        source: e.source,
        target: e.target,
      };
      if (e.sourceHandle) o.sourceHandle = e.sourceHandle;
      if (e.targetHandle) o.targetHandle = e.targetHandle;
      if (e.type) o.type = e.type;
      if (e.class) o.class = e.class;
      if (e.animated) o.animated = e.animated;
      if (e.style) o.style = JSON.parse(JSON.stringify(e.style));
      if (e.markerEnd) o.markerEnd = JSON.parse(JSON.stringify(e.markerEnd));
      if (e.label) o.label = e.label;
      if (e.labelStyle) o.labelStyle = e.labelStyle;
      if (e.labelBgStyle) o.labelBgStyle = e.labelBgStyle;
      if (e.labelBgPadding) o.labelBgPadding = e.labelBgPadding;
      if (e.labelBgBorderRadius) o.labelBgBorderRadius = e.labelBgBorderRadius;
      // 数量单位（如 '个' / 'ml' / '组'）
      const unit = (e as any).unit;
      if (unit) o.unit = unit;
      return o;
    });
  }

  /** 生成当前活动画布的完整快照：节点（含最新位置）+ 连线 + 视图状态（平移/缩放）+ 全局分组/动作 */
  function snapshot(): RecipeGraphData {
    return {
      version: "1.0",
      actions: allActions(),
      groups: allGroups(),
      nodes: serializeNodes() as unknown as RecipeNode[],
      edges: serializeEdges() as unknown as RecipeEdge[],
      viewport: {
        x: viewport.value.x,
        y: viewport.value.y,
        zoom: viewport.value.zoom,
      },
    };
  }

  /** 按 id 查找画布 */
  function findCanvas(id: string): CanvasData | undefined {
    return canvases.value.find((c) => c.id === id);
  }

  /**
   * 自动持久化：从 VueFlow store 读取最新活动画布状态（节点位置 / 连线 / 视图缩放），
   * 同步到 canvases 中对应条目，并以多画布格式写入 localStorage。
   * 任何修改（拖拽、增删、连线、数量编辑）后调用均可保证位置是最新的。
   */
  function persist() {
    try {
      const sn = serializeNodes() as unknown as RecipeNode[];
      const se = serializeEdges() as unknown as RecipeEdge[];
      const vp = {
        x: viewport.value.x,
        y: viewport.value.y,
        zoom: viewport.value.zoom,
      };
      // 1) 同步活动画布条目（保留原 name，仅更新 nodes/edges/viewport）
      const idx = canvases.value.findIndex(
        (c) => c.id === activeCanvasId.value,
      );
      if (idx >= 0) {
        canvases.value[idx] = {
          ...canvases.value[idx],
          nodes: JSON.parse(JSON.stringify(sn)),
          edges: JSON.parse(JSON.stringify(se)),
          viewport: vp,
        };
      }
      // 2) 写入多画布格式
      const payload: MultiCanvasGraphData = {
        version: "2.0",
        canvases: JSON.parse(JSON.stringify(canvases.value)),
        actions: allActions(),
        groups: allGroups(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      // 3) 同步本地副本，保证 getItemNodes / detectCycle / 属性面板数量判断与画布一致
      nodes.value = JSON.parse(JSON.stringify(sn));
      edges.value = JSON.parse(JSON.stringify(se));
    } catch (e) {
      // localStorage 容量超限等异常时静默忽略
      console.warn("自动保存失败", e);
    }
  }

  /**
   * 把单个画布的数据载入 VueFlow store（不合并 actions / groups，不替换 canvases 列表）。
   * 载入时会装饰连线：补齐箭头 / 样式 / 动画 / 单位（沿用导入旧数据的装饰逻辑）。
   */
  function loadCanvasToStore(cv: CanvasData, persistFlag = true) {
    setNodes(cv.nodes ?? []);
    const decoratedEdges = (cv.edges ?? []).map((e) => {
      const srcNode = findNode(e.source);
      const isOut = srcNode?.data?.kind === "action";
      const color = isOut ? "#e6a23c" : "#409eff";
      const unit = (e as any).unit || resolveUnit(e.source, e.target);
      return {
        ...e,
        unit,
        label: (e as any).unit
          ? (e as any).label
          : edgeLabel(qtyFromLabel((e as any).label), unit),
        animated: e.animated ?? true,
        style: e.style ?? {
          stroke: color,
          strokeWidth: 2,
          strokeDasharray: "8 4",
        },
        markerEnd: e.markerEnd ?? {
          type: MarkerType.ArrowClosed,
          color,
          width: 16,
          height: 16,
        },
      };
    }) as RecipeEdge[];
    setEdges(decoratedEdges);
    nodes.value = JSON.parse(JSON.stringify(cv.nodes ?? []));
    edges.value = JSON.parse(JSON.stringify(decoratedEdges));
    if (cv.viewport && typeof cv.viewport.zoom === "number") {
      setViewport({
        x: cv.viewport.x,
        y: cv.viewport.y,
        zoom: cv.viewport.zoom,
      });
    }
    if (persistFlag) persist();
  }

  /** 初始化一个默认空画布（无数据时使用） */
  function initDefaultCanvas(): CanvasData {
    const cv: CanvasData = {
      id: genCanvasId(),
      name: "画布1",
      nodes: [],
      edges: [],
    };
    canvases.value = [cv];
    activeCanvasId.value = cv.id;
    return cv;
  }

  /**
   * 从 localStorage 恢复全部画布状态（应用启动时调用一次）。
   * 兼容三种数据：多画布格式（v2.0）/ 旧版单画布格式（v1.0）/ 无数据。
   */
  function loadFromStorage(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        initDefaultCanvas();
        return false;
      }
      const data = JSON.parse(raw);
      // 多画布格式
      if (data && Array.isArray(data.canvases)) {
        mergeImportedActions(data.actions);
        mergeImportedGroups(data.groups);
        const list: CanvasData[] = data.canvases
          .map((c: any) => ({
            id: c.id || genCanvasId(),
            name: c.name || "画布",
            nodes: Array.isArray(c.nodes) ? c.nodes : [],
            edges: Array.isArray(c.edges) ? c.edges : [],
            viewport: c.viewport,
          }))
          .filter((c: CanvasData) => c);
        if (!list.length) list.push(initDefaultCanvas());
        canvases.value = list;
        const ac =
          data.activeCanvasId && findCanvas(data.activeCanvasId)
            ? data.activeCanvasId
            : list[0].id;
        activeCanvasId.value = ac;
        loadCanvasToStore(findCanvas(ac)!, false);
        return true;
      }
      // 旧版单画布格式 → 迁移为一个画布
      if (data && Array.isArray(data.nodes) && Array.isArray(data.edges)) {
        mergeImportedActions(data.actions);
        mergeImportedGroups(data.groups);
        const cv: CanvasData = {
          id: genCanvasId(),
          name: "画布1",
          nodes: data.nodes,
          edges: data.edges,
          viewport: data.viewport,
        };
        canvases.value = [cv];
        activeCanvasId.value = cv.id;
        loadCanvasToStore(cv, false);
        return true;
      }
      initDefaultCanvas();
      return false;
    } catch {
      initDefaultCanvas();
      return false;
    }
  }

  // ---- 多画布管理 ----

  /** 新增一个空白画布并切换过去。返回新画布 id。 */
  function addCanvas(name?: string): string {
    // 先保存当前活动画布的最新状态
    persist();
    // 生成不重名的画布名
    const used = new Set(canvases.value.map((c) => c.name));
    let n = canvases.value.length + 1;
    let nm = (name || "").trim() || `画布${n}`;
    while (used.has(nm)) {
      n++;
      nm = `画布${n}`;
    }
    const cv: CanvasData = {
      id: genCanvasId(),
      name: nm,
      nodes: [],
      edges: [],
    };
    canvases.value = [...canvases.value, cv];
    // 清空 VueFlow store 供新画布使用，并重置视图
    setNodes([]);
    setEdges([]);
    nodes.value = [];
    edges.value = [];
    setViewport({ x: 0, y: 0, zoom: 0.9 });
    activeCanvasId.value = cv.id;
    persist();
    return cv.id;
  }

  /**
   * 删除一个画布。至少保留一个画布（最后一个不可删）。
   * 若删除的是活动画布，自动切换到相邻画布。
   */
  function removeCanvas(id: string): boolean {
    if (canvases.value.length <= 1) return false;
    const idx = canvases.value.findIndex((c) => c.id === id);
    if (idx < 0) return false;
    // 先保存当前活动画布最新状态
    persist();
    canvases.value = canvases.value.filter((c) => c.id !== id);
    if (activeCanvasId.value === id) {
      const nextIdx = Math.min(idx, canvases.value.length - 1);
      const next = canvases.value[nextIdx];
      activeCanvasId.value = next.id;
      loadCanvasToStore(next, false);
    }
    persist();
    return true;
  }

  /** 重命名画布（空名忽略） */
  function renameCanvas(id: string, name: string) {
    const cv = findCanvas(id);
    if (!cv) return;
    const nm = name.trim();
    if (!nm) return;
    if (cv.name === nm) return;
    cv.name = nm;
    canvases.value = [...canvases.value];
    persist();
  }

  /** 切换活动画布（先保存当前画布状态，再载入目标画布） */
  function switchCanvas(id: string) {
    if (id === activeCanvasId.value) return;
    const target = findCanvas(id);
    if (!target) return;
    persist();
    activeCanvasId.value = id;
    loadCanvasToStore(target, false);
  }

  /** 拖拽调整画布顺序（from → to，均基于当前下标） */
  function reorderCanvases(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const len = canvases.value.length;
    if (fromIndex < 0 || fromIndex >= len) return;
    if (toIndex < 0 || toIndex >= len) return;
    const arr = [...canvases.value];
    const [moved] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, moved);
    canvases.value = arr;
    persist();
  }

  /** 创建一个物品节点 */
  function createItemNode(
    label: string,
    image = "",
    position = { x: 0, y: 0 },
    showLabel = true,
    quantity = 1,
    description = "",
    attributes: ItemAttribute[] = [],
    groupIds: string[] = [],
  ): RecipeNode {
    return {
      id: genId("item"),
      type: "item",
      position,
      data: {
        kind: "item",
        label,
        image,
        showLabel,
        quantity: quantity || 1,
        description: description || undefined,
        attributes: attributes.length ? attributes : undefined,
        groupIds: groupIds.length ? groupIds : undefined,
      },
    };
  }

  /** 创建一个动作节点 */
  function createActionNode(
    action: string,
    position = { x: 0, y: 0 },
    image = "",
    description = "",
    extra = "",
    outputUnit = DEFAULT_UNIT,
    groupIds: string[] = [],
  ): RecipeNode {
    return {
      id: genId("action"),
      type: "action",
      position,
      data: {
        kind: "action",
        label: action,
        action,
        image,
        description: description || undefined,
        extra: extra || undefined,
        outputUnit: outputUnit || DEFAULT_UNIT,
        groupIds: groupIds.length ? groupIds : undefined,
      },
    };
  }

  /**
   * 解析一条连线（由其 source / target 节点）应使用的单位，遵循继承规则：
   * - 输出边（action → item）：取加工节点的「输出单位」（默认「个」）。
   * - 输入边（item → action）：继承生成该物品节点的上游加工节点输出单位；若物品是基本原料（无上游加工）则默认「个」。
   */
  function resolveUnit(sourceId: string, _targetId: string): string {
    const src = findNode(sourceId);
    if (src?.data?.kind === "action") {
      return (src.data.outputUnit as string) || DEFAULT_UNIT;
    }
    // 输入边：找生成该物品的加工节点
    const producer = getEdges.value.find(
      (e) =>
        e.target === sourceId && findNode(e.source)?.data?.kind === "action",
    );
    if (producer) {
      return (
        (findNode(producer.source)?.data as any)?.outputUnit || DEFAULT_UNIT
      );
    }
    return DEFAULT_UNIT;
  }

  /** 按继承规则重算所有连线的单位并同步 label（用于导入旧数据等场景） */
  function refreshEdgeUnits() {
    getEdges.value.forEach((e) => {
      const unit = resolveUnit(e.source, e.target);
      Object.assign(e, { unit, label: edgeLabel(qtyFromLabel(e.label), unit) });
    });
  }

  /**
   * 加工节点「输出单位」变更后，同步继承关系：
   * - 该加工节点的所有输出边（action → item）单位 = 新输出单位；
   * - 以这些产物为输入的下游加工节点，其输入边单位同样继承为新输出单位。
   * 例如：搅拌输出单位改为 ml → 「搅拌→B」输出边与「B→注液」输入边都变为 ml。
   */
  function syncUnitFromAction(actionId: string) {
    const act = findNode(actionId);
    if (!act) return;
    const unit = (act.data as any)?.outputUnit || DEFAULT_UNIT;
    getEdges.value.forEach((e) => {
      if (e.source !== actionId) return;
      const src = findNode(e.source);
      if (src?.data?.kind !== "action") return;
      Object.assign(e, { unit, label: edgeLabel(qtyFromLabel(e.label), unit) });
      // 下游加工节点的输入边继承同一单位
      getEdges.value.forEach((de) => {
        if (
          de.source === e.target &&
          findNode(de.target)?.data?.kind === "action"
        ) {
          Object.assign(de, {
            unit,
            label: edgeLabel(qtyFromLabel(de.label), unit),
          });
        }
      });
    });
    persist();
  }

  /**
   * 根据表单生成「输入物品 -> 动作节点 -> 输出物品（可多个）」的节点与连线。
   * - 若输入项选择了「已有产物」(refId)，则直接复用该节点作为来源（不新建重复物品）。
   * - 数量展示在「输入 -> 动作」的连线上（数量为 1 时不显示）。
   * - 布局：输入在左列、动作在中间列、输出在右列（按行纵向排列，动作纵向居中）。
   */
  /**
   * 计算新节点的放置锚点：取当前画布中最右下（x+y 最大）的节点，
   * 新配方在其右下方生成，避免远离当前内容区域。
   */
  function getPlacementAnchor(): { x: number; y: number } {
    const ns = getNodes.value;
    if (!ns.length) return { x: 80, y: 80 };
    let anchor = ns[0];
    for (const n of ns) {
      if (n.position.x + n.position.y > anchor.position.x + anchor.position.y) {
        anchor = n;
      }
    }
    return { x: anchor.position.x, y: anchor.position.y };
  }

  function addRecipeFromForm(form: RecipeForm) {
    const anchor = getPlacementAnchor();
    const baseX = anchor.x + 340;
    const baseY = anchor.y;

    const createdNodes: RecipeNode[] = [];

    // 解析每个输入：复用已有节点 or 新建
    const inputSources = form.inputs.map((inp, i) => {
      if (inp.refId) {
        const existing = findNode(inp.refId);
        if (existing) {
          return { node: existing, quantity: inp.quantity ?? 1 };
        }
      }
      const n = createItemNode(
        inp.name,
        inp.image ?? "",
        { x: baseX, y: baseY + i * 90 },
        true,
        1,
        inp.description,
        inp.attributes ?? [],
        inp.groupIds ?? [],
      );
      createdNodes.push(n);
      return { node: n, quantity: inp.quantity ?? 1 };
    });

    // 输出节点（至少一个，可多个）；若选择了已有物品节点则复用（不新建）
    const outputNodes = form.outputs.map((out, j) => {
      if (out.refId) {
        const existing = findNode(out.refId);
        if (existing) {
          // 复用已有节点，仅用其 id + 表单数量生成输出边
          return { id: existing.id, data: { quantity: out.quantity ?? 1 } };
        }
      }
      const n = createItemNode(
        out.name,
        out.image ?? "",
        { x: baseX + 460, y: baseY + j * 90 },
        true,
        1,
        out.description,
        out.attributes ?? [],
        out.groupIds ?? [],
      );
      // 输出数量记录在输出物品节点上（用于动作 -> 输出 连线展示）
      (n.data as any).quantity = out.quantity ?? 1;
      createdNodes.push(n);
      return n;
    });

    // 加工动作节点：若选择了已有加工节点且勾选复用图片 -> 复用该节点；否则新建
    // 动作节点在中间列，纵向居中对齐输入 / 输出的整体高度
    const rowCount = Math.max(inputSources.length, outputNodes.length);
    const actionY = baseY + ((rowCount - 1) * 90) / 2;
    let actionNode: any = null;
    if (form.actionRefId && form.reuseActionImage) {
      const existing = findNode(form.actionRefId);
      if (existing) {
        // 复制加工节点到新配方链（新 id，相同数据），而不是链接到原节点
        const copyData = JSON.parse(JSON.stringify(existing.data));
        if (form.actionExtra) copyData.extra = form.actionExtra;
        if (form.actionGroupIds) copyData.groupIds = form.actionGroupIds;
        actionNode = {
          id: genId("action"),
          type: "action",
          position: { x: baseX + 220, y: actionY },
          data: copyData,
        };
        createdNodes.push(actionNode);
      }
    }
    if (!actionNode) {
      actionNode = createActionNode(
        form.action,
        { x: baseX + 220, y: actionY },
        form.actionImage ?? "",
        form.actionDescription,
        form.actionExtra,
        form.actionOutputUnit,
        form.actionGroupIds ?? [],
      );
      createdNodes.push(actionNode);
    }

    const actionOutUnit = (actionNode.data as any)?.outputUnit || DEFAULT_UNIT;

    const newEdges: RecipeEdge[] = [
      // 输入边：单位优先用表单指定值，否则遵循继承规则（基本原料默认「个」）
      ...inputSources.map((s, i) => {
        const formUnit = form.inputs[i]?.unit;
        const unit = formUnit || resolveUnit(s.node.id, actionNode.id);
        return {
          id: genId("e"),
          source: s.node.id,
          target: actionNode.id,
          class: "recipe-edge",
          // 默认虚线 + 流动动画（有向图）
          animated: true,
          style: { stroke: "#409eff", strokeWidth: 2, strokeDasharray: "8 4" },
          // 输入边箭头蓝色（指向加工节点）
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#409eff",
            width: 16,
            height: 16,
          },
          unit,
          label: edgeLabel(s.quantity ?? 1, unit),
          labelStyle: { fill: "#409eff", fontWeight: 700, fontSize: "12px" },
          labelBgStyle: { fill: "#ffffff", fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
        };
      }),
      // 输出边：动作节点 -> 每个输出节点（橙色，单位 = 加工节点输出单位）
      ...outputNodes.map((outputNode) => {
        const outQty = (outputNode.data as any).quantity ?? 1;
        return {
          id: genId("e"),
          source: actionNode.id,
          target: outputNode.id,
          class: "recipe-edge",
          // 默认虚线 + 流动动画（有向图）
          animated: true,
          style: { stroke: "#e6a23c", strokeWidth: 2, strokeDasharray: "8 4" },
          // 输出边箭头橙色（从加工节点指出），单位 = 加工节点输出单位
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#e6a23c",
            width: 16,
            height: 16,
          },
          unit: actionOutUnit,
          label: edgeLabel(outQty, actionOutUnit),
          labelStyle: { fill: "#e6a23c", fontWeight: 700, fontSize: "12px" },
          labelBgStyle: { fill: "#ffffff", fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
        };
      }),
    ];

    addNodes(createdNodes as any);
    addEdges(newEdges as any);

    // 同步本地 ref
    nodes.value = [...nodes.value, ...(createdNodes as any[])] as RecipeNode[];
    edges.value = [...edges.value, ...(newEdges as any[])] as RecipeEdge[];

    persist();
    return {
      inputNodes: inputSources.map((s) => s.node),
      actionNode,
      outputNodes,
    };
  }

  /**
   * 从加工动作节点反向解析配方数据。
   * 收集该 action 的所有输入/输出边及对应物品节点，组装为可编辑的 RecipeForm。
   * 用于「修改配方」流程：把画布上的现有配方加载到 FormPanel 中重新编辑。
   * 返回的 form 中：
   *   - inputs[].refId / outputs[].refId 为对应物品节点 id（提交时优先复用而非新建）
   *   - actionRefId 为 actionId 本身（提交时复用该 action 节点）
   */
  function loadRecipeFromAction(actionId: string): RecipeForm | null {
    const action = findNode(actionId);
    if (!action || action.data?.kind !== "action") return null;
    const aData = action.data as ActionNodeData;

    const inEdges = (getEdges.value as any[]).filter(
      (e) => e.target === actionId,
    );
    const outEdges = (getEdges.value as any[]).filter(
      (e) => e.source === actionId,
    );

    const inputs = inEdges.map((e: any) => {
      const n = findNode(e.source);
      const d = (n?.data ?? {}) as ItemNodeData;
      return {
        name: d.label ?? "",
        image: d.image ?? "",
        quantity: qtyFromLabel(e.label),
        unit: (e.unit as string) ?? resolveUnit(e.source, actionId),
        description: d.description ?? "",
        attributes: d.attributes
          ? (JSON.parse(JSON.stringify(d.attributes)) as ItemAttribute[])
          : [],
        refId: n?.id,
        groupIds: d.groupIds ? [...d.groupIds] : [],
      };
    });

    const outputs = outEdges.map((e: any) => {
      const n = findNode(e.target);
      const d = (n?.data ?? {}) as ItemNodeData;
      return {
        name: d.label ?? "",
        image: d.image ?? "",
        quantity: qtyFromLabel(e.label),
        description: d.description ?? "",
        attributes: d.attributes
          ? (JSON.parse(JSON.stringify(d.attributes)) as ItemAttribute[])
          : [],
        refId: n?.id,
        groupIds: d.groupIds ? [...d.groupIds] : [],
      };
    });

    return {
      inputs: inputs.length
        ? inputs
        : [
            {
              name: "",
              image: "",
              quantity: 1,
              unit: DEFAULT_UNIT,
              description: "",
              attributes: [],
              groupIds: [],
            },
          ],
      action: aData.action ?? aData.label ?? "",
      actionImage: aData.image ?? "",
      actionDescription: aData.description ?? "",
      actionExtra: aData.extra ?? "",
      actionOutputUnit: aData.outputUnit || DEFAULT_UNIT,
      actionRefId: actionId,
      reuseActionImage: true,
      actionGroupIds: aData.groupIds ? [...aData.groupIds] : [],
      outputs: outputs.length
        ? outputs
        : [
            {
              name: "",
              image: "",
              quantity: 1,
              description: "",
              attributes: [],
              groupIds: [],
            },
          ],
    };
  }

  /**
   * 根据表单增量更新已有加工节点的配方连线与物品节点。
   * - 删除该 action 的所有旧 in/out 连线
   * - 对比新旧输入/输出：refId 命中的复用并更新节点属性；其余按需新建；不再使用的旧物品节点若被其他 action 引用则保留，否则删除
   * - 更新 action 节点本身字段（action/extra/outputUnit/image/description/groupIds）
   * - 重建 in/out 连线（样式与单位继承规则同 addRecipeFromForm）
   */
  function updateRecipeFromForm(actionId: string, form: RecipeForm) {
    const action = findNode(actionId);
    if (!action || action.data?.kind !== "action") {
      throw new Error("加工节点不存在或类型不匹配");
    }

    const oldInEdges = (getEdges.value as any[]).filter(
      (e) => e.target === actionId,
    );
    const oldOutEdges = (getEdges.value as any[]).filter(
      (e) => e.source === actionId,
    );
    const oldInputIds = new Set(oldInEdges.map((e) => e.source));
    const oldOutputIds = new Set(oldOutEdges.map((e) => e.target));

    // 1) 删除所有旧 in/out 连线
    oldInEdges.forEach((e) => removeEdges(e.id));
    oldOutEdges.forEach((e) => removeEdges(e.id));

    // 2) 解析新输入：refId 命中复用并更新，否则新建
    const usedInputIds = new Set<string>();
    const inputSources = form.inputs.map((inp, i) => {
      const reuseId =
        inp.refId && oldInputIds.has(inp.refId) ? inp.refId : undefined;
      if (reuseId) {
        usedInputIds.add(reuseId);
        const existing = findNode(reuseId);
        if (existing) {
          updateNode(reuseId, {
            data: {
              ...existing.data,
              label: inp.name.trim(),
              image: inp.image ?? "",
              description: inp.description ?? undefined,
              attributes: inp.attributes?.length
                ? (JSON.parse(
                    JSON.stringify(inp.attributes),
                  ) as ItemAttribute[])
                : undefined,
              groupIds: inp.groupIds?.length ? [...inp.groupIds] : undefined,
            } as ItemNodeData,
          });
        }
        return {
          node: existing!,
          quantity: inp.quantity ?? 1,
          unit: inp.unit ?? "",
        };
      }
      // 新建输入物品节点（与 addRecipeFromForm 布局无关，位置由新连线的节点偏移决定；这里放在 action 节点左侧偏移）
      const pos = {
        x: action.position.x - 240,
        y: action.position.y + i * 90,
      };
      const n = createItemNode(
        inp.name.trim(),
        inp.image ?? "",
        pos,
        true,
        1,
        inp.description,
        inp.attributes ?? [],
      );
      if (inp.groupIds?.length) (n.data as any).groupIds = [...inp.groupIds];
      addNodes([n as any]);
      return { node: n, quantity: inp.quantity ?? 1, unit: inp.unit ?? "" };
    });

    // 3) 解析新输出：refId 命中复用并更新，否则新建
    const usedOutputIds = new Set<string>();
    const outputNodes = form.outputs.map((out, j) => {
      const reuseId =
        out.refId && oldOutputIds.has(out.refId) ? out.refId : undefined;
      if (reuseId) {
        usedOutputIds.add(reuseId);
        const existing = findNode(reuseId);
        if (existing) {
          updateNode(reuseId, {
            data: {
              ...existing.data,
              label: out.name.trim(),
              image: out.image ?? "",
              description: out.description ?? undefined,
              attributes: out.attributes?.length
                ? (JSON.parse(
                    JSON.stringify(out.attributes),
                  ) as ItemAttribute[])
                : undefined,
              groupIds: out.groupIds?.length ? [...out.groupIds] : undefined,
            } as ItemNodeData,
          });
        }
        return existing!;
      }
      const pos = {
        x: action.position.x + 460,
        y: action.position.y + j * 90,
      };
      const n = createItemNode(
        out.name.trim(),
        out.image ?? "",
        pos,
        true,
        1,
        out.description,
        out.attributes ?? [],
      );
      (n.data as any).quantity = out.quantity ?? 1;
      if (out.groupIds?.length) (n.data as any).groupIds = [...out.groupIds];
      addNodes([n as any]);
      return n;
    });

    // 4) 删除不再使用的旧物品节点（前提：没有被其他 action / 其他连线引用）
    const orphanIds = [...oldInputIds, ...oldOutputIds].filter(
      (id) => !usedInputIds.has(id) && !usedOutputIds.has(id),
    );
    orphanIds.forEach((id) => {
      // 检查是否还有其他连线引用该节点
      const stillReferenced = (getEdges.value as any[]).some(
        (e) => e.source === id || e.target === id,
      );
      if (!stillReferenced) {
        removeNodes(id);
        nodes.value = nodes.value.filter((n) => n.id !== id);
      }
    });

    // 5) 更新 action 节点本身字段
    const nextActionData: ActionNodeData = {
      ...(action.data as ActionNodeData),
      action: form.action,
      label: form.action,
      image: form.actionImage ?? "",
      description: form.actionDescription ?? undefined,
      extra: form.actionExtra ?? undefined,
      outputUnit: form.actionOutputUnit || DEFAULT_UNIT,
      groupIds: form.actionGroupIds?.length
        ? [...form.actionGroupIds]
        : undefined,
    };
    updateNode(actionId, { data: nextActionData as any });

    // 6) 重建 in/out 连线（样式与单位继承规则同 addRecipeFromForm）
    const actionOutUnit = nextActionData.outputUnit || DEFAULT_UNIT;
    const newEdges: RecipeEdge[] = [
      ...inputSources.map((s) => {
        const unit = s.unit || resolveUnit(s.node.id, actionId);
        return {
          id: genId("e"),
          source: s.node.id,
          target: actionId,
          class: "recipe-edge",
          animated: true,
          style: { stroke: "#409eff", strokeWidth: 2, strokeDasharray: "8 4" },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#409eff",
            width: 16,
            height: 16,
          },
          unit,
          label: edgeLabel(s.quantity ?? 1, unit),
          labelStyle: { fill: "#409eff", fontWeight: 700, fontSize: "12px" },
          labelBgStyle: { fill: "#ffffff", fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
        };
      }),
      ...outputNodes.map((outputNode) => {
        const outQty = (outputNode.data as any).quantity ?? 1;
        return {
          id: genId("e"),
          source: actionId,
          target: outputNode.id,
          class: "recipe-edge",
          animated: true,
          style: { stroke: "#e6a23c", strokeWidth: 2, strokeDasharray: "8 4" },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#e6a23c",
            width: 16,
            height: 16,
          },
          unit: actionOutUnit,
          label: edgeLabel(outQty, actionOutUnit),
          labelStyle: { fill: "#e6a23c", fontWeight: 700, fontSize: "12px" },
          labelBgStyle: { fill: "#ffffff", fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
        };
      }),
    ];
    addEdges(newEdges as any);

    // 同步本地 ref 副本（含新增节点 + 删除节点 + action 自身更新）
    nodes.value = JSON.parse(JSON.stringify(serializeNodes()));
    edges.value = JSON.parse(JSON.stringify(serializeEdges()));
    persist();
    return {
      inputNodes: inputSources.map((s) => s.node),
      actionNode: action,
      outputNodes,
    };
  }

  /** 删除节点（连同其相关连线） */
  function deleteNode(id: string) {
    const related = edges.value.filter(
      (e) => e.source === id || e.target === id,
    );
    related.forEach((e) => removeEdges(e.id));
    removeNodes(id);
    nodes.value = nodes.value.filter((n) => n.id !== id);
    edges.value = edges.value.filter((e) => e.source !== id && e.target !== id);
    persist();
  }

  /**
   * 复制节点（仅复制物品/动作节点本身，不复制连线）。
   * 复制除 id 外的所有字段（type / position / data / class / style 等），id 重新生成；
   * 可通过 position 指定副本位置（默认在原节点右下偏移 40px，供 Ctrl+C/V 粘贴使用）。
   */
  function duplicateNode(id: string, position?: { x: number; y: number }) {
    const node = findNode(id);
    if (!node) return;
    const copy: RecipeNode = {
      ...node,
      id: genId(node.type === "item" ? "item" : "action"),
      position: position ?? {
        x: node.position.x + 40,
        y: node.position.y + 40,
      },
      data: JSON.parse(JSON.stringify(node.data)) as RecipeNodeData,
    } as RecipeNode;
    // 清理 Vue Flow 运行时字段，避免副本携带脏状态（选中 / 拖拽中 / 内部缓存）
    const c = copy as any;
    delete c.selected;
    delete c.dragging;
    delete c.positionAbsolute;
    delete c.computedPosition;
    delete c.handleBounds;
    delete c.dimensions;
    delete c.events;
    addNodes([copy] as any);
    nodes.value = [...nodes.value, copy];
    persist();
    return copy;
  }

  /**
   * 环检测：DFS 检测有向图中是否存在环（循环依赖）。
   * 返回参与循环的节点 id 数组；无环返回空数组。
   */
  function detectCycle(): string[] {
    const adj = new Map<string, string[]>();
    nodes.value.forEach((n) => adj.set(n.id, []));
    edges.value.forEach((e) => {
      if (adj.has(e.source)) adj.get(e.source)!.push(e.target);
    });

    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    nodes.value.forEach((n) => color.set(n.id, WHITE));
    const stack: string[] = [];
    const cycleNodes = new Set<string>();

    let found = false;

    function dfs(u: string) {
      if (found) return;
      color.set(u, GRAY);
      stack.push(u);
      for (const v of adj.get(u) ?? []) {
        if (found) return;
        const c = color.get(v);
        if (c === GRAY) {
          // 找到回边 -> 环
          found = true;
          const idx = stack.indexOf(v);
          for (let i = idx; i < stack.length; i++) cycleNodes.add(stack[i]);
          return;
        } else if (c === WHITE) {
          dfs(v);
        }
      }
      stack.pop();
      color.set(u, BLACK);
    }

    for (const n of nodes.value) {
      if (color.get(n.id) === WHITE) dfs(n.id);
      if (found) break;
    }

    return [...cycleNodes];
  }

  /** 导出当前活动画布 JSON（单画布格式，向后兼容 v1.0） */
  function exportJSON(): RecipeGraphData {
    return snapshot();
  }

  /** 导出全部画布 JSON（多画布格式 v2.0，包含全部画布 + 全局动作 / 分组） */
  function exportAllJSON(): MultiCanvasGraphData {
    // 先同步活动画布最新状态到 canvases，再快照
    persist();
    return {
      version: "2.0",
      canvases: JSON.parse(JSON.stringify(canvases.value)),
      actions: allActions(),
      groups: allGroups(),
    };
  }

  /**
   * 导入 JSON（兼容单画布 / 多画布格式）。
   * - 多画布格式（含 canvases 字段）→ 替换全部画布，活动画布切到第一个。
   * - 单画布格式（含 nodes / edges）→ 替换当前活动画布的内容。
   * persist=false 时不重复写回（用于启动时从存储恢复）。
   */
  function importJSON(
    data: RecipeGraphData | MultiCanvasGraphData,
    persistFlag = true,
  ) {
    // 多画布格式
    if (data && Array.isArray((data as MultiCanvasGraphData).canvases)) {
      const multi = data as MultiCanvasGraphData;
      if (!Array.isArray(multi.canvases)) {
        throw new Error("JSON 结构不合法：缺少 canvases");
      }
      mergeImportedActions(multi.actions);
      mergeImportedGroups(multi.groups);
      const list: CanvasData[] = multi.canvases
        .map((c) => ({
          id: c.id || genCanvasId(),
          name: c.name || "画布",
          nodes: Array.isArray(c.nodes) ? c.nodes : [],
          edges: Array.isArray(c.edges) ? c.edges : [],
          viewport: c.viewport,
        }))
        .filter((c) => c);
      if (!list.length) {
        const cv: CanvasData = {
          id: genCanvasId(),
          name: "画布1",
          nodes: [],
          edges: [],
        };
        list.push(cv);
      }
      canvases.value = list;
      activeCanvasId.value = list[0].id;
      loadCanvasToStore(list[0], false);
      if (persistFlag) persist();
      return;
    }
    // 单画布格式 → 替换当前活动画布内容
    const single = data as RecipeGraphData;
    if (
      !single ||
      !Array.isArray(single.nodes) ||
      !Array.isArray(single.edges)
    ) {
      throw new Error("JSON 结构不合法：缺少 nodes / edges");
    }
    mergeImportedActions(single.actions);
    mergeImportedGroups(single.groups);
    // 确保有活动画布
    if (!activeCanvasId.value || !findCanvas(activeCanvasId.value)) {
      const cv: CanvasData = {
        id: genCanvasId(),
        name: "画布1",
        nodes: [],
        edges: [],
      };
      canvases.value = [cv];
      activeCanvasId.value = cv.id;
    }
    // 装饰连线（补齐箭头 / 样式 / 动画 / 单位）
    const decoratedEdges = single.edges.map((e) => {
      const srcNode = single.nodes.find((n) => n.id === e.source);
      const isOut = srcNode?.data?.kind === "action";
      const color = isOut ? "#e6a23c" : "#409eff";
      // 单位：优先保留导入的手工单位，否则默认「个」（此时 store 尚未载入，无法走继承解析）
      const unit = (e as any).unit || DEFAULT_UNIT;
      return {
        ...e,
        unit,
        label: (e as any).unit
          ? (e as any).label
          : edgeLabel(qtyFromLabel((e as any).label), unit),
        animated: e.animated ?? true,
        style: e.style ?? {
          stroke: color,
          strokeWidth: 2,
          strokeDasharray: "8 4",
        },
        markerEnd: e.markerEnd ?? {
          type: MarkerType.ArrowClosed,
          color,
          width: 16,
          height: 16,
        },
      };
    }) as RecipeEdge[];
    // 更新活动画布条目（先写数据，再载入 store；loadCanvasToStore 会再次装饰，但 unit 已存在不会重算）
    const idx = canvases.value.findIndex((c) => c.id === activeCanvasId.value);
    if (idx >= 0) {
      canvases.value[idx] = {
        ...canvases.value[idx],
        nodes: JSON.parse(JSON.stringify(single.nodes)),
        edges: JSON.parse(JSON.stringify(decoratedEdges)),
        viewport: single.viewport
          ? { ...single.viewport }
          : canvases.value[idx].viewport,
      };
      loadCanvasToStore(canvases.value[idx], false);
    }
    if (persistFlag) persist();
  }

  /**
   * 配方追踪：计算「要产出 targetQty 个目标产物」时，各基本原料的需求量。
   * 基本原料 = 不通过任何加工节点生成（没有任何 action→item 输入边）的源头物品节点。
   * 沿上游按「item → action → item」反向传播，加工节点的输入 / 输出数量取自各连线 label（×N）。
   * 采用不动点迭代自目标向上逐层传播需求，直至收敛：
   *  - 某产物被多个加工节点（多条配方）生产时，按单次产量从大到小贪心分配需求，避免重复放大；
   *  - 某加工节点被多个下游共享时，执行次数取各下游需求的最大值（一次产出同时满足所有输出）；
   *  - 图中存在环时由迭代次数上限截断，不会死循环。
   */
  function computeBasicMaterials(
    targetId: string,
    targetQty: number,
  ): MaterialDemand[] {
    const qty = Math.max(1, Math.floor(targetQty || 1));
    const allEdges = getEdges.value as any[];
    const nodeMap = new Map<string, any>();
    getNodes.value.forEach((n) => nodeMap.set(n.id, n));

    // item 的输入边（action → item）与 action 的输入边（item → action）
    const itemIn = new Map<string, any[]>();
    const actionIn = new Map<string, any[]>();

    const push = (m: Map<string, any[]>, k: string, v: any) => {
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(v);
    };

    for (const e of allEdges) {
      const src = nodeMap.get(e.source);
      const tgt = nodeMap.get(e.target);
      if (!src || !tgt) continue;
      if (src.data?.kind === "action" && tgt.data?.kind === "item") {
        push(itemIn, e.target, e);
      } else if (src.data?.kind === "item" && tgt.data?.kind === "action") {
        push(actionIn, e.target, e);
      }
    }

    // 不动点迭代：每轮由当前需求计算各加工节点执行次数，再按次数累加上游原料需求，直至收敛
    let demand = new Map<string, number>([[targetId, qty]]);
    const maxIter = nodeMap.size + 5; // 图中存在环时截断，防止无限循环
    for (let iter = 0; iter < maxIter; iter++) {
      // 第一遍：由各物品的需求计算其生产加工节点需要执行的次数
      const times = new Map<string, number>();
      for (const [itemId, d] of demand) {
        if (d <= 0) continue;
        const prods = itemIn.get(itemId) ?? [];
        if (prods.length === 0) continue; // 基本原料：没有生产者
        // 多个加工节点（多条配方）生产同一物品时：按单次产量从大到小贪心分配需求
        const sorted = [...prods].sort(
          (a, b) => qtyFromLabel(b.label) - qtyFromLabel(a.label),
        );
        let remaining = d;
        for (const edge of sorted) {
          if (remaining <= 0) break;
          const outQty = qtyFromLabel(edge.label);
          const t = Math.ceil(remaining / outQty);
          // 同一加工节点被多个下游共享时取最大执行次数（一次产出同时满足所有输出）
          times.set(edge.source, Math.max(times.get(edge.source) ?? 0, t));
          remaining -= t * outQty;
        }
      }
      // 第二遍：按执行次数累加上游原料需求
      const nextDemand = new Map<string, number>();
      for (const [actId, t] of times) {
        for (const ae of actionIn.get(actId) ?? []) {
          const need = t * qtyFromLabel(ae.label);
          nextDemand.set(ae.source, (nextDemand.get(ae.source) ?? 0) + need);
        }
      }
      nextDemand.set(targetId, qty); // 目标产物的需求量恒定

      // 收敛判断：本轮与上一轮需求一致则停止
      const stable =
        demand.size === nextDemand.size &&
        [...demand].every(([k, v]) => nextDemand.get(k) === v);
      demand = nextDemand;
      if (stable) break;
    }

    // 基本原料作为加工输入的连线单位（如 ×3 ml → 'ml'）
    const demandUnit = new Map<string, string>();
    for (const ae of allEdges) {
      const src = nodeMap.get(ae.source);
      if (!src || src.data?.kind !== "item") continue;
      const u = unitFromLabel(ae.label);
      if (u && !demandUnit.has(ae.source)) demandUnit.set(ae.source, u);
    }

    // 仅保留基本原料（无 action → item 输入边）
    const result: MaterialDemand[] = [];
    for (const [id, need] of demand) {
      const n = nodeMap.get(id);
      if (!n || n.data?.kind !== "item") continue;
      if ((itemIn.get(id)?.length ?? 0) === 0) {
        result.push({
          id,
          name: (n.data as any).label ?? id,
          qty: need,
          unit: demandUnit.get(id),
        });
      }
    }
    return result;
  }

  /** 列出当前画布上已有的物品节点（供配方录入「选择已有产物」使用） */
  function getItemNodes() {
    return nodes.value
      .filter((n) => n.data?.kind === "item")
      .map((n) => ({
        id: n.id,
        name: (n.data as any).label ?? "",
        image: (n.data as any).image ?? "",
      }));
  }

  /** 列出当前画布上已有的加工动作节点（供配方录入「选择已有加工节点」使用） */
  function getActionNodes() {
    return nodes.value
      .filter((n) => n.data?.kind === "action")
      .map((n) => ({
        id: n.id,
        name: (n.data as any).label ?? "",
        action: (n.data as any).action ?? "",
        image: (n.data as any).image ?? "",
        outputUnit: (n.data as any)?.outputUnit || DEFAULT_UNIT,
        extra: (n.data as any)?.extra ?? "",
      }));
  }

  /**
   * 将解析出的源配方导入画布：
   * - 每个配方生成一个动作节点（名称为配方名）与若干输入物品节点、一个输出物品节点；
   * - 相同 id + 类型的物品节点自动复用；
   * - 布局：每个配方横向排布（输入在左、动作居中、输出在右），配方间纵向错开。
   */
  function importSourceRecipes(src: SourceMachine, selectedNames?: string[]) {
    const names =
      selectedNames && selectedNames.length ? new Set(selectedNames) : null;
    const createdNodes: RecipeNode[] = [];
    const newEdges: RecipeEdge[] = [];
    const itemCache = new Map<string, RecipeNode>();

    const anchor = getPlacementAnchor();
    const IN_X = anchor.x + 340;
    const ACTION_X = anchor.x + 600;
    const OUT_X = anchor.x + 860;
    let cursorY = anchor.y;

    const getOrCreateItem = (
      ing: SourceIngredient,
      x: number,
      y: number,
    ): RecipeNode => {
      const key = `${ing.type}:${ing.id}`;
      const cached = itemCache.get(key);
      if (cached) return cached;
      const n = createItemNode(
        nameFromId(ing.id),
        "",
        { x, y },
        true,
        1,
        `来源：${src.machine}\n类型：${ing.type}\n原始 id：${ing.id}`,
        [],
      );
      itemCache.set(key, n);
      createdNodes.push(n);
      return n;
    };

    src.recipes.forEach((recipe) => {
      if (names && !names.has(recipe.name)) return;
      const inCount = recipe.inputs.length;
      const actionY = cursorY + ((Math.max(inCount, 1) - 1) * 90) / 2;
      const actionNode = createActionNode(
        recipe.name,
        { x: ACTION_X, y: actionY },
        "",
        [
          recipe.category ? `分类：${recipe.category}` : "",
          recipe.heated ? "需要加热" : "",
          recipe.timeSeconds ? `处理时间：${recipe.timeSeconds} 秒` : "",
        ]
          .filter(Boolean)
          .join("\n") || undefined,
        "",
        unitOfIngredient(recipe.output),
      );
      createdNodes.push(actionNode);

      // 输入边
      recipe.inputs.forEach((ing, i) => {
        const item = getOrCreateItem(ing, IN_X, cursorY + i * 90);
        const unit = unitOfIngredient(ing);
        newEdges.push({
          id: genId("e"),
          source: item.id,
          target: actionNode.id,
          class: "recipe-edge",
          animated: true,
          style: { stroke: "#409eff", strokeWidth: 2, strokeDasharray: "8 4" },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#409eff",
            width: 16,
            height: 16,
          },
          unit,
          label: edgeLabel(ing.quantity, unit),
          labelStyle: { fill: "#409eff", fontWeight: 700, fontSize: "12px" },
          labelBgStyle: { fill: "#ffffff", fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
        });
      });

      // 输出边
      const out = getOrCreateItem(recipe.output, OUT_X, actionY);
      (out.data as any).quantity = recipe.output.quantity;
      const outUnit = unitOfIngredient(recipe.output);
      newEdges.push({
        id: genId("e"),
        source: actionNode.id,
        target: out.id,
        class: "recipe-edge",
        animated: true,
        style: { stroke: "#e6a23c", strokeWidth: 2, strokeDasharray: "8 4" },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "#e6a23c",
          width: 16,
          height: 16,
        },
        unit: outUnit,
        label: edgeLabel(recipe.output.quantity, outUnit),
        labelStyle: { fill: "#e6a23c", fontWeight: 700, fontSize: "12px" },
        labelBgStyle: { fill: "#ffffff", fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
      });

      cursorY += Math.max(inCount, 1) * 90 + 130;
    });

    if (!createdNodes.length) return { nodes: [], edges: [] };
    addNodes(createdNodes as any);
    addEdges(newEdges as any);
    nodes.value = [...nodes.value, ...(createdNodes as any[])] as RecipeNode[];
    edges.value = [...edges.value, ...(newEdges as any[])] as RecipeEdge[];
    persist();
    return { nodes: createdNodes, edges: newEdges };
  }

  /**
   * 收集目标产物及其全部上游物品节点上出现过的属性名（去重），
   * 供属性面板的「展示属性」多选使用。
   */
  function getTraceAttributeNames(targetId: string): string[] {
    const names = new Set<string>();
    const seen = new Set<string>();
    const stack = [targetId];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const n = findNode(id);
      if (n?.data?.kind !== "item") continue;
      for (const a of (n.data as any)?.attributes ?? []) {
        if (a?.name) names.add(String(a.name));
      }
      // 沿上游收集：生产该物品的动作节点的输入物品
      for (const e of getEdges.value as any[]) {
        if (e.target !== id) continue;
        const producer = findNode(e.source);
        if (producer?.data?.kind !== "action") continue;
        for (const ie of getEdges.value as any[]) {
          if (ie.target === producer.id) stack.push(ie.source);
        }
      }
    }
    return [...names];
  }

  /**
   * 属性追踪计算：目标产物的某个属性，沿上游由各基本原料同名属性推算。
   * 例如：樱桃酒「金币」=4，其基本原料樱桃「金币」=2 × 需求 2 = 4。
   */
  function computeAttributeTrace(
    targetId: string,
    targetQty: number,
    attrName: string,
  ): AttributeTraceResult | null {
    const target = findNode(targetId);
    if (!target) return null;
    const targetAttr = ((target.data as any)?.attributes ?? []).find(
      (a: ItemAttribute) => a.name === attrName,
    ) as ItemAttribute | undefined;
    const materials = computeBasicMaterials(targetId, targetQty);
    const items: AttributeTraceItem[] = materials.map((m) => {
      const n = findNode(m.id);
      const attr = ((n?.data as any)?.attributes ?? []).find(
        (a: ItemAttribute) => a.name === attrName,
      ) as ItemAttribute | undefined;
      let contribution: number | null = null;
      if (attr) {
        const v = Number(attr.value);
        if (Number.isFinite(v)) contribution = v * m.qty;
      }
      return {
        id: m.id,
        name: m.name,
        qty: m.qty,
        unit: m.unit,
        attr,
        contribution,
      };
    });
    const numeric = items.filter((it) => it.contribution !== null);
    const total =
      numeric.length === items.length && items.length > 0
        ? items.reduce((s, it) => s + (it.contribution ?? 0), 0)
        : null;
    return { name: attrName, targetAttr, items, total };
  }

  /** 收集画布上正在使用的所有单位（从连线 unit + 加工节点 outputUnit） */
  function getCanvasUnits(): string[] {
    const set = new Set<string>();
    getEdges.value.forEach((e: any) => {
      const u = e?.unit;
      if (u) set.add(u);
    });
    getNodes.value.forEach((n: any) => {
      const u = n?.data?.outputUnit;
      if (u) set.add(u);
    });
    return [...set];
  }

  /**
   * 分组属性图标/名称变更后，同步到该分组下所有节点的对应属性（仅 icon + name）。
   * 匹配方式：节点属性 name === oldName（用户手动改过名的不同步）。
   */
  function syncGroupAttrToNodes(
    gid: string,
    oldName: string,
    newIcon: string,
    newName: string,
  ) {
    getNodes.value.forEach((n) => {
      const data = n.data as any;
      if (!data?.groupIds?.includes(gid)) return;
      if (!Array.isArray(data?.attributes) || !data.attributes.length) return;
      let changed = false;
      const newAttrs = data.attributes.map((a: any) => {
        if (a.name === oldName) {
          changed = true;
          return { ...a, icon: newIcon, name: newName };
        }
        return a;
      });
      if (changed) {
        updateNode(n.id, { data: { ...data, attributes: newAttrs } });
      }
    });
    persist();
  }

  return {
    nodes,
    edges,
    canvases,
    activeCanvasId,
    updateEdge,
    createItemNode,
    createActionNode,
    addRecipeFromForm,
    loadRecipeFromAction,
    updateRecipeFromForm,
    deleteNode,
    duplicateNode,
    detectCycle,
    exportJSON,
    exportAllJSON,
    importJSON,
    persist,
    loadFromStorage,
    addCanvas,
    removeCanvas,
    renameCanvas,
    switchCanvas,
    reorderCanvases,
    computeBasicMaterials,
    resolveUnit,
    edgeLabel,
    syncUnitFromAction,
    refreshEdgeUnits,
    getItemNodes,
    getActionNodes,
    getCanvasUnits,
    syncGroupAttrToNodes,
    parseSourceRecipe,
    importSourceRecipes,
    getTraceAttributeNames,
    computeAttributeTrace,
    serializeNodes,
  };
}
