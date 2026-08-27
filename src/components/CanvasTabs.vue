<script setup lang="ts">
import { ref, nextTick, computed } from 'vue'
import { useRecipeGraph, useRecipeHighlight } from '../composables'

const emit = defineEmits<{
  /** 画布切换后触发，供父组件清理选中节点 / 连线等状态 */
  switch: [id: string]
}>()

const {
  canvases,
  activeCanvasId,
  switchCanvas,
  addCanvas,
  removeCanvas,
  renameCanvas,
  reorderCanvases,
} = useRecipeGraph()
const { isHighlighting, clearHighlight } = useRecipeHighlight()

// ---- 重命名（双击进入，文本默认全选）----
const renamingId = ref<string | null>(null)
const renameValue = ref('')

function startRename(id: string) {
  const cv = canvases.value.find((c) => c.id === id)
  if (!cv) return
  renamingId.value = id
  renameValue.value = cv.name
  nextTick(() => {
    const el = document.querySelector<HTMLInputElement>('.tab-input')
    if (el) {
      el.focus()
      el.select() // 默认为全选状态，方便直接输入覆盖
    }
  })
}

function commitRename() {
  if (!renamingId.value) return
  renameCanvas(renamingId.value, renameValue.value)
  renamingId.value = null
}

function cancelRename() {
  renamingId.value = null
}

// ---- 标签页点击 / 双击 ----
function onTabClick(id: string) {
  if (id === activeCanvasId.value) return
  if (isHighlighting.value) clearHighlight()
  switchCanvas(id)
  emit('switch', id)
}

function onTabDblClick(id: string) {
  // 单击切换已先触发（若是非活动标签）；此处进入重命名
  startRename(id)
}

// ---- 右键菜单 ----
const ctxMenu = ref<{ visible: boolean; x: number; y: number; id: string }>({
  visible: false,
  x: 0,
  y: 0,
  id: '',
})

function onTabContextMenu(e: MouseEvent, id: string) {
  e.preventDefault()
  e.stopPropagation()
  // 右键位置作为菜单的左下角：left = 点击 x，向上展开使底部对齐点击 y
  ctxMenu.value = { visible: true, x: e.clientX, y: e.clientY, id }
}

// 右键位置 = 菜单左下角：left 对齐点击 x，translateY(-100%) 使菜单底部对齐点击 y
// 标签栏位于画布底部，点击 y 始终足够大，菜单向上展开不会溢出视口顶部
const ctxMenuStyle = computed(() => ({
  left: ctxMenu.value.x + 'px',
  top: ctxMenu.value.y + 'px',
  transform: 'translateY(-100%)',
}))

function closeCtxMenu() {
  ctxMenu.value.visible = false
}

function ctxRename() {
  const id = ctxMenu.value.id
  closeCtxMenu()
  nextTick(() => startRename(id))
}

function ctxDelete() {
  const id = ctxMenu.value.id
  closeCtxMenu()
  const cv = canvases.value.find((c) => c.id === id)
  if (!cv) return
  if (canvases.value.length <= 1) {
    ElMessage.warning('至少保留一个画布')
    return
  }
  ElMessageBox.confirm(
    `确定删除画布「${cv.name}」？该画布的全部节点与连线将丢失。`,
    '删除画布',
    { type: 'warning' },
  )
    .then(() => {
      if (isHighlighting.value) clearHighlight()
      const ok = removeCanvas(id)
      if (ok) emit('switch', activeCanvasId.value)
    })
    .catch(() => { })
}

// ---- 新建画布 ----
function onAdd() {
  if (isHighlighting.value) clearHighlight()
  const id = addCanvas()
  emit('switch', id)
}

// ---- 拖拽排序（原生 HTML5 拖拽）----
const dragFromIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function onDragStart(e: DragEvent, idx: number) {
  dragFromIndex.value = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }
}

function onDragOver(e: DragEvent, idx: number) {
  if (dragFromIndex.value === null) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  if (dragFromIndex.value !== idx) dragOverIndex.value = idx
}

