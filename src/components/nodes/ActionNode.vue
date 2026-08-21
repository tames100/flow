<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import type { ActionNodeData } from '../../types'

const props = defineProps<{
  id: string
  data: ActionNodeData
}>()

const iconMap: Record<string, string> = {
  合成: '⚗️',
  搅拌: '🥄',
  切割: '🔪',
  熔炼: '🔥',
}

const icon = computed(() => iconMap[props.data.action] ?? '⚙️')
const hasImage = computed(() => !!props.data.image)
</script>

<template>
  <div class="action-node">
    <!-- 接收多个输入物品（左侧入点） -->
    <Handle type="target" :position="Position.Left" :connectable="true" />

    <div class="action-body">
      <img v-if="hasImage" :src="data.image" class="action-img" :alt="data.label" />
      <span v-else class="action-icon">{{ icon }}</span>
      <span class="action-label">{{ data.label }}</span>
    </div>

    <!-- 输出产物（右侧出点） -->
    <Handle type="source" :position="Position.Right" :connectable="true" />
  </div>
</template>

<style scoped>
.action-node {
  min-width: 110px;
  padding: 10px 14px;
  background: linear-gradient(135deg, #fef0e6, #ffe2cc);
  border: 2px solid #e6a23c;
  border-radius: 14px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  user-select: none;
}

.action-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.action-icon {
  font-size: 26px;
  line-height: 1;
}

.action-img {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 8px;
  background: #fff;
}

.action-label {
  font-size: 14px;
  font-weight: 700;
  color: #b35a00;
}
</style>
