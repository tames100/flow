<script setup lang="ts">
import { reactive, ref, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { RecipeForm } from '../types'
import { useRecipeGraph } from '../composables/useRecipeGraph'
import { useActionTypes } from '../composables/useActionTypes'
import { useImageUpload } from '../composables/useImageUpload'

const { addRecipeFromForm, detectCycle } = useRecipeGraph()
const { allActions } = useActionTypes()

const form = reactive<RecipeForm>({
  inputs: [{ name: '', image: '' }],
  action: '合成',
  output: { name: '', image: '' },
})

const inputUpload = useImageUpload()
const outputUpload = useImageUpload()

/**
 * 上传目标：'output' 或 输入行的索引（数字）。
 * 用于剪贴板粘贴时，把图片写入当前「激活」的图片槽。
 */
const pasteTarget = ref<string | number>('output')

function setImage(target: string | number, dataUrl: string) {
  if (target === 'output') form.output.image = dataUrl
  else form.inputs[target as number].image = dataUrl
}

function pickInputImage(idx: number) {
  const inp = inputUpload.fileInput.value
  if (!inp) return
  inp.onchange = (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (!f) return
    inputUpload.handleFile(f).then(() => setImage(idx, inputUpload.image.value))
  }
  inp.click()
}

function pickOutputImage() {
  const inp = outputUpload.fileInput.value
  if (!inp) return
  inp.onchange = (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (!f) return
    outputUpload.handleFile(f).then(() => setImage('output', outputUpload.image.value))
  }
  inp.click()
}

// 拖拽放置（每个图片槽的 drop 区域）
async function onDrop(target: string | number, e: DragEvent) {
  e.preventDefault()
  pasteTarget.value = target
  await inputUpload.handleFile(e.dataTransfer?.files?.[0])
  setImage(target, inputUpload.image.value)
}

// 全局粘贴：写入当前激活的图片槽
async function onPaste(e: ClipboardEvent) {
  await inputUpload.onPaste(e)
  if (!inputUpload.image.value) return
  setImage(pasteTarget.value, inputUpload.image.value)
}

onMounted(() => window.addEventListener('paste', onPaste))
onBeforeUnmount(() => window.removeEventListener('paste', onPaste))

function addInputRow() {
  form.inputs.push({ name: '', image: '' })
}

function removeInputRow(idx: number) {
  if (form.inputs.length === 1) {
    ElMessage.warning('至少保留一个输入物品')
    return
  }
  form.inputs.splice(idx, 1)
}

function submit() {
  const validInputs = form.inputs.filter((i) => i.name.trim())
  if (validInputs.length === 0) {
    ElMessage.warning('请至少填写一个输入物品名称')
    return
  }
  if (!form.output.name.trim()) {
    ElMessage.warning('请填写输出产物名称')
    return
  }

  addRecipeFromForm({
    inputs: validInputs.map((i) => ({ name: i.name.trim(), image: i.image })),
    action: form.action,
    output: { name: form.output.name.trim(), image: form.output.image },
  })

  // 新增后立即检测循环依赖
  const cycle = detectCycle()
  if (cycle.length > 0) {
    ElMessageBox.alert(
      `检测到循环依赖！参与循环的节点数：${cycle.length}。请检查配方连线。`,
      '循环依赖警告',
      { type: 'warning', confirmButtonText: '我知道了' },
    )
  } else {
    ElMessage.success('配方已生成')
  }

  // 重置输入行（保留一行）
  form.inputs = [{ name: '', image: '' }]
  form.output = { name: '', image: '' }
  outputUpload.reset()
}
</script>

<template>
  <div class="form-panel">
    <h3 class="panel-title">配方录入</h3>

    <!-- 隐藏 file input（本地文件选择共用） -->
    <input ref="inputUpload.fileInput" type="file" accept="image/*" style="display: none" />
    <input ref="outputUpload.fileInput" type="file" accept="image/*" style="display: none" />

    <el-form label-position="top" size="default">
      <div class="section-label">输入物品（支持上传图 / 拖拽 / 粘贴）</div>
      <div v-for="(inp, idx) in form.inputs" :key="idx" class="input-row">
        <el-input v-model="inp.name" placeholder="物品名称" clearable @focus="pasteTarget = idx" />
        <el-button v-if="inp.image" link type="primary" size="small" @click="inp.image = ''">清除图</el-button>
        <el-button v-if="form.inputs.length > 1" link type="danger" size="small"
          @click="removeInputRow(idx)">删除</el-button>
        <div class="drop-zone" :class="{ active: pasteTarget === idx }" @click="pickInputImage(idx)"
          @mouseenter="pasteTarget = idx" @drop="onDrop(idx, $event)" @dragover.prevent>
          <img v-if="inp.image" :src="inp.image" class="thumb" />
          <span v-else class="drop-hint">点击/拖拽/粘贴</span>
        </div>
      </div>
      <el-button text type="primary" @click="addInputRow">+ 添加输入物品</el-button>

      <div class="section-label" style="margin-top: 14px">加工动作</div>
      <el-select v-model="form.action" style="width: 100%" filterable allow-create default-first-option
        placeholder="选择或输入自定义动作">
        <el-option v-for="a in allActions()" :key="a" :label="a" :value="a" />
      </el-select>

      <div class="section-label" style="margin-top: 14px">
        输出产物（支持上传图 / 拖拽 / 粘贴）
      </div>
      <el-input v-model="form.output.name" placeholder="产物名称" clearable @focus="pasteTarget = 'output'" />
      <div class="drop-zone output" :class="{ active: pasteTarget === 'output' }" @click="pickOutputImage"
        @mouseenter="pasteTarget = 'output'" @drop="onDrop('output', $event)" @dragover.prevent>
        <img v-if="form.output.image" :src="form.output.image" class="thumb" />
        <span v-else class="drop-hint">点击/拖拽/粘贴图片</span>
      </div>

      <el-button type="primary" style="width: 100%; margin-top: 18px" @click="submit">
        生成配方节点
      </el-button>
    </el-form>
  </div>
</template>

<style scoped>
.form-panel {
  padding: 14px;
  height: 100%;
  overflow-y: auto;
}

.panel-title {
  margin: 0 0 12px;
  font-size: 16px;
}

.section-label {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 6px;
}

.input-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.thumb {
  width: 34px;
  height: 34px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid #dcdfe6;
}

.drop-zone {
  width: 34px;
  height: 34px;
  border: 1px dashed #c0c4cc;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
}

.drop-zone.output {
  width: 100%;
  height: 44px;
  margin-top: 6px;
}

.drop-zone.active {
  border-color: #409eff;
  background: #ecf5ff;
}

.drop-hint {
  font-size: 10px;
  color: #c0c4cc;
  text-align: center;
  line-height: 1.1;
  padding: 0 2px;
}
</style>
