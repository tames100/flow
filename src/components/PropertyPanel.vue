<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useVueFlow } from '@vue-flow/core'
import { useRecipeGraph, useActionTypes } from '../composables'

const { findNode, updateNode, getEdges, updateEdge } = useVueFlow()
const { deleteNode, duplicateNode, persist, edges } = useRecipeGraph()
const { allActions, addAction } = useActionTypes()

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

// ---- 连线数量编辑（仅物品节点）----
// hasOutgoing：该物品作为原料连接到动作节点（出边）；hasIncoming：该物品作为产物被输出（入边）
const hasOutgoing = computed(() =>
  selectedId.value ? edges.value.some((e) => e.source === selectedId.value) : false,
)
const hasIncoming = computed(() =>
  selectedId.value ? edges.value.some((e) => e.target === selectedId.value) : false,
)

function qtyFromLabel(label: unknown): number {
  const m = /×(\d+)/.exec(String(label ?? ''))
  return m ? +m[1] : 1
}

/** 更新物品节点某侧所有连线的数量，并同步 VueFlow 渲染与本地存储 */
function applyQty(side: 'out' | 'in', q: number) {
  const id = selectedId.value
  if (!id) return
  const list = edges.value.filter((e) => (side === 'out' ? e.source === id : e.target === id))
  if (!list.length) return
  const label = q > 1 ? `×${q}` : ''
  const labelStyle =
    side === 'out'
      ? { fill: '#409eff', fontWeight: 700, fontSize: '12px' }
      : { fill: '#e6a23c', fontWeight: 700, fontSize: '12px' }
  const vfEdges = getEdges.value
  for (const e of list) {
    // 同步画布上的连线数字
    const vf = vfEdges.find((x) => x.id === e.id)
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
  }
  persist()
}

/** 输入数量：该物品作为原料时（出边 source）的数量 */
const inQty = computed({
  get: () => {
    if (!selectedId.value) return 1
    const e = edges.value.find((x) => x.source === selectedId.value)
    return e ? qtyFromLabel(e.label) : 1
  },
  set: (v: number) => applyQty('out', v),
})

/** 输出数量：该物品作为产物时（入边 target）的数量 */
const outQty = computed({
  get: () => {
    if (!selectedId.value) return 1
    const e = edges.value.find((x) => x.target === selectedId.value)
    return e ? qtyFromLabel(e.label) : 1
  },
  set: (v: number) => applyQty('in', v),
})

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
          <el-form-item v-if="hasOutgoing" label="输入数量（作为原料）">
            <el-input-number v-model="inQty" :min="1" :max="9999" controls-position="right" style="width: 100%" />
            <div class="qty-tip">同步该物品到所有加工节点的连线数字</div>
          </el-form-item>
          <el-form-item v-if="hasIncoming" label="输出数量（作为产物）">
            <el-input-number v-model="outQty" :min="1" :max="9999" controls-position="right" style="width: 100%" />
            <div class="qty-tip">同步所有加工节点到该物品的连线数字</div>
          </el-form-item>
          <el-form-item label="显示文字">
            <el-switch v-model="showLabel" active-text="图片+文字" inactive-text="仅图片" />
          </el-form-item>
          <el-form-item label="图片">
            <div class="img-box">
              <img v-if="image" :src="image" class="preview" />
              <div v-else class="preview placeholder">无</div>
              <el-button size="small" type="primary" @click="pickImage">替换图片</el-button>
            </div>
            <input ref="fileInput" type="file" accept="image/*" style="display: none" @change="onFileChange" />
          </el-form-item>
        </template>

        <template v-if="isAction">
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
              <img v-if="image" :src="image" class="preview" />
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
.preview.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
  background: #f4f4f5;
}
</style>
