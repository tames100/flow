<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { ElMessage, ElMessageBox } from 'element-plus'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

import FormPanel from './components/FormPanel.vue'
import PropertyPanel from './components/PropertyPanel.vue'
import ItemNode from './components/nodes/ItemNode.vue'
import ActionNode from './components/nodes/ActionNode.vue'
import ImagePreview from './components/ImagePreview.vue'
import ContextMenu from './components/ContextMenu.vue'

import {
  useRecipeGraph,
  useRecipeHighlight,
  useCanvasShortcuts,
  useContextMenu,
  type RecipeGraphData,
} from './composables'

const { onNodeClick, onConnect, addEdges, addNodes, onNodeDragStop, onPaneClick, screenToFlowCoordinate, setCenter, viewport } =
  useVueFlow()
const { detectCycle, exportJSON, importJSON, persist, loadFromStorage, createItemNode, createActionNode, duplicateNode, deleteNode } =
  useRecipeGraph()
const { highlightFromNode, clearHighlight } = useRecipeHighlight()
const { open: openContextMenu } = useContextMenu()

const shortcutsVisible = ref(false)

// 画布快捷键
useCanvasShortcuts({
  onEscape: () => {
    clearHighlight()
    selectedNodeId.value = null
  },
  // Ctrl/Cmd + S：保存为本地文件
  onSave: onSaveFile,
})

// 启动时从 localStorage 恢复自动保存的数据
onMounted(() => {
  loadFromStorage()
  // 10s 一次的自动保存（静默写入 localStorage，作为草稿，避免频繁下载文件干扰）
  autoSaveTimer = window.setInterval(() => persist(), 10000)
})

onBeforeUnmount(() => {
  if (autoSaveTimer) window.clearInterval(autoSaveTimer)
})

let autoSaveTimer: number | undefined

// 拖拽节点结束后自动保存位置
onNodeDragStop(() => persist())

// 点击画布空白处：清除文本选区（避免残留选中高亮）
onPaneClick(() => {
  window.getSelection()?.removeAllRanges()
})

const selectedNodeId = ref<string | null>(null)
const importInput = ref<HTMLInputElement | null>(null)
const formDialogVisible = ref(false)

const nodeTypes: Record<string, any> = {
  item: ItemNode,
  action: ActionNode,
}

// 选中节点同步到属性面板
onNodeClick(({ node }) => {
  selectedNodeId.value = node.id
  // 核心交互：点击任意物品节点 -> 高亮完整上游配方链
  highlightFromNode(node.id)
  // 聚焦：将节点居中并放大，形成聚焦效果
  const w = node.dimensions?.width ?? 60
  const h = node.dimensions?.height ?? 60
  setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: 1.3, duration: 400 })
  // 清除因点击产生的浏览器文本选区，避免属性面板文字呈“选中”态
  window.getSelection()?.removeAllRanges()
})

// 连线时记录（供手动拖拽连接使用）
onConnect((connection) => {
  addEdges([{ ...connection, id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, class: 'recipe-edge' }])
  persist()
  const cycle = detectCycle()
  if (cycle.length > 0) {
    ElMessageBox.alert(
      `检测到循环依赖！参与循环的节点数：${cycle.length}。`,
      '循环依赖警告',
      { type: 'warning' },
    )
  }
})

// ---- 顶部工具栏：添加 / 保存 / 导出 / 导入 / 重置 ----
function onAddRecipe() {
  formDialogVisible.value = true
}

