<script setup lang="ts">
import { reactive, ref } from 'vue'
import {
  useRecipeGraph,
  useActionTypes,
  useGroups,
  useImageUpload,
  useImageCrop,
  fileToDataURL,
  fileBaseName,
  isImageIcon,
  type ItemAttribute,
  type RecipeForm,
} from '../composables'
import { DEFAULT_EXTRAS, DEFAULT_UNIT, DEFAULT_UNITS } from '../types'

const { addRecipeFromForm, detectCycle, getItemNodes, getActionNodes } = useRecipeGraph()
const { allActions, addAction } = useActionTypes()
const { allGroups } = useGroups()
const { open: openCrop } = useImageCrop()

const emit = defineEmits<{ submitted: [] }>()

const form = reactive<RecipeForm>({
  inputs: [{ name: '', image: '', quantity: 1, unit: DEFAULT_UNIT, description: '', attributes: [], groupIds: [] }],
  action: '合成',
  actionImage: '',
  actionDescription: '',
  actionExtra: '',
  actionOutputUnit: DEFAULT_UNIT,
  actionRefId: undefined,
  reuseActionImage: true,
  actionGroupIds: [],
  outputs: [{ name: '', image: '', quantity: 1, description: '', attributes: [], groupIds: [] }],
})

/** 属性编辑区展开状态：`in${idx}` / `out${idx}` */
const attrExpanded = ref<Record<string, boolean>>({})

function toggleAttrArea(key: string) {
  attrExpanded.value[key] = !attrExpanded.value[key]
}

/** 确保属性数组存在 */
function ensureAttrs(arr: { attributes?: ItemAttribute[] }) {
  if (!arr.attributes) arr.attributes = []
}

/** 收集「可选的附加操作」：内置默认项 + 画布上所有加工节点已使用的值（用户输入自定义后同步更新） */
function getExtraOptions(): string[] {
  const set = new Set<string>(DEFAULT_EXTRAS)
  getActionNodes().forEach((n) => {
    if (n.extra) set.add(n.extra)
  })
  // 若用户已在表单中输入自定义值，一并纳入
  if (form.actionExtra) set.add(form.actionExtra)
  return [...set]
}

/** 收集该行所属分组的全部属性（用于「从分组复制属性」下拉） */
function attrsFromGroupIds(groupIds: string[] | undefined): ItemAttribute[] {
  if (!groupIds || !groupIds.length) return []
  const result: ItemAttribute[] = []
  groupIds.forEach((gid) => {
    const g = allGroups().find((x) => x.id === gid)
    if (g?.attributes) result.push(...g.attributes)
  })
  return result
}

/** 从分组复制一条属性到该行（深拷贝，独立可编辑） */
function copyAttrFromGroup(target: { attributes?: ItemAttribute[] }, attr: ItemAttribute) {
  ensureAttrs(target)
  target.attributes!.push(JSON.parse(JSON.stringify(attr)))
  ElMessage.success('已从分组复制属性到节点')
}

/** 输入行：从分组复制属性（el-select @change 回调） */
function onCopyInputAttr(idx: number, v: string) {
  const a = attrsFromGroupIds(form.inputs[idx].groupIds).find(
    (x) => x.name === v || String(x.value) === v,
  )
  if (a) copyAttrFromGroup(form.inputs[idx], a)
}

/** 输出行：从分组复制属性（el-select @change 回调） */
function onCopyOutputAttr(idx: number, v: string) {
  const a = attrsFromGroupIds(form.outputs[idx].groupIds).find(
    (x) => x.name === v || String(x.value) === v,
  )
  if (a) copyAttrFromGroup(form.outputs[idx], a)
}

/**
 * 选择分组变更后，检查新增分组中是否存在节点尚未拥有的属性，
 * 若有则提示用户是否将这些属性复制到本节点（深拷贝，独立可编辑）。
 */
function onInputGroupChange(idx: number, newIds: string[]) {
  const inp = form.inputs[idx]
  const oldIds = inp.groupIds ?? []
  inp.groupIds = newIds
  promptCopyMissingAttrs(inp, oldIds, newIds)
}

