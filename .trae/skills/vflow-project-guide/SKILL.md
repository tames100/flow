---
name: "vflow-project-guide"
description: "Provides the v-flow project structure, each file's purpose, architecture and conventions. Invoke when starting any task on v-flow, needing orientation, locating files, or understanding how the codebase fits together."
---

# v-flow 项目结构与文件作用指南

游戏合成配方 DAG（有向无环图）可视化编辑器，基于 **Vue 3 `<script setup>` + Vue-Flow + Element Plus + TypeScript + Vite**。包管理器为 pnpm。

调用此 skill 后，Agent 无需再次遍历目录即可知道：每个文件做什么、放在哪、彼此如何协作，以及本项目已确立的约定。

---

## 1. 技术栈速览

- **框架**：Vue 3.5 + TypeScript（`<script setup>` 组合式 API）
- **图编辑器**：`@vue-flow/core`（核心）+ `@vue-flow/background` / `controls` / `minimap`（画布辅助）
- **UI 库**：Element Plus，经 `unplugin-auto-import` + `unplugin-vue-components` **按需自动导入**（组件与 API 均按需，样式自动注入，无需手动 import）
- **图片裁剪**：cropperjs（`ImageCropDialog` 按需异步加载，独立分包）
- **构建**：Vite 8（Rolldown）+ `vue-tsc` 类型检查；`vite.config.ts` 设置 `base: './'`，产物可部署到任意子目录
- **持久化**：localStorage（画布状态、自定义动作、自动保存间隔）

> Element Plus 的 `ElMessage` / `ElMessageBox` 等 API 全局可用（自动导入），无需 import。

---

## 2. 目录结构与文件作用

```
v-flow/
├── index.html                    # HTML 入口
├── package.json                  # 依赖与脚本（name: v-flow-recipe-editor）
├── vite.config.ts                # Vite 配置：base './'、Element Plus 按需导入、vendor 分包（vue/vue-flow/element-plus）
├── tsconfig.json / .app.json / .node.json  # TS 配置（分别用于 app 与 node）
├── pnpm-lock.yaml
├── README.md                     # 项目说明（功能/技术栈/目录/启动/部署，最权威的总览）
├── skll.md                       # 无关：一个"精准手术刀"提示词文件，非项目结构内容
├── 大容量发酵罐配方.json          # 源配方数据样例（可被 parseSourceRecipe 导入）
├── json/                         # 导出/样例配方 JSON
│   └── recipe_*.json
├── public/
│   ├── favicon.svg
│   └── icons.svg                 # 节点/动作图标精灵图
└── src/
    ├── main.ts                   # 入口：createApp(App).mount('#app')，仅引入全局样式
    ├── App.vue                   # 顶层：工具栏 + VueFlow 画布 + 悬浮 PropertyPanel + 各弹窗；编排所有 composables，自动保存定时器、Ctrl+拖动复制、连线高亮入口
    ├── style.css                 # 全局样式
    ├── types.ts                  # 类型与内置常量：DEFAULT_ACTIONS / DEFAULT_UNIT / DEFAULT_UNITS / DEFAULT_EXTRAS；ItemNodeData / ActionNodeData / RecipeForm / RecipeGraphData 等
    ├── auto-imports.d.ts         # 自动导入类型声明（构建生成，已提交）
    ├── components.d.ts            # 组件自动注册类型声明（构建生成，已提交）
    ├── composables/               # 组合式函数（项目核心逻辑均在此）
    │   ├── index.ts              # 统一导出入口：`import { useRecipeGraph, ... } from '../composables'`
    │   ├── useRecipeGraph.ts     # 图数据中心：建/删节点、表单生成节点+连线、环检测、导入/导出 JSON、localStorage 持久化、单位继承、配方追踪(基本原料/属性)、源配方解析
    │   ├── useRecipeHighlight.ts # 配方链高亮：点击物品节点递归向上游遍历整条 DAG，高亮链路、其余置灰
    │   ├── useCanvasShortcuts.ts  # 画布快捷键：Ctrl+A 全选、Ctrl+C/V 复制粘贴、Delete 删除、Esc 取消、Ctrl+S 保存
    │   ├── useContextMenu.ts      # 右键菜单状态（单例）：canvas / node 两种目标
    │   ├── useActionTypes.ts      # 加工动作池：内置 + 自定义（持久化 localStorage，随 JSON 导入/导出）
    │   ├── useGroups.ts           # 分组管理（单例）：增删改分组及其预设属性，持久化 localStorage，随 JSON 导入/导出
    │   ├── useImageUpload.ts      # 图片上传：fileToDataURL / isImageIcon / fileBaseName；useImageUpload()（文件选择/拖拽，不再支持剪贴板粘贴）
    │   ├── useImagePreview.ts     # 图片放大预览状态（单例）
    │   └── useImageCrop.ts        # 图片裁剪状态控制（单例）：open(src) → Promise，由 ImageCropDialog 消费
    └── components/
        ├── FormPanel.vue          # 配方录入表单（弹窗内）：输入物品数组 + 加工动作 + 输出产物；提交后自动生成节点与连线；每行可选分组、从分组复制属性；附加操作下拉动态同步画布
        ├── PropertyPanel.vue      # 画布内悬浮属性面板：编辑节点名称/图片/数量/单位/解释/属性/分组、连线样式；配方追踪展示；物品节点可从所属分组复制属性
        ├── GroupDrawer.vue        # 分组管理抽屉（从画布左侧滑入，画布置暗）：增删改分组及预设属性
        ├── ContextMenu.vue        # 自定义右键菜单
        ├── ImageCropDialog.vue    # 图片裁剪弹窗（cropperjs，按需异步加载）
        ├── ImagePreview.vue       # 图片放大预览遮罩
        └── nodes/
            ├── ItemNode.vue       # 物品节点（原料/产物）
            └── ActionNode.vue     # 加工动作节点（合成/搅拌/...）
```

