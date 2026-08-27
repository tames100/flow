<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  useRecipeGraph,
  type AttributeTraceResult,
} from '../composables'

const props = defineProps<{
  nodeId: string | null
  label: string
}>()

const { computeBasicMaterials, computeAttributeTrace, getTraceAttributeNames } = useRecipeGraph()

// ---- 配方追踪（仅物品节点）：按上游加工输入 / 输出数量反推基本原料需求 ----
const traceQty = ref(1)
const traceMaterials = computed(() =>
  props.nodeId ? computeBasicMaterials(props.nodeId, traceQty.value) : [],
)
const isBasicSelf = computed(
  () => traceMaterials.value.length === 1 && traceMaterials.value[0].id === props.nodeId,
)

// ---- 属性追踪：默认不展示，由用户选择要展示的属性 ----
const attrOptions = computed<string[]>(() =>
  props.nodeId ? getTraceAttributeNames(props.nodeId) : [],
)
const selectedAttrs = ref<string[]>([])
watch(
  () => props.nodeId,
  () => {
    selectedAttrs.value = []
  },
)
/** 对每个选中的属性计算追踪结果 */
const attrTraces = computed<AttributeTraceResult[]>(() =>
  selectedAttrs.value
    .map((name) =>
      props.nodeId ? computeAttributeTrace(props.nodeId, traceQty.value, name) : null,
    )
    .filter((t): t is AttributeTraceResult => !!t),
)
</script>

<template>
  <el-divider content-position="left">配方追踪</el-divider>
  <el-form-item label="目标数量（想要多少个该产物）">
    <el-input-number v-model="traceQty" :min="1" :max="999999" controls-position="right" style="width: 100%" />
  </el-form-item>
  <div class="trace-tip">按上游加工节点的输入/输出数量反推所需<b>基本原料</b>（不依赖其他加工节点、直接作为原料消耗的源头物品）：</div>
  <div v-if="isBasicSelf" class="trace-result">
    <div class="trace-row">
      <span class="trace-name">{{ label }}</span>
      <span class="trace-qty">× {{ traceQty }}{{ traceMaterials[0].unit ? ' ' + traceMaterials[0].unit :
        '' }}</span>
    </div>
    <div class="qty-tip">该产物本身就是基本原料，无上游加工链。</div>
  </div>
  <div v-else-if="traceMaterials.length" class="trace-result">
    <div v-for="m in traceMaterials" :key="m.id" class="trace-row">
      <span class="trace-name" :title="m.name">{{ m.name }}</span>
      <span class="trace-qty">× {{ m.qty }}{{ m.unit ? ' ' + m.unit : '' }}</span>
    </div>
  </div>
  <div v-else class="trace-empty">该产物没有上游加工链，无法反推。</div>

  <!-- 属性追踪：默认不展示，由用户选择 -->
  <el-form-item v-if="attrOptions.length" label="展示属性（默认不展示）">
    <el-select v-model="selectedAttrs" multiple clearable placeholder="选择要展示的属性" style="width: 100%">
      <el-option v-for="n in attrOptions" :key="n" :label="n" :value="n" />
    </el-select>
    <div class="qty-tip">选中属性后，将展示该属性在各基本原料上的值与其需求量的乘积计算过程</div>
  </el-form-item>
  <div v-if="attrTraces.length" class="trace-result attr-trace">
    <div v-for="t in attrTraces" :key="t.name" class="attr-trace-block">
      <div class="attr-trace-head">
        <span class="attr-trace-name">{{ t.name }}</span>
        <span v-if="t.targetAttr" class="attr-trace-target">
          {{ label }}：{{ t.targetAttr.value }} × {{ traceQty }} = {{
            Number(t.targetAttr.value) * Number(traceQty)
          }}
        </span>
      </div>
      <div v-if="t.items.length">
        <div v-for="it in t.items" :key="it.id" class="trace-row">
          <span class="trace-name" :title="it.name">{{ it.name }}</span>
          <span class="trace-qty">
            <template v-if="it.attr">
              {{ it.attr.value }} × {{ it.qty }} = {{
                it.contribution ?? '无法计算'
              }}
            </template>
            <template v-else>无该属性</template>
          </span>
        </div>
        <div v-if="t.total !== null" class="attr-trace-total">
          合计：{{ t.total }}
          <span v-if="t.targetAttr && String(t.targetAttr.value) === String(t.total)" class="attr-trace-ok">
            ✓ 与目标产物属性值一致
          </span>
        </div>
      </div>
      <div v-else class="trace-empty">上游原料均无该属性，无法计算。</div>
    </div>
  </div>
</template>

<style scoped>
.qty-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.2;
}

.trace-tip {
  font-size: 12px;
  color: #909399;
  margin: -4px 0 8px;
  line-height: 1.6;
}

.trace-result {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px dashed #dcdfe6;
  border-radius: 8px;
  background: #fafafa;
}

.trace-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
}

.trace-name {
  flex: 1;
  min-width: 0;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-qty {
  color: #e6a23c;
  font-weight: 700;
  white-space: nowrap;
}

.trace-empty {
  font-size: 12px;
  color: #909399;
}

.attr-trace {
  margin-top: 6px;
  gap: 8px;
}

.attr-trace-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #fff;
}

.attr-trace-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
}

.attr-trace-name {
  color: #409eff;
}

.attr-trace-target {
  font-weight: 600;
  color: #e6a23c;
}

.attr-trace-total {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  border-top: 1px dashed #dcdfe6;
  padding-top: 4px;
}

.attr-trace-ok {
  color: #67c23a;
  font-weight: 600;
}
</style>
