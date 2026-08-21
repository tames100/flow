import { ref } from 'vue'

/**
 * useImageUpload —— 统一处理图片文件 -> dataURL 上传。
 * 返回触发文件选择的方法与选择的 dataURL。
 */
export function useImageUpload() {
  const image = ref('')
  const fileInput = ref<HTMLInputElement | null>(null)

  function openPicker() {
    fileInput.value?.click()
  }

  function onFileChange(e: Event) {
    const target = e.target as HTMLInputElement
    const file = target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      image.value = reader.result as string
    }
    reader.readAsDataURL(file)
    // 允许重复选择同一文件
    target.value = ''
  }

  function reset() {
    image.value = ''
  }

  return { image, fileInput, openPicker, onFileChange, reset }
}
