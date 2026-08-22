<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useVueFlow, MarkerType } from '@vue-flow/core'
import {
  useRecipeGraph,
  useActionTypes,
  useGroups,
  useUnits,
  useImagePreview,
  useImageCrop,
  fileToDataURL,
  fileBaseName,
  isImageIcon,
  type ItemAttribute,
  type AttributeTraceResult,
} from '../composables'
import { DEFAULT_EXTRAS, DEFAULT_UNIT } from '../types'

const { findNode, updateNode, getNodes, getEdges, removeEdges } = useVueFlow()
const {
  deleteNode,
  duplicateNode,
  persist,
  computeBasicMaterials,
  computeAttributeTrace,
  getTraceAttributeNames,
  resolveUnit,
  syncUnitFromAction,
  getCanvasUnits,
} = useRecipeGraph()
const { allActions, addAction } = useActionTypes()
const { allGroups } = useGroups()
const { allUnits, addUnit, removeUnit } = useUnits()
const { openImage } = useImagePreview()
const { open: openCrop } = useImageCrop()

// 由 App 通过 v-model 同步选中节点 / 连线
const props = defineProps<{
  modelValue: string | null
  edge?: string | null
}>()
const emit = defineEmits<{
  'update:modelValue': [string | null]
  'update:edge': [string | null]
}>()

// 初始即同步当前选中值（解决首帧空白问题）
const selectedId = ref<string | null>(props.modelValue)
const edgeId = ref<string | null>(props.edge ?? null)
const fileInput = ref<HTMLInputElement | null>(null)
const actionFileInput = ref<HTMLInputElement | null>(null)

const node = computed(() => (selectedId.value ? findNode(selectedId.value) : null))

const isItem = computed(() => node.value?.data?.kind === 'item')
const isAction = computed(() => node.value?.data?.kind === 'action')

const label = computed({
  get: () => (node.value?.data ? (node.value.data as any).label ?? '' : ''),
  set: (v: string) => {
    if (node.value) {
      const data: any = { ...node.value.data, label: v }
      // 方向 A：加工节点的名称始终跟随加工动作，避免两者分叉
      if (node.value.data?.kind === 'action') {
        addAction(v)
        data.action = v
      }
      updateNode(node.value.id, { data })
      persist()
    }
  },
})

const description = computed({
  get: () => (node.value?.data ? (node.value.data as any)?.description ?? '' : ''),
  set: (v: string) => {
    if (node.value) {
      updateNode(node.value.id, { data: { ...node.value.data, description: v } })
      persist()
    }
  },
})

const showLabel = computed({
  get: () => (node.value?.data as any)?.showLabel ?? true,
  set: (v: boolean) => {
    if (node.value) {
      updateNode(node.value.id, { data: { ...node.value.data, showLabel: v } })
      persist()
    }
  },
})

const action = computed({
  get: () => (node.value?.data as any)?.action ?? '合成',
  set: (v: string) => {
    if (node.value) {
      // 新增的自定义加工动作持久化到下拉列表
      addAction(v)
      updateNode(node.value.id, { data: { ...node.value.data, action: v, label: v } })
      persist()
    }
  },
})

/** 加工节点输出单位：修改后自动同步到其输出边及下游加工节点输入边 */
const outputUnit = computed({
  get: () => (node.value?.data as any)?.outputUnit || DEFAULT_UNIT,
  set: (v: string) => {
    if (node.value) {
      updateNode(node.value.id, {
        data: { ...node.value.data, outputUnit: v || DEFAULT_UNIT },
      })
      syncUnitFromAction(node.value.id)
    }
  },
})

/** 加工节点附加操作 / 附加条件（如「发酵」是否需要加热）：支持选择内置项或自定义输入 */
const actionExtra = computed({
  get: () => (node.value?.data as any)?.extra ?? '',
  set: (v: string) => {
    if (node.value) {
      updateNode(node.value.id, { data: { ...node.value.data, extra: v || undefined } })
      persist()
    }
  },
})

/** 收集「可选的附加操作」：内置默认项 + 画布上所有加工节点已使用的值 */
function getExtraOptions(): string[] {
  const set = new Set<string>(DEFAULT_EXTRAS)
  getNodes.value.forEach((n) => {
    const e = (n.data as any)?.extra
    if (e) set.add(e)
  })
  return [...set]
}

/** 节点所属分组 id 列表（物品 / 加工节点通用；加工节点仅保留归属，不继承分组属性） */
const groupIds = computed<string[]>({
  get: () => (node.value?.data as any)?.groupIds ?? [],
  set: (v: string[]) => {
    if (node.value) {
      updateNode(node.value.id, {
        data: { ...node.value.data, groupIds: v.length ? v : undefined },
      })
      persist()
    }
  },
})