function onOutputGroupChange(idx: number, newIds: string[]) {
  const out = form.outputs[idx]
  const oldIds = out.groupIds ?? []
  out.groupIds = newIds
  promptCopyMissingAttrs(out, oldIds, newIds)
}

/** 通用：对比新旧分组 id，找出新增分组中节点缺失的属性并提示复制 */
function promptCopyMissingAttrs(
  target: { attributes?: ItemAttribute[]; name?: string },
  oldIds: string[],
  newIds: string[],
) {
  const addedIds = newIds.filter((id) => !oldIds.includes(id))
  if (!addedIds.length) return
  const existingNames = new Set((target.attributes ?? []).map((a) => a.name))
  const missing: { attr: ItemAttribute; groupName: string }[] = []
  addedIds.forEach((gid) => {
    const g = allGroups().find((x) => x.id === gid)
    if (!g?.attributes) return
    g.attributes.forEach((a) => {
      if (a.name && !existingNames.has(a.name)) {
        missing.push({ attr: a, groupName: g.name })
      }
    })
  })
  if (!missing.length) return
  const attrList = missing.map((m) => m.attr.name).join('、')
  const groupList = [...new Set(missing.map((m) => m.groupName))].join('、')
  ElMessageBox.confirm(
    `所选分组「${groupList}」包含本节点尚不存在的属性：${attrList}。是否将这些属性复制到本节点？`,
    '从分组复制属性',
    { confirmButtonText: '复制', cancelButtonText: '跳过', type: 'info' },
  )
    .then(() => {
      ensureAttrs(target)
      missing.forEach((m) => target.attributes!.push(JSON.parse(JSON.stringify(m.attr))))
      ElMessage.success(`已复制 ${missing.length} 个属性`)
    })
    .catch(() => { })
}

/** 分组多选下拉所需选项 */
function groupOptions() {
  return allGroups().map((g) => ({ id: g.id, name: g.name }))
}

function addInputAttr(idx: number) {
  const row = form.inputs[idx]
  ensureAttrs(row)
  row.attributes!.push({ icon: '', name: '', value: '', desc: '' })
}

function removeInputAttr(idx: number, aidx: number) {
  form.inputs[idx].attributes?.splice(aidx, 1)
}

function addOutputAttr(idx: number) {
  const row = form.outputs[idx]
  ensureAttrs(row)
  row.attributes!.push({ icon: '', name: '', value: '', desc: '' })
}

function removeOutputAttr(idx: number, aidx: number) {
  form.outputs[idx].attributes?.splice(aidx, 1)
}

// ---- 属性图标：支持本地上传 / 剪贴板粘贴 / 直接输入 emoji 或 URL ----
const attrIconFileInput = ref<HTMLInputElement | null>(null)
const attrIconTarget = ref<ItemAttribute | null>(null)

/** 点击图标预览 → 选择本地图片 */
function pickAttrIcon(a: ItemAttribute) {
  attrIconTarget.value = a
  attrIconFileInput.value?.click()
}

async function onAttrIconFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f || !attrIconTarget.value) return
  try {
    attrIconTarget.value.icon = await fileToDataURL(f)
  } catch (err: any) {
    ElMessage.warning(err?.message ?? '图片读取失败')
  }
}

const inputUpload = useImageUpload()
const outputUpload = useImageUpload()
const actionUpload = useImageUpload()

/**
 * 上传目标：'action' | `in${idx}`（输入行索引） | `out${idx}`（输出行索引）。
 * 用于剪贴板粘贴时，把图片写入当前「激活」的图片槽。
 */
const pasteTarget = ref<string>('out0')

function resolveUpload(target: string) {
  if (target === 'action') return actionUpload
  return target.startsWith('out') ? outputUpload : inputUpload
}

function setImage(target: string, dataUrl: string) {
  if (target === 'action') form.actionImage = dataUrl
  else if (target.startsWith('out')) form.outputs[Number(target.slice(3))].image = dataUrl
  else form.inputs[Number(target.slice(2))].image = dataUrl
}

