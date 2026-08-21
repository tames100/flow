<script setup lang="ts">
import { ref } from 'vue'
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
import type { RecipeGraphData } from './types'

const { onNodeClick, onConnect, addEdges } = useVueFlow()
const { deleteNode, detectCycle, exportJSON, importJSON } = useRecipeGraph()
const { highlightFromNode, clearHighlight } = useRecipeHighlight()

const selectedNodeId = ref<string | null>(null)
const importInput = ref<HTMLInputElement | null>(null)

const nodeTypes: Record<string, any> = {
  item: ItemNode,
  action: ActionNode,
}

// 选中节点同步到属性面板
onNodeClick(({ node }) => {
  selectedNodeId.value = node.id
  // 核心交互：点击任意物品节点 -> 高亮完整上游配方链
  highlightFromNode(node.id)
})

// 连线时记录（供手动拖拽连接使用）
onConnect((connection) => {
  addEdges([{ ...connection, id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, class: 'recipe-edge' }])
  const cycle = detectCycle()
  if (cycle.length > 0) {
    ElMessageBox.alert(
      `检测到循环依赖！参与循环的节点数：${cycle.length}。`,
      '循环依赖警告',
      { type: 'warning' },
    )
  }
})

// 删除键删除选中节点
function onKeydown(e: KeyboardEvent) {
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId.value) {
    // 避免在输入框中误删
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    deleteNode(selectedNodeId.value)
    selectedNodeId.value = null
  }
}
window.addEventListener('keydown', onKeydown)

// ---- 顶部工具栏：保存 / 导出 / 导入 / 重置 ----
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
      importJSON({ version: '1.0', nodes: [], edges: [] })
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
        <el-button size="small" @click="onSave">保存校验</el-button>
        <el-button size="small" type="success" @click="onExport">导出 JSON</el-button>
        <el-button size="small" type="primary" @click="onImportClick">导入 JSON</el-button>
        <el-button size="small" type="danger" plain @click="onReset">清空</el-button>
        <input ref="importInput" type="file" accept="application/json" style="display:none" @change="onImportChange" />
      </div>
    </header>

    <div class="body">
      <!-- 左：表单录入 -->
      <aside class="left">
        <FormPanel />
      </aside>

      <!-- 中：画布 -->
      <main class="center">
        <VueFlow
          :node-types="nodeTypes"
          :default-viewport="{ zoom: 0.9 }"
          :min-zoom="0.2"
          :max-zoom="2.5"
          fit-view-on-init
        >
          <Background :gap="16" pattern-color="#dcdfe6" />
          <Controls />
          <MiniMap pannable zoomable />
        </VueFlow>
        <div class="hint">提示：点击任意【物品节点】高亮其完整上游配方链；点击空白取消。</div>
      </main>

      <!-- 右：属性面板 -->
      <aside class="right">
        <PropertyPanel v-model="selectedNodeId" />
      </aside>
    </div>
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
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.left {
  width: 300px;
  border-right: 1px solid #e4e7ed;
  background: #fafafa;
  overflow: hidden;
}
.center {
  flex: 1;
  position: relative;
  min-width: 0;
}
.right {
  width: 300px;
  border-left: 1px solid #e4e7ed;
  background: #fafafa;
  overflow: hidden;
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
</style>