/** 分组多选下拉所需选项 */
function groupOptions() {
  return allGroups().map((g) => ({ id: g.id, name: g.name }))
}

/** 收集当前节点所属分组的全部属性（用于「从分组复制属性」下拉） */
function attrsFromGroups(): ItemAttribute[] {
  const gids = (node.value?.data as any)?.groupIds as string[] | undefined
  if (!gids || !gids.length) return []
  const result: ItemAttribute[] = []
  gids.forEach((gid) => {
    const g = allGroups().find((x) => x.id === gid)
    if (g?.attributes) result.push(...g.attributes)
  })
  return result
}

/** 从分组复制一条属性到节点（深拷贝，独立可编辑，之后改分组不影响已拷贝的节点属性） */
function copyAttrFromGroup(attr: ItemAttribute) {
  attrs.value.push(JSON.parse(JSON.stringify(attr)))
  saveAttrs()
  ElMessage.success('已从分组复制属性到节点')
}

/** 从分组复制属性（el-select @change 回调） */
function onCopyAttrFromGroup(v: string) {
  const a = attrsFromGroups().find((x) => x.name === v || String(x.value) === v)
  if (a) copyAttrFromGroup(a)
}

/**
 * 选择分组变更后，检查新增分组中是否存在节点尚未拥有的属性，
 * 若有则提示用户是否将这些属性复制到本节点（深拷贝，独立可编辑）。
 */
function onGroupIdsChange(newIds: string[]) {
  const oldIds = groupIds.value
  groupIds.value = newIds
  const addedIds = newIds.filter((id) => !oldIds.includes(id))
  if (!addedIds.length) return
  const existingNames = new Set(attrs.value.map((a) => a.name))
  const missing: { attr: ItemAttribute; groupName: string }[] = []
  addedIds.forEach((gid) => {
    const g = allGroups().find((x) => x.id === gid)
    if (!g?.attributes) return
    g.attributes.forEach((a) => {
      if (a.name && !existingNames.has(a.name)) {
        missing.push({ attr: a, groupName: g.name })
      }
    })
  })
  if (!missing.length) return
  const attrList = missing.map((m) => m.attr.name).join('、')
  const groupList = [...new Set(missing.map((m) => m.groupName))].join('、')
  ElMessageBox.confirm(
    `所选分组「${groupList}」包含本节点尚不存在的属性：${attrList}。是否将这些属性复制到本节点？`,
    '从分组复制属性',
    { confirmButtonText: '复制', cancelButtonText: '跳过', type: 'info' },
  )
    .then(() => {
      missing.forEach((m) => attrs.value.push(JSON.parse(JSON.stringify(m.attr))))
      saveAttrs()
      ElMessage.success(`已复制 ${missing.length} 个属性`)
    })
    .catch(() => { })
}

const image = computed(() => (node.value?.data as any)?.image ?? '')

// ---- 加工节点输入 / 输出数量（有向图语义）----
// 任何指向加工节点的连线均为输入；任何从加工节点指出的连线均为输出
// 直接从 VueFlow store 过滤，保证连线对象是响应式的（数量修改即时生效）
const inEdges = computed(() =>
  selectedId.value ? getEdges.value.filter((e) => e.target === selectedId.value) : [],
)
const outEdges = computed(() =>
  selectedId.value ? getEdges.value.filter((e) => e.source === selectedId.value) : [],
)

function qtyFromLabel(label: unknown): number {
  const m = /×(\d+)/.exec(String(label ?? ''))
  return m ? +m[1] : 1
}

/** 读取连线的数量单位（自定义字段） */
function unitOf(e: any): string {
  return (e as any)?.unit ?? ''
}

/** 可选单位：内置 + 自定义 + 画布使用中 - 隐藏（「个」始终保留） */
function getUnitOptions(): string[] {
  return allUnits(getCanvasUnits())
}

/** 用户选择/输入单位后，若为新值则持久化 */
function onUnitPick(v: string) {
  if (v) addUnit(v)
}

/** 删除单位（「个」不可删；画布正在使用的不允许删） */
function onRemoveUnit(u: string) {
  removeUnit(u, getCanvasUnits())
}

function nodeName(id: string) {
  const n = findNode(id)
  return ((n?.data as any)?.label as string) || id
}

