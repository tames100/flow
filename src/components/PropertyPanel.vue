<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useVueFlow } from '@vue-flow/core'
import { useRecipeGraph } from '../composables/useRecipeGraph'
import { useActionTypes } from '../composables/useActionTypes'

const { findNode, updateNode } = useVueFlow()
const { deleteNode, duplicateNode, persist } = useRecipeGraph()
const { allActions } = useActionTypes()

const selectedId = ref<string | null>(null)
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
      updateNode(node.value.id, { data: { ...node.value.data, action: v, label: v } })
      persist()
    }
  },
})

const image = computed(() => (node.value?.data as any)?.image ?? '')

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

// 由 App 通过 v-model 同步选中节点
const props = defineProps<{ modelValue: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [string | null] }>()

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

        <el-button type="primary" plain style="width: 100%" @click="onDuplicate">
          复制节点
        </el-button>
        <el-button type="danger" plain style="width: 100%; margin-top: 10px" @click="onDelete">
          删除节点
        </el-button>
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
