<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue'
import { useImagePreview } from '../composables/useImagePreview'

const { visible, src, alt, close } = useImagePreview()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && visible.value) {
    e.stopPropagation()
    close()
  }
}

window.addEventListener('keydown', onKey)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// 预览关闭时锁定背景滚动
watch(visible, (v) => {
  document.body.style.overflow = v ? 'hidden' : ''
})
onBeforeUnmount(() => {
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div v-if="visible" class="img-preview-overlay" @click.self="close">
        <button class="img-preview-close" title="关闭 (Esc)" @click="close">✕</button>
        <img :src="src" :alt="alt" class="img-preview-img" />
        <div v-if="alt" class="img-preview-caption">{{ alt }}</div>
        <div class="img-preview-tip">按 Esc 关闭</div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.img-preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.78);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  cursor: zoom-out;
}
.img-preview-img {
  max-width: 86vw;
  max-height: 80vh;
  object-fit: contain;
  border-radius: 10px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  background: #fff;
}
.img-preview-close {
  position: absolute;
  top: 20px;
  right: 24px;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 20px;
  cursor: pointer;
}
.img-preview-close:hover {
  background: rgba(255, 255, 255, 0.3);
}
.img-preview-caption {
  margin-top: 14px;
  color: #fff;
  font-size: 15px;
}
.img-preview-tip {
  position: absolute;
  bottom: 20px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