/** 获取目标对应的名称字段访问器（物品 / 加工动作） */
function getNameAccessor(target: string): { get: () => string; set: (v: string) => void } | null {
  if (target === 'action') {
    return {
      get: () => form.action,
      set: (v: string) => { form.action = v },
    }
  }
  if (target.startsWith('out')) {
    const idx = Number(target.slice(3))
    return {
      get: () => form.outputs[idx]?.name ?? '',
      set: (v: string) => {
        if (form.outputs[idx]) form.outputs[idx].name = v
      },
    }
  }
  if (target.startsWith('in')) {
    const idx = Number(target.slice(2))
    return {
      get: () => form.inputs[idx]?.name ?? '',
      set: (v: string) => {
        if (form.inputs[idx]) form.inputs[idx].name = v
      },
    }
  }
  return null
}

/** 名称标签：动作 vs 物品 */
function getNameLabel(target: string): string {
  return target === 'action' ? '动作名称' : '物品名称'
}

/**
 * 上传图片后根据文件名同步物品/动作名称：
 * - 名称为空：直接用图片名（去扩展名）填入
 * - 名称与图片名一致：无操作
 * - 名称与图片名不一致：弹窗让用户选择是否用图片名替换（展示两者）
 */
async function maybeUpdateName(target: string, file: File) {
  const acc = getNameAccessor(target)
  if (!acc) return
  const baseName = fileBaseName(file)
  if (!baseName) return
  const current = acc.get().trim()
  if (!current) {
    acc.set(baseName)
    return
  }
  if (current === baseName) return
  try {
    await ElMessageBox.confirm(
      `${getNameLabel(target)}：${current}\n图片名称：${baseName}\n\n是否使用图片名称替换当前名称？`,
      '名称不一致',
      {
        confirmButtonText: '使用图片名称',
        cancelButtonText: '保留原名称',
        type: 'warning',
      },
    )
    acc.set(baseName)
  } catch {
    // 用户选择保留原名称
  }
}

/** 上传图片统一入口：先打开裁剪弹窗，用户确认后才写入目标图片槽（取消则忽略） */
async function cropAndSet(target: string, dataUrl: string, file?: File) {
  const cropped = await openCrop(dataUrl)
  if (!cropped) return
  setImage(target, cropped)
  if (file) await maybeUpdateName(target, file)
}

function pickImage(target: string) {
  const upload = resolveUpload(target)
  const inp = upload.fileInput.value
  if (!inp) return
  inp.onchange = (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (!f) return
    upload.handleFile(f).then(() => cropAndSet(target, upload.image.value, f))
  }
  inp.click()
}

// 拖拽放置
async function onDrop(target: string, e: DragEvent) {
  e.preventDefault()
  const upload = resolveUpload(target)
  const file = e.dataTransfer?.files?.[0]
  await upload.handleFile(file)
  await cropAndSet(target, upload.image.value, file)
}

function addInputRow() {
  form.inputs.push({ name: '', image: '', quantity: 1, unit: DEFAULT_UNIT, description: '', attributes: [], groupIds: [] })
}

function removeInputRow(idx: number) {
  if (form.inputs.length === 1) {
    ElMessage.warning('至少保留一个输入物品')
    return
  }
  form.inputs.splice(idx, 1)
}

function addOutputRow() {
  form.outputs.push({ name: '', image: '', quantity: 1, description: '', attributes: [], groupIds: [] })
}

