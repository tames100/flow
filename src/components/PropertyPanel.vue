<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useVueFlow, MarkerType } from '@vue-flow/core'
import { useRecipeGraph, useActionTypes, useImagePreview, useImageCrop } from '../composables'
import { DEFAULT_UNIT, DEFAULT_UNITS } from '../types'

const { findNode, updateNode, getEdges, removeEdges } = useVueFlow()
const {
  deleteNode,
  duplicateNode,
  persist,
  computeBasicMaterials,
  resolveUnit,
  syncUnitFromAction,
} = useRecipeGraph()
const { allActions, addAction } = useActionTypes()
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

/** 收集「目前已有的单位」：内置默认单位 + 画布上所有连线使用过的单位 */
function getUnitOptions(): string[] {
  const set = new Set<string>(DEFAULT_UNITS)
  getEdges.value.forEach((e: any) => {
    const u = e?.unit
    if (u) set.add(u)
  })
  return [...set]
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
  const color = isIn ? '#409eff' : '#e6a23c'
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

// ---- 配方追踪（仅物品节点）：按上游加工输入 / 输出数量反推基本原料需求 ----
const traceQty = ref(1)
const traceMaterials = computed(() =>
  selectedId.value ? computeBasicMaterials(selectedId.value, traceQty.value) : [],
)
const isBasicSelf = computed(
  () => traceMaterials.value.length === 1 && traceMaterials.value[0].id === selectedId.value,
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
              style="width: 96px">
              <el-option v-for="u in getUnitOptions()" :key="u" :label="u" :value="u" />
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

          <el-divider content-position="left">配方追踪</el-divider>
          <el-form-item label="目标数量（想要多少个该产物）">
            <el-input-number v-model="traceQty" :min="1" :max="999999" controls-position="right" style="width: 100%" />
          </el-form-item>
          <div class="trace-tip">按上游加工节点的输入 / 输出数量反推所需<b>基本原料</b>（不依赖其他加工节点、直接作为原料消耗的源头物品）：</div>
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
        </template>

        <template v-if="isAction">
          <el-form-item v-if="inEdges.length" label="输入数量">
            <div v-for="e in inEdges" :key="e.id" class="qty-row">
              <span class="qty-name" :title="nodeName(e.source)">{{ nodeName(e.source) }}</span>
              <el-input-number :model-value="qtyFromLabel(e.label)" :min="1" :max="9999" controls-position="right"
                size="small" style="width: 96px" @update:model-value="onQtyInput(e, $event)" />
              <el-select :model-value="unitOf(e) || resolveUnit(e.source, e.target)" placeholder="单位" clearable
                filterable allow-create default-first-option size="small" style="width: 76px"
                @update:model-value="onUnitInput(e, $event)">
                <el-option v-for="u in getUnitOptions()" :key="u" :label="u" :value="u" />
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
                @update:model-value="onUnitInput(e, $event)">
                <el-option v-for="u in getUnitOptions()" :key="u" :label="u" :value="u" />
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
          <el-form-item label="输出单位（下游输入自动继承）">
            <el-select v-model="outputUnit" style="width: 100%" filterable allow-create default-first-option
              placeholder="选择或输入单位">
              <el-option v-for="u in getUnitOptions()" :key="u" :label="u" :value="u" />
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

.qty-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.2;
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
