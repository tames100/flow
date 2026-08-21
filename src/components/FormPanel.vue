<script setup lang="ts">
import { reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ACTION_TYPES, type ActionType, type RecipeForm } from '../types'
import { useRecipeGraph } from '../composables/useRecipeGraph'
import { useImageUpload } from '../composables/useImageUpload'

const { addRecipeFromForm, detectCycle } = useRecipeGraph()

const form = reactive<RecipeForm>({
  inputs: [{ name: '', image: '' }],
  action: '合成',
  output: { name: '', image: '' },
})

const inputUpload = useImageUpload()
const outputUpload = useImageUpload()

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

function pickInputImage(idx: number) {
  const inp = inputUpload.fileInput.value
  if (!inp) return
  inp.onchange = (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      form.inputs[idx].image = reader.result as string
    }
    reader.readAsDataURL(f)
  }
  inp.click()
}

function pickOutputImage() {
  const inp = outputUpload.fileInput.value
  if (!inp) return
  inp.onchange = (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      form.output.image = reader.result as string
    }
    reader.readAsDataURL(f)
  }
  inp.click()
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
    action: form.action as ActionType,
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

    <!-- 共享的隐藏 file input -->
    <input ref="inputUpload.fileInput" type="file" accept="image/*" style="display: none" />
    <input ref="outputUpload.fileInput" type="file" accept="image/*" style="display: none" />

    <el-form label-position="top" size="default">
      <div class="section-label">输入物品</div>
      <div v-for="(inp, idx) in form.inputs" :key="idx" class="input-row">
        <el-input v-model="inp.name" placeholder="物品名称" clearable />
        <el-button
          v-if="inp.image"
          link
          type="primary"
          size="small"
          @click="inp.image = ''"
          >清除图</el-button
        >
        <el-button link type="success" size="small" @click="pickInputImage(idx)">
          {{ inp.image ? '换图' : '上传图' }}
        </el-button>
        <el-button
          v-if="form.inputs.length > 1"
          link
          type="danger"
          size="small"
          @click="removeInputRow(idx)"
          >删除</el-button
        >
        <img v-if="inp.image" :src="inp.image" class="thumb" />
      </div>
      <el-button text type="primary" @click="addInputRow">+ 添加输入物品</el-button>

      <div class="section-label" style="margin-top: 14px">加工动作</div>
      <el-select v-model="form.action" style="width: 100%">
        <el-option v-for="a in ACTION_TYPES" :key="a" :label="a" :value="a" />
      </el-select>

      <div class="section-label" style="margin-top: 14px">输出产物</div>
      <el-input v-model="form.output.name" placeholder="产物名称" clearable />
      <div class="output-img-row">
        <el-button link type="success" size="small" @click="pickOutputImage">
          {{ form.output.image ? '更换图片' : '上传图片' }}
        </el-button>
        <img v-if="form.output.image" :src="form.output.image" class="thumb" />
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
.output-img-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
</style>
