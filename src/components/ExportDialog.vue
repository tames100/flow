<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: [scope: 'current' | 'all']
}>()

const scope = ref<'current' | 'all'>('all')

// 打开时重置为默认「全部画布」
watch(
  () => props.modelValue,
  (v) => {
    if (v) scope.value = 'all'
  },
)

function onConfirm() {
  emit('confirm', scope.value)
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="导出 JSON" width="420px" append-to-body
    @update:model-value="emit('update:modelValue', $event)">
    <div class="export-scope">
      <el-radio-group v-model="scope">
        <div class="export-option">
          <el-radio label="all">导出全部画布</el-radio>
          <div class="export-desc">包含所有画布的节点 / 连线 / 视图（多画布格式，可作为备份）</div>
        </div>
        <div class="export-option">
          <el-radio label="current">仅导出当前画布</el-radio>
          <div class="export-desc">仅当前活动画布（单画布格式，向后兼容旧版本）</div>
        </div>
      </el-radio-group>
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="onConfirm">导出</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.export-scope {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0;
}

.export-option {
  padding: 8px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
}

.export-desc {
  margin-top: 4px;
  margin-left: 24px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
</style>
