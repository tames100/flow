<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { VueFlow, useVueFlow, MarkerType } from '@vue-flow/core'
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
import ImageCropDialog from './components/ImageCropDialog.vue'
import ContextMenu from './components/ContextMenu.vue'

import {
  useRecipeGraph,
  useRecipeHighlight,
  useCanvasShortcuts,
  useContextMenu,
  type RecipeGraphData,
} from './composables'

const { onNodeClick, onEdgeClick, onConnect, addEdges, addNodes, onNodeDragStop, onPaneClick, screenToFlowCoordinate, setCenter, viewport, findNode } =
  useVueFlow()
const { detectCycle, exportJSON, importJSON, persist, loadFromStorage, createItemNode, createActionNode, duplicateNode, deleteNode, resolveUnit, edgeLabel } =
  useRecipeGraph()
const { highlightFromNode, clearHighlight } = useRecipeHighlight()
const { open: openContextMenu } = useContextMenu()

const shortcutsVisible = ref(false)

// 画布快捷键
useCanvasShortcuts({
  onEscape: () => {
    clearHighlight()
    selectedNodeId.value = null
    selectedEdgeId.value = null
  },
  // Ctrl/Cmd + S：保存完整画布状态
  onSave: onSaveState,
})

const AUTO_SAVE_KEY = 'vflow_auto_save_interval'
let autoSaveTimer: number | undefined

// 自动保存间隔（秒），可在顶部工具栏调整，设置持久化到 localStorage
const autoSaveInterval = ref(10)
;(() => {
  const saved = Number(localStorage.getItem(AUTO_SAVE_KEY))
  if (Number.isFinite(saved) && saved >= 1 && saved <= 3600) {
    autoSaveInterval.value = saved
  }
})()

/** 按当前设置的间隔（秒）启动自动保存定时器 */
function startAutoSaveTimer() {
  if (autoSaveTimer) window.clearInterval(autoSaveTimer)
  autoSaveTimer = window.setInterval(() => {
    persist()
    ElMessage({
      message: '已自动保存画布状态（节点位置 / 连线 / 视图）',
      type: 'success',
      grouping: true,
      duration: 1500,
    })
  }, autoSaveInterval.value * 1000)
}

// 间隔变化时：持久化设置并重启定时器
watch(autoSaveInterval, (v) => {
  localStorage.setItem(AUTO_SAVE_KEY, String(v))
  startAutoSaveTimer()
})

// 启动时从 localStorage 恢复完整画布状态（节点位置 / 连线 / 视图）
onMounted(() => {
  loadFromStorage()
  startAutoSaveTimer()
})

onBeforeUnmount(() => {
  if (autoSaveTimer) window.clearInterval(autoSaveTimer)
})

// 拖拽节点结束后自动保存位置
onNodeDragStop(() => persist())

// 点击画布空白处：取消选中与文本选区
onPaneClick(() => {
  selectedNodeId.value = null
  selectedEdgeId.value = null
  window.getSelection()?.removeAllRanges()
})

const selectedNodeId = ref<string | null>(null)
const selectedEdgeId = ref<string | null>(null)
const importInput = ref<HTMLInputElement | null>(null)
const formDialogVisible = ref(false)

const nodeTypes: Record<string, any> = {
  item: ItemNode,
  action: ActionNode,
}

// 选中连线同步到属性面板（连线样式编辑）
onEdgeClick(({ edge }) => {
  selectedNodeId.value = null
  clearHighlight()
  selectedEdgeId.value = edge.id
  window.getSelection()?.removeAllRanges()
})

// 选中节点同步到属性面板
onNodeClick(({ node }) => {
  selectedNodeId.value = node.id
  selectedEdgeId.value = null
  // 核心交互：点击任意物品节点 -> 高亮完整上游配方链
  highlightFromNode(node.id)
  // 聚焦：将节点居中并放大，形成聚焦效果
  const w = node.dimensions?.width ?? 60
  const h = node.dimensions?.height ?? 60
  setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: 1.3, duration: 400 })
  // 清除因点击产生的浏览器文本选区，避免属性面板文字呈“选中”态
  window.getSelection()?.removeAllRanges()
})

