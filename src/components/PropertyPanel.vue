<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import {
  useRecipeGraph,
  useActionTypes,
  useGroups,
  useUnits,
  useImagePreview,
  useImageCrop,
  fileBaseName,
} from '../composables'
import { DEFAULT_EXTRAS, DEFAULT_UNIT } from '../types'
import EdgePropertyEditor from './EdgePropertyEditor.vue'
import RecipeTraceView from './RecipeTraceView.vue'
import ItemAttrEditor from './ItemAttrEditor.vue'

const { findNode, updateNode, getNodes, getEdges } = useVueFlow()
const {
  deleteNode,
  duplicateNode,
  persist,
  resolveUnit,
  syncUnitFromAction,
  getCanvasUnits,
} = useRecipeGraph()
const { allActions, addAction } = useActionTypes()
const { allGroups } = useGroups()
const { allUnits, addUnit, removeUnit } = useUnits()
const { openImage } = useImagePreview()
const { open: openCrop } = useImageCrop()

// 由 App 通过 v-model 同步选中节点 / 连线
const props = defineProps<{
  modelValue: string | null
  edge?: string | null
}>()
const emit = defineEmits<{
  'update:modelValue': [string | null]
  'update:edge': [string | null]
}>()

// 初始即同步当前选中值（解决首帧空白问题）
const selectedId = ref<string | null>(props.modelValue)
const edgeId = ref<string | null>(props.edge ?? null)
const fileInput = ref<HTMLInputElement | null>(null)
const actionFileInput = ref<HTMLInputElement | null>(null)

const node = computed(() => (selectedId.value ? findNode(selectedId.value) : null))

const isItem = computed(() => node.value?.data?.kind === 'item')
const isAction = computed(() => node.value?.data?.kind === 'action')

const label = computed({
  get: () => (node.value?.data ? (node.value.data as any).label ?? '' : ''),
  set: (v: string) => {
    if (node.value) {
      const data: any = { ...node.value.data, label: v }
      // 方向 A：加工节点的名称始终跟随加工动作，避免两者分叉
      if (node.value.data?.kind === 'action') {
        addAction(v)
        data.action = v
      }
      updateNode(node.value.id, { data })
      persist()
    }
  },
})

const description = computed({
  get: () => (node.value?.data ? (node.value.data as any)?.description ?? '' : ''),
  set: (v: string) => {
    if (node.value) {
      updateNode(node.value.id, { data: { ...node.value.data, description: v } })
      persist()
    }
  },
})

const showLabel = computed({
  get: () => (node.value?.data as any)?.showLabel ?? true,
  set: (v: boolean) => {
    if (node.value) {
      updateNode(node.value.id, { data: { ...node.value.data, showLabel: v } })
      persist()
    }
  },
})

const action = computed({
  get: () => (node.value?.data as any)?.action ?? '合成',
  set: (v: string) => {
    if (node.value) {
      // 新增的自定义加工动作持久化到下拉列表
      addAction(v)
      updateNode(node.value.id, { data: { ...node.value.data, action: v, label: v } })
      persist()
    }
  },
})

/** 加工节点输出单位：修改后自动同步到其输出边及下游加工节点输入边 */
const outputUnit = computed({
  get: () => (node.value?.data as any)?.outputUnit || DEFAULT_UNIT,
  set: (v: string) => {
    if (node.value) {
      updateNode(node.value.id, {
        data: { ...node.value.data, outputUnit: v || DEFAULT_UNIT },
      })
      syncUnitFromAction(node.value.id)
    }
  },
})

/** 加工节点附加操作 / 附加条件（如「发酵」是否需要加热）：支持选择内置项或自定义输入 */
const actionExtra = computed({
  get: () => (node.value?.data as any)?.extra ?? '',
  set: (v: string) => {
    if (node.value) {
      updateNode(node.value.id, { data: { ...node.value.data, extra: v || undefined } })
      persist()
    }
  },
})

/** 收集「可选的附加操作」：内置默认项 + 画布上所有加工节点已使用的值 */
function getExtraOptions(): string[] {
  const set = new Set<string>(DEFAULT_EXTRAS)
  getNodes.value.forEach((n) => {
    const e = (n.data as any)?.extra
    if (e) set.add(e)
  })
  return [...set]
}

/** 节点所属分组 id 列表（物品 / 加工节点通用；加工节点仅保留归属，不继承分组属性） */
const groupIds = computed<string[]>({
  get: () => (node.value?.data as any)?.groupIds ?? [],
  set: (v: string[]) => {
    if (node.value) {
      updateNode(node.value.id, {
        data: { ...node.value.data, groupIds: v.length ? v : undefined },
      })
      persist()
    }
  },
})

/** 分组多选下拉所需选项 */
function groupOptions() {
  return allGroups().map((g) => ({ id: g.id, name: g.name }))
}