/** 更新单条连线的数量与单位（指向本节点=输入，本节点指出=输出），直接修改响应式连线对象，连线数字即时同步 */
function applyEdgeQty(e: any, q: number, unit = '') {
  const isIn = e.target === selectedId.value || e.target === edgeId.value
  const qty = Math.max(1, Math.floor(q || 1))
  const label = qty > 1 || unit ? `×${qty}${unit ? ' ' + unit : ''}` : ''
  // 文字颜色继承当前线段颜色；无线段颜色时按方向回退到默认蓝/橙
  const color = (e.style as any)?.stroke ?? (isIn ? '#409eff' : '#e6a23c')
  Object.assign(e, {
    label,
    unit: unit || undefined,
    labelStyle: { fill: color, fontWeight: 700, fontSize: '12px' },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
  })
  persist()
}

function onQtyInput(e: any, v: number | undefined) {
  applyEdgeQty(e, v ?? 1, unitOf(e))
}

function onUnitInput(e: any, v: string | undefined) {
  applyEdgeQty(e, qtyFromLabel(e.label), v ?? '')
}

// ---- 物品属性编辑（图标 + 名称 + 值 + 说明，图标与说明非必选）----
const attrs = ref<ItemAttribute[]>([])
watch(
  () => (node.value?.data as any)?.attributes,
  (v) => {
    attrs.value = v ? (JSON.parse(JSON.stringify(v)) as ItemAttribute[]) : []
  },
  { immediate: true, deep: true },
)

/** 点击「添加属性」：先插入一个空行（暂不保存），用户填写后由输入事件自动保存 */
function addAttr() {
  attrs.value.push({ icon: '', name: '', value: '', desc: '' })
}

function removeAttr(idx: number) {
  attrs.value.splice(idx, 1)
  saveAttrs()
}

/** 将本地属性草稿保存回节点（保留所有行含空行，渲染时再过滤） */
function saveAttrs() {
  if (!node.value) return
  updateNode(node.value.id, {
    data: {
      ...node.value.data,
      attributes: attrs.value.length ? JSON.parse(JSON.stringify(attrs.value)) : undefined,
    },
  })
  persist()
}

// ---- 属性图标：支持本地上传 / 剪贴板粘贴 / 直接输入 emoji 或 URL ----
const attrIconFileInput = ref<HTMLInputElement | null>(null)
const attrIconTarget = ref<ItemAttribute | null>(null)

/** 点击图标预览 → 选择本地图片 */
function pickAttrIcon(a: ItemAttribute) {
  attrIconTarget.value = a
  attrIconFileInput.value?.click()
}

async function onAttrIconFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f || !attrIconTarget.value) return
  try {
    attrIconTarget.value.icon = await fileToDataURL(f)
    saveAttrs()
  } catch (err: any) {
    ElMessage.warning(err?.message ?? '图片读取失败')
  }
}

// ---- 配方追踪（仅物品节点）：按上游加工输入 / 输出数量反推基本原料需求 ----
const traceQty = ref(1)
const traceMaterials = computed(() =>
  selectedId.value ? computeBasicMaterials(selectedId.value, traceQty.value) : [],
)
const isBasicSelf = computed(
  () => traceMaterials.value.length === 1 && traceMaterials.value[0].id === selectedId.value,
)

// ---- 属性追踪：默认不展示，由用户选择要展示的属性 ----
const attrOptions = computed<string[]>(() =>
  selectedId.value ? getTraceAttributeNames(selectedId.value) : [],
)
const selectedAttrs = ref<string[]>([])
watch(selectedId, () => {
  selectedAttrs.value = []
})
/** 对每个选中的属性计算追踪结果 */
const attrTraces = computed<AttributeTraceResult[]>(() =>
  selectedAttrs.value
    .map((name) =>
      selectedId.value ? computeAttributeTrace(selectedId.value, traceQty.value, name) : null,
    )
    .filter((t): t is AttributeTraceResult => !!t),
)

// ---- 连线编辑模式（点击连线后编辑样式）----
const selectedEdge = computed(() =>
  edgeId.value ? getEdges.value.find((e) => e.id === edgeId.value) ?? null : null,
)

const edgeQty = computed({
  get: () => (selectedEdge.value ? qtyFromLabel(selectedEdge.value.label) : 1),
  set: (v: number | undefined) => {
    if (selectedEdge.value) applyEdgeQty(selectedEdge.value, v ?? 1, unitOf(selectedEdge.value))
  },
})

const edgeUnit = computed({
  get: () => (selectedEdge.value ? unitOf(selectedEdge.value) : ''),
  set: (v: string | undefined) => {
    if (selectedEdge.value) applyEdgeQty(selectedEdge.value, edgeQty.value, v ?? '')
  },
})