---

## 3. 架构与数据流

### 组合式函数模式（composables）

- 所有业务逻辑集中在 `src/composables/`，组件保持"瘦"。
- `composables/index.ts` 统一导出，组件只需一行 import 即可拿到所需函数与类型。
- 多数 composable 使用**模块级单例状态**（在函数外定义 ref/reactive，如 `useImageCrop`、`useImagePreview`、`useContextMenu`、`useActionTypes`、`useRecipeGraph`、`useRecipeHighlight`），因此多处调用共享同一份状态。这意味着：
  - 裁剪弹窗、图片预览、右键菜单都是全局唯一实例（由 `App.vue` 挂载一次，其余地方调用 `open(...)` 触发）。
  - **图片上传流程**：选择/拖拽文件 → `useImageUpload.handleFile` → `fileToDataURL` → `useImageCrop.open` 弹裁剪窗 → 确认后写入目标 → 持久化。

### 数据流

- `App.vue` 是编排中枢：工具栏按钮 → 打开 `FormPanel` / 触发导入导出 / 调整自动保存间隔。
- `FormPanel` 提交 → `useRecipeGraph.addRecipeFromForm` → 批量创建 ItemNode / ActionNode / Edge → `persist()`。
- 节点点击 → `useRecipeHighlight.highlightFromNode` → 高亮上游链；连线点击 → 选中并交给 `PropertyPanel` 编辑。
- 持久化：`useRecipeGraph.persist` 把节点位置/连线/视图/分组写入 localStorage（key `vflow_graph_data`）；自定义动作用 `vflow_action_types`；分组用 `vflow_groups`；自动保存间隔用 `vflow_auto_save_interval`。

### 关键类型（见 `src/types.ts`）

- `NodeKind = 'item' | 'action'`；`ItemNodeData` / `ActionNodeData` / `RecipeNodeData`。
- `ItemAttribute`：`{ icon?, name, value, desc? }`（图标与说明非必选）。
- `RecipeGroup`：`{ id, name, attributes? }`（用户自定义分组，可携带预设属性）。
- `ItemNodeData` / `ActionNodeData` 均含 `groupIds?: string[]`（所属分组 id 列表，一个节点可归属多个分组）。
- `RecipeForm`：表单录入结构（inputs[] 各含 groupIds、action、actionGroupIds、outputs[] 各含 groupIds）。
- `RecipeGraphData`：导入/导出 JSON 结构（version、actions、groups、nodes、edges、viewport）。
- 内置常量：`DEFAULT_ACTIONS=['合成','搅拌','切割','熔炼']`、`DEFAULT_UNIT='个'`、`DEFAULT_UNITS`、`DEFAULT_EXTRAS`。