/** 收集当前节点所属分组的全部属性（已迁移到 ItemAttrEditor.vue） */

/** 从分组复制属性（已迁移到 ItemAttrEditor.vue） */

// ItemAttrEditor 子组件引用：用于 onGroupIdsChange 后调用 promptCopyMissingAttrs 复制缺失属性
const attrEditorRef = ref<InstanceType<typeof ItemAttrEditor> | null>(null)

/**
 * 选择分组变更后，检查新增分组中是否存在节点尚未拥有的属性，
 * 若有则提示用户是否将这些属性复制到本节点（深拷贝，独立可编辑）。
 * 属性复制由 ItemAttrEditor 子组件通过 promptCopyMissingAttrs 处理。
 */
function onGroupIdsChange(newIds: string[]) {
  const oldIds = groupIds.value
  groupIds.value = newIds
  const addedIds = newIds.filter((id) => !oldIds.includes(id))
  if (addedIds.length) attrEditorRef.value?.promptCopyMissingAttrs(addedIds)
}

const image = computed(() => (node.value?.data as any)?.image ?? '')

// ---- 加工节点输入 / 输出数量（有向图语义）----
// 任何指向加工节点的连线均为输入；任何从加工节点指出的连线均为输出
// 直接从 VueFlow store 过滤，保证连线对象是响应式的（数量修改即时生效）
const inEdges = computed(() =>
  selectedId.value ? getEdges.value.filter((e) => e.target === selectedId.value) : [],
)
const outEdges = computed(() =>
  selectedId.value ? getEdges.value.filter((e) => e.source === selectedId.value) : [],
)

function qtyFromLabel(label: unknown): number {
  const m = /×(\d+)/.exec(String(label ?? ''))
  return m ? +m[1] : 1
}

/** 读取连线的数量单位（自定义字段） */
function unitOf(e: any): string {
  return (e as any)?.unit ?? ''
}

/** 可选单位：内置 + 自定义 + 画布使用中 - 隐藏（「个」始终保留） */
function getUnitOptions(): string[] {
  return allUnits(getCanvasUnits())
}

/** 用户选择/输入单位后，若为新值则持久化 */
function onUnitPick(v: string) {
  if (v) addUnit(v)
}

/** 删除单位（「个」不可删；画布正在使用的不允许删） */
function onRemoveUnit(u: string) {
  removeUnit(u, getCanvasUnits())
}

function nodeName(id: string) {
  const n = findNode(id)
  return ((n?.data as any)?.label as string) || id
}

/** 更新单条连线的数量与单位（指向本节点=输入，本节点指出=输出），直接修改响应式连线对象，连线数字即时同步 */
function applyEdgeQty(e: any, q: number, unit = '') {
  const isIn = e.target === selectedId.value || e.target === edgeId.value
  const qty = Math.max(1, Math.floor(q || 1))
  const label = qty > 1 || unit ? `×${qty}${unit ? ' ' + unit : ''}` : ''
  // 文字颜色继承当前线段颜色；无线段颜色时按方向回退到默认蓝/橙
  const color = (e.style as any)?.stroke ?? (isIn ? '#409eff' : '#e6a23c')
  Object.assign(e, {
    label,
    unit: unit || undefined,
    labelStyle: { fill: color, fontWeight: 700, fontSize: '12px' },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
  })
  persist()
}

function onQtyInput(e: any, v: number | undefined) {
  applyEdgeQty(e, v ?? 1, unitOf(e))
}

function onUnitInput(e: any, v: string | undefined) {
  applyEdgeQty(e, qtyFromLabel(e.label), v ?? '')
}

// ---- 物品属性编辑已抽离至 ItemAttrEditor.vue ----
// ---- 配方追踪 / 属性追踪已抽离至 RecipeTraceView.vue ----
// ---- 连线编辑模式已抽离至 EdgePropertyEditor.vue ----

function pickImage() {
  fileInput.value?.click()
}

/**
 * 上传图片后根据文件名同步节点名称（物品 / 加工动作）：
 * - 名称为空：直接用图片名（去扩展名）填入
 * - 名称与图片名一致：无操作
 * - 名称与图片名不一致：弹窗让用户选择是否用图片名替换（展示两者）
 */
async function maybeUpdateNodeName(file: File) {
  if (!node.value) return
  const baseName = fileBaseName(file)
  if (!baseName) return
  const current = (label.value ?? '').trim()
  if (!current) {
    label.value = baseName
    return
  }
  if (current === baseName) return
  const isAction = node.value.data?.kind === 'action'
  try {
    await ElMessageBox.confirm(
      `${isAction ? '动作名称' : '物品名称'}：${current}\n图片名称：${baseName}\n\n是否使用图片名称替换当前名称？`,
      '名称不一致',
      {
        confirmButtonText: '使用图片名称',
        cancelButtonText: '保留原名称',
        type: 'warning',
      },
    )
    label.value = baseName
  } catch {
    // 保留原名称
  }
}

