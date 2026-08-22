<script setup lang="ts">
import { ref } from 'vue'
import { useGroups, useRecipeGraph, fileToDataURL, isImageIcon, type ItemAttribute } from '../composables'

/**
 * GroupDrawer —— 分组管理抽屉（从画布左侧滑入，画布置暗遮罩）。
 * 支持新增 / 改名 / 删除分组，以及为分组增删改预设属性（图标 + 名称 + 值 + 说明）。
 * 物品节点选择某分组的属性后会复制为节点自有属性，独立可编辑。
 * 分组属性图标 / 名称变更时，自动同步到该分组下所有节点的对应属性（仅 icon + name）。
 */
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const { groups, allGroups, addGroup, updateGroup, removeGroup, addAttr, removeAttr, updateAttr } =
  useGroups()
const { syncGroupAttrToNodes } = useRecipeGraph()

/**
 * 修改分组属性后，若 icon 或 name 变更，同步到该分组下所有节点的对应属性。
 * 匹配方式：节点属性 name === 旧名称（用户手动改过名的不同步）。
 */
function onAttrChange(gid: string, idx: number, patch: Partial<ItemAttribute>) {
  const g = groups.value.find((x) => x.id === gid)
  const old = g?.attributes?.[idx]
  if (!old) return
  const oldName = old.name
  const oldIcon = old.icon ?? ''
  updateAttr(gid, idx, patch)
  if ('icon' in patch || 'name' in patch) {
    const newIcon = 'icon' in patch ? (patch.icon ?? '') : oldIcon
    const newName = 'name' in patch ? (patch.name ?? oldName) : oldName
    syncGroupAttrToNodes(gid, oldName, newIcon, newName)
  }
}

/** 抽屉关闭时同步父组件状态 */
function onClose(v: boolean) {
  emit('update:modelValue', v)
}

/** 新增分组：先插入空名占位，用户随后输入名称 */
function onAddGroup() {
  addGroup('新分组')
}

/** 删除分组前确认 */
function onRemoveGroup(id: string, name: string) {
  ElMessageBox.confirm(
    `确认删除分组「${name}」？该分组下的节点归属引用会自动失效（不影响节点本身）。`,
    '删除分组',
    { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
  )
    .then(() => removeGroup(id))
    .catch(() => { })
}

/** 新增属性行 */
function onAddAttr(gid: string) {
  addAttr(gid, { icon: '', name: '', value: '', desc: '' })
}

// ---- 属性图标：本地上传 / 直接输入 emoji 或 URL ----
const attrIconFileInput = ref<HTMLInputElement | null>(null)
const attrIconTarget = ref<{ gid: string; idx: number } | null>(null)

function pickAttrIcon(gid: string, idx: number) {
  attrIconTarget.value = { gid, idx }
  attrIconFileInput.value?.click()
}

async function onAttrIconFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f || !attrIconTarget.value) return
  try {
    const dataUrl = await fileToDataURL(f)
    onAttrChange(attrIconTarget.value.gid, attrIconTarget.value.idx, { icon: dataUrl })
  } catch (err: any) {
    ElMessage.warning(err?.message ?? '图片读取失败')
  }
}

/** 取分组的属性（确保数组存在） */
function groupAttrs(g: { attributes?: ItemAttribute[] }): ItemAttribute[] {
  return g.attributes ?? []
}
</script>

<template>
  <el-drawer :model-value="props.modelValue" title="分组管理" direction="ltr" size="420px" :close-on-click-modal="true"
    append-to-body @update:model-value="onClose">
    <div class="group-drawer">
      <div class="drawer-tip">
        分组用于归类节点（一个节点可归属多个分组）。物品节点可从所属分组复制属性为节点自有属性；加工节点仅保留分组归属。
      </div>

      <el-button type="primary" plain style="width: 100%; margin-bottom: 12px" @click="onAddGroup">
        + 新增分组
      </el-button>

      <div v-if="!allGroups().length" class="empty">暂无分组，点击上方按钮新增。</div>

      <div v-for="g in groups" :key="g.id" class="group-card">
        <div class="group-head">
          <el-input :model-value="g.name" size="default" placeholder="分组名称"
            @update:model-value="(v: string) => updateGroup(g.id, { name: v })" />
          <el-button link type="danger" size="small" @click="onRemoveGroup(g.id, g.name)">
            删除组
          </el-button>
        </div>

        <div class="attr-section">
          <div class="attr-section-label">预设属性（{{ groupAttrs(g).length }}）</div>
          <div v-if="groupAttrs(g).length" class="attr-list">
            <div v-for="(a, idx) in groupAttrs(g)" :key="idx" class="attr-item">
              <div class="attr-item-main">
                <span class="attr-icon-box" :title="a.icon ? '点击更换图标' : '点击上传图标'" @click="pickAttrIcon(g.id, idx)">
                  <img v-if="a.icon && isImageIcon(a.icon)" :src="a.icon" class="attr-icon-img" />
                  <span v-else class="attr-icon-text">{{ a.icon || '📷' }}</span>
                </span>
                <el-input :model-value="a.icon" placeholder="图标/emoji" size="small" class="attr-icon"
                  @update:model-value="(v: string) => onAttrChange(g.id, idx, { icon: v })" />
                <el-input :model-value="a.name" placeholder="名称" size="small" class="attr-name"
                  @update:model-value="(v: string) => onAttrChange(g.id, idx, { name: v })" />
                <el-input :model-value="String(a.value ?? '')" placeholder="值" size="small" class="attr-value"
                  @update:model-value="(v: string) => updateAttr(g.id, idx, { value: v })" />
                <el-button link type="danger" size="small" @click="removeAttr(g.id, idx)">
                  删
                </el-button>
              </div>
              <el-input :model-value="a.desc" placeholder="说明（可选）" size="small" class="attr-desc"
                @update:model-value="(v: string) => updateAttr(g.id, idx, { desc: v })" />
            </div>
          </div>
          <el-button text type="primary" size="small" @click="onAddAttr(g.id)">
            + 添加属性
          </el-button>
        </div>
      </div>
    </div>
    <input ref="attrIconFileInput" type="file" accept="image/*" style="display: none" @change="onAttrIconFileChange" />
  </el-drawer>
</template>

<style scoped>
.group-drawer {
  padding: 4px 0 16px;
}

.drawer-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
  margin-bottom: 12px;
  padding: 8px 10px;
  background: #f5f7fa;
  border-radius: 6px;
}

.empty {
  text-align: center;
  color: #c0c4cc;
  font-size: 13px;
  padding: 24px 0;
}

.group-card {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 12px;
  background: #fafafa;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.attr-section {
  margin-top: 6px;
}

.attr-section-label {
  font-size: 12px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 6px;
}

.attr-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 6px;
}

.attr-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px dashed #e4e7ed;
  border-radius: 4px;
  background: #fff;
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
