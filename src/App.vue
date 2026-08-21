<script setup lang="ts">
import { ref, onMounted } from 'vue'
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

import { useRecipeGraph } from './composables/useRecipeGraph'
import { useRecipeHighlight } from './composables/useRecipeHighlight'
import { useCanvasShortcuts } from './composables/useCanvasShortcuts'
import type { RecipeGraphData } from './types'

const { onNodeClick, onConnect, addEdges, onNodeDragStop, onPaneClick, getNodes, getEdges, updateNode, updateEdge } =
  useVueFlow()
const { detectCycle, exportJSON, importJSON, persist, loadFromStorage } =
  useRecipeGraph()
const { highlightFromNode, clearHighlight } = useRecipeHighlight()

// 右键点击画布空白：选中全部节点
function selectAll() {
  getNodes.value.forEach((n) => updateNode(n.id, { selected: true } as any))
  getEdges.value.forEach((e) => updateEdge(e as any, { selected: true } as any))
}

// 画布快捷键
useCanvasShortcuts({
  onSelectAll: selectAll,
  onEscape: () => {
    clearHighlight()
    selectedNodeId.value = null
  },
})

// 启动时从 localStorage 恢复自动保存的数据
onMounted(() => {
  loadFromStorage()
})

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

function onSave() {
  const cycle = detectCycle()
  if (cycle.length > 0) {
    ElMessageBox.alert(
      `保存失败：图中存在循环依赖（${cycle.length} 个节点）。请先消除循环。`,
      '循环依赖',
      { type: 'error' },
    )
    return
  }
  ElMessage.success('保存校验通过：无循环依赖')
}

function onExport() {
  const data = exportJSON()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `recipe_${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已导出 JSON')
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
</script>

<template>
  <div class="layout">
    <!-- 顶部工具栏 -->
    <header class="toolbar">
      <span class="brand">🎮 游戏配方可视化编辑器</span>
      <div class="tool-actions">
        <el-button size="small" type="primary" @click="onAddRecipe">+ 添加配方</el-button>
        <el-button size="small" @click="onSave">保存校验</el-button>
        <el-button size="small" type="success" @click="onExport">导出 JSON</el-button>
        <el-button size="small" @click="onImportClick">导入 JSON</el-button>
        <el-button size="small" type="danger" plain @click="onReset">清空</el-button>
        <input ref="importInput" type="file" accept="application/json" style="display:none" @change="onImportChange" />
      </div>
    </header>

    <!-- 画布区 -->
    <main class="center">
      <VueFlow
        :node-types="nodeTypes"
        :default-viewport="{ zoom: 0.9 }"
        :min-zoom="0.2"
        :max-zoom="2.5"
        fit-view-on-init
        :selection-key-code="'Control'"
        :multi-selection-key-code="'Control'"
        :selection-on-drag="false"
        :pan-on-drag="true"
      >
        <Background :gap="16" pattern-color="#dcdfe6" />
        <Controls />
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
  left: 12px;
  font-size: 12px;
  color: #909399;
  background: rgba(255, 255, 255, 0.85);
  padding: 4px 10px;
  border-radius: 6px;
  pointer-events: none;
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
</style>
