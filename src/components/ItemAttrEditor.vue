<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import {
  useRecipeGraph,
  useGroups,
  fileToDataURL,
  isImageIcon,
  type ItemAttribute,
} from '../composables'

const props = defineProps<{
  nodeId: string | null
}>()

const { findNode, updateNode } = useVueFlow()
const { persist } = useRecipeGraph()
const { allGroups } = useGroups()

const node = computed(() => (props.nodeId ? findNode(props.nodeId) : null))

// ---- 物品属性编辑（图标 + 名称 + 值 + 说明，图标与说明非必选）----
const attrs = ref<ItemAttribute[]>([])
watch(
  () => (node.value?.data as any)?.attributes,
  (v) => {
    attrs.value = v ? (JSON.parse(JSON.stringify(v)) as ItemAttribute[]) : []
  },
  { immediate: true, deep: true },
)

/** 点击「添加属性」：先插入一个空行（暂不保存），用户填写后由输入事件自动保存 */
function addAttr() {
  attrs.value.push({ icon: '', name: '', value: '', desc: '' })
}

function removeAttr(idx: number) {
  attrs.value.splice(idx, 1)
  saveAttrs()
}

/** 将本地属性草稿保存回节点（保留所有行含空行，渲染时再过滤） */
function saveAttrs() {
  if (!node.value) return
  updateNode(node.value.id, {
    data: {
      ...node.value.data,
      attributes: attrs.value.length ? JSON.parse(JSON.stringify(attrs.value)) : undefined,
    },
  })
  persist()
}

/** 收集当前节点所属分组的全部属性（用于「从分组复制属性」下拉） */
function attrsFromGroups(): ItemAttribute[] {
  const gids = (node.value?.data as any)?.groupIds as string[] | undefined
  if (!gids || !gids.length) return []
  const result: ItemAttribute[] = []
  gids.forEach((gid) => {
    const g = allGroups().find((x) => x.id === gid)
    if (g?.attributes) result.push(...g.attributes)
  })
  return result
}

/** 从分组复制一条属性到节点（深拷贝，独立可编辑，之后改分组不影响已拷贝的节点属性） */
function copyAttrFromGroup(attr: ItemAttribute) {
  attrs.value.push(JSON.parse(JSON.stringify(attr)))
  saveAttrs()
  ElMessage.success('已从分组复制属性到节点')
}

/** 从分组复制属性（el-select @change 回调） */
function onCopyAttrFromGroup(v: string) {
  const a = attrsFromGroups().find((x) => x.name === v || String(x.value) === v)
  if (a) copyAttrFromGroup(a)
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
    saveAttrs()
  } catch (err: any) {
    ElMessage.warning(err?.message ?? '图片读取失败')
  }
}

/**
 * 选择分组变更后，检查新增分组中是否存在节点尚未拥有的属性，
 * 若有则提示用户是否将这些属性复制到本节点（深拷贝，独立可编辑）。
 * 由父组件 onGroupIdsChange 在新增分组后调用。
 */
function promptCopyMissingAttrs(addedIds: string[]) {
  if (!addedIds.length) return
  const existingNames = new Set(attrs.value.map((a) => a.name))
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
      missing.forEach((m) => attrs.value.push(JSON.parse(JSON.stringify(m.attr))))
      saveAttrs()
      ElMessage.success(`已复制 ${missing.length} 个属性`)
    })
    .catch(() => {})
}

defineExpose({ promptCopyMissingAttrs })
</script>

<template>
  <!-- 物品属性：图标 + 名称 + 值 + 说明（图标与说明非必选） -->
  <el-divider content-position="left">物品属性</el-divider>
  <div class="attr-tip">属性由「图标 + 名称 + 值 + 说明」组成，图标与说明非必选；可在下方配方追踪中选择展示属性。</div>
  <div v-for="(a, idx) in attrs" :key="idx" class="attr-row">
    <div class="attr-main">
      <span class="attr-icon-box" :title="a.icon ? '点击更换图标' : '点击上传图标'" @click="pickAttrIcon(a)">
        <img v-if="a.icon && isImageIcon(a.icon)" :src="a.icon" class="attr-icon-img" />
        <span v-else class="attr-icon-text">{{ a.icon || '📷' }}</span>
      </span>
      <el-input v-model="a.icon" placeholder="图标/emoji" size="small" class="attr-icon"
        @update:model-value="saveAttrs" />
      <el-input v-model="a.name" placeholder="名称" size="small" class="attr-name"
        @update:model-value="saveAttrs" />
      <el-input v-model="a.value" placeholder="值" size="small" class="attr-value"
        @update:model-value="saveAttrs" />
      <el-button link type="danger" size="small" @click="removeAttr(idx)">删</el-button>
    </div>
    <el-input v-model="a.desc" placeholder="说明（可选）" size="small" class="attr-desc"
      @update:model-value="saveAttrs" />
  </div>
  <!-- 从所属分组复制属性：深拷贝为节点自有属性，独立可编辑 -->
  <div v-if="attrsFromGroups().length" class="group-attr-copy">
    <el-select placeholder="从分组复制属性到本节点" size="small" clearable style="width: 100%"
      @change="(v: string) => onCopyAttrFromGroup(v)">
      <el-option v-for="(ga, gi) in attrsFromGroups()" :key="gi"
        :label="`${ga.name}${ga.value !== '' ? '：' + ga.value : ''}`" :value="ga.name || String(ga.value)" />
    </el-select>
  </div>
  <el-button text type="primary" size="small" @click="addAttr">+ 添加属性</el-button>
  <input ref="attrIconFileInput" type="file" accept="image/*" style="display: none"
    @change="onAttrIconFileChange" />
</template>

<style scoped>
.attr-tip {
  font-size: 12px;
  color: #909399;
  margin: -4px 0 8px;
  line-height: 1.5;
}

.attr-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px dashed #e4e7ed;
  border-radius: 6px;
  margin-bottom: 6px;
  background: #fff;
}

.attr-main {
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
  width: 52px;
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

.attr-main :deep(.el-input__inner) {
  font-size: 12px;
}

/* 从分组复制属性下拉区 */
.group-attr-copy {
  margin: 6px 0;
  padding: 6px;
  border: 1px dashed #b3d8ff;
  border-radius: 6px;
  background: #f0f9ff;
}
</style>
