<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { VueFlow, useVueFlow, MarkerType } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

import FormPanel from './components/FormPanel.vue'
import PropertyPanel from './components/PropertyPanel.vue'
import GroupDrawer from './components/GroupDrawer.vue'
import ItemNode from './components/nodes/ItemNode.vue'
import ActionNode from './components/nodes/ActionNode.vue'
import ImagePreview from './components/ImagePreview.vue'
// 裁剪弹窗按需加载（cropperjs 单独分包，仅打开裁剪时才请求）
const ImageCropDialog = defineAsyncComponent(() => import('./components/ImageCropDialog.vue'))
import ContextMenu from './components/ContextMenu.vue'
import CanvasTabs from './components/CanvasTabs.vue'
import ShortcutsDialog from './components/ShortcutsDialog.vue'
import ExportDialog from './components/ExportDialog.vue'
import SourceImportDialog from './components/SourceImportDialog.vue'
import BatchEditDialog from './components/BatchEditDialog.vue'

import {
  useRecipeGraph,
  useRecipeHighlight,
  useCanvasShortcuts,
  useContextMenu,
  useGroups,
  useImageCrop,
  type RecipeGraphData,
  type SourceMachine,
} from './composables'

const { onNodeClick, onEdgeClick, onConnect, addEdges, addNodes, onNodeDragStart, onNodeDrag, onNodeDragStop, onPaneClick, screenToFlowCoordinate, setCenter, viewport, findNode, updateNode, getNodes } =
  useVueFlow()
const { detectCycle, exportJSON, exportAllJSON, importJSON, persist, loadFromStorage, createItemNode, createActionNode, duplicateNode, deleteNode, resolveUnit, edgeLabel, parseSourceRecipe, importSourceRecipes, serializeNodes, nodes } =
  useRecipeGraph()
