# 游戏配方可视化编辑器 (v-flow)

基于 **Vue 3 + `<script setup>` + Vue-Flow + Element Plus + TypeScript** 开发的游戏合成配方 DAG（有向无环图）可视化编辑器。

## 功能一览

1. **两类节点**
   - `ItemNode` 物品节点：显示物品名称 / 图片，支持「仅图片 / 图片+文字」两种显示模式，可上传图片、设置数量与解释，代表原料或产物。
   - `ActionNode` 加工动作节点：内置 `合成 / 搅拌 / 切割 / 熔炼`，支持自定义扩展动作与动作图标，可设置输出单位，接收多个输入物品、输出产物。
2. **配方录入弹窗**：点击工具栏「+ 添加配方」，填写「输入物品数组 + 加工动作 + 输出产物」，提交后**自动生成节点与连线**，无需手动拖拽；弹窗顶部与工具栏底部对齐。
3. **画布基础能力**：拖拽节点、平移缩放（Controls / MiniMap + 缩放指示）、框选、复制 / 粘贴、删除节点与连线（Delete 键或右键菜单）；**按住 `Ctrl/⌘` 左键拖动节点 = 复制节点**（副本生成新 ID，完整保留节点全部属性，松手后原节点自动还原到原位）。
4. **核心交互（配方链高亮）**：点击任意【物品节点】，递归向上遍历整张 DAG，找到该节点**完整上游所有依赖**（追溯到最顶层原始原料），将这条配方链上的所有节点与连线**高亮**、其余**置灰**，并自动将节点居中放大聚焦；点击画布空白区域取消高亮。
5. **连线编辑与单位继承**：点击连线可在属性面板编辑数量、单位、线型、颜色、动画与箭头端点；加工节点的输出单位会自动继承给下游输入连线（默认单位「个」）。
6. **环检测**：新增连线 / 保存校验时检测循环依赖，有环则弹窗警告（不阻断保存）。
7. **右键菜单**：画布空白处右键可创建物品 / 加工动作节点；节点上右键可编辑属性、复制、删除。
8. **图片能力**：上传图片先经 **cropperjs 裁剪**（裁剪弹窗按需加载），节点图片支持点击**放大预览**。
9. **属性面板**：选中节点 / 连线后在画布内悬浮显示，可编辑名称、加工动作、显示模式、数量、单位、解释、替换图片，以及复制 / 删除；「加工动作」与「名称」保持同步。
10. **自动保存与持久化**：按可调间隔（工具栏设置，1–3600s）自动将节点位置 / 连线 / 视图持久化到 localStorage；`Ctrl/Cmd + S` 手动保存。
11. **数据导入 / 导出 JSON**：导出包含全部节点、连线、图片（dataURL）、动作配置与视图状态；支持导入恢复与一键清空。
12. **快捷键**：`Ctrl + 左键拖动节点` 复制节点、`Ctrl+A` 全选、`Ctrl+C / V` 复制粘贴、`Delete` 删除、`Esc` 取消选中 / 关闭弹窗（工具栏「⌨ 快捷键说明」可查看完整列表）。

## 技术栈

- **Vue 3.5 + TypeScript**：`<script setup>` 组合式 API。
- **Vite 8（Rolldown）+ vue-tsc**：构建与类型检查。
- **Vue Flow**：`@vue-flow/core`（图核心）、`@vue-flow/background` / `controls` / `minimap`（画布辅助）。
- **Element Plus**：UI 组件库，通过 `unplugin-auto-import` + `unplugin-vue-components` **按需自动导入**（组件与 API 均按需，样式自动注入，无需全量引入）。
- **cropperjs**：图片裁剪（`ImageCropDialog` 按需加载，独立分包）。
- **包管理器**：pnpm（也兼容 npm / yarn）。

## 目录结构

```
src/
├── main.ts                      # 入口（Element Plus 按需导入，无全量注册）
├── App.vue                      # 工具栏 + 画布 + 悬浮属性面板 + 各弹窗
├── style.css                    # 全局样式
├── types.ts                     # 类型定义与内置常量（动作 / 单位）
├── auto-imports.d.ts            # 自动导入类型声明（构建时生成，建议提交）
├── components.d.ts              # 组件自动注册类型声明（构建时生成，建议提交）
├── composables/
│   ├── index.ts                 # 统一导出入口
│   ├── useRecipeGraph.ts        # 图数据中心：增删改/表单生成/环检测/导入导出/持久化
│   ├── useRecipeHighlight.ts    # 配方链高亮（递归上游遍历）
│   ├── useCanvasShortcuts.ts    # 画布快捷键（全选/复制/粘贴/删除/保存/Esc）
│   ├── useContextMenu.ts        # 右键菜单控制
│   ├── useActionTypes.ts        # 加工动作类型池（内置 + 自定义扩展）
│   ├── useImageUpload.ts        # 图片文件 -> dataURL
│   ├── useImagePreview.ts       # 图片放大预览
│   └── useImageCrop.ts          # 图片裁剪状态控制（cropperjs）
└── components/
    ├── FormPanel.vue            # 配方录入表单（弹窗内）
    ├── PropertyPanel.vue        # 属性编辑面板（画布内悬浮卡片）
    ├── ContextMenu.vue          # 自定义右键菜单
    ├── ImageCropDialog.vue      # 图片裁剪弹窗（按需加载）
    ├── ImagePreview.vue         # 图片放大预览遮罩
    └── nodes/
        ├── ItemNode.vue         # 物品节点
        └── ActionNode.vue       # 加工动作节点
```

## 启动步骤

1. 安装依赖（项目使用 pnpm，也可用 npm / yarn）：

```bash
pnpm install
# 或
npm install
```

2. 启动开发服务器（端口 8080 并自动打开浏览器）：

```bash
pnpm dev
```

3. 生产构建（`vue-tsc` 类型检查 + `vite build`）：

```bash
pnpm build
```

4. 预览构建产物：

```bash
pnpm preview
```

## 构建说明

- **按需导入**：Element Plus 组件与 API 由 `unplugin-auto-import` / `unplugin-vue-components` 自动按需引入并注入样式，主包显著减小。
- **分包策略**：第三方库按 `vue` / `vue-flow` / `element-plus` 拆分为独立 vendor chunk（`vite.config.ts` 中 `manualChunks`），裁剪器 `cropperjs` 仅在打开裁剪弹窗时按需加载。
- **产物体积参考**：主包 JS 约 50KB（gzip 16KB），全部 JS 约 725KB（gzip 243KB），CSS 约 153KB（gzip 24KB）。

> 依赖说明：`@vue-flow/core` 为图核心，`@vue-flow/background` / `@vue-flow/controls` / `@vue-flow/minimap` 为画布辅助组件，`element-plus` 为 UI 组件库，`vue` 为框架。详见 `package.json`。
