<script setup lang="ts">
import { ref } from 'vue'
import {
  useGroups,
  fileToDataURL,
  isImageIcon,
  type ItemAttribute,
} from '../composables'

// 父组件传入 reactive 数组引用，子组件 push/splice 即可同步到父组件
const props = defineProps<{
  attrs: ItemAttribute[]
  groupIds: string[]
}>()

const { allGroups } = useGroups()

const expanded = ref(false)
const attrIconFileInput = ref<HTMLInputElement | null>(null)
const attrIconTarget = ref<ItemAttribute | null>(null)

function toggle() {
  expanded.value = !expanded.value
}

/** 收集该行所属分组的全部属性（用于「从分组复制属性」下拉） */
function attrsFromGroupIds(): ItemAttribute[] {
  if (!props.groupIds.length) return []
  const result: ItemAttribute[] = []
  props.groupIds.forEach((gid) => {
    const g = allGroups().find((x) => x.id === gid)
    if (g?.attributes) result.push(...g.attributes)
  })
  return result
}

/** 从分组复制一条属性到该行（深拷贝，独立可编辑） */
function copyAttrFromGroup(attr: ItemAttribute) {
  props.attrs.push(JSON.parse(JSON.stringify(attr)))
  ElMessage.success('已从分组复制属性到节点')
}

/** 从分组复制属性（el-select @change 回调） */
function onCopyAttrFromGroup(v: string) {
  const a = attrsFromGroupIds().find((x) => x.name === v || String(x.value) === v)
  if (a) copyAttrFromGroup(a)
}

function addAttr() {
  props.attrs.push({ icon: '', name: '', value: '', desc: '' })
}

function removeAttr(aidx: number) {
  props.attrs.splice(aidx, 1)
}

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

/**
 * 选择分组变更后，检查新增分组中是否存在节点尚未拥有的属性，
 * 若有则提示用户是否将这些属性复制到本节点（深拷贝，独立可编辑）。
 * 由父组件 onInputGroupChange/onOutputGroupChange 在新增分组后调用。
 */
function promptCopyMissingAttrs(addedIds: string[]) {
  if (!addedIds.length) return
  const existingNames = new Set(props.attrs.map((a) => a.name))
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
      missing.forEach((m) => props.attrs.push(JSON.parse(JSON.stringify(m.attr))))
      ElMessage.success(`已复制 ${missing.length} 个属性`)
    })
    .catch(() => { })
}

defineExpose({ promptCopyMissingAttrs })
</script>

<template>
  <!-- 物品属性（可折叠）：图标 + 名称 + 值 + 说明 -->
  <div class="attr-block">
    <div class="attr-toggle" @click="toggle">
      <span class="attr-toggle-text">属性（{{ attrs.length }}）</span>
      <span class="attr-toggle-arrow">{{ expanded ? '▾' : '▸' }}</span>
    </div>
    <div v-if="expanded" class="attr-list">
      <div v-for="(a, aidx) in attrs" :key="aidx" class="attr-item">
        <div class="attr-item-main">
          <span class="attr-icon-box" :title="a.icon ? '点击更换图标' : '点击上传图标'" @click="pickAttrIcon(a)">
            <img v-if="a.icon && isImageIcon(a.icon)" :src="a.icon" class="attr-icon-img" />
            <span v-else class="attr-icon-text">{{ a.icon || '📷' }}</span>
          </span>
          <el-input v-model="a.icon" placeholder="图标/emoji" size="small" class="attr-icon" />
          <el-input v-model="a.name" placeholder="名称" size="small" class="attr-name" />
          <el-input v-model="a.value" placeholder="值" size="small" class="attr-value" />
          <el-button link type="danger" size="small" @click="removeAttr(aidx)">删</el-button>
        </div>
        <el-input v-model="a.desc" placeholder="说明（可选）" size="small" class="attr-desc" />
      </div>
      <div v-if="attrsFromGroupIds().length" class="group-attr-copy">
        <el-select placeholder="从分组复制属性到本节点" size="small" clearable style="width: 100%"
          @change="(v: string) => onCopyAttrFromGroup(v)">
          <el-option v-for="(ga, gi) in attrsFromGroupIds()" :key="gi"
            :label="`${ga.name}${ga.value !== '' ? '：' + ga.value : ''}`" :value="ga.name || String(ga.value)" />
        </el-select>
      </div>
      <el-button text type="primary" size="small" @click="addAttr">+ 添加属性</el-button>
    </div>
  </div>
  <input ref="attrIconFileInput" type="file" accept="image/*" style="display: none" @change="onAttrIconFileChange" />
</template>

<style scoped>
.attr-block {
  margin-top: 4px;
}

.attr-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: #606266;
}

.attr-toggle:hover {
  background: #ecf5ff;
  color: #409eff;
}

.attr-toggle-text {
  font-weight: 600;
}

.attr-toggle-arrow {
  font-size: 12px;
}

.attr-list {
  margin-top: 4px;
}

.attr-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px dashed #e4e7ed;
  border-radius: 4px;
  margin-bottom: 6px;
  background: #fff;
}

.attr-item-main {
  display: flex;
  gap: 4px;
  align-items: center;
}

.attr-icon-box {
  width: 24px;
  height: 24px;
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
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.attr-icon-text {
  font-size: 13px;
  line-height: 1;
}

.attr-icon {
  width: 50px;
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

.group-attr-copy {
  margin: 6px 0;
  padding: 6px;
  border: 1px dashed #b3d8ff;
  border-radius: 4px;
  background: #f0f9ff;
}
</style>
