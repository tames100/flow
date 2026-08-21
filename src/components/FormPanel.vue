<script setup lang="ts">
import { reactive, ref, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRecipeGraph, useActionTypes, useImageUpload, type RecipeForm } from '../composables'

const { addRecipeFromForm, detectCycle, getItemNodes, getActionNodes } = useRecipeGraph()
const { allActions, addAction } = useActionTypes()

const emit = defineEmits<{ submitted: [] }>()

const form = reactive<RecipeForm>({
  inputs: [{ name: '', image: '', quantity: 1 }],
  action: '合成',
  actionImage: '',
  actionRefId: undefined,
  reuseActionImage: true,
  output: { name: '', image: '', quantity: 1 },
})

const inputUpload = useImageUpload()
const outputUpload = useImageUpload()
const actionUpload = useImageUpload()

/**
 * 上传目标：'action' | 'output' | 输入行的索引（数字）。
 * 用于剪贴板粘贴时，把图片写入当前「激活」的图片槽。
 */
const pasteTarget = ref<string | number>('output')

function setImage(target: string | number, dataUrl: string) {
  if (target === 'output') form.output.image = dataUrl
  else if (target === 'action') form.actionImage = dataUrl
  else form.inputs[target as number].image = dataUrl
}

function pickImage(upload: ReturnType<typeof useImageUpload>, target: string | number) {
  const inp = upload.fileInput.value
  if (!inp) return
  inp.onchange = (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (!f) return
    upload.handleFile(f).then(() => setImage(target, upload.image.value))
  }
  inp.click()
}

// 拖拽放置
async function onDrop(target: string | number, e: DragEvent) {
  e.preventDefault()
  pasteTarget.value = target
  const upload = target === 'output' ? outputUpload : target === 'action' ? actionUpload : inputUpload
  await upload.handleFile(e.dataTransfer?.files?.[0])
  setImage(target, upload.image.value)
}

// 全局粘贴：写入当前激活的图片槽
async function onPaste(e: ClipboardEvent) {
  const upload = pasteTarget.value === 'output' ? outputUpload
    : pasteTarget.value === 'action' ? actionUpload
    : inputUpload
  await upload.onPaste(e)
  if (!upload.image.value) return
  setImage(pasteTarget.value, upload.image.value)
}

onMounted(() => window.addEventListener('paste', onPaste))
onBeforeUnmount(() => window.removeEventListener('paste', onPaste))

function addInputRow() {
  form.inputs.push({ name: '', image: '', quantity: 1 })
}

function removeInputRow(idx: number) {
  if (form.inputs.length === 1) {
    ElMessage.warning('至少保留一个输入物品')
    return
  }
  form.inputs.splice(idx, 1)
}

/** 选择已有产物：带入名称与图片 */
function onSelectExisting(idx: number, nodeId: string) {
  const item = getItemNodes().find((n) => n.id === nodeId)
  if (!item) return
  form.inputs[idx].name = item.name
  form.inputs[idx].image = item.image
  form.inputs[idx].refId = nodeId
}

/** 选择已有加工节点：带入动作名称；若勾选复用图片，则带入该节点图片 */
function onSelectExistingAction(nodeId?: string) {
  if (!nodeId) {
    form.actionRefId = undefined
    return
  }
  const act = getActionNodes().find((n) => n.id === nodeId)
  if (!act) return
  form.action = act.name
  form.actionRefId = nodeId
  if (form.reuseActionImage) {
    form.actionImage = act.image
  }
}

/** 切换「复用图片」：勾选则带出所选加工节点图片，取消则清空（需用户上传） */
function onToggleReuse() {
  if (form.actionRefId) {
    const act = getActionNodes().find((n) => n.id === form.actionRefId)
    if (form.reuseActionImage && act) form.actionImage = act.image
    else form.actionImage = ''
  }
}