function removeOutputRow(idx: number) {
  if (form.outputs.length === 1) {
    ElMessage.warning('至少保留一个输出产物')
    return
  }
  form.outputs.splice(idx, 1)
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
  form.actionOutputUnit = act.outputUnit
  if (act.extra) form.actionExtra = act.extra
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
  const validOutputs = form.outputs.filter((o) => o.name.trim())
  if (validOutputs.length === 0) {
    ElMessage.warning('请至少填写一个输出产物名称')
    return
  }

  // 新增的自定义加工动作持久化到下拉列表
  addAction(form.action)

  /** 过滤空属性行（名称与值都为空的行不保留） */
  const cleanAttrs = (list?: ItemAttribute[]) =>
    (list ?? []).filter(
      (a) => (a.name ?? '').trim() || String(a.value ?? '').trim(),
    )

  addRecipeFromForm({
    inputs: validInputs.map((i) => ({
      name: i.name.trim(),
      image: i.image,
      refId: i.refId,
      quantity: i.quantity,
      unit: i.unit,
      description: i.description ?? '',
      attributes: cleanAttrs(i.attributes),
      groupIds: i.groupIds ?? [],
    })),
    action: form.action,
    actionImage: form.actionImage,
    actionDescription: form.actionDescription ?? '',
    actionExtra: form.actionExtra ?? '',
    actionOutputUnit: form.actionOutputUnit,
    actionRefId: form.actionRefId,
    reuseActionImage: form.reuseActionImage,
    actionGroupIds: form.actionGroupIds ?? [],
    outputs: validOutputs.map((o) => ({
      name: o.name.trim(),
      image: o.image,
      quantity: o.quantity,
      description: o.description ?? '',
      attributes: cleanAttrs(o.attributes),
      groupIds: o.groupIds ?? [],
    })),
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

  // 重置表单（各保留一行）
  form.inputs = [{ name: '', image: '', quantity: 1, unit: DEFAULT_UNIT, description: '', attributes: [], groupIds: [] }]
  form.outputs = [{ name: '', image: '', quantity: 1, description: '', attributes: [], groupIds: [] }]
  form.actionImage = ''
  form.actionDescription = ''
  form.actionExtra = ''
  form.actionOutputUnit = DEFAULT_UNIT
  form.actionRefId = undefined
  form.reuseActionImage = true
  form.actionGroupIds = []
  pasteTarget.value = 'out0'
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
      <div class="form-columns">
        <!-- 左列：输入 -->
        <div class="form-col">
          <div class="section-label">输入</div>
          <div v-for="(inp, idx) in form.inputs" :key="idx" class="input-row">
            <el-select :model-value="inp.refId" placeholder="选择已有产物（可选）" clearable filterable style="width: 100%"
              @focus="pasteTarget = `in${idx}`" @change="(v: string) => onSelectExisting(idx, v)">
              <el-option v-for="n in getItemNodes()" :key="n.id" :label="n.name" :value="n.id">
                <span style="display: flex; align-items: center; gap: 6px">
                  <img v-if="n.image" :src="n.image" class="opt-thumb" />
                  <span>{{ n.name || '未命名' }}</span>
                </span>
              </el-option>
            </el-select>
            <div class="name-quantity">
              <el-input v-model="inp.name" placeholder="或手动输入物品名称" clearable @focus="pasteTarget = `in${idx}`" />
              <el-input-number v-model="inp.quantity" :min="1" :max="9999" size="small" controls-position="right"
                class="qty-input" />
              <el-select v-model="inp.unit" filterable allow-create default-first-option size="small"
                class="unit-select" placeholder="单位">
                <el-option v-for="u in DEFAULT_UNITS" :key="u" :label="u" :value="u" />
              </el-select>
            </div>
            <el-input v-model="inp.description" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }"
              placeholder="输入解释（可选，展示在节点上）" class="desc-input" @focus="pasteTarget = `in${idx}`" />
            <!-- 分组归属（一个物品可归属多个分组） -->
            <div class="group-row">
              <span class="qty-label">分组</span>
              <el-select :model-value="inp.groupIds" multiple filterable default-first-option clearable size="small"
                style="flex: 1" placeholder="选择分组（在「分组」管理中创建）"
                @update:model-value="(v: string[]) => onInputGroupChange(idx, v)">
                <el-option v-for="g in groupOptions()" :key="g.id" :label="g.name" :value="g.id" />
              </el-select>
            </div>
            <!-- 物品属性（可折叠）：图标 + 名称 + 值 + 说明 -->
            <div class="attr-block">
              <div class="attr-toggle" @click="toggleAttrArea(`in${idx}`)">
                <span class="attr-toggle-text">属性（{{ inp.attributes?.length ?? 0 }}）</span>
                <span class="attr-toggle-arrow">{{ attrExpanded[`in${idx}`] ? '▾' : '▸' }}</span>
              </div>
              <div v-if="attrExpanded[`in${idx}`]" class="attr-list">
                <div v-for="(a, aidx) in inp.attributes" :key="aidx" class="attr-item">
                  <div class="attr-item-main">
                    <span class="attr-icon-box" :title="a.icon ? '点击更换图标' : '点击上传图标'" @click="pickAttrIcon(a)">
                      <img v-if="a.icon && isImageIcon(a.icon)" :src="a.icon" class="attr-icon-img" />
                      <span v-else class="attr-icon-text">{{ a.icon || '📷' }}</span>
                    </span>
                    <el-input v-model="a.icon" placeholder="图标/emoji" size="small" class="attr-icon" />
                    <el-input v-model="a.name" placeholder="名称" size="small" class="attr-name" />
                    <el-input v-model="a.value" placeholder="值" size="small" class="attr-value" />
                    <el-button link type="danger" size="small" @click="removeInputAttr(idx, aidx)">删</el-button>
                  </div>
                  <el-input v-model="a.desc" placeholder="说明（可选）" size="small" class="attr-desc" />
                </div>
                <div v-if="attrsFromGroupIds(inp.groupIds).length" class="group-attr-copy">
                  <el-select placeholder="从分组复制属性到本节点" size="small" clearable style="width: 100%"
                    @change="(v: string) => onCopyInputAttr(idx, v)">
                    <el-option v-for="(ga, gi) in attrsFromGroupIds(inp.groupIds)" :key="gi"
                      :label="`${ga.name}${ga.value !== '' ? '：' + ga.value : ''}`"
                      :value="ga.name || String(ga.value)" />
                  </el-select>
                </div>
                <el-button text type="primary" size="small" @click="addInputAttr(idx)">+ 添加属性</el-button>
              </div>
            </div>
            <div class="row-actions">
              <el-button v-if="inp.image" link type="primary" size="small" @click="inp.image = ''">清除图</el-button>
              <el-button link type="danger" size="small" @click="removeInputRow(idx)">删除</el-button>
            </div>
            <!-- 整行宽拖拽上传区 -->
            <div class="drop-zone full" :class="{ active: pasteTarget === `in${idx}` }" @click="pickImage(`in${idx}`)"
              @mouseenter="pasteTarget = `in${idx}`" @drop="onDrop(`in${idx}`, $event)" @dragover.prevent>
              <img v-if="inp.image" :src="inp.image" class="thumb" />
              <span v-else class="drop-hint">点击 / 拖拽 上传图片</span>
            </div>
          </div>
          <el-button text type="primary" @click="addInputRow">+ 添加输入</el-button>
        </div>

        <!-- 中列：加工 -->
        <div class="form-col">
          <div class="section-label">加工</div>
          <el-select :model-value="form.actionRefId" placeholder="选择已有加工节点（可选）" clearable filterable style="width: 100%"
            @change="onSelectExistingAction">
            <el-option v-for="n in getActionNodes()" :key="n.id" :label="n.name" :value="n.id">
              <span style="display: flex; align-items: center; gap: 6px">
                <img v-if="n.image" :src="n.image" class="opt-thumb" />
                <span>{{ n.name || '未命名' }}</span>
              </span>
            </el-option>
          </el-select>
          <el-select v-model="form.action" style="width: 100%; margin-top: 6px" filterable allow-create
            default-first-option placeholder="选择或输入自定义动作" @change="onActionNameChange">
            <el-option v-for="a in allActions()" :key="a" :label="a" :value="a" />
          </el-select>
          <el-checkbox v-if="form.actionRefId" v-model="form.reuseActionImage" style="margin-top: 6px"
            @change="onToggleReuse">
            复用该加工节点的图片
          </el-checkbox>
          <!-- 加工动作图标图片上传（点击/拖拽/粘贴） -->
          <div class="drop-zone full" :class="{ active: pasteTarget === 'action' }" @click="pickImage('action')"
            @mouseenter="pasteTarget = 'action'" @drop="onDrop('action', $event)" @dragover.prevent>
            <img v-if="form.actionImage" :src="form.actionImage" class="thumb" />
            <span v-else class="drop-hint">点击 / 拖拽 上传动作图标</span>
          </div>
          <el-input v-model="form.actionDescription" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }"
            placeholder="加工解释（可选，展示在节点上）" class="desc-input" style="margin-top: 6px" />
          <div class="name-quantity" style="margin-top: 6px">
            <span class="qty-label">附加操作</span>
            <el-select v-model="form.actionExtra" filterable allow-create default-first-option clearable size="small"
              style="flex: 1" placeholder="选择或自定义，如：需要加热">
              <el-option v-for="x in getExtraOptions()" :key="x" :label="x" :value="x" />
            </el-select>
          </div>
          <div class="group-row" style="margin-top: 6px">
            <span class="qty-label">分组</span>
            <el-select v-model="form.actionGroupIds" multiple filterable default-first-option clearable size="small"
              style="flex: 1" placeholder="选择分组（加工节点仅保留归属）">
              <el-option v-for="g in groupOptions()" :key="g.id" :label="g.name" :value="g.id" />
            </el-select>
          </div>
          <div class="name-quantity" style="margin-top: 6px">
            <span class="qty-label">输出单位</span>
            <el-select v-model="form.actionOutputUnit" filterable allow-create default-first-option size="small"
              style="flex: 1">
              <el-option v-for="u in DEFAULT_UNITS" :key="u" :label="u" :value="u" />
            </el-select>
          </div>
        </div>

        <!-- 右列：输出（至少一个，可多个） -->
        <div class="form-col">
          <div class="section-label">输出</div>
          <div v-for="(out, idx) in form.outputs" :key="idx" class="input-row">
            <el-input v-model="out.name" placeholder="产物名称" clearable @focus="pasteTarget = `out${idx}`" />
            <div class="name-quantity" style="margin-top: 6px">
              <span class="qty-label">产出数量</span>
              <el-input-number v-model="out.quantity" :min="1" :max="9999" size="small" controls-position="right"
                class="qty-input" />
            </div>
            <el-input v-model="out.description" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }"
              placeholder="产物解释（可选，展示在节点上）" class="desc-input" style="margin-top: 6px" />
            <!-- 分组归属（一个产物可归属多个分组） -->
            <div class="group-row" style="margin-top: 6px">
              <span class="qty-label">分组</span>
              <el-select :model-value="out.groupIds" multiple filterable default-first-option clearable size="small"
                style="flex: 1" placeholder="选择分组（在「分组」管理中创建）"
                @update:model-value="(v: string[]) => onOutputGroupChange(idx, v)">
                <el-option v-for="g in groupOptions()" :key="g.id" :label="g.name" :value="g.id" />
              </el-select>
            </div>
            <!-- 产物属性（可折叠）：图标 + 名称 + 值 + 说明 -->
            <div class="attr-block" style="margin-top: 6px">
              <div class="attr-toggle" @click="toggleAttrArea(`out${idx}`)">
                <span class="attr-toggle-text">属性（{{ out.attributes?.length ?? 0 }}）</span>
                <span class="attr-toggle-arrow">{{ attrExpanded[`out${idx}`] ? '▾' : '▸' }}</span>
              </div>
              <div v-if="attrExpanded[`out${idx}`]" class="attr-list">
                <div v-for="(a, aidx) in out.attributes" :key="aidx" class="attr-item">
                  <div class="attr-item-main">
                    <span class="attr-icon-box" :title="a.icon ? '点击更换图标' : '点击上传图标'" @click="pickAttrIcon(a)">
                      <img v-if="a.icon && isImageIcon(a.icon)" :src="a.icon" class="attr-icon-img" />
                      <span v-else class="attr-icon-text">{{ a.icon || '📷' }}</span>
                    </span>
                    <el-input v-model="a.icon" placeholder="图标/emoji" size="small" class="attr-icon" />
                    <el-input v-model="a.name" placeholder="名称" size="small" class="attr-name" />
                    <el-input v-model="a.value" placeholder="值" size="small" class="attr-value" />
                    <el-button link type="danger" size="small" @click="removeOutputAttr(idx, aidx)">删</el-button>
                  </div>
                  <el-input v-model="a.desc" placeholder="说明（可选）" size="small" class="attr-desc" />
                </div>
                <div v-if="attrsFromGroupIds(out.groupIds).length" class="group-attr-copy">
                  <el-select placeholder="从分组复制属性到本节点" size="small" clearable style="width: 100%"
                    @change="(v: string) => onCopyOutputAttr(idx, v)">
                    <el-option v-for="(ga, gi) in attrsFromGroupIds(out.groupIds)" :key="gi"
                      :label="`${ga.name}${ga.value !== '' ? '：' + ga.value : ''}`"
                      :value="ga.name || String(ga.value)" />
                  </el-select>
                </div>
                <el-button text type="primary" size="small" @click="addOutputAttr(idx)">+ 添加属性</el-button>
              </div>
            </div>
            <div class="row-actions">
              <el-button v-if="out.image" link type="primary" size="small" @click="out.image = ''">清除图</el-button>
              <el-button link type="danger" size="small" @click="removeOutputRow(idx)">删除</el-button>
            </div>
            <div class="drop-zone full" :class="{ active: pasteTarget === `out${idx}` }" @click="pickImage(`out${idx}`)"
              @mouseenter="pasteTarget = `out${idx}`" @drop="onDrop(`out${idx}`, $event)" @dragover.prevent>
              <img v-if="out.image" :src="out.image" class="thumb" />
              <span v-else class="drop-hint">点击 / 拖拽 上传图片</span>
            </div>
          </div>
          <el-button text type="primary" @click="addOutputRow">+ 添加输出</el-button>
        </div>
      </div>

      <el-button type="primary" style="width: 100%; margin-top: 14px" @click="submit">
        生成配方节点
      </el-button>
    </el-form>
    <input ref="attrIconFileInput" type="file" accept="image/*" style="display: none" @change="onAttrIconFileChange" />
  </div>