// 保存：导出为本地 .json 文件（直接落盘），并弹窗提示成功
function onSaveFile() {
  // 循环依赖仅作警告，不阻断保存
  const cycle = detectCycle()
  if (cycle.length > 0) {
    ElMessage.warning(`注意：图中存在循环依赖（${cycle.length} 个节点），仍已保存`)
  }
  const data = exportJSON()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `recipe_${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已保存到本地文件')
}

function onImportClick() {
  importInput.value?.click()
}

function onImportChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string) as RecipeGraphData
      importJSON(data)
      clearHighlight()
      selectedNodeId.value = null
      ElMessage.success('导入成功')
    } catch (err) {
      ElMessage.error('导入失败：JSON 解析错误')
    }
  }
  reader.readAsText(file)
  ;(e.target as HTMLInputElement).value = ''
}

function onReset() {
  ElMessageBox.confirm('确定清空当前画布全部节点与连线？', '清空确认', {
    type: 'warning',
  })
    .then(() => {
      importJSON({ version: '1.0', actions: [], nodes: [], edges: [] })
      clearHighlight()
      selectedNodeId.value = null
    })
    .catch(() => {})
}

// ---- 画布右键菜单 ----
// 在画布空白处右键：打开画布级菜单（创建节点）
function onCanvasContextMenu(e: MouseEvent) {
  const targetEl = e.target as HTMLElement
  // 仅当右键落在画布空白(pane)时才打开画布菜单；节点右键已在节点组件内处理并 stopPropagation
  if (targetEl && targetEl.classList.contains('vue-flow__pane')) {
    openContextMenu(e, { type: 'canvas' })
  }
}

// 根据右键屏幕坐标创建节点并打开属性面板编辑
function createItemAt(screen: { x: number; y: number }) {
  const pos = screenToFlowCoordinate({ x: screen.x, y: screen.y })
  const node = createItemNode('新物品', '', pos)
  addNodes([node as any])
  persist()
  selectedNodeId.value = node.id
  highlightFromNode(node.id)
}

function createActionAt(screen: { x: number; y: number }) {
  const pos = screenToFlowCoordinate({ x: screen.x, y: screen.y })
  const node = createActionNode('合成', pos)
  addNodes([node as any])
  persist()
  selectedNodeId.value = node.id
  highlightFromNode(node.id)
}

function onCtxCreateItem(screen: { x: number; y: number }) {
  createItemAt(screen)
}
function onCtxCreateAction(screen: { x: number; y: number }) {
  createActionAt(screen)
}
function onCtxEdit(nodeId: string) {
  selectedNodeId.value = nodeId
  highlightFromNode(nodeId)
}
function onCtxDuplicate(nodeId: string) {
  duplicateNode(nodeId)
  persist()
}
function onCtxRemove(nodeId: string) {
  deleteNode(nodeId)
  persist()
  if (selectedNodeId.value === nodeId) selectedNodeId.value = null
  clearHighlight()
}

// ---- 快捷键说明 ----
const shortcutsList = [
  { keys: '左键拖动', desc: '平移画布' },
  { keys: '滚轮', desc: '缩放画布' },
  { keys: '点击节点', desc: '选中并在右侧属性面板编辑，高亮其上游配方链' },
  { keys: 'Ctrl + 左键拖动', desc: '框选多个节点' },
  { keys: '点击空白', desc: '取消选中 / 取消高亮' },
  { keys: '右键画布', desc: '打开菜单：创建物品/加工动作节点' },
  { keys: '右键节点', desc: '打开菜单：属性修改 / 复制 / 删除' },
  { keys: 'Ctrl/⌘ + S', desc: '保存到本地文件（下载 .json）' },
  { keys: 'Ctrl + A', desc: '全选所有节点' },
  { keys: 'Ctrl + C', desc: '复制选中节点' },
  { keys: 'Ctrl + V', desc: '粘贴（复制生成的新节点）' },
  { keys: 'Delete / Backspace', desc: '删除选中节点' },
  { keys: 'Esc', desc: '取消选中 / 关闭弹窗 / 关闭图片预览' },
]

</script>

<template>
  <div class="layout">
    <!-- 顶部工具栏 -->
    <header class="toolbar">
      <span class="brand">🎮 游戏配方可视化编辑器</span>
      <div class="tool-actions">
        <el-button size="small" type="primary" @click="onAddRecipe">+ 添加配方</el-button>
        <el-button size="small" type="primary" @click="onSaveFile">💾 保存到本地文件</el-button>
        <el-button size="small" @click="onImportClick">导入 JSON</el-button>
        <el-button size="small" type="danger" plain @click="onReset">清空</el-button>
        <el-button size="small" @click="shortcutsVisible = true">⌨ 快捷键说明</el-button>
        <input ref="importInput" type="file" accept="application/json" style="display:none" @change="onImportChange" />
      </div>
    </header>

    <!-- 画布区 -->
    <main class="center" @contextmenu="onCanvasContextMenu">
      <VueFlow
        :node-types="nodeTypes"
        :default-viewport="{ zoom: 0.9 }"
        :min-zoom="0.2"
        :max-zoom="2.5"
        fit-view-on-init
        :selection-key-code="'Control'"
        :multi-selection-key-code="'Control'"
        :selection-on-drag="false"
        :pan-on-drag="[0]"
      >
        <Background :gap="16" pattern-color="#dcdfe6" />
        <Controls />
        <div class="zoom-indicator">{{ Math.round(viewport.zoom * 100) }}%</div>
        <MiniMap pannable zoomable />
      </VueFlow>

      <!-- 选中节点后的属性面板：画布内悬浮卡片（不覆盖工具栏、不置暗画布） -->
      <div v-if="selectedNodeId" class="float-panel">
        <div class="float-head">
          <span>属性面板</span>
          <el-button text size="small" circle @click="selectedNodeId = null">✕</el-button>
        </div>
        <PropertyPanel v-model="selectedNodeId" />
      </div>

      <div class="hint">提示：点击任意【物品节点】高亮其完整上游配方链；点击空白取消。点击节点可在右侧面板编辑，可继续点其他节点切换。</div>
    </main>

    <!-- 全局图片放大预览 -->
    <ImagePreview />

    <!-- 自定义右键菜单 -->
    <ContextMenu
      @create-item="onCtxCreateItem"
      @create-action="onCtxCreateAction"
      @edit="onCtxEdit"
      @duplicate="onCtxDuplicate"
      @remove="onCtxRemove"
    />

    <!-- 快捷键说明弹窗 -->
    <el-dialog v-model="shortcutsVisible" title="快捷键说明" width="440px" append-to-body>
      <el-table :data="shortcutsList" size="small" border>
        <el-table-column prop="keys" label="快捷键" width="140">
          <template #default="{ row }">
            <span class="kbd">{{ row.keys }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="desc" label="功能说明" />
      </el-table>
    </el-dialog>

    <!-- 配方录入弹窗 -->
    <el-dialog
      v-model="formDialogVisible"
      title="配方录入"
      width="460px"
      :close-on-click-modal="false"
      append-to-body
    >
      <FormPanel @submitted="formDialogVisible = false" />
    </el-dialog>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #1f2933;
  color: #fff;
}
.brand {
  font-weight: 700;
  font-size: 16px;
}
.tool-actions {
  display: flex;
  gap: 8px;
}
.center {
  flex: 1;
  position: relative;
  min-width: 0;
}
.hint {
  position: absolute;
  bottom: 12px;
  right: 12px;
  font-size: 12px;
  color: #909399;
  background: rgba(255, 255, 255, 0.85);
  padding: 4px 10px;
  border-radius: 6px;
  pointer-events: none;
  max-width: 60%;
}
.zoom-indicator {
  position: absolute;
  bottom: 12px;
  left: 60px;
  z-index: 5;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #606266;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #e4e7ed;
  padding: 3px 9px;
  border-radius: 6px;
  pointer-events: none;
  user-select: none;
}
/* 画布内悬浮属性面板 */
.float-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 300px;
  max-height: calc(100% - 24px);
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
  z-index: 20;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.float-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-weight: 700;
  font-size: 14px;
  border-bottom: 1px solid #ebeef5;
  background: #fafafa;
  user-select: none;
}
.float-panel :deep(.prop-panel) {
  padding: 12px;
  height: auto;
  overflow-y: auto;
}
.kbd {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  background: #f4f4f5;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 12px;
  white-space: nowrap;
}</style>