const { highlightFromNode, clearHighlight } = useRecipeHighlight()
const { open: openContextMenu } = useContextMenu()
const { allGroups } = useGroups()
const crop = useImageCrop()

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
  ; (() => {
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
      customClass: 'save-toast',
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

// ---- Shift + 左键拖动节点 = 复制并拖出副本 ----
// 注：Ctrl 键留给「多选节点」交互
// 按住 Shift 拖动节点：拖动开始时立即在原点生成副本（新 id，完整复制），
// 拖动过程中原件（及同组选中节点）钉在原位不动，副本跟随鼠标移动；
// 松手后副本留在终点、原件留在原位。
const dragCopyInfo = ref<{ id: string; copyId: string; group: Map<string, { x: number; y: number }> } | null>(null)

onNodeDragStart(({ node, event }) => {
  if (!('shiftKey' in event)) return
  const e = event as MouseEvent
  if (!e.shiftKey) return
  // 立即在原点生成副本（复制除 id 外的所有值，id 重新生成）
  const copy = duplicateNode(node.id, { ...node.position })
  if (!copy) return
  // 记录原件与同组选中节点的起始位置（拖动过程中保持原位）
  const group = new Map<string, { x: number; y: number }>()
  getNodes.value.forEach((n) => {
    if (n.selected) group.set(n.id, { x: n.position.x, y: n.position.y })
  })
  group.set(node.id, { x: node.position.x, y: node.position.y })
  dragCopyInfo.value = { id: node.id, copyId: copy.id, group }
})

onNodeDrag(({ node }) => {
  const info = dragCopyInfo.value
  if (!info || info.id !== node.id) return
  const pos = { x: node.position.x, y: node.position.y }
  // 原件（及同组节点）钉回原位，副本跟随鼠标
  info.group.forEach((p, id) => updateNode(id, { position: { ...p } }))
  updateNode(info.copyId, { position: pos })
})

onNodeDragStop(({ node }) => {
  const info = dragCopyInfo.value
  dragCopyInfo.value = null
  if (info && info.id === node.id) {
    // 原件（及同组节点）复位；副本保持终点位置
    info.group.forEach((p, id) => updateNode(id, { position: { ...p } }))
    persist()
    return
  }
  // 普通拖拽：自动保存最新位置
  persist()
})

// 点击画布空白处：取消选中与文本选区
onPaneClick(() => {
  selectedNodeId.value = null
  selectedEdgeId.value = null
  window.getSelection()?.removeAllRanges()
})

const selectedNodeId = ref<string | null>(null)
const selectedEdgeId = ref<string | null>(null)
const importInput = ref<HTMLInputElement | null>(null)
const folderUploadInput = ref<HTMLInputElement | null>(null)
const batchEditDialogVisible = ref(false)
// 批量编辑分组：弹窗内 UI 状态（groupIds/mode）已抽离到 BatchEditDialog.vue；
// App 仅持有选中节点 id 列表 + 传递给弹窗的初始值
const batchEditNodeIds = ref<string[]>([])
const batchInitGroupIds = ref<string[]>([])
const batchInitMode = ref<'union' | 'replace'>('union')
const formDialogVisible = ref(false)
const formEditActionId = ref<string | null>(null)
const formDialogTitle = ref('配方录入')
const groupDrawerVisible = ref(false)

// 导出 JSON：弹窗 UI 与 scope 状态已抽离到 ExportDialog.vue，App 仅持有可见性
const exportDialogVisible = ref(false)

// 画布切换：清理选中节点 / 连线 / 高亮（新画布的节点 id 与旧画布无关）
function onCanvasSwitch() {
  selectedNodeId.value = null
  selectedEdgeId.value = null
  clearHighlight()
  window.getSelection()?.removeAllRanges()
}

// ---- 顶部工具栏：全局搜索节点 ----
const searchNodeId = ref<string | null>(null)
const searchOptions = computed<{ id: string; label: string; kind: string }[]>(() =>
  getNodes.value.map((n) => ({
    id: n.id,
    label: ((n.data as any)?.label as string) || n.id,
    kind: (n.data as any)?.kind ?? '',
  })),
)

// 选中搜索结果：聚焦居中 + 高亮其上游配方链
function onSearchSelect(id: string | null) {
  if (!id) return
  const node = findNode(id)
  if (!node) return
  selectedNodeId.value = id
  selectedEdgeId.value = null
  highlightFromNode(id)
  const w = node.dimensions?.width ?? 60
  const h = node.dimensions?.height ?? 60
  setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: 1.3, duration: 400 })
  window.getSelection()?.removeAllRanges()
}

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
onNodeClick(({ node, event }) => {
  // Shift + 点击节点 = 立即复制当前节点（新 id，完整复制），副本偏移显示并选中
  // 注：Ctrl/⌘ 留给 Vue Flow 的多选交互（Ctrl+单击 / Ctrl+框选）
  if ('shiftKey' in event && event.shiftKey) {
    const copy = duplicateNode(node.id, { x: node.position.x + 24, y: node.position.y + 24 })
    selectedNodeId.value = copy?.id ?? null
    selectedEdgeId.value = null
    clearHighlight()
    window.getSelection()?.removeAllRanges()
    return
  }
  // Ctrl/⌘ 多选时，不做「居中聚焦 / 高亮上游」，保留节点多选状态给批量编辑
  if ('ctrlKey' in event && (event.ctrlKey || event.metaKey)) {
    selectedEdgeId.value = null
    window.getSelection()?.removeAllRanges()
    return
  }
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
  formEditActionId.value = null
  formDialogTitle.value = '配方录入'
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
  ElMessage.success({ message: '画布状态已保存（节点位置 / 连线 / 视图）', customClass: 'save-toast' })
}

// 导出：打开弹窗（scope 重置由 ExportDialog 在打开时处理）
function onExportFile() {
  exportDialogVisible.value = true
}

// 导出确认：按用户选择的范围导出（当前画布 / 全部画布）
function onExportConfirm(scope: 'current' | 'all') {
  const isAll = scope === 'all'
  const data = isAll ? exportAllJSON() : exportJSON()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = isAll ? `recipes_all_${Date.now()}.json` : `recipe_${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(isAll ? '已导出全部画布 .json 文件' : '已导出当前画布 .json 文件')
}

function onFolderUploadClick() {
  folderUploadInput.value?.click()
}
async function onFolderUploadChange(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
    .filter((f) => /\.(png|jpg|jpeg|webp|gif)$/i.test(f.name))
  if (!files.length) {
    ElMessage.warning('未检测到可用图片文件（png/jpg/jpeg/webp/gif）')
    return
  }
  // 读取当前视图中心，围绕它排布新节点
  const viewCenter = viewport.value
  const startX = viewCenter.x - viewCenter.x / viewCenter.zoom + 60
  const startY = viewCenter.y - viewCenter.y / viewCenter.zoom + 60
  let i = 0
  const perRow = 5
  const stepX = 230
  const stepY = 180
  for (const file of files) {
    const name = file.name.replace(/\.[^/.]+$/, '')
    let imgData = ''
    try {
      // 单张图超过 1.5MB 也先尝试读取，失败则跳过
      imgData = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = () => reject(r.error)
        r.readAsDataURL(file)
      })
    } catch (_err) {
      ElMessage.warning(`读取失败，已跳过：${file.name}`)
      continue
    }
    const col = i % perRow
    const row = Math.floor(i / perRow)
    const pos = { x: startX + col * stepX, y: startY + row * stepY }
    const n = createItemNode(name, imgData, pos, true, 1, '', [])
    addNodes([n as any])
    i++
  }
  nodes.value = JSON.parse(JSON.stringify(serializeNodes()))
  persist()
  ElMessage.success(`已批量生成 ${i} 个物品节点`)
    ; (e.target as HTMLInputElement).value = ''
}

function onImportClick() {
  importInput.value?.click()
}

/** 源配方（Minecraft 配方 JSON）导入：弹窗 UI 与勾选状态已抽离到 SourceImportDialog.vue */
const sourceDialogVisible = ref(false)
const sourceData = ref<SourceMachine | null>(null)

function onImportChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string)
      // 1) 尝试识别 Minecraft 配方 JSON（如「大容量发酵罐配方.json」）
      const src = parseSourceRecipe(data)
      if (src) {
        // 设置 sourceData 后，SourceImportDialog 内部 watch 会自动重置勾选为「全选」
        sourceData.value = src
        sourceDialogVisible.value = true
        return
      }
      // 2) 多画布格式：替换全部画布（需确认）
      if (data && Array.isArray(data.canvases)) {
        ElMessageBox.confirm(
          '导入多画布 JSON 将替换当前全部画布，是否继续？',
          '导入确认',
          { type: 'warning' },
        )
          .then(() => {
            importJSON(data)
            clearHighlight()
            onCanvasSwitch()
            ElMessage.success('导入成功（已替换全部画布）')
          })
          .catch(() => { })
        return
      }
      // 3) 单画布格式：替换当前活动画布内容（其他画布保留）
      importJSON(data as RecipeGraphData)
      clearHighlight()
      selectedNodeId.value = null
      selectedEdgeId.value = null
      ElMessage.success('导入成功（已替换当前画布）')
    } catch (err) {
      ElMessage.error('导入失败：JSON 解析错误')
    }
  }
  reader.readAsText(file)
    ; (e.target as HTMLInputElement).value = ''
}

// 源配方导入确认：由 SourceImportDialog emit confirm(selectedNames) 触发
function onSourceImport(selectedNames: string[]) {
  if (!sourceData.value) return
  const { nodes, edges } = importSourceRecipes(sourceData.value, selectedNames)
  clearHighlight()
  if (!nodes.length) {
    ElMessage.warning('未选择任何配方，未导入节点')
    return
  }
  selectedNodeId.value = null
  selectedEdgeId.value = null
  ElMessage.success(`已导入 ${nodes.length} 个节点、${edges.length} 条连线`)
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
    .catch(() => { })
}

// ---- 画布右键菜单 ----
// 在画布空白处右键：打开画布级菜单（创建节点）
function onCanvasContextMenu(e: MouseEvent) {
  const targetEl = e.target as HTMLElement
  // 如果右键落在节点卡片上，节点组件的 contextmenu 已经 stopPropagation，不会冒泡到这里
  // 因此命中这里时一定是画布（或 Vue Flow 内部容器：pane / selection 框 / viewport 等）
  const withinFlow = targetEl?.closest('.vue-flow')
  if (!withinFlow) return
  // 如果已经选中 ≥2 个节点：进入批量模式菜单
  const selectedNodes = (getNodes.value as any[]).filter((n) => n.selected)
  if (selectedNodes.length >= 2) {
    const kinds = new Set(
      selectedNodes.map((n) => (n.data?.kind as 'item' | 'action') ?? 'item'),
    )
    const allKind = kinds.size === 1 ? (kinds.values().next().value as 'item' | 'action') : 'mixed'
    openContextMenu(e, { type: 'multi-node', nodeIds: selectedNodes.map((n) => n.id), allKind })
    return
  }
  // 否则：普通画布菜单
  openContextMenu(e, { type: 'canvas' })
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
function onCtxEditRecipe(nodeId: string) {
  selectedNodeId.value = nodeId
  selectedEdgeId.value = null
  highlightFromNode(nodeId)
  formEditActionId.value = nodeId
  formDialogTitle.value = '修改配方'
  formDialogVisible.value = true
}
function onCtxDuplicate(nodeId: string) {
  duplicateNode(nodeId)
  persist()
}
function onCtxBatchEditGroup(nodeIds: string[]) {
  batchEditNodeIds.value = nodeIds
  // 取交集：所有选中物品节点共同拥有的分组作为默认勾选
  if (nodeIds.length === 0) {
    batchInitGroupIds.value = []
  } else {
    let common: string[] | null = null
    for (const id of nodeIds) {
      const n = findNode(id)
      const ids = (n?.data as any)?.groupIds as string[] | undefined
      if (!ids || ids.length === 0) {
        common = []
        break
      }
      common = common === null ? [...ids] : common.filter((g) => ids.includes(g))
    }
    batchInitGroupIds.value = common ?? []
  }
  // 若无交集，启用"合并"模式，避免用户以为所有选中的都没有分组
  batchInitMode.value = batchInitGroupIds.value.length ? 'replace' : 'union'
  batchEditDialogVisible.value = true
}
// 批量编辑确认：由 BatchEditDialog emit confirm(groupIds, mode) 触发
function onBatchEditConfirm(groupIds: string[], mode: 'union' | 'replace') {
  const ids = batchEditNodeIds.value
  for (const id of ids) {
    const n = findNode(id)
    if (!n || n.data?.kind !== 'item') continue
    const curr = ((n.data as any).groupIds ?? []) as string[]
    let next: string[]
    if (mode === 'replace') {
      next = groupIds.length ? [...new Set(groupIds)] : []
    } else {
      next = [...new Set([...curr, ...groupIds])]
    }
    updateNode(id, {
      data: { ...n.data, groupIds: next.length ? next : undefined } as any,
    })
  }
  persist()
  ElMessage.success(`已更新 ${ids.length} 个物品节点的分组`)
}
function onCtxRemove(nodeId: string) {
  deleteNode(nodeId)
  persist()
  if (selectedNodeId.value === nodeId) selectedNodeId.value = null
  clearHighlight()
}

// 快捷键说明弹窗数据与 UI 已抽离到 ShortcutsDialog.vue

</script>

<template>
  <div class="layout">
    <!-- 顶部工具栏 -->
    <header class="toolbar">
      <span class="brand">🎮 游戏配方可视化编辑器</span>
      <div class="tool-actions">
        <el-select v-model="searchNodeId" placeholder="🔍 搜索节点" filterable clearable size="small" class="node-search"
          @change="onSearchSelect">
          <el-option v-for="o in searchOptions" :key="o.id" :value="o.id" :label="o.label">
            <span style="display: flex; align-items: center; gap: 6px">
              <el-tag size="small" :type="o.kind === 'action' ? 'warning' : 'primary'"
                style="width: 34px; text-align: center">
                {{ o.kind === 'action' ? '加工' : '物品' }}
              </el-tag>
              <span>{{ o.label }}</span>
            </span>
          </el-option>
        </el-select>
        <el-button size="small" type="primary" @click="onAddRecipe">+ 添加配方</el-button>
        <el-button size="small" @click="groupDrawerVisible = true">🗂 分组</el-button>
        <el-button size="small" type="primary" @click="onSaveState">💾 保存画布状态</el-button>
        <el-button size="small" @click="onExportFile">导出 JSON</el-button>
        <el-button size="small" @click="onImportClick">导入 JSON</el-button>
        <el-button size="small" type="success" @click="onFolderUploadClick">🖼 批量导入图片</el-button>
        <el-button size="small" type="danger" plain @click="onReset">清空</el-button>
        <div class="auto-save-set" title="设置自动保存间隔">
          <span class="auto-save-label">自动保存</span>
          <el-input-number v-model="autoSaveInterval" :min="1" :max="3600" :step="5" size="small"
            controls-position="right" style="width: 100px" />
          <span class="auto-save-unit">s</span>
        </div>
        <el-button size="small" @click="shortcutsVisible = true">⌨ 快捷键说明</el-button>
        <input ref="importInput" type="file" accept="application/json" style="display:none" @change="onImportChange" />
        <input ref="folderUploadInput" type="file" multiple webkitdirectory directory style="display:none"
          @change="onFolderUploadChange" />
      </div>
    </header>

    <!-- 画布区 -->
    <main class="center">
      <div class="canvas-area" @contextmenu="onCanvasContextMenu">
        <VueFlow :node-types="nodeTypes" :default-viewport="{ zoom: 0.9 }" :min-zoom="0.2" :max-zoom="2.5"
          fit-view-on-init :selection-key-code="'Control'" :multi-selection-key-code="'Control'"
          :selection-on-drag="false" :pan-on-drag="[0]">
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
      </div>

      <!-- 多画布标签页（左下角，底部条形，左对齐） -->
      <CanvasTabs @switch="onCanvasSwitch" />
    </main>

    <!-- 全局图片放大预览 -->
    <ImagePreview />

    <!-- 全局图片裁剪弹窗（上传图片时先裁剪再写入节点，按需渲染） -->
    <ImageCropDialog v-if="crop.state.visible" />

    <!-- 分组管理抽屉（从画布左侧滑入，画布置暗） -->
    <GroupDrawer v-model="groupDrawerVisible" />

    <!-- 自定义右键菜单 -->
    <ContextMenu @create-item="onCtxCreateItem" @create-action="onCtxCreateAction" @edit="onCtxEdit"
      @edit-recipe="onCtxEditRecipe" @batch-edit-group="onCtxBatchEditGroup" @duplicate="onCtxDuplicate"
      @remove="onCtxRemove" />

    <!-- 批量编辑分组弹窗（UI 抽离到 BatchEditDialog，emit confirm 携带 groupIds/mode） -->
    <BatchEditDialog v-model="batchEditDialogVisible" :node-count="batchEditNodeIds.length" :groups="allGroups()"
      :initial-group-ids="batchInitGroupIds" :initial-mode="batchInitMode" @confirm="onBatchEditConfirm" />

    <!-- 快捷键说明弹窗（UI 抽离到 ShortcutsDialog） -->
    <ShortcutsDialog v-model="shortcutsVisible" />

    <!-- 源配方（Minecraft 配方 JSON）导入选择弹窗（UI 抽离到 SourceImportDialog） -->
    <SourceImportDialog v-model="sourceDialogVisible" :source-data="sourceData" @confirm="onSourceImport" />

    <!-- 配方录入弹窗 -->
    <el-dialog v-model="formDialogVisible" :title="formDialogTitle" width="980px" top="40px" class="recipe-dialog"
      :close-on-click-modal="false" append-to-body @closed="formEditActionId = null">
      <FormPanel :edit-action-id="formEditActionId" @submitted="formDialogVisible = false" />
    </el-dialog>

    <!-- 导出 JSON 弹窗（UI 抽离到 ExportDialog，emit confirm 携带 scope） -->
    <ExportDialog v-model="exportDialogVisible" @confirm="onExportConfirm" />
  </div>
</template>

<style scoped>
/* 批量编辑分组弹窗样式已迁移到 BatchEditDialog.vue */
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

.node-search {
  width: 180px;
}

.node-search :deep(.el-select__wrapper) {
  background: #fff;
}

.center {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.canvas-area {
  flex: 1;
  position: relative;
  min-width: 0;
  min-height: 0;
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

/* 配方录入弹窗：弹窗本体固定高度（永远不超过视口），内部三栏各自滚动 */
.recipe-dialog {
  height: calc(100vh - 100px);
  max-height: calc(100vh - 100px);
  display: flex;
  flex-direction: column;
  margin-bottom: 0;
}

.recipe-dialog :deep(.el-dialog__header) {
  flex-shrink: 0;
}

.recipe-dialog :deep(.el-dialog__body) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 导出弹窗样式已迁移到 ExportDialog.vue */
</style>
