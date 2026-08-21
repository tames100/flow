import { ref } from 'vue'

/** 全局图片放大预览状态（单例） */
const visible = ref(false)
const src = ref('')
const alt = ref('')

export function useImagePreview() {
  function openImage(url: string, altText = '') {
    if (!url) return
    src.value = url
    alt.value = altText
    visible.value = true
  }

  function close() {
    visible.value = false
  }

  return { visible, src, alt, openImage, close }
}
