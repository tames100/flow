<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useContextMenu, useGroups, type ActionNodeData } from '../../composables'

const props = defineProps<{
  id: string
  data: ActionNodeData
}>()

const { open: openContextMenu } = useContextMenu()
const { allGroups } = useGroups()

const iconMap: Record<string, string> = {
  合成: '⚗️',
  搅拌: '🥄',
  切割: '🔪',
  熔炼: '🔥',
}

const icon = computed(() => iconMap[props.data.action] ?? '⚙️')
const hasImage = computed(() => !!props.data.image)
/** 解析节点所属分组名称（加工节点仅保留归属，不继承分组属性） */
const groupNames = computed(() => {
  const ids = props.data.groupIds ?? []
  if (!ids.length) return []
  return allGroups()
    .filter((g) => ids.includes(g.id))
    .map((g) => g.name)
})

function onContextMenu(e: MouseEvent) {
  openContextMenu(e, { type: 'node', nodeId: props.id, nodeKind: 'action' })
}
</script>

<template>
  <div class="action-node" @contextmenu="onContextMenu">
    <!-- 接收多个输入物品（左侧入点） -->
    <Handle type="target" :position="Position.Left" :connectable="true" />

    <span class="node-badge" title="加工动作节点">加工</span>

    <!-- 分组标签（加工节点仅保留归属，不继承分组属性） -->
    <div v-if="groupNames.length" class="node-groups">
      <span v-for="name in groupNames" :key="name" class="group-tag">{{ name }}</span>
    </div>

    <div class="action-body">
      <img v-if="hasImage" :src="data.image" class="action-img" :alt="data.label" />
      <span v-else class="action-icon">{{ icon }}</span>
      <span class="action-label">{{ data.label }}</span>
      <div v-if="data.description" class="node-desc" :title="data.description">{{ data.description }}</div>
      <div v-if="data.extra" class="node-extra" :title="`附加操作 / 条件：${data.extra}`">
        <span class="extra-icon">📌</span>{{ data.extra }}
      </div>
    </div>

    <!-- 输出产物（右侧出点） -->
    <Handle type="source" :position="Position.Right" :connectable="true" />
  </div>
</template>

<style scoped>
.action-node {
  position: relative;
  min-width: 110px;
  padding: 10px 14px;
  background: linear-gradient(135deg, #fef0e6, #ffe2cc);
  border: 2px solid #e6a23c;
  border-radius: 14px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  user-select: none;
}

/* 加工节点整体比物品节点小一号 */
.action-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.node-badge {
  position: absolute;
  top: -10px;
  left: -10px;
  z-index: 1;
  padding: 1px 7px;
  font-size: 10px;
  line-height: 16px;
  color: #fff;
  background: #e6a23c;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  user-select: none;
  pointer-events: none;
}

.action-icon {
  font-size: 22px;
  line-height: 1;
}

.action-img {
  width: 48px;
  height: 48px;
  object-fit: contain;
  border-radius: 8px;
  background: #fff;
}

.action-label {
  /* 比物品节点（13px）小一号 */
  font-size: 12px;
  font-weight: 700;
  color: #b35a00;
}

.node-desc {
  max-width: 170px;
  margin-top: 1px;
  font-size: 11px;
  line-height: 1.45;
  color: #a8784a;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 附加操作 / 附加条件徽章 */
.node-extra {
  display: flex;
  align-items: center;
  gap: 3px;
  max-width: 170px;
  margin-top: 2px;
  padding: 1px 6px;
  font-size: 10.5px;
  line-height: 1.5;
  color: #b35a00;
  background: rgba(255, 255, 255, 0.55);
  border: 1px dashed rgba(230, 162, 60, 0.7);
  border-radius: 6px;
  word-break: break-all;
}

.extra-icon {
  flex-shrink: 0;
  font-size: 10px;
}

/* 分组标签 */
.node-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  justify-content: center;
  margin-bottom: 2px;
}

.group-tag {
  padding: 0 6px;
  font-size: 10px;
  line-height: 16px;
  color: #7c3aed;
  background: #f3e8ff;
  border: 1px solid #c4b5fd;
  border-radius: 8px;
  white-space: nowrap;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
