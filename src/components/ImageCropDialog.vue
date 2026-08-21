<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'
import { useImageCrop } from '../composables'

const { state, confirm, cancel } = useImageCrop()

const imgRef = ref<HTMLImageElement | null>(null)
const cropper = ref<Cropper | null>(null)
const ratio = ref<number>(1)

const ratios = [
  { label: '自由', value: 0 },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
]

watch(
  () => state.visible,
  (v) => {
    if (v) {
      nextTick(() => initCropper())
    } else {
      cropper.value?.destroy()
      cropper.value = null
    }
  },
)

function initCropper() {
  if (!imgRef.value) return
  cropper.value?.destroy()
  cropper.value = new Cropper(imgRef.value, {
    aspectRatio: ratio.value || NaN,
    viewMode: 1,
    autoCropArea: 1,
    background: false,
    dragMode: 'move',
    minCropBoxWidth: 40,
    minCropBoxHeight: 40,
  })
}

function onRatioChange(v: number) {
  cropper.value?.setAspectRatio(v || NaN)
}

function doConfirm() {
  const c = cropper.value
  if (!c) return
  if (typeof (c as any).getCroppedCanvas !== 'function') {
    // 兜底：运行时加载到了不兼容的版本（如 cropperjs 2.x 缓存），提示重启开发服务器
    ElMessage.error('裁剪组件加载异常（检测到不兼容版本），请重启开发服务器后重试')
    cancel()
    return
  }
  const canvas = c.getCroppedCanvas({
    maxWidth: 1024,
    maxHeight: 1024,
    imageSmoothingQuality: 'high',
  })
  confirm(canvas.toDataURL('image/png'))
}
</script>

<template>
  <el-dialog
    :model-value="state.visible"
    title="裁剪图片"
    width="520px"
    append-to-body
    :close-on-click-modal="false"
    @close="cancel"
  >
    <div class="crop-toolbar">
      <span class="crop-ratio-label">裁剪比例</span>
      <el-radio-group v-model="ratio" size="small" @change="onRatioChange">
        <el-radio-button v-for="r in ratios" :key="r.value" :value="r.value">
          {{ r.label }}
        </el-radio-button>
      </el-radio-group>
    </div>
    <div class="crop-wrap">
      <img v-if="state.src" ref="imgRef" :src="state.src" class="crop-img" alt="" />
    </div>
    <template #footer>
      <el-button @click="cancel">取消</el-button>
      <el-button type="primary" @click="doConfirm">确定裁剪</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.crop-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.crop-ratio-label {
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
}
.crop-wrap {
  width: 100%;
  max-height: 420px;
  overflow: auto;
  background: #f5f7fa;
  border-radius: 6px;
}
.crop-img {
  display: block;
  max-width: 100%;
}
</style>