function onDrop(e: DragEvent, idx: number) {
  e.preventDefault()
  const from = dragFromIndex.value
  dragFromIndex.value = null
  dragOverIndex.value = null
  if (from === null || from === idx) return
  reorderCanvases(from, idx)
}

function onDragEnd() {
  dragFromIndex.value = null
  dragOverIndex.value = null
}
</script>

<template>
  <div class="canvas-tabs-bar">
    <div class="tabs-scroll">
      <div v-for="(cv, idx) in canvases" :key="cv.id" class="tab" :class="{
        active: cv.id === activeCanvasId,
        'drag-over': dragOverIndex === idx && dragFromIndex !== idx,
        renaming: renamingId === cv.id,
      }" draggable="true" @click="onTabClick(cv.id)" @dblclick="onTabDblClick(cv.id)"
        @contextmenu="onTabContextMenu($event, cv.id)" @dragstart="onDragStart($event, idx)"
        @dragover="onDragOver($event, idx)" @drop="onDrop($event, idx)" @dragend="onDragEnd">
        <span v-if="renamingId !== cv.id" class="tab-label" :title="cv.name">{{ cv.name }}</span>
        <input v-else v-model="renameValue" class="tab-input" @click.stop @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename" @blur="commitRename" />
      </div>
      <button class="tab-add" title="新建画布" @click="onAdd">+</button>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="ctxMenu.visible" class="ctx-overlay" @click="closeCtxMenu" @contextmenu.prevent="closeCtxMenu">
        <div class="ctx-menu" :style="ctxMenuStyle" @click.stop @contextmenu.stop>
          <div class="ctx-item" @click="ctxRename">✏️ 重命名</div>
          <div class="ctx-item danger" @click="ctxDelete">🗑️ 删除标签页</div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.canvas-tabs-bar {
  flex-shrink: 0;
  /* 高度需容纳 tab（约 24px）+ 横向滚动条（6px）：34 - 8(padding) - 6(scrollbar) = 20 < 24 会裁剪；
     改为 40px：40 - 8 - 6 = 26 ≥ 24，滚动条出现时不再裁剪 tab */
  height: 40px;
  box-sizing: border-box;
  overflow: hidden;
  background: #1f2933;
  border-top: 1px solid #11181f;
  padding: 4px 8px;
  user-select: none;
}

.tabs-scroll {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  /* 始终为滚动条预留空间，避免出现 / 消失时 tab 高度跳动 */
  scrollbar-gutter: stable;
}

.tabs-scroll::-webkit-scrollbar {
  height: 6px;
}

.tabs-scroll::-webkit-scrollbar-thumb {
  background: #3a4653;
  border-radius: 3px;
}

.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  max-width: 180px;
  min-width: 60px;
  padding: 4px 14px 4px 12px;
  border-radius: 6px 6px 0 0;
  background: #2c3845;
  color: #c0c4cc;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}

.tab:hover {
  background: #374351;
  color: #fff;
}

.tab.active {
  background: #f5f7fa;
  color: #303133;
  font-weight: 600;
}

.tab.active::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: -1px;
  height: 2px;
  background: #409eff;
  border-radius: 2px;
}

.tab.drag-over {
  outline: 2px dashed #409eff;
  outline-offset: -2px;
}

.tab.renaming {
  cursor: text;
}

.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-input {
  width: 100%;
  min-width: 60px;
  max-width: 160px;
  padding: 0 2px;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font-size: 13px;
  font-weight: inherit;
}

.tab-add {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  margin-left: 4px;
  border: 1px dashed #5a6573;
  background: transparent;
  color: #909399;
  border-radius: 6px;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.tab-add:hover {
  border-color: #409eff;
  color: #409eff;
}

/* 右键菜单 */
.ctx-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.ctx-menu {
  position: fixed;
  min-width: 160px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  padding: 4px;
  z-index: 10000;
  user-select: none;
  font-size: 13px;
}

.ctx-item {
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.ctx-item:hover {
  background: #ecf5ff;
  color: #409eff;
}

.ctx-item.danger:hover {
  background: #fef0f0;
  color: #f56c6c;
}
</style>