const MARKER_MAP: Record<string, MarkerType | undefined> = {
  arrowclosed: MarkerType.ArrowClosed,
  arrow: MarkerType.Arrow,
  none: undefined,
}

function markerName(markerEnd: unknown): string {
  const t = (markerEnd as any)?.type
  if (t === MarkerType.Arrow) return 'arrow'
  return 'arrowclosed'
}

function dashName(dasharray: string | undefined): string {
  if (!dasharray || dasharray === 'none' || dasharray === '0') return 'solid'
  if (dasharray === '2 4') return 'dotted'
  return 'dashed'
}

const edgeLineStyle = computed({
  get: () => dashName((selectedEdge.value?.style as any)?.strokeDasharray),
  set: (v: string) =>
    applyEdgeStyle({
      strokeDasharray: v === 'solid' ? 'none' : v === 'dotted' ? '2 4' : '8 4',
    }),
})

const edgeColor = computed({
  get: () => (selectedEdge.value?.style as any)?.stroke ?? '#409eff',
  set: (v: string) => {
    const e = selectedEdge.value
    if (!e) return
    const next: any = { ...e }
    next.style = {
      stroke: v,
      strokeWidth: (e.style as any)?.strokeWidth ?? 2,
      strokeDasharray: (e.style as any)?.strokeDasharray ?? '8 4',
    }
    const type = MARKER_MAP[markerName(e.markerEnd)]
    next.markerEnd = type ? { type, color: v, width: 16, height: 16 } : undefined
    // 数量数字颜色跟随连线颜色，保持视觉一致
    next.labelStyle = { ...((e.labelStyle as any) ?? {}), fill: v }
    Object.assign(e, next)
    persist()
  },
})

const edgeAnimated = computed({
  get: () => !!selectedEdge.value?.animated,
  set: (v: boolean) => applyEdgeStyle({ animated: v }),
})

const edgeMarker = computed({
  get: () => markerName(selectedEdge.value?.markerEnd),
  set: (v: string) => applyEdgeStyle({ marker: v }),
})

/** 统一更新选中连线的样式字段（响应式对象 + 持久化） */
function applyEdgeStyle(patch: Record<string, unknown>) {
  const e = selectedEdge.value
  if (!e) return
  const next: any = { ...e }
  if ('stroke' in patch || 'strokeDasharray' in patch) {
    next.style = {
      stroke: (patch.stroke as string) ?? (e.style as any)?.stroke ?? '#409eff',
      strokeWidth: (e.style as any)?.strokeWidth ?? 2,
      strokeDasharray:
        (patch.strokeDasharray as string) ?? (e.style as any)?.strokeDasharray ?? '8 4',
    }
  }
  if ('animated' in patch) next.animated = patch.animated as boolean
  if ('marker' in patch) {
    const type = MARKER_MAP[patch.marker as string]
    const color = ((e.markerEnd as any)?.color as string) ?? (e.style as any)?.stroke ?? '#409eff'
    next.markerEnd = type ? { type, color, width: 16, height: 16 } : undefined
  }
  Object.assign(e, next)
  persist()
}

function onDeleteEdge() {
  const id = edgeId.value
  if (id) {
    removeEdges(id)
    edgeId.value = null
    persist()
  }
}

function pickImage() {
  fileInput.value?.click()
}

/**
 * 上传图片后根据文件名同步节点名称（物品 / 加工动作）：
 * - 名称为空：直接用图片名（去扩展名）填入
 * - 名称与图片名一致：无操作
 * - 名称与图片名不一致：弹窗让用户选择是否用图片名替换（展示两者）
 */
async function maybeUpdateNodeName(file: File) {
  if (!node.value) return
  const baseName = fileBaseName(file)
  if (!baseName) return
  const current = (label.value ?? '').trim()
  if (!current) {
    label.value = baseName
    return
  }
  if (current === baseName) return
  const isAction = node.value.data?.kind === 'action'
  try {
    await ElMessageBox.confirm(
      `${isAction ? '动作名称' : '物品名称'}：${current}\n图片名称：${baseName}\n\n是否使用图片名称替换当前名称？`,
      '名称不一致',
      {
        confirmButtonText: '使用图片名称',
        cancelButtonText: '保留原名称',
        type: 'warning',
      },
    )
    label.value = baseName
  } catch {
    // 保留原名称
  }
}

async function onFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const dataURL = await readFileAsDataURL(f)
  // 上传后先裁剪，确认后才写入节点（取消则忽略）
  const cropped = await openCrop(dataURL)
  if (cropped && node.value) {
    updateNode(node.value.id, { data: { ...node.value.data, image: cropped } })
    persist()
    ElMessage.success('图片已替换')
    await maybeUpdateNodeName(f)
  }
  ; (e.target as HTMLInputElement).value = ''
}