// 连线时记录（供手动拖拽连接使用）：统一为有向图 + 默认虚线动画，从加工节点指出=输出(橙)，指向加工节点=输入(蓝)
onConnect((connection) => {
  const srcNode = findNode(connection.source)
  const isOut = srcNode?.data?.kind === 'action'
  const color = isOut ? '#e6a23c' : '#409eff'
  // 新连线默认单位：加工节点输出单位 / 上游继承单位 / 「个」
  const unit = resolveUnit(connection.source, connection.target)
  addEdges([
    {
      ...connection,
      id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      class: 'recipe-edge',
      animated: true,
      style: { stroke: color, strokeWidth: 2, strokeDasharray: '8 4' },
      unit,
      label: edgeLabel(1, unit),
      labelStyle: { fill: color, fontWeight: 700, fontSize: '12px' },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        width: 16,
        height: 16,
      },
    } as any,
  ])
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

// 保存：将当前画布完整状态（节点 / 连线 / 节点位置 / 视图缩放）持久化到本地，并弹窗提示
function onSaveState() {
  // 循环依赖仅作警告，不阻断保存
  const cycle = detectCycle()
  if (cycle.length > 0) {
    ElMessage.warning(`注意：图中存在循环依赖（${cycle.length} 个节点），仍已保存`)
  }
  persist()
  ElMessage.success('画布状态已保存（节点位置 / 连线 / 视图）')
}

// 导出：将完整画布状态生成为本地 .json 文件（便于备份 / 分享）
function onExportFile() {
  const data = exportJSON()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `recipe_${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已导出 .json 文件')
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
      selectedEdgeId.value = null
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
      selectedEdgeId.value = null
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
  selectedEdgeId.value = null
  highlightFromNode(node.id)
}

function createActionAt(screen: { x: number; y: number }) {
  const pos = screenToFlowCoordinate({ x: screen.x, y: screen.y })
  const node = createActionNode('合成', pos)
  addNodes([node as any])
  persist()
  selectedNodeId.value = node.id
  selectedEdgeId.value = null
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
  selectedEdgeId.value = null
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
  { keys: '点击节点', desc: '选中并在属性面板编辑，高亮其上游配方链' },
  { keys: '点击连线', desc: '编辑连线数量与样式（线型 / 颜色 / 动画 / 端点）' },
  { keys: 'Ctrl + 左键拖动', desc: '框选多个节点' },
  { keys: '点击空白', desc: '取消选中 / 取消高亮' },
  { keys: '右键画布', desc: '打开菜单：创建物品/加工动作节点' },
  { keys: '右键节点', desc: '打开菜单：属性修改 / 复制 / 删除' },
  { keys: 'Ctrl/⌘ + S', desc: '保存当前画布状态（节点位置 / 连线 / 视图）' },
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
        <el-button size="small" type="primary" @click="onSaveState">💾 保存画布状态</el-button>
        <el-button size="small" @click="onExportFile">导出 JSON</el-button>
        <el-button size="small" @click="onImportClick">导入 JSON</el-button>
        <el-button size="small" type="danger" plain @click="onReset">清空</el-button>
        <div class="auto-save-set" title="设置自动保存间隔">
          <span class="auto-save-label">自动保存</span>
          <el-input-number
            v-model="autoSaveInterval"
            :min="1"
            :max="3600"
            :step="5"
            size="small"
            controls-position="right"
            style="width: 100px"
          />
          <span class="auto-save-unit">s</span>
        </div>
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

      <!-- 选中节点 / 连线后的属性面板：画布内悬浮卡片（不覆盖工具栏、不置暗画布） -->
      <div v-if="selectedNodeId || selectedEdgeId" class="float-panel">
        <div class="float-head">
          <span>属性面板</span>
          <el-button text size="small" circle @click="selectedNodeId = null; selectedEdgeId = null">✕</el-button>
        </div>
        <PropertyPanel v-model="selectedNodeId" v-model:edge="selectedEdgeId" />
      </div>

      <div class="hint">提示：点击任意【物品节点】高亮其完整上游配方链；点击空白取消。点击节点可在右侧面板编辑，可继续点其他节点切换。</div>
    </main>

    <!-- 全局图片放大预览 -->
    <ImagePreview />

    <!-- 全局图片裁剪弹窗（上传图片时先裁剪再写入节点） -->
    <ImageCropDialog />

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
  align-items: center;
  gap: 8px;
}
.auto-save-set {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 6px;
}
.auto-save-label {
  font-size: 12px;
  color: #dcdfe6;
  white-space: nowrap;
}
.auto-save-unit {
  font-size: 12px;
  color: #dcdfe6;
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
