<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { useContextMenu, useGroups, isImageIcon, type ItemNodeData } from '../../composables'

const props = defineProps<{
  id: string
  data: ItemNodeData
}>()

const { getNodes } = useVueFlow()
const { open: openContextMenu } = useContextMenu()
const { allGroups } = useGroups()

const hasImage = computed(() => !!props.data.image)
const displayName = computed(() => props.data.label || '未命名物品')
/** 过滤掉名称与值均为空的属性行 */
const displayAttrs = computed(() =>
  (props.data.attributes ?? []).filter(
    (a) => (a.name ?? '').trim() || String(a.value ?? '').trim(),
  ),
)
/** 解析节点所属分组名称（渲染时自动忽略已删除的无效 id） */
const groupNames = computed(() => {
  const ids = props.data.groupIds ?? []
  if (!ids.length) return []
  return allGroups()
    .filter((g) => ids.includes(g.id))
    .map((g) => g.name)
})

function onContextMenu(e: MouseEvent) {
  const selectedIds = (getNodes.value as any[]).filter((n) => n.selected).map((n) => n.id)
  if (selectedIds.length >= 2) {
    const kinds = new Set(
      (getNodes.value as any[])
        .filter((n) => n.selected)
        .map((n) => (n.data?.kind as 'item' | 'action') ?? 'item'),
    )
    const allKind = kinds.size === 1 ? (kinds.values().next().value as 'item' | 'action') : 'mixed'
    openContextMenu(e, { type: 'multi-node', nodeIds: selectedIds, allKind })
    return
  }
  openContextMenu(e, { type: 'node', nodeId: props.id, nodeKind: 'item' })
}
</script>

<template>
  <div class="item-node" :class="{ 'no-label': !data.showLabel }" @contextmenu="onContextMenu">
    <!-- 输入连接点（物品作为原料时位于左侧） -->
    <Handle type="target" :position="Position.Left" :connectable="true" />

    <span class="node-badge" title="物品节点（原料 / 产物）">物品</span>

    <!-- 分组标签（一个节点可归属多个分组） -->
    <div v-if="groupNames.length" class="node-groups">
      <span v-for="name in groupNames" :key="name" class="group-tag">{{ name }}</span>
    </div>

    <div class="item-content">
      <div class="item-img-box">
        <img v-if="hasImage" :src="data.image" :alt="displayName" class="item-img" />
        <div v-else class="item-img placeholder">📦</div>
      </div>
      <span v-if="data.showLabel" class="item-label">{{ displayName }}</span>
      <div v-if="data.description" class="node-desc" :title="data.description">{{ data.description }}</div>
      <!-- 物品属性：图标 + 名称 + 值 + 说明（图标与说明非必选） -->
      <div v-if="displayAttrs.length" class="node-attrs">
        <div v-for="a in displayAttrs" :key="`${a.name}-${a.value}`" class="node-attr" :title="a.desc || a.name">
          <img v-if="a.icon && isImageIcon(a.icon)" :src="a.icon" class="attr-icon-img" />
          <span v-else-if="a.icon" class="attr-icon">{{ a.icon }}</span>
          <span class="attr-text">{{ a.name }}: {{ a.value }}</span>
        </div>
      </div>
    </div>

    <!-- 输出连接点（物品作为产物时位于右侧） -->
    <Handle type="source" :position="Position.Right" :connectable="true" />
  </div>
</template>

<style scoped>
.item-node {
  position: relative;
  min-width: 90px;
  padding: 8px 10px;
  background: #ffffff;
  border: 2px solid #67c23a;
  border-radius: 10px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  user-select: none;
  text-align: center;
  transition: box-shadow 0.15s ease;
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
  background: #67c23a;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  user-select: none;
  pointer-events: none;
}

.item-node:hover {
  box-shadow: 0 4px 14px rgba(103, 194, 58, 0.45);
}

.item-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.item-img-box {
  position: relative;
  width: 56px;
  height: 56px;
}

.item-img {
  width: 56px;
  height: 56px;
  object-fit: contain;
  border-radius: 8px;
  background: #f4f4f5;
}

.item-img.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}

.item-label {
  font-size: 13px;
  font-weight: 600;
  color: #1f2933;
  word-break: break-all;
}

.node-desc {
  max-width: 170px;
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.45;
  color: #909399;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 物品属性：图标 + 名称:值 + 说明 */
.node-attrs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
  max-width: 170px;
}

.node-attr {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  font-size: 11px;
  line-height: 16px;
  color: #606266;
  background: #f4f7fb;
  border: 1px solid #e1e8f0;
  border-radius: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-attr .attr-icon {
  font-size: 12px;
}

.node-attr .attr-icon-img {
  width: 14px;
  height: 14px;
  object-fit: contain;
  flex-shrink: 0;
}

.node-attr .attr-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-node.no-label {
  padding: 6px;
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