function readFileAsDataURL(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = () => res(reader.result as string)
    reader.onerror = rej
    reader.readAsDataURL(f)
  })
}

// 加工动作图标图片替换（仅动作节点）
function pickActionImage() {
  actionFileInput.value?.click()
}

async function onActionFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const dataURL = await readFileAsDataURL(f)
  const cropped = await openCrop(dataURL)
  if (cropped && node.value) {
    updateNode(node.value.id, { data: { ...node.value.data, image: cropped } })
    persist()
    ElMessage.success('动作图标已替换')
    await maybeUpdateNodeName(f)
  }
  ; (e.target as HTMLInputElement).value = ''
}

function onDuplicate() {
  if (selectedId.value) duplicateNode(selectedId.value)
}
function onDelete() {
  if (selectedId.value) {
    deleteNode(selectedId.value)
    selectedId.value = null
  }
}

// 由 App 通过 v-model 同步选中（props/emit/selectedId 已在顶部声明）
watch(
  () => props.modelValue,
  (v) => (selectedId.value = v),
)
watch(selectedId, (v) => emit('update:modelValue', v))
watch(
  () => props.edge,
  (v) => (edgeId.value = v ?? null),
)
watch(edgeId, (v) => emit('update:edge', v))
</script>

<template>
  <div class="prop-panel">

    <!-- ===== 连线编辑模式 ===== -->
    <template v-if="selectedEdge">
      <el-form label-position="top">
        <el-form-item label="连线方向">
          <span class="edge-dir">{{ nodeName(selectedEdge.source) }} → {{ nodeName(selectedEdge.target) }}</span>
        </el-form-item>
        <el-form-item label="数量与单位">
          <div class="qty-unit-row">
            <el-input-number v-model="edgeQty" :min="1" :max="9999" controls-position="right" style="flex: 1" />
            <el-select v-model="edgeUnit" placeholder="单位" clearable filterable allow-create default-first-option
              style="width: 96px" @change="onUnitPick">
              <el-option v-for="u in getUnitOptions()" :key="u" :label="u" :value="u">
                <div class="unit-option">
                  <span>{{ u }}</span>
                  <span v-if="u !== '个'" class="unit-del" @click.stop="onRemoveUnit(u)">×</span>
                </div>
              </el-option>
            </el-select>
          </div>
        </el-form-item>
        <el-form-item label="线条样式">
          <el-select v-model="edgeLineStyle" style="width: 100%">
            <el-option label="实线" value="solid" />
            <el-option label="虚线" value="dashed" />
            <el-option label="点线" value="dotted" />
          </el-select>
        </el-form-item>
        <el-form-item label="颜色">
          <el-color-picker v-model="edgeColor" />
        </el-form-item>
        <el-form-item label="动画">
          <el-switch v-model="edgeAnimated" active-text="流动动画" inactive-text="静态" />
        </el-form-item>
        <el-form-item label="端点样式">
          <el-select v-model="edgeMarker" style="width: 100%">
            <el-option label="实心箭头" value="arrowclosed" />
            <el-option label="空心箭头" value="arrow" />
            <el-option label="无端点" value="none" />
          </el-select>
        </el-form-item>
        <el-button type="danger" plain style="width: 100%" @click="onDeleteEdge">删除连线</el-button>
      </el-form>
    </template>

    <!-- ===== 节点编辑模式 ===== -->
    <template v-else>
      <el-empty v-if="!node" description="选中一个节点或连线以编辑属性" :image-size="60" />
      <el-form v-else label-position="top">
        <el-form-item label="节点类型">
          <el-tag :type="isItem ? 'success' : 'warning'">
            {{ isItem ? '物品节点' : '加工动作节点' }}
          </el-tag>
        </el-form-item>

        <el-form-item v-if="isItem" label="名称">
          <el-input v-model="label" placeholder="节点名称" />
        </el-form-item>

        <el-form-item label="解释">
          <el-input v-model="description" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }"
            placeholder="节点解释（展示在节点上）" />
        </el-form-item>

        <el-form-item label="分组">
          <el-select :model-value="groupIds" multiple filterable default-first-option clearable
            placeholder="选择分组（在「分组」管理中创建）" style="width: 100%"
            @update:model-value="(v: string[]) => onGroupIdsChange(v)">
            <el-option v-for="g in groupOptions()" :key="g.id" :label="g.name" :value="g.id" />
          </el-select>
          <div v-if="isAction" class="qty-tip">加工节点仅保留分组归属，不继承分组属性</div>
        </el-form-item>

        <template v-if="isItem">
          <el-form-item label="显示文字">
            <el-switch v-model="showLabel" active-text="图片+文字" inactive-text="仅图片" />
          </el-form-item>
          <el-form-item label="图片">
            <div class="img-box">
              <img v-if="image" :src="image" class="preview zoomable" :title="`点击放大：${label}`"
                @click.stop="openImage(image, label)" />
              <div v-else class="preview placeholder">无</div>
              <el-button size="small" type="primary" @click="pickImage">替换图片</el-button>
            </div>
            <input ref="fileInput" type="file" accept="image/*" style="display: none" @change="onFileChange" />
          </el-form-item>

          <!-- 物品属性：图标 + 名称 + 值 + 说明（图标与说明非必选） -->
          <el-divider content-position="left">物品属性</el-divider>
          <div class="attr-tip">属性由「图标 + 名称 + 值 + 说明」组成，图标与说明非必选；可在下方配方追踪中选择展示属性。</div>
          <div v-for="(a, idx) in attrs" :key="idx" class="attr-row">
            <div class="attr-main">
              <span class="attr-icon-box" :title="a.icon ? '点击更换图标' : '点击上传图标'" @click="pickAttrIcon(a)">
                <img v-if="a.icon && isImageIcon(a.icon)" :src="a.icon" class="attr-icon-img" />
                <span v-else class="attr-icon-text">{{ a.icon || '📷' }}</span>
              </span>
              <el-input v-model="a.icon" placeholder="图标/emoji" size="small" class="attr-icon"
                @update:model-value="saveAttrs" />
              <el-input v-model="a.name" placeholder="名称" size="small" class="attr-name"
                @update:model-value="saveAttrs" />
              <el-input v-model="a.value" placeholder="值" size="small" class="attr-value"
                @update:model-value="saveAttrs" />
              <el-button link type="danger" size="small" @click="removeAttr(idx)">删</el-button>
            </div>
            <el-input v-model="a.desc" placeholder="说明（可选）" size="small" class="attr-desc"
              @update:model-value="saveAttrs" />
          </div>
          <!-- 从所属分组复制属性：深拷贝为节点自有属性，独立可编辑 -->
          <div v-if="attrsFromGroups().length" class="group-attr-copy">
            <el-select placeholder="从分组复制属性到本节点" size="small" clearable style="width: 100%"
              @change="(v: string) => onCopyAttrFromGroup(v)">
              <el-option v-for="(ga, gi) in attrsFromGroups()" :key="gi"
                :label="`${ga.name}${ga.value !== '' ? '：' + ga.value : ''}`" :value="ga.name || String(ga.value)" />
            </el-select>
          </div>
          <el-button text type="primary" size="small" @click="addAttr">+ 添加属性</el-button>
          <input ref="attrIconFileInput" type="file" accept="image/*" style="display: none"
            @change="onAttrIconFileChange" />

          <el-divider content-position="left">配方追踪</el-divider>
          <el-form-item label="目标数量（想要多少个该产物）">
            <el-input-number v-model="traceQty" :min="1" :max="999999" controls-position="right" style="width: 100%" />
          </el-form-item>
          <div class="trace-tip">按上游加工节点的输入/输出数量反推所需<b>基本原料</b>（不依赖其他加工节点、直接作为原料消耗的源头物品）：</div>
          <div v-if="isBasicSelf" class="trace-result">
            <div class="trace-row">
              <span class="trace-name">{{ label }}</span>
              <span class="trace-qty">× {{ traceQty }}{{ traceMaterials[0].unit ? ' ' + traceMaterials[0].unit : ''
              }}</span>
            </div>
            <div class="qty-tip">该产物本身就是基本原料，无上游加工链。</div>
          </div>
          <div v-else-if="traceMaterials.length" class="trace-result">
            <div v-for="m in traceMaterials" :key="m.id" class="trace-row">
              <span class="trace-name" :title="m.name">{{ m.name }}</span>
              <span class="trace-qty">× {{ m.qty }}{{ m.unit ? ' ' + m.unit : '' }}</span>
            </div>
          </div>
          <div v-else class="trace-empty">该产物没有上游加工链，无法反推。</div>

          <!-- 属性追踪：默认不展示，由用户选择 -->
          <el-form-item v-if="attrOptions.length" label="展示属性（默认不展示）">
            <el-select v-model="selectedAttrs" multiple clearable placeholder="选择要展示的属性" style="width: 100%">
              <el-option v-for="n in attrOptions" :key="n" :label="n" :value="n" />
            </el-select>
            <div class="qty-tip">选中属性后，将展示该属性在各基本原料上的值与其需求量的乘积计算过程</div>
          </el-form-item>
          <div v-if="attrTraces.length" class="trace-result attr-trace">
            <div v-for="t in attrTraces" :key="t.name" class="attr-trace-block">
              <div class="attr-trace-head">
                <span class="attr-trace-name">{{ t.name }}</span>
                <span v-if="t.targetAttr" class="attr-trace-target">
                  {{ label }}：
                  <template v-if="t.targetAttr.icon">{{ t.targetAttr.icon }} </template>{{ t.targetAttr.value }}
                </span>
              </div>
              <div v-if="t.items.length">
                <div v-for="it in t.items" :key="it.id" class="trace-row">
                  <span class="trace-name" :title="it.name">{{ it.name }}</span>
                  <span class="trace-qty">
                    <template v-if="it.attr">
                      {{ it.attr.icon ? it.attr.icon + ' ' : '' }}{{ it.attr.value }} × {{ it.qty }} = {{
                        it.contribution ?? '无法计算' }}
                    </template>
                    <template v-else>无该属性</template>
                  </span>
                </div>
                <div v-if="t.total !== null" class="attr-trace-total">
                  合计：{{ t.total }}
                  <span v-if="t.targetAttr && String(t.targetAttr.value) === String(t.total)" class="attr-trace-ok">
                    ✓ 与目标产物属性值一致
                  </span>
                </div>
              </div>
              <div v-else class="trace-empty">上游原料均无该属性，无法计算。</div>
            </div>
          </div>
        </template>

        <template v-if="isAction">
          <el-form-item v-if="inEdges.length" label="输入数量">
            <div v-for="e in inEdges" :key="e.id" class="qty-row">
              <span class="qty-name" :title="nodeName(e.source)">{{ nodeName(e.source) }}</span>
              <el-input-number :model-value="qtyFromLabel(e.label)" :min="1" :max="9999" controls-position="right"
                size="small" style="width: 96px" @update:model-value="onQtyInput(e, $event)" />
              <el-select :model-value="unitOf(e) || resolveUnit(e.source, e.target)" placeholder="单位" clearable
                filterable allow-create default-first-option size="small" style="width: 76px"
                @update:model-value="onUnitInput(e, $event)" @change="onUnitPick">
                <el-option v-for="u in getUnitOptions()" :key="u" :label="u" :value="u">
                  <div class="unit-option">
                    <span>{{ u }}</span>
                    <span v-if="u !== '个'" class="unit-del" @click.stop="onRemoveUnit(u)">×</span>
                  </div>
                </el-option>
              </el-select>
            </div>
            <div class="qty-tip">指向本加工节点的连线均为输入，单位默认继承上游加工节点的输出单位</div>
          </el-form-item>
          <el-form-item v-if="outEdges.length" label="输出数量">
            <div v-for="e in outEdges" :key="e.id" class="qty-row">
              <span class="qty-name" :title="nodeName(e.target)">{{ nodeName(e.target) }}</span>
              <el-input-number :model-value="qtyFromLabel(e.label)" :min="1" :max="9999" controls-position="right"
                size="small" style="width: 96px" @update:model-value="onQtyInput(e, $event)" />
              <el-select :model-value="unitOf(e) || resolveUnit(e.source, e.target)" placeholder="单位" clearable
                filterable allow-create default-first-option size="small" style="width: 76px"
                @update:model-value="onUnitInput(e, $event)" @change="onUnitPick">
                <el-option v-for="u in getUnitOptions()" :key="u" :label="u" :value="u">
                  <div class="unit-option">
                    <span>{{ u }}</span>
                    <span v-if="u !== '个'" class="unit-del" @click.stop="onRemoveUnit(u)">×</span>
                  </div>
                </el-option>
              </el-select>
            </div>
            <div class="qty-tip">本加工节点指出的连线均为输出，单位与「输出单位」一致</div>
          </el-form-item>
          <el-form-item label="加工动作">
            <el-select v-model="action" style="width: 100%" filterable allow-create default-first-option
              placeholder="选择或输入自定义动作">
              <el-option v-for="a in allActions()" :key="a" :label="a" :value="a" />
            </el-select>
          </el-form-item>
          <el-form-item label="附加操作 / 条件（如发酵需加热）">
            <el-select v-model="actionExtra" style="width: 100%" filterable allow-create default-first-option clearable
              placeholder="选择或自定义，如：需要加热">
              <el-option v-for="x in getExtraOptions()" :key="x" :label="x" :value="x" />
            </el-select>
          </el-form-item>
          <el-form-item label="输出单位（下游输入自动继承）">
            <el-select v-model="outputUnit" style="width: 100%" filterable allow-create default-first-option
              placeholder="选择或输入单位" @change="onUnitPick">
              <el-option v-for="u in getUnitOptions()" :key="u" :label="u" :value="u">
                <div class="unit-option">
                  <span>{{ u }}</span>
                  <span v-if="u !== '个'" class="unit-del" @click.stop="onRemoveUnit(u)">×</span>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="动作图标">
            <div class="img-box">
              <img v-if="image" :src="image" class="preview zoomable" :title="`点击放大：${label}`"
                @click.stop="openImage(image, label)" />
              <div v-else class="preview placeholder">默认</div>
              <el-button size="small" type="primary" @click="pickActionImage">替换图标</el-button>
            </div>
            <input ref="actionFileInput" type="file" accept="image/*" style="display: none"
              @change="onActionFileChange" />
          </el-form-item>
        </template>

        <el-button-group style="width: 100%; display: flex">
          <el-button type="primary" plain style="flex: 1" @click="onDuplicate">
            复制节点
          </el-button>
          <el-button type="danger" plain style="flex: 1" @click="onDelete">
            删除节点
          </el-button>
        </el-button-group>
      </el-form>
    </template>
  </div>
