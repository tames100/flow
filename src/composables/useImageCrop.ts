import { reactive } from 'vue'

/**
 * 全局图片裁剪控制器。
 * 调用 open(src) 得到 Promise：用户在裁剪弹窗确认后 resolve 裁剪后的 dataURL，
 * 取消 / 关闭时 resolve 空字符串（调用方应忽略空值）。
 * 该状态由 App.vue 中挂载的 ImageCropDialog 消费。
 */
const state = reactive({
  visible: false,
  src: '',
  resolve: null as null | ((v: string) => void),
})

function open(src: string): Promise<string> {
  state.src = src
  state.visible = true
  return new Promise((res) => {
    state.resolve = res
  })
}

function confirm(cropped: string) {
  state.visible = false
  const done = state.resolve
  state.resolve = null
  done?.(cropped)
}

function cancel() {
  state.visible = false
  const done = state.resolve
  state.resolve = null
  done?.('')
}

export function useImageCrop() {
  return { state, open, confirm, cancel }
}
