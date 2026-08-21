<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import type { ItemNodeData } from '../../types'

const props = defineProps<{
  id: string
  data: ItemNodeData
}>()

const hasImage = computed(() => !!props.data.image)
const displayName = computed(() => props.data.label || '未命名物品')
</script>

<template>
  <div
    class="item-node"
    :class="{ 'no-label': !data.showLabel }"
  >
    <!-- 输入连接点（物品作为原料时位于左侧） -->
    <Handle type="target" :position="Position.Left" :connectable="true" />

    <div class="item-content">
      <img
        v-if="hasImage"
        :src="data.image"
        :alt="displayName"
        class="item-img"
      />
      <div v-else class="item-img placeholder">📦</div>
      <span v-if="data.showLabel" class="item-label">{{ displayName }}</span>
    </div>

    <!-- 输出连接点（物品作为产物时位于右侧） -->
    <Handle type="source" :position="Position.Right" :connectable="true" />
  </div>
</template>

<style scoped>
.item-node {
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

.item-node:hover {
  box-shadow: 0 4px 14px rgba(103, 194, 58, 0.45);
}

.item-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.item-img {
  width: 48px;
  height: 48px;
  object-fit: cover;
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

.item-node.no-label {
  padding: 6px;
}
</style>
