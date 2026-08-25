<script setup lang="ts">
import { useContextMenu } from '../composables'

const { visible, x, y, target, close } = useContextMenu()

const emit = defineEmits<{
  createItem: [screen: { x: number; y: number }]
  createAction: [screen: { x: number; y: number }]
  edit: [nodeId: string]
  editRecipe: [nodeId: string]
  duplicate: [nodeId: string]
  remove: [nodeId: string]
  batchEditGroup: [nodeIds: string[]]
}>()

function createItem() {
  emit('createItem', { x: x.value, y: y.value })
  close()
}
function createAction() {
  emit('createAction', { x: x.value, y: y.value })
  close()
}
function edit() {
  if (target.value.type === 'node') emit('edit', target.value.nodeId)
  close()
}
function editRecipe() {
  if (target.value.type === 'node') emit('editRecipe', target.value.nodeId)
  close()
}
function duplicate() {
  if (target.value.type === 'node') emit('duplicate', target.value.nodeId)
  close()
}
function remove() {
  if (target.value.type === 'node') emit('remove', target.value.nodeId)
  else if (target.value.type === 'multi-node') target.value.nodeIds.forEach((id) => emit('remove', id))
  close()
}
function batchEditGroup() {
  if (target.value.type === 'multi-node') emit('batchEditGroup', target.value.nodeIds)
  close()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="ctx-overlay" @click="close" @contextmenu.prevent="close">
      <div class="ctx-menu" :style="{ left: x + 'px', top: y + 'px' }" @click.stop @contextmenu.stop>
        <template v-if="target.type === 'canvas'">
          <div class="ctx-item" @click="createItem">➕ 创建物品节点</div>
          <div class="ctx-item" @click="createAction">⚙️ 创建加工动作节点</div>
        </template>

        <template v-else-if="target.type === 'multi-node'">
          <div class="ctx-info">已选中 {{ target.nodeIds.length }} 个节点</div>
          <div v-if="target.allKind === 'item'" class="ctx-item" @click="batchEditGroup">
            🗂️ 批量编辑分组
          </div>
          <div class="ctx-item danger" @click="remove">🗑️ 批量删除节点</div>
        </template>

        <template v-else>
          <div class="ctx-item" @click="edit">✏️ 属性修改</div>
          <div v-if="target.type === 'node' && target.nodeKind === 'action'" class="ctx-item" @click="editRecipe">
            📝 修改配方
          </div>
          <div class="ctx-item" @click="duplicate">📑 复制节点</div>
          <div class="ctx-item danger" @click="remove">🗑️ 删除节点</div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.ctx-menu {
  position: fixed;
  min-width: 160px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  padding: 4px;
  z-index: 10000;
  user-select: none;
  font-size: 13px;
}

.ctx-info {
  padding: 6px 12px;
  font-size: 12px;
  color: #909399;
  border-bottom: 1px solid #ebeef5;
  margin-bottom: 4px;
  white-space: nowrap;
}

.ctx-item {
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.ctx-item:hover {
  background: #ecf5ff;
  color: #409eff;
}

.ctx-item.danger:hover {
  background: #fef0f0;
  color: #f56c6c;
}
</style>