</template>

<style scoped>
.prop-panel {
  padding: 14px;
  height: 100%;
  overflow-y: auto;
}

/* 表单 label 加粗，与输入内容区分 */
.prop-panel :deep(.el-form-item__label) {
  font-weight: 600;
}

.qty-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.2;
}

.unit-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.unit-del {
  color: #f56c6c;
  font-size: 14px;
  margin-left: 8px;
  cursor: pointer;
  flex-shrink: 0;
}

.unit-del:hover {
  color: #d9362e;
}

.qty-unit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.trace-tip {
  font-size: 12px;
  color: #909399;
  margin: -4px 0 8px;
  line-height: 1.6;
}

.trace-result {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px dashed #dcdfe6;
  border-radius: 8px;
  background: #fafafa;
}

.trace-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
}

.trace-name {
  flex: 1;
  min-width: 0;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-qty {
  color: #e6a23c;
  font-weight: 700;
  white-space: nowrap;
}

.trace-empty {
  font-size: 12px;
  color: #909399;
}

/* 物品属性编辑区 */
.attr-tip {
  font-size: 12px;
  color: #909399;
  margin: -4px 0 8px;
  line-height: 1.5;
}

.attr-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px dashed #e4e7ed;
  border-radius: 6px;
  margin-bottom: 6px;
  background: #fff;
}

