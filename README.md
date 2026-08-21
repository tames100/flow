# 游戏配方可视化编辑器 (v-flow)

基于 **Vue 3 + `<script setup>` + Vue-Flow + Element Plus + TypeScript** 开发的游戏合成配方 DAG（有向无环图）可视化编辑器。

## 功能一览

1. **两类节点**
   - `ItemNode` 物品节点：显示物品名称，支持「仅图片 / 图片+文字」，支持上传图片，代表原料或产物。
   - `ActionNode` 加工动作节点：支持 `合成 / 搅拌 / 切割 / 熔炼`，接收多个输入物品，输出产物。
2. **表单录入面板**（左侧）：填写「输入物品数组 + 加工动作 + 输出产物」，提交后**自动生成节点与连线**，无需手动拖拽。
3. **画布基础能力**：拖拽节点、画布平移缩放（Controls / MiniMap）、删除节点与连线（Delete 键或属性面板）、复制节点。
4. **核心交互（配方链高亮）**：点击任意【物品节点】，递归向上遍历整张 DAG，找到该节点的**完整上游所有依赖**（追溯到最顶层原始原料），将这条配方链上的所有节点与连线**高亮**，其余**置灰**；点击画布空白区域取消高亮。
5. **环检测**：新增连线 / 保存校验时检测是否存在循环依赖，有环则弹窗提示。
6. **数据导入 / 导出 JSON**：导出包含全部节点、连线、图片（dataURL）、动作配置；支持导入恢复。
7. **属性面板**（右侧）：选中节点后可编辑名称、切换显示模式、替换图片、复制 / 删除节点。

## 目录结构

```
src/
├── App.vue                      # 三栏布局 + 画布 + 工具栏
├── types.ts                     # 类型定义
├── composables/
│   ├── useRecipeGraph.ts        # 图数据中心：创建/删除/复制/表单生成/环检测/导入导出
│   ├── useRecipeHighlight.ts    # 高亮逻辑（单独抽出，递归上游遍历）
│   └── useImageUpload.ts        # 图片文件 -> dataURL
├── components/
│   ├── FormPanel.vue            # 左侧表单录入面板
│   ├── PropertyPanel.vue        # 右侧属性面板
│   └── nodes/
│       ├── ItemNode.vue         # 自定义物品节点（完整实现）
│       └── ActionNode.vue       # 自定义加工动作节点（完整实现）
```

## 启动步骤

1. 安装依赖（项目使用 pnpm，也可用 npm / yarn）：

```bash
pnpm install
# 或
npm install
```

2. 启动开发服务器（默认端口 8080 并自动打开浏览器）：

```bash
pnpm dev
```

3. 生产构建：

```bash
pnpm build
```

4. 预览构建产物：

```bash
pnpm preview
```

> 依赖说明：`@vue-flow/core` 为图核心，`@vue-flow/background` / `@vue-flow/controls` / `@vue-flow/minimap` 为画布辅助组件，`element-plus` 为 UI 组件库，`vue` 为框架。详见 `package.json`。
