<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useVueFlow, MarkerType } from '@vue-flow/core'
import { useRecipeGraph, useUnits } from '../composables'

// 由 PropertyPanel 通过 v-model 同步当前选中连线
const props = defineProps<{ modelValue: string | null }>()
const emit = defineEmits<{
  'update:modelValue': [string | null]
}>()

const { findNode, getEdges, removeEdges } = useVueFlow()
const { persist, getCanvasUnits } = useRecipeGraph()
const { allUnits, addUnit, removeUnit } = useUnits()

const edgeId = ref<string | null>(props.modelValue)
watch(
  () => props.modelValue,
  (v) => (edgeId.value = v ?? null),
)
watch(edgeId, (v) => emit('update:modelValue', v))

const selectedEdge = computed(() =>
  edgeId.value ? getEdges.value.find((e) => e.id === edgeId.value) ?? null : null,
)

function nodeName(id: string) {
  const n = findNode(id)
  return ((n?.data as any)?.label as string) || id
}

function qtyFromLabel(label: unknown): number {
  const m = /×(\d+)/.exec(String(label ?? ''))
  return m ? +m[1] : 1
}

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

/** 更新单条连线的数量与单位 */
function applyEdgeQty(e: any, q: number, unit = '') {
  const isIn = e.target === edgeId.value
  const qty = Math.max(1, Math.floor(q || 1))
  const label = qty > 1 || unit ? `×${qty}${unit ? ' ' + unit : ''}` : ''
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
</script>

<template>
  <el-form v-if="selectedEdge" label-position="top">
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

<style scoped>
.qty-unit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
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

.edge-dir {
  font-size: 13px;
  color: #606266;
  word-break: break-all;
}
</style>
