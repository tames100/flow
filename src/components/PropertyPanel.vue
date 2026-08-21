<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useVueFlow } from '@vue-flow/core'
import { useRecipeGraph, useActionTypes, useImagePreview } from '../composables'

const { findNode, updateNode, getEdges, updateEdge } = useVueFlow()
const { deleteNode, duplicateNode, persist, edges } = useRecipeGraph()
const { allActions, addAction } = useActionTypes()
const { openImage } = useImagePreview()

// 由 App 通过 v-model 同步选中节点
const props = defineProps<{ modelValue: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [string | null] }>()

// 初始即同步当前选中值（解决首帧空白问题）
const selectedId = ref<string | null>(props.modelValue)
const fileInput = ref<HTMLInputElement | null>(null)
const actionFileInput = ref<HTMLInputElement | null>(null)

const node = computed(() => (selectedId.value ? findNode(selectedId.value) : null))

const isItem = computed(() => node.value?.data?.kind === 'item')
const isAction = computed(() => node.value?.data?.kind === 'action')

const label = computed({
  get: () => (node.value?.data ? (node.value.data as any).label ?? '' : ''),
  set: (v: string) => {
    if (node.value) {
      updateNode(node.value.id, { data: { ...node.value.data, label: v } })
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

const image = computed(() => (node.value?.data as any)?.image ?? '')

// ---- 加工节点输入 / 输出数量（有向图语义）----
// 任何指向加工节点的连线均为输入；任何从加工节点指出的连线均为输出
const inEdges = computed(() =>
  selectedId.value ? edges.value.filter((e) => e.target === selectedId.value) : [],
)
const outEdges = computed(() =>
  selectedId.value ? edges.value.filter((e) => e.source === selectedId.value) : [],
)

function qtyFromLabel(label: unknown): number {
  const m = /×(\d+)/.exec(String(label ?? ''))
  return m ? +m[1] : 1
}

function nodeName(id: string) {
  const n = findNode(id)
  return ((n?.data as any)?.label as string) || id
}

/** 更新单条连线的数量（该边指向本节点则为输入，由本节点指出则为输出），同步连线数字 */
function applyEdgeQty(e: any, q: number) {
  const isIn = e.target === selectedId.value
  const label = q > 1 ? `×${q}` : ''
  const labelStyle = isIn
    ? { fill: '#409eff', fontWeight: 700, fontSize: '12px' }
    : { fill: '#e6a23c', fontWeight: 700, fontSize: '12px' }
  // 同步画布上的连线数字
  const vf = getEdges.value.find((x) => x.id === e.id)
  if (vf) {
    updateEdge(vf as any, {
      label,
      labelStyle,
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
    } as any)
  }
  // 同步本地存储
  e.label = label
  e.labelStyle = labelStyle
  persist()
}

function onEdgeQtyChange(e: any, v: number | undefined) {
  applyEdgeQty(e, v ?? 1)
}

function pickImage() {
  fileInput.value?.click()
}

function onFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const reader = new FileReader()
  reader.onload = () => {
    const dataURL = reader.result as string
    if (node.value) {
      updateNode(node.value.id, { data: { ...node.value.data, image: dataURL } })
      persist()
    }
    ElMessage.success('图片已替换')
  }
  reader.readAsDataURL(f)
  ;(e.target as HTMLInputElement).value = ''
}

// 加工动作图标图片替换（仅动作节点）
function pickActionImage() {
  actionFileInput.value?.click()
}

function onActionFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const reader = new FileReader()
  reader.onload = () => {
    const dataURL = reader.result as string
    if (node.value) {
      updateNode(node.value.id, { data: { ...node.value.data, image: dataURL } })
      persist()
    }
    ElMessage.success('动作图标已替换')
  }
  reader.readAsDataURL(f)
  ;(e.target as HTMLInputElement).value = ''
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

// 由 App 通过 v-model 同步选中节点（props/emit/selectedId 已在顶部声明）
watch(
  () => props.modelValue,
  (v) => (selectedId.value = v),
)
watch(selectedId, (v) => emit('update:modelValue', v))
</script>

<template>
  <div class="prop-panel">
    <h3 class="panel-title">属性面板</h3>

    <el-empty v-if="!node" description="选中一个节点以编辑属性" :image-size="60" />

    <template v-else>
      <el-form label-position="top">
        <el-form-item label="节点类型">
          <el-tag :type="isItem ? 'success' : 'warning'">
            {{ isItem ? '物品节点' : '加工动作节点' }}
          </el-tag>
        </el-form-item>

        <el-form-item label="名称">
          <el-input v-model="label" placeholder="节点名称" />
        </el-form-item>

        <template v-if="isItem">
          <el-form-item label="显示文字">
            <el-switch v-model="showLabel" active-text="图片+文字" inactive-text="仅图片" />
          </el-form-item>
          <el-form-item label="图片">
            <div class="img-box">
              <img
                v-if="image"
                :src="image"
                class="preview zoomable"
                :title="`点击放大：${label}`"
                @click.stop="openImage(image, label)"
              />
              <div v-else class="preview placeholder">无</div>
              <el-button size="small" type="primary" @click="pickImage">替换图片</el-button>
            </div>
            <input ref="fileInput" type="file" accept="image/*" style="display: none" @change="onFileChange" />
          </el-form-item>
        </template>

        <template v-if="isAction">
          <el-form-item v-if="inEdges.length" label="输入数量">
            <div v-for="e in inEdges" :key="e.id" class="qty-row">
              <span class="qty-name" :title="nodeName(e.source)">{{ nodeName(e.source) }}</span>
              <el-input-number
                :model-value="qtyFromLabel(e.label)"
                :min="1"
                :max="9999"
                controls-position="right"
                size="small"
                style="width: 120px"
                @change="onEdgeQtyChange(e, $event)"
              />
            </div>
            <div class="qty-tip">指向本加工节点的连线均为输入</div>
          </el-form-item>
          <el-form-item v-if="outEdges.length" label="输出数量">
            <div v-for="e in outEdges" :key="e.id" class="qty-row">
              <span class="qty-name" :title="nodeName(e.target)">{{ nodeName(e.target) }}</span>
              <el-input-number
                :model-value="qtyFromLabel(e.label)"
                :min="1"
                :max="9999"
                controls-position="right"
                size="small"
                style="width: 120px"
                @change="onEdgeQtyChange(e, $event)"
              />
            </div>
            <div class="qty-tip">本加工节点指出的连线均为输出</div>
          </el-form-item>
          <el-form-item label="加工动作">
            <el-select
              v-model="action"
              style="width: 100%"
              filterable
              allow-create
              default-first-option
              placeholder="选择或输入自定义动作"
            >
              <el-option v-for="a in allActions()" :key="a" :label="a" :value="a" />
            </el-select>
          </el-form-item>
          <el-form-item label="动作图标">
            <div class="img-box">
              <img
                v-if="image"
                :src="image"
                class="preview zoomable"
                :title="`点击放大：${label}`"
                @click.stop="openImage(image, label)"
              />
              <div v-else class="preview placeholder">默认</div>
              <el-button size="small" type="primary" @click="pickActionImage">替换图标</el-button>
            </div>
            <input
              ref="actionFileInput"
              type="file"
              accept="image/*"
              style="display: none"
              @change="onActionFileChange"
            />
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
.panel-title {
  margin: 0 0 12px;
  font-size: 16px;
}
.qty-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
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