.attr-main {
  display: flex;
  gap: 4px;
  align-items: center;
}

.attr-icon-box {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed #c0c4cc;
  border-radius: 4px;
  cursor: pointer;
  overflow: hidden;
  background: #fff;
}

.attr-icon-box:hover {
  border-color: #409eff;
}

.attr-icon-img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.attr-icon-text {
  font-size: 14px;
  line-height: 1;
}

.attr-icon {
  width: 52px;
  flex-shrink: 0;
}

.attr-name {
  flex: 1;
  min-width: 0;
}

.attr-value {
  flex: 1;
  min-width: 0;
}

.attr-desc {
  width: 100%;
}

.attr-main :deep(.el-input__inner) {
  font-size: 12px;
}

/* 从分组复制属性下拉区 */
.group-attr-copy {
  margin: 6px 0;
  padding: 6px;
  border: 1px dashed #b3d8ff;
  border-radius: 6px;
  background: #f0f9ff;
}

/* 属性追踪结果 */
.attr-trace {
  margin-top: 6px;
  gap: 8px;
}

.attr-trace-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #fff;
}

.attr-trace-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
}

.attr-trace-name {
  color: #409eff;
}

.attr-trace-target {
  font-weight: 600;
  color: #e6a23c;
}

.attr-trace-total {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  border-top: 1px dashed #dcdfe6;
  padding-top: 4px;
}

.attr-trace-ok {
  color: #67c23a;
  font-weight: 600;
}

.qty-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 3px 0;
}

.qty-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: #606266;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edge-dir {
  font-size: 13px;
  color: #606266;
  word-break: break-all;
}

.img-box {
  display: flex;
  align-items: center;
  gap: 10px;
}

.preview {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid #dcdfe6;
}

.preview.zoomable {
  cursor: zoom-in;
  transition: transform 0.15s ease;
}

.preview.zoomable:hover {
  transform: scale(1.08);
}

.preview.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
  background: #f4f4f5;
}
</style>
