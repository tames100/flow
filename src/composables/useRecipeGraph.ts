import { ref } from "vue";
import { useVueFlow, MarkerType } from "@vue-flow/core";
import type {
  ItemAttribute,
  MaterialDemand,
  RecipeEdge,
  RecipeForm,
  RecipeGraphData,
  RecipeNode,
  RecipeNodeData,
} from "../types";
import { DEFAULT_UNIT } from "../types";
import { useActionTypes } from "./useActionTypes";
import { useGroups } from "./useGroups";

const STORAGE_KEY = "vflow_graph_data";

let nodeSeq = 1;

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

export function useRecipeGraph() {
  const {
    addNodes,
    addEdges,
    removeNodes,
    removeEdges,
    setNodes,
    setEdges,
    findNode,
    updateEdge,
    getNodes,
    getEdges,
    viewport,
    setViewport,
  } = useVueFlow();
  const { allActions } = useActionTypes();
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

  /** 生成当前画布的完整快照：节点（含最新位置）+ 连线 + 视图状态（平移/缩放）+ 分组 */
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

  /**
   * 自动持久化：从 VueFlow store 读取最新画布状态（节点位置 / 连线 / 视图缩放）写入 localStorage。
   * 任何修改（拖拽、增删、连线、数量编辑）后调用均可保证位置是最新的。
   */
  function persist() {
    try {
      const payload = snapshot();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      // 同步本地副本，保证 getItemNodes / detectCycle / 属性面板数量判断与画布一致
      nodes.value = JSON.parse(JSON.stringify(payload.nodes));
      edges.value = JSON.parse(JSON.stringify(payload.edges));
    } catch (e) {
      // localStorage 容量超限等异常时静默忽略
      console.warn("自动保存失败", e);
    }
  }

  /** 从 localStorage 恢复完整画布状态（含节点位置与视图，应用启动时调用一次） */
  function loadFromStorage(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw) as RecipeGraphData;
      if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges))
        return false;
      importJSON(data, false);
      return true;
    } catch {
      return false;
    }
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

    // 输出节点（至少一个，可多个）
    const outputNodes = form.outputs.map((out, j) => {
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

  /** 导出 JSON：包含完整画布状态（节点位置 / 连线 / 视图缩放） */
  function exportJSON(): RecipeGraphData {
    return snapshot();
  }

  /** 导入 JSON（覆盖当前图）。persist=false 时不重复写回（用于启动时从存储恢复） */
  function importJSON(data: RecipeGraphData, persistFlag = true) {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      throw new Error("JSON 结构不合法：缺少 nodes / edges");
    }
    const { mergeImported } = useActionTypes();
    mergeImported(data.actions);
    mergeImportedGroups(data.groups);
    setNodes(data.nodes);
    // 统一为有向图 + 默认虚线动画：导入数据若缺少箭头/样式/动画，自动补齐（按方向着色）
    const decoratedEdges = data.edges.map((e) => {
      const srcNode = findNode(e.source);
      const isOut = srcNode?.data?.kind === "action";
      const color = isOut ? "#e6a23c" : "#409eff";
      // 单位：优先保留导入的手工单位，否则按继承规则解析（默认「个」）
      const unit = (e as any).unit || resolveUnit(e.source, e.target);
      return {
        ...e,
        unit,
        // 无单位数据自动补 label（含继承单位）；已有单位的数据保留原 label
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
    nodes.value = JSON.parse(JSON.stringify(data.nodes));
    edges.value = JSON.parse(JSON.stringify(decoratedEdges));
    // 完整还原画布视图（平移 / 缩放）；旧版数据无 viewport 时保持默认视图
    if (data.viewport && typeof data.viewport.zoom === "number") {
      setViewport({
        x: data.viewport.x,
        y: data.viewport.y,
        zoom: data.viewport.zoom,
      });
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
   * 解析 Minecraft 配方 JSON（如「大容量发酵罐配方.json」）。
   * 支持结构：{ "机器名": { "说明": "...", "配方列表": [ { "配方名", "分类", "输入", "输出", "加热", "处理时间(秒)" } ] } }
   */
  function parseSourceRecipe(json: unknown): SourceMachine | null {
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
  function nameFromId(id: string): string {
    const short = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
    return short.replace(/_/g, " ");
  }

  /** 根据原料/产物类型得到单位（流体→ml，其他→默认单位） */
  function unitOfIngredient(ing: SourceIngredient): string {
    return ing.type === "流体" ? "ml" : DEFAULT_UNIT;
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

  return {
    nodes,
    edges,
    updateEdge,
    createItemNode,
    createActionNode,
    addRecipeFromForm,
    deleteNode,
    duplicateNode,
    detectCycle,
    exportJSON,
    importJSON,
    persist,
    loadFromStorage,
    computeBasicMaterials,
    resolveUnit,
    edgeLabel,
    syncUnitFromAction,
    refreshEdgeUnits,
    getItemNodes,
    getActionNodes,
    getCanvasUnits,
    parseSourceRecipe,
    importSourceRecipes,
    getTraceAttributeNames,
    computeAttributeTrace,
  };
}