async function onFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const dataURL = await readFileAsDataURL(f)
  // 上传后先裁剪，确认后才写入节点（取消则忽略）
  const cropped = await openCrop(dataURL)
  if (cropped && node.value) {
    updateNode(node.value.id, { data: { ...node.value.data, image: cropped } })
    persist()
    ElMessage.success('图片已替换')
    await maybeUpdateNodeName(f)
  }
  ; (e.target as HTMLInputElement).value = ''
}

function readFileAsDataURL(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = () => res(reader.result as string)
    reader.onerror = rej
    reader.readAsDataURL(f)
  })
}

// 加工动作图标图片替换（仅动作节点）
function pickActionImage() {
  actionFileInput.value?.click()
}

async function onActionFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const dataURL = await readFileAsDataURL(f)
  const cropped = await openCrop(dataURL)
  if (cropped && node.value) {
    updateNode(node.value.id, { data: { ...node.value.data, image: cropped } })
    persist()
    ElMessage.success('动作图标已替换')
    await maybeUpdateNodeName(f)
  }
  ; (e.target as HTMLInputElement).value = ''
}

function onDuplicate() {
  if (selectedId.value) duplicateNode(selectedId.value)
}
function onDelete() {
  if (selectedId.value) {
    deleteNode(selectedId.value)
    selectedId.value = null
  }
}

// 由 App 通过 v-model 同步选中（props/emit/selectedId 已在顶部声明）
watch(
  () => props.modelValue,
  (v) => (selectedId.value = v),
)
watch(selectedId, (v) => emit('update:modelValue', v))
watch(
  () => props.edge,
  (v) => (edgeId.value = v ?? null),
)
watch(edgeId, (v) => emit('update:edge', v))
</script>

