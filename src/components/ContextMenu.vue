<script setup lang="ts">
import { useContextMenu } from '../composables'

const { visible, x, y, target, close } = useContextMenu()

const emit = defineEmits<{
  createItem: [screen: { x: number; y: number }]
  createAction: [screen: { x: number; y: number }]
  edit: [nodeId: string]
  duplicate: [nodeId: string]
  remove: [nodeId: string]
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
function duplicate() {
  if (target.value.type === 'node') emit('duplicate', target.value.nodeId)
  close()
}
function remove() {
  if (target.value.type === 'node') emit('remove', target.value.nodeId)
  close()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="ctx-overlay" @click="close" @contextmenu.prevent="close">
      <div
        class="ctx-menu"
        :style="{ left: x + 'px', top: y + 'px' }"
        @click.stop
        @contextmenu.stop
      >
        <template v-if="target.type === 'canvas'">
          <div class="ctx-item" @click="createItem">➕ 创建物品节点</div>
          <div class="ctx-item" @click="createAction">⚙️ 创建加工动作节点</div>
        </template>

        <template v-else>
          <div class="ctx-item" @click="edit">✏️ 属性修改</div>
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
