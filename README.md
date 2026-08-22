# 游戏配方可视化编辑器 (v-flow)

基于 **Vue 3 + `<script setup>` + Vue-Flow + Element Plus + TypeScript** 开发的游戏合成配方 DAG（有向无环图）可视化编辑器。

> 建议使用电脑进行查看，项目并没有做媒体查询。
> `json`文件夹下有示例配方 JSON 文件，可直接导入查看。

## 功能一览

1. **两类节点**
   - `ItemNode` 物品节点：显示物品名称 / 图片，支持「仅图片 / 图片+文字」两种显示模式，可上传图片、设置数量与解释，代表原料或产物；支持物品属性（图标 + 名称 + 值 + 说明）。
   - `ActionNode` 加工动作节点：内置 `合成 / 搅拌 / 切割 / 熔炼`，支持自定义扩展动作与动作图标，可设置输出单位、附加操作 / 附加条件，接收多个输入物品、输出产物。
2. **配方录入弹窗**：点击工具栏「+ 添加配方」，填写「输入物品数组 + 加工动作 + 输出产物」，提交后**自动生成节点与连线**，无需手动拖拽；输入 / 输出均可选择画布已有物品节点（复用而非新建重复节点）；选择已有加工节点时自动**复制**到新配方链（非链接原节点）；输入物品支持设置单位；附加操作下拉**动态同步**画布已有加工节点的 extra。
3. **分组系统**：工具栏「🗂 分组」打开分组管理抽屉（从画布左侧滑入，画布置暗）；支持新增 / 改名 / 删除分组，每组可定义预设属性（图标 + 名称 + 值 + 说明）；物品节点与加工节点均可归属多个分组（节点上显示分组标签）；物品节点可从所属分组**复制属性**为节点自有属性（独立可编辑），选择分组时自动提示是否复制缺失属性；分组属性的**图标 / 名称变更时自动同步**到该分组下所有节点的对应属性（仅同步 icon + name，值与说明不同步；用户手动改过名的不同步）；分组数据随配方 JSON 导入 / 导出。
4. **单位管理**：单位下拉展示内置 + 自定义 + 画布正在使用的全部单位；用户可输入自定义单位（自动持久化）；可删除不需要的单位（「个」为基本单位不可删，画布正在使用的不允许删）。
5. **画布基础能力**：拖拽节点、平移缩放（Controls / MiniMap + 缩放指示）、框选、复制 / 粘贴、删除节点与连线（Delete 键或右键菜单）；**`Ctrl/⌘` + 左键点击节点立即复制**（副本生成新 ID、完整保留全部属性并偏移显示）；**`Ctrl/⌘` + 左键拖动节点则直接拖出副本**（原件始终钉在原位，副本跟随鼠标，松手落在终点）。
6. **核心交互（配方链高亮）**：点击任意【物品节点】，递归向上遍历整张 DAG，找到该节点**完整上游所有依赖**（追溯到最顶层原始原料），将这条配方链上的所有节点与连线**高亮**、其余**置灰**，并自动将节点居中放大聚焦；点击画布空白区域取消高亮。
7. **连线编辑与单位继承**：点击连线可在属性面板编辑数量、单位、线型、颜色、动画与箭头端点；加工节点的输出单位会自动继承给下游输入连线（默认单位「个」）。
8. **环检测**：新增连线 / 保存校验时检测循环依赖，有环则弹窗警告（不阻断保存）。
9. **右键菜单**：画布空白处右键可创建物品 / 加工动作节点；节点上右键可编辑属性、复制、删除。
10. **图片能力**：图片仅通过**用户上传**获取（无剪贴板粘贴）；上传图片先经 **cropperjs 裁剪**（裁剪弹窗按需加载），节点图片支持点击**放大预览**；上传图片后**图片名可替换物品名**（名称不一致时弹窗确认）。
11. **属性面板**：选中节点 / 连线后在画布内悬浮显示，可编辑名称、加工动作、显示模式、数量、单位、解释、替换图片、分组归属、物品属性，以及复制 / 删除；「加工动作」与「名称」保持同步。
12. **自动保存与持久化**：按可调间隔（工具栏设置，1–3600s）自动将节点位置 / 连线 / 视图持久化到 localStorage；`Ctrl/Cmd + S` 手动保存。
13. **数据导入 / 导出 JSON**：导出包含全部节点、连线、图片（dataURL）、动作配置、分组配置与视图状态；支持导入恢复与一键清空。
14. **快捷键**：`Ctrl + 左键点击节点` 立即复制、`Ctrl + 左键拖动节点` 复制并拖出副本、`Ctrl+A` 全选、`Ctrl+C / V` 复制粘贴、`Delete` 删除、`Esc` 取消选中 / 关闭弹窗（工具栏「⌨ 快捷键说明」可查看完整列表）。

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
├── App.vue                      # 工具栏 + 画布 + 悬浮属性面板 + 分组抽屉 + 各弹窗
├── style.css                    # 全局样式
├── types.ts                     # 类型定义与内置常量（动作 / 单位 / 分组 / 属性）
├── auto-imports.d.ts            # 自动导入类型声明（构建时生成，建议提交）
├── components.d.ts              # 组件自动注册类型声明（构建时生成，建议提交）
├── composables/
│   ├── index.ts                 # 统一导出入口
│   ├── useRecipeGraph.ts        # 图数据中心：增删改/表单生成/环检测/导入导出/持久化/分组属性同步
│   ├── useRecipeHighlight.ts    # 配方链高亮（递归上游遍历）
│   ├── useCanvasShortcuts.ts    # 画布快捷键（全选/复制/粘贴/删除/保存/Esc）
│   ├── useContextMenu.ts        # 右键菜单控制
│   ├── useActionTypes.ts        # 加工动作类型池（内置 + 自定义扩展）
│   ├── useGroups.ts             # 分组管理（增删改属性/持久化/导入导出合并）
│   ├── useUnits.ts              # 单位管理（内置 + 自定义 + 画布使用中 + 隐藏）
│   ├── useImageUpload.ts        # 图片文件 -> dataURL + 图片名替换物品名
│   ├── useImagePreview.ts       # 图片放大预览
│   └── useImageCrop.ts          # 图片裁剪状态控制（cropperjs）
└── components/
    ├── FormPanel.vue            # 配方录入表单（弹窗内）：输入/输出可选已有节点、单位、分组、从分组复制属性
    ├── PropertyPanel.vue        # 属性编辑面板（画布内悬浮卡片）：分组、属性、单位、附加操作
    ├── GroupDrawer.vue          # 分组管理抽屉（从左滑入，画布置暗）：增删改分组与预设属性
    ├── ContextMenu.vue          # 自定义右键菜单
    ├── ImageCropDialog.vue      # 图片裁剪弹窗（按需加载）
    ├── ImagePreview.vue         # 图片放大预览遮罩
    └── nodes/
        ├── ItemNode.vue         # 物品节点（含分组标签 + 属性展示）
        └── ActionNode.vue       # 加工动作节点（含分组标签 + 附加操作）
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
- **相对路径引用**：`vite.config.ts` 设置了 `base: './'`，所有 JS / CSS / 图片资源均按相对 `index.html` 的路径引用，可直接部署到任意子目录（如 GitHub Pages）。
- **产物体积参考**：主包 JS 约 50KB（gzip 16KB），全部 JS 约 725KB（gzip 243KB），CSS 约 153KB（gzip 24KB）。

> 依赖说明：`@vue-flow/core` 为图核心，`@vue-flow/background` / `@vue-flow/controls` / `@vue-flow/minimap` 为画布辅助组件，`element-plus` 为 UI 组件库，`vue` 为框架。详见 `package.json`。

## 部署到 GitHub Pages

构建产物为纯静态文件，无需服务器：

1. 执行 `pnpm build`，产出 `dist/` 目录。
2. 将 `dist/` 目录内容上传到仓库（如 `username/flow`），使页面位于 `https://username.github.io/flow/dist/index.html`。
3. 因已启用 `base: './'`，页面会从**当前目录**（`/flow/dist/assets/...`）加载依赖文件，无需修改任何路径即可正常访问。

> 常见问题：若未设置 `base`（默认 `'/'`），`index.html` 会引用 `/assets/xxx.js`，浏览器会到域名根目录查找资源而加载失败，报错类似于"Failed to load module script"。设置相对路径后即可避免。