<template>
  <div class="prop-panel">

    <!-- ===== 连线编辑模式 ===== -->
    <EdgePropertyEditor v-if="edgeId" v-model="edgeId" />

    <!-- ===== 节点编辑模式 ===== -->
    <template v-else>
      <el-empty v-if="!node" description="选中一个节点或连线以编辑属性" :image-size="60" />
      <el-form v-else label-position="top">
        <el-form-item label="节点类型">
          <el-tag :type="isItem ? 'success' : 'warning'">
            {{ isItem ? '物品节点' : '加工动作节点' }}
          </el-tag>
        </el-form-item>

        <el-form-item v-if="isItem" label="名称">
          <el-input v-model="label" placeholder="节点名称" />
        </el-form-item>

        <el-form-item label="解释">
          <el-input v-model="description" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }"
            placeholder="节点解释（展示在节点上）" />
        </el-form-item>

        <el-form-item label="分组">
          <el-select :model-value="groupIds" multiple filterable default-first-option clearable
            placeholder="选择分组（在「分组」管理中创建）" style="width: 100%"
            @update:model-value="(v: string[]) => onGroupIdsChange(v)">
            <el-option v-for="g in groupOptions()" :key="g.id" :label="g.name" :value="g.id" />
          </el-select>
          <div v-if="isAction" class="qty-tip">加工节点仅保留分组归属，不继承分组属性</div>
        </el-form-item>

        <template v-if="isItem">
          <el-form-item label="显示文字">
            <el-switch v-model="showLabel" active-text="图片+文字" inactive-text="仅图片" />
          </el-form-item>
          <el-form-item label="图片">
            <div class="img-box">
              <img v-if="image" :src="image" class="preview zoomable" :title="`点击放大：${label}`"
                @click.stop="openImage(image, label)" />
              <div v-else class="preview placeholder">无</div>
              <el-button size="small" type="primary" @click="pickImage">替换图片</el-button>
            </div>
            <input ref="fileInput" type="file" accept="image/*" style="display: none" @change="onFileChange" />
          </el-form-item>

          <!-- 物品属性编辑（图标 + 名称 + 值 + 说明）已抽离至 ItemAttrEditor.vue -->
          <ItemAttrEditor ref="attrEditorRef" :node-id="selectedId" />

          <RecipeTraceView :node-id="selectedId" :label="label" />
        </template>

        <template v-if="isAction">
          <el-form-item v-if="inEdges.length" label="输入数量">
            <div v-for="e in inEdges" :key="e.id" class="qty-row">
              <span class="qty-name" :title="nodeName(e.source)">{{ nodeName(e.source) }}</span>
              <el-input-number :model-value="qtyFromLabel(e.label)" :min="1" :max="9999" controls-position="right"
                size="small" style="width: 96px" @update:model-value="onQtyInput(e, $event)" />
              <el-select :model-value="unitOf(e) || resolveUnit(e.source, e.target)" placeholder="单位" clearable
                filterable allow-create default-first-option size="small" style="width: 76px"
                @update:model-value="onUnitInput(e, $event)" @change="onUnitPick">
                <el-option v-for="u in getUnitOptions()" :key="u" :label="u" :value="u">
                  <div class="unit-option">
                    <span>{{ u }}</span>
                    <span v-if="u !== '个'" class="unit-del" @click.stop="onRemoveUnit(u)">×</span>
                  </div>
                </el-option>
              </el-select>
            </div>
            <div class="qty-tip">指向本加工节点的连线均为输入，单位默认继承上游加工节点的输出单位</div>
          </el-form-item>
          <el-form-item v-if="outEdges.length" label="输出数量">
            <div v-for="e in outEdges" :key="e.id" class="qty-row">
              <span class="qty-name" :title="nodeName(e.target)">{{ nodeName(e.target) }}</span>
              <el-input-number :model-value="qtyFromLabel(e.label)" :min="1" :max="9999" controls-position="right"
                size="small" style="width: 96px" @update:model-value="onQtyInput(e, $event)" />
              <el-select :model-value="unitOf(e) || resolveUnit(e.source, e.target)" placeholder="单位" clearable
                filterable allow-create default-first-option size="small" style="width: 76px"
                @update:model-value="onUnitInput(e, $event)" @change="onUnitPick">
                <el-option v-for="u in getUnitOptions()" :key="u" :label="u" :value="u">
                  <div class="unit-option">
                    <span>{{ u }}</span>
                    <span v-if="u !== '个'" class="unit-del" @click.stop="onRemoveUnit(u)">×</span>
                  </div>
                </el-option>
              </el-select>
            </div>
            <div class="qty-tip">本加工节点指出的连线均为输出，单位与「输出单位」一致</div>
          </el-form-item>
          <el-form-item label="加工动作">
            <el-select v-model="action" style="width: 100%" filterable allow-create default-first-option
              placeholder="选择或输入自定义动作">
              <el-option v-for="a in allActions()" :key="a" :label="a" :value="a" />
            </el-select>
          </el-form-item>
          <el-form-item label="附加操作 / 条件（如发酵需加热）">
            <el-select v-model="actionExtra" style="width: 100%" filterable allow-create default-first-option clearable
              placeholder="选择或自定义，如：需要加热">
              <el-option v-for="x in getExtraOptions()" :key="x" :label="x" :value="x" />
            </el-select>
          </el-form-item>
          <el-form-item label="输出单位（下游输入自动继承）">
            <el-select v-model="outputUnit" style="width: 100%" filterable allow-create default-first-option
              placeholder="选择或输入单位" @change="onUnitPick">
              <el-option v-for="u in getUnitOptions()" :key="u" :label="u" :value="u">
                <div class="unit-option">
                  <span>{{ u }}</span>
                  <span v-if="u !== '个'" class="unit-del" @click.stop="onRemoveUnit(u)">×</span>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="动作图标">
            <div class="img-box">
              <img v-if="image" :src="image" class="preview zoomable" :title="`点击放大：${label}`"
                @click.stop="openImage(image, label)" />
              <div v-else class="preview placeholder">默认</div>
              <el-button size="small" type="primary" @click="pickActionImage">替换图标</el-button>
            </div>
            <input ref="actionFileInput" type="file" accept="image/*" style="display: none"
              @change="onActionFileChange" />
          </el-form-item>
        </template>

        <el-button-group style="width: 100%; display: flex">
          <el-button type="primary" plain style="flex: 1" @click="onDuplicate">
            复制节点
          </el-button>
          <el-button type="danger" plain style="flex: 1" @click="onDelete">
            删除节点
          </el-button>
        </el-button-group>
      </el-form>
    </template>
  </div>
</template>

<style scoped>
.prop-panel {
  padding: 14px;
  height: 100%;
  overflow-y: auto;
}

/* 表单 label 加粗，与输入内容区分 */
.prop-panel :deep(.el-form-item__label) {
  font-weight: 600;
}

.qty-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.2;
}

.unit-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.unit-del {
  color: #f56c6c;
  font-size: 14px;
  margin-left: 8px;
  cursor: pointer;
  flex-shrink: 0;
}

.unit-del:hover {
  color: #d9362e;
}

.qty-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 3px 0;
}

.qty-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: #606266;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.img-box {
  display: flex;
  align-items: center;
  gap: 10px;
}

.preview {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid #dcdfe6;
}

.preview.zoomable {
  cursor: zoom-in;
  transition: transform 0.15s ease;
}

.preview.zoomable:hover {
  transform: scale(1.08);
}

.preview.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
  background: #f4f4f5;
}
</style>
