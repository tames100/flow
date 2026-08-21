import { ref } from 'vue'

/**
 * useImageUpload —— 统一处理图片来源（本地文件 / 拖拽 / 剪贴板）→ dataURL。
 */
export function useImageUpload() {
  const image = ref('')
  const fileInput = ref<HTMLInputElement | null>(null)

  /** 限制大小，避免 localStorage 溢出（默认 1.5MB） */
  const MAX_SIZE = 1.5 * 1024 * 1024

  function fileToDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error('请选择图片文件'))
        return
      }
      if (file.size > MAX_SIZE) {
        reject(new Error('图片过大，请控制在 1.5MB 以内'))
        return
      }
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
  }

  /** 处理单个 File（拖拽 / 文件选择共用） */
  async function handleFile(file: File | undefined | null) {
    if (!file) return
    try {
      image.value = await fileToDataURL(file)
    } catch (e) {
      console.warn(e)
    }
  }

  /** 点击按钮选择本地文件 */
  function openPicker() {
    fileInput.value?.click()
  }
  function onFileChange(e: Event) {
    const target = e.target as HTMLInputElement
    const file = target.files?.[0]
    handleFile(file)
    target.value = '' // 允许重复选择同一文件
  }

  /** 拖拽放置 */
  function onDrop(e: DragEvent) {
    const file = e.dataTransfer?.files?.[0]
    handleFile(file)
  }

  /** 剪贴板粘贴（通常在 paste 事件上调用） */
  async function onPaste(e: ClipboardEvent) {
    const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
      i.type.startsWith('image/'),
    )
    if (!item) return
    const file = item.getAsFile()
    await handleFile(file)
  }

  function reset() {
    image.value = ''
  }

  return {
    image,
    fileInput,
    openPicker,
    onFileChange,
    onDrop,
    onPaste,
    reset,
  }
}