---

## 4. 已确立的约定（修改时务必遵循）

1. **图片来源仅限用户上传**：所有图片上传走文件选择 / 拖拽，**不再支持剪贴板粘贴**（`useImageUpload` 已移除 `onPaste`，组件中 `@paste` 绑定与全局 paste 监听均已删除）。
2. **上传必经裁剪**：图片写入节点/表单前一律先经 `ImageCropDialog` 裁剪确认（取消则忽略）。
3. **图片名可替换物品名**：上传图片后，用 `fileBaseName(file)` 取基础名（去扩展名）同步名称：
   - 名称空 → 直接填入图片名；
   - 名称与图片名一致 → 无操作；
   - 不一致 → `ElMessageBox.confirm` 弹窗，展示"物品名称/动作名称"与"图片名称"，让用户选"使用图片名称"或"保留原名称"。
   - 该逻辑在 `FormPanel.vue`（输入/输出/动作）与 `PropertyPanel.vue`（物品/动作节点）均已落地；**属性图标不参与名称替换**（仅作为图标）。
4. **加工动作节点**：`label` 与 `action` 始终同步（改名称即改动作，并 `addAction` 入池）。
5. **单位继承**：加工节点 `outputUnit` 自动同步到下游输入连线单位；连线默认单位"个"。
6. **样式相对路径**：`vite.config.ts` 的 `base: './'` 不可随意改回 `'/'`，否则子目录部署会资源 404。
7. **避免文件膨胀**：新增逻辑优先放进 composables 或独立组件，主文件保持精简。
8. **删除文件用 DeleteFile 工具**，不要用 shell；编辑用 Edit；搜索用 Glob/Grep/SearchCodebase。
9. **分组功能**：一个节点可归属多个分组（`groupIds?: string[]`）。物品节点可从所属分组**复制属性为节点自有属性**（深拷贝，独立可编辑，之后改分组不影响已拷贝的节点属性）。加工节点加入分组**仅保留归属**（groupIds），不继承分组属性。分组列表随配方 JSON 一起导入/导出（`RecipeGraphData.groups`）。分组管理通过工具栏「🗂 分组」按钮打开 `GroupDrawer`（从画布左侧滑入，画布置暗）。
10. **附加操作下拉动态同步**：`FormPanel` 与 `PropertyPanel` 的附加操作下拉选项由 `getExtraOptions()` 动态生成（内置 `DEFAULT_EXTRAS` + 画布上加工节点已使用的 `extra` 值 + 当前表单输入值），用户输入自定义附加操作后下拉列表自动更新。

---

## 5. 常用命令

```bash
pnpm install          # 安装依赖
pnpm dev              # 启动开发服务器（端口 8080，自动打开浏览器）
pnpm build            # vue-tsc 类型检查 + vite build → dist/
pnpm preview          # 预览构建产物
pnpm exec vue-tsc --noEmit   # 仅类型检查
```

- 启动后访问 http://localhost:8080
- Element Plus 按需导入，故 `ElMessage`/`ElMessageBox` 等可在任意 `.vue`/`.ts` 中直接使用。

---

## 6. 典型任务定位

- **改配方录入表单** → `src/components/FormPanel.vue`
- **改节点展示样式** → `src/components/nodes/ItemNode.vue` / `ActionNode.vue`
- **改连线/节点数据逻辑、环检测、导入导出** → `src/composables/useRecipeGraph.ts`
- **改画布快捷键** → `src/composables/useCanvasShortcuts.ts`
- **改高亮交互** → `src/composables/useRecipeHighlight.ts`
- **改图片上传/裁剪/预览** → `composables/useImageUpload.ts` / `useImageCrop.ts` / `useImagePreview.ts` + `components/ImageCropDialog.vue` / `ImagePreview.vue`
- **改属性编辑/连线编辑面板** → `src/components/PropertyPanel.vue`
- **改分组管理/分组属性** → `src/components/GroupDrawer.vue` + `src/composables/useGroups.ts`
- **改工具栏/自动保存/顶层编排** → `src/App.vue`
- **改类型/内置常量** → `src/types.ts`
