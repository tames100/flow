<script setup lang="ts">
defineProps<{ modelValue: boolean }>()
defineEmits<{ 'update:modelValue': [boolean] }>()

// 快捷键说明数据
const shortcutsList = [
  { keys: '左键拖动', desc: '平移画布' },
  { keys: '滚轮', desc: '缩放画布' },
  { keys: '点击节点', desc: '选中并在属性面板编辑，高亮其上游配方链' },
  { keys: '点击连线', desc: '编辑连线数量与样式（线型 / 颜色 / 动画 / 端点）' },
  { keys: 'Ctrl + 左键点击节点', desc: '立即复制节点（新 ID，副本偏移显示）' },
  { keys: 'Ctrl + 左键拖动节点', desc: '复制并拖出副本（原件留在原位）' },
  { keys: 'Ctrl + 左键拖动', desc: '框选多个节点' },
  { keys: '点击空白', desc: '取消选中 / 取消高亮' },
  { keys: '右键画布', desc: '打开菜单：创建物品/加工动作节点' },
  { keys: '右键节点', desc: '打开菜单：属性修改 / 复制 / 删除' },
  { keys: 'Ctrl/⌘ + S', desc: '保存当前画布状态（节点位置 / 连线 / 视图）' },
  { keys: 'Ctrl + A', desc: '全选所有节点' },
  { keys: 'Ctrl + C', desc: '复制选中节点' },
  { keys: 'Ctrl + V', desc: '粘贴（复制生成的新节点）' },
  { keys: 'Delete / Backspace', desc: '删除选中节点' },
  { keys: 'Esc', desc: '取消选中 / 关闭弹窗 / 关闭图片预览' },
]
</script>

<template>
  <el-dialog :model-value="modelValue" title="快捷键说明" width="440px" append-to-body
    @update:model-value="$emit('update:modelValue', $event)">
    <el-table :data="shortcutsList" size="small" border>
      <el-table-column prop="keys" label="快捷键" width="140">
        <template #default="{ row }">
          <span class="kbd">{{ row.keys }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="desc" label="功能说明" />
    </el-table>
  </el-dialog>
</template>

<style scoped>
.kbd {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  background: #f4f4f5;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 12px;
  white-space: nowrap;
}
</style>
