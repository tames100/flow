<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { SourceMachine } from '../composables'

const props = defineProps<{
  modelValue: boolean
  sourceData: SourceMachine | null
}>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: [selectedNames: string[]]
}>()

const recipeChecked = ref<Record<string, boolean>>({})

// 新源数据载入时：重置勾选为「全选」
watch(
  () => props.sourceData,
  (s) => {
    recipeChecked.value = {}
    if (s) s.recipes.forEach((r) => (recipeChecked.value[r.name] = true))
  },
  { immediate: true },
)

const sourceCheckedNames = computed<string[]>({
  get: () =>
    props.sourceData?.recipes
      .filter((r) => recipeChecked.value[r.name])
      .map((r) => r.name) ?? [],
  set: (names) => {
    props.sourceData?.recipes.forEach(
      (r) => (recipeChecked.value[r.name] = names.includes(r.name)),
    )
  },
})

const allSourceChecked = computed(() => {
  const s = props.sourceData
  return !!s && s.recipes.length > 0 && s.recipes.every((r) => recipeChecked.value[r.name])
})

function onCheckAll() {
  const allChecked = props.sourceData?.recipes.every((r) => recipeChecked.value[r.name])
  props.sourceData?.recipes.forEach((r) => (recipeChecked.value[r.name] = !allChecked))
}

function onConfirm() {
  const selected =
    props.sourceData?.recipes
      .filter((r) => recipeChecked.value[r.name])
      .map((r) => r.name) ?? []
  emit('confirm', selected)
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="选择要导入的配方" width="720px" append-to-body
    :close-on-click-modal="false" @update:model-value="emit('update:modelValue', $event)">
    <div v-if="sourceData" class="source-meta">
      <div class="source-name">{{ sourceData.machine }}</div>
      <div v-if="sourceData.description" class="source-desc">{{ sourceData.description }}</div>
      <div class="source-count">共 {{ sourceData.recipes.length }} 条配方，相同物品自动合并为一个节点。</div>
    </div>
    <el-checkbox :model-value="allSourceChecked" @change="onCheckAll">全选 / 全不选</el-checkbox>
    <el-scrollbar max-height="320px" class="source-list">
      <el-checkbox-group v-model="sourceCheckedNames">
        <el-checkbox v-for="r in sourceData?.recipes ?? []" :key="r.name" :label="r.name" class="source-item">
          <span class="source-item-name">{{ r.name }}</span>
          <span class="source-item-cat">{{ r.category ? '分类：' + r.category : '' }}</span>
        </el-checkbox>
      </el-checkbox-group>
    </el-scrollbar>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="onConfirm">导入所选配方</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.source-meta {
  padding: 10px 12px;
  border-radius: 6px;
  background: #f5f7fa;
  margin-bottom: 10px;
}

.source-name {
  font-size: 14px;
  font-weight: 700;
  color: #303133;
}

.source-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.source-count {
  margin-top: 4px;
  font-size: 12px;
  color: #606266;
}

.source-list {
  margin-top: 10px;
  padding: 4px 8px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
}

.source-item {
  display: flex;
  align-items: center;
  width: 100%;
  margin-right: 0;
  padding: 4px 0;
}

.source-item-name {
  font-size: 13px;
  color: #303133;
}

.source-item-cat {
  margin-left: 8px;
  font-size: 12px;
  color: #909399;
}
</style>