</template>

<style scoped>
.form-panel {
  padding: 14px;
  height: 100%;
  overflow-y: auto;
}

.section-label {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 8px;
}

/* 三栏布局：输入 | 加工 | 输出 */
.form-columns {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  align-items: start;
}

.form-col {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 10px;
  background: #fafafa;
}

.name-quantity {
  display: flex;
  align-items: center;
  gap: 6px;
}

.group-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.group-attr-copy {
  margin-top: 4px;
  padding: 6px;
  border: 1px dashed #b3d8ff;
  border-radius: 4px;
  background: #f0f9ff;
}

.qty-label {
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
}

.qty-input {
  width: 100px;
  flex-shrink: 0;
}

.unit-select {
  width: 72px;
  flex-shrink: 0;
}

.input-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px dashed #ebeef5;
}

.desc-input :deep(.el-textarea__inner) {
  font-size: 12px;
  padding: 4px 8px;
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

/* 物品属性编辑区 */
.attr-block {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  overflow: hidden;
}

.attr-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  cursor: pointer;
  background: #f5f7fa;
  font-size: 12px;
  color: #606266;
}

.attr-toggle:hover {
  background: #ecf5ff;
}

.attr-toggle-arrow {
  font-size: 10px;
  color: #909399;
}

.attr-list {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #fff;
}

.attr-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px dashed #e4e7ed;
  border-radius: 4px;
}

.attr-item-main {
  display: flex;
  gap: 4px;
  align-items: center;
}

.attr-icon-box {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed #c0c4cc;
  border-radius: 4px;
  cursor: pointer;
  overflow: hidden;
  background: #fff;
}

.attr-icon-box:hover {
  border-color: #409eff;
}

.attr-icon-img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.attr-icon-text {
  font-size: 14px;
  line-height: 1;
}

.attr-icon {
  width: 56px;
  flex-shrink: 0;
}

.attr-name {
  flex: 1;
  min-width: 0;
}

.attr-value {
  flex: 1;
  min-width: 0;
}

.attr-desc {
  width: 100%;
}

.attr-item-main :deep(.el-input__inner) {
  font-size: 12px;
}
</style>
