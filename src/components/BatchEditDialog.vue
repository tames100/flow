<script setup lang="ts">
import { ref, watch } from 'vue'
import type { RecipeGroup } from '../types'

const props = defineProps<{
  modelValue: boolean
  nodeCount: number
  groups: RecipeGroup[]
  /** 打开时初始化用的分组 id（选中节点交集） */
  initialGroupIds: string[]
  /** 打开时初始化用的模式 */
  initialMode: 'union' | 'replace'
}>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: [groupIds: string[], mode: 'union' | 'replace']
}>()

const groupIds = ref<string[]>([])
const mode = ref<'union' | 'replace'>('union')

// 打开时同步初始值（由父组件根据选中节点交集预先计算）
watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      groupIds.value = [...props.initialGroupIds]
      mode.value = props.initialMode
    }
  },
)

function onConfirm() {
  emit('confirm', groupIds.value, mode.value)
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="批量编辑分组" width="480px" append-to-body
    @update:model-value="emit('update:modelValue', $event)">
    <div class="batch-edit-summary">
      已选中 <b>{{ nodeCount }}</b> 个物品节点
    </div>
    <div class="batch-edit-mode">
      <el-radio-group v-model="mode" size="default">
        <el-radio-button label="replace">覆盖原有分组</el-radio-button>
        <el-radio-button label="union">合并到原有分组</el-radio-button>
      </el-radio-group>
    </div>
    <div class="batch-edit-select">
      <el-select v-model="groupIds" multiple filterable collapse-tags collapse-tags-tooltip
        default-first-option clearable placeholder="请选择要写入的分组" style="width: 100%">
        <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
      </el-select>
    </div>
    <div class="batch-edit-tip" v-if="mode === 'replace'">
      覆盖模式：勾选后，所有选中节点的分组将被替换为你的选择；不勾选任何分组则全部清空。
    </div>
    <div class="batch-edit-tip" v-else>
      合并模式：勾选的分组将追加到所有选中节点的原有分组上，不删除已有分组。
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="onConfirm">确认修改</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.batch-edit-summary {
  font-size: 14px;
  margin-bottom: 14px;
  color: #303133;
}

.batch-edit-mode {
  margin-bottom: 14px;
}

.batch-edit-select {
  margin-bottom: 10px;
}

.batch-edit-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
  background: #f4f4f5;
  padding: 8px 10px;
  border-radius: 6px;
}
</style>
