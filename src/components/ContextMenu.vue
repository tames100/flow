<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { useContextMenu } from '../composables/useContextMenu'

const { visible, x, y, target, close } = useContextMenu()

const emit = defineEmits<{
  createItem: [screen: { x: number; y: number }]
  createAction: [screen: { x: number; y: number }]
  edit: [nodeId: string]
  duplicate: [nodeId: string]
  remove: [nodeId: string]
}>()

function onDocDown(e: MouseEvent) {
  // 点击菜单外区域关闭（点击菜单项本身会先执行再关闭）
  const el = e.target as HTMLElement
  if (!el.closest('.ctx-menu')) close()
}

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

// 打开时屏蔽背景右键默认菜单 + 监听全局点击关闭
watch(visible, (v) => {
  if (v) {
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('contextmenu', onDocContext)
  } else {
    document.removeEventListener('mousedown', onDocDown)
    document.removeEventListener('contextmenu', onDocContext)
  }
})

function onDocContext(e: MouseEvent) {
  // 菜单打开期间，任何右键都先关闭（并阻止浏览器原生菜单）
  e.preventDefault()
  close()
}

onMounted(() => {})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown)
  document.removeEventListener('contextmenu', onDocContext)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="ctx-menu"
      :style="{ left: x + 'px', top: y + 'px' }"
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
  </Teleport>
</template>

<style scoped>
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