/** 手动修改加工动作名称/清空选择时，断开复用关联 */
function onActionNameChange() {
  form.actionRefId = undefined
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

  // 新增的自定义加工动作持久化到下拉列表
  addAction(form.action)

  addRecipeFromForm({
    inputs: validInputs.map((i) => ({
      name: i.name.trim(),
      image: i.image,
      refId: i.refId,
    })),
    action: form.action,
    actionImage: form.actionImage,
    actionRefId: form.actionRefId,
    reuseActionImage: form.reuseActionImage,
    output: {
      name: form.output.name.trim(),
      image: form.output.image,
      quantity: form.output.quantity,
    },
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

  // 关闭弹窗
  emit('submitted')

  // 重置输入行（保留一行）
  form.inputs = [{ name: '', image: '' }]
  form.output = { name: '', image: '', quantity: 1 }
  form.actionImage = ''
  form.actionRefId = undefined
  form.reuseActionImage = true
  outputUpload.reset()
  actionUpload.reset()
}
</script>

<template>
  <div class="form-panel">
    <!-- 隐藏 file input（本地文件选择共用） -->
    <input ref="inputUpload.fileInput" type="file" accept="image/*" style="display: none" />
    <input ref="outputUpload.fileInput" type="file" accept="image/*" style="display: none" />
    <input ref="actionUpload.fileInput" type="file" accept="image/*" style="display: none" />

    <el-form label-position="top" size="default">
      <div class="section-label">输入物品</div>
      <div v-for="(inp, idx) in form.inputs" :key="idx" class="input-row">
        <el-select
          :model-value="inp.refId"
          placeholder="选择已有产物（可选）"
          clearable
          filterable
          style="width: 100%"
          @focus="pasteTarget = idx"
          @change="(v: string) => onSelectExisting(idx, v)"
        >
          <el-option v-for="n in getItemNodes()" :key="n.id" :label="n.name" :value="n.id">
            <span style="display: flex; align-items: center; gap: 6px">
              <img v-if="n.image" :src="n.image" class="opt-thumb" />
              <span>{{ n.name || '未命名' }}</span>
            </span>
          </el-option>
        </el-select>
        <div class="name-quantity">
          <el-input v-model="inp.name" placeholder="或手动输入物品名称" clearable @focus="pasteTarget = idx" />
          <el-input-number v-model="inp.quantity" :min="1" :max="9999" size="small" controls-position="right" class="qty-input" />
        </div>
        <div class="row-actions">
          <el-button v-if="inp.image" link type="primary" size="small" @click="inp.image = ''">清除图</el-button>
          <el-button link type="danger" size="small" @click="removeInputRow(idx)">删除</el-button>
        </div>
        <!-- 与输出产物一致的整行宽拖拽上传区 -->
        <div
          class="drop-zone full"
          :class="{ active: pasteTarget === idx }"
          @click="pickImage(inputUpload, idx)"
          @mouseenter="pasteTarget = idx"
          @drop="onDrop(idx, $event)"
          @dragover.prevent
        >
          <img v-if="inp.image" :src="inp.image" class="thumb" />
          <span v-else class="drop-hint">点击 / 拖拽 / 粘贴图片</span>
        </div>
      </div>
      <el-button text type="primary" @click="addInputRow">+ 添加输入物品</el-button>

      <div class="section-label" style="margin-top: 14px">加工动作</div>
      <el-select
        :model-value="form.actionRefId"
        placeholder="选择已有加工节点（可选）"
        clearable
        filterable
        style="width: 100%"
        @change="onSelectExistingAction"
      >
        <el-option v-for="n in getActionNodes()" :key="n.id" :label="n.name" :value="n.id">
          <span style="display: flex; align-items: center; gap: 6px">
            <img v-if="n.image" :src="n.image" class="opt-thumb" />
            <span>{{ n.name || '未命名' }}</span>
          </span>
        </el-option>
      </el-select>
      <el-select
        v-model="form.action"
        style="width: 100%; margin-top: 6px"
        filterable
        allow-create
        default-first-option
        placeholder="选择或输入自定义动作"
        @change="onActionNameChange"
      >
        <el-option v-for="a in allActions()" :key="a" :label="a" :value="a" />
      </el-select>
      <el-checkbox
        v-if="form.actionRefId"
        v-model="form.reuseActionImage"
        style="margin-top: 6px"
        @change="onToggleReuse"
      >
        复用该加工节点的图片
      </el-checkbox>
      <!-- 加工动作图标图片上传（点击/拖拽/粘贴） -->
      <div
        class="drop-zone full"
        :class="{ active: pasteTarget === 'action' }"
        @click="pickImage(actionUpload, 'action')"
        @mouseenter="pasteTarget = 'action'"
        @drop="onDrop('action', $event)"
        @dragover.prevent
      >
        <img v-if="form.actionImage" :src="form.actionImage" class="thumb" />
        <span v-else class="drop-hint">点击 / 拖拽 / 粘贴动作图标</span>
      </div>

      <div class="section-label" style="margin-top: 14px">输出产物</div>
      <el-input v-model="form.output.name" placeholder="产物名称" clearable @focus="pasteTarget = 'output'" />
      <div class="name-quantity" style="margin-top: 6px">
        <span class="qty-label">产出数量</span>
        <el-input-number v-model="form.output.quantity" :min="1" :max="9999" size="small" controls-position="right" class="qty-input" />
      </div>
      <div
        class="drop-zone full"
        :class="{ active: pasteTarget === 'output' }"
        @click="pickImage(outputUpload, 'output')"
        @mouseenter="pasteTarget = 'output'"
        @drop="onDrop('output', $event)"
        @dragover.prevent
      >
        <img v-if="form.output.image" :src="form.output.image" class="thumb" />
        <span v-else class="drop-hint">点击 / 拖拽 / 粘贴图片</span>
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
.name-quantity {
  display: flex;
  align-items: center;
  gap: 6px;
}
.qty-label {
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
}
.qty-input {
  width: 110px;
  flex-shrink: 0;
}
.input-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px dashed #ebeef5;
}
.row-actions {
  display: flex;
  gap: 6px;
}
.thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid #dcdfe6;
}
.drop-zone {
  border: 1px dashed #c0c4cc;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
}
.drop-zone.full {
  width: 100%;
  height: 44px;
}
.drop-zone.active {
  border-color: #409eff;
  background: #ecf5ff;
}
.drop-hint {
  font-size: 12px;
  color: #c0c4cc;
}
.opt-thumb {
  width: 20px;
  height: 20px;
  object-fit: cover;
  border-radius: 4px;
}
</style>
