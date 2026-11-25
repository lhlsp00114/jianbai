<template>
  <div class="providerModelSelect nodrag nopan" :class="{ detachedProviderModel: !!providerTarget, compactModel: compact }" :style="compact && providerTarget ? { flex: '0 1 auto', width: compactWidth, maxWidth: '180px' } : undefined">
    <teleport :to="providerTarget || 'body'" :disabled="!providerTarget">
      <modelSelect
        :empty="!providers.length"
        :modelValue="selectedProvider?.id ?? ''"
        class="providerSelect"
        :class="{ detachedProviderSelect: !!providerTarget }"
        :loading="loading"
        :disabled="disabled"
        :title="selectedProvider?.label ?? '选择 API 供应商'"
        :aria-label="`API 供应商：${selectedProvider?.label ?? '未选择'}`"
        placeholder="API"
        :noDataText="noDataText"
        :placement="providerTarget ? 'bottom-end' : 'top-start'"
        @update:modelValue="selectProvider"
        @visible-change="(visible: boolean) => visible && emit('open')">
        <template #label>API</template>
        <el-option v-for="provider in providers" :key="provider.id" :label="provider.label" :value="provider.id">
          <span class="providerOption"><span>{{ provider.label }}</span><el-tag v-if="provider.id === 'tokenGo'" size="small" type="info" effect="plain">官方</el-tag></span>
        </el-option>
      </modelSelect>
    </teleport>
    <el-cascader
      ref="cascader"
      v-if="seedanceGroups.length"
      :modelValue="selectedModel ? model : ''"
      class="modelSelect groupedModelSelect"
      :options="groupedModels"
      :props="{ expandTrigger: 'hover', emitPath: false }"
      :showAllLevels="false"
      :title="selectedModel?.label"
      placement="top-start"
      :fallbackPlacements="['bottom-start']"
      :popperClass="compact ? 'videoModelDropdown' : undefined"
      :disabled="disabled || !selectedProvider"
      placeholder="选择模型"
      aria-label="生成模型"
      @update:modelValue="value => typeof value === 'string' && selectModel(value)"
      @visible-change="onCascaderVisible">
      <template #prefix><modelIcon v-if="selectedModel && modelIcon" :model="modelIconKey(selectedModel.modelId)" aria-hidden="true" /></template>
      <template #default="{ data }">
        <modelLabel v-if="data.model" :label="data.model.label" :providerId="data.model.providerId" :modelId="modelIconKey(data.model.modelId)" />
        <modelLabel v-else :label="data.label" modelId="seedance" />
      </template>
    </el-cascader>
    <el-select
      v-else
      :modelValue="selectedModel ? model : ''"
      class="modelSelect"
      filterable
      :loading="loading"
      :disabled="disabled || !selectedProvider"
      placeholder="选择模型"
      aria-label="生成模型"
      :noDataText="noDataText"
      placement="top-start"
      :popperClass="compact ? 'videoModelDropdown' : undefined"
      @update:modelValue="selectModel"
      @visible-change="visible => visible && emit('open')">
      <template v-if="!selectedModel" #prefix><icon-sparkles :size="17" /></template>
      <template #label="{ label }"><modelLabel :title="label" :label="compactLabel(label)" :providerId="compact ? undefined : selectedModel?.providerId" :modelId="selectedModel && modelIconKey(selectedModel.modelId)" /></template>
      <el-option v-for="item in selectedProvider?.models ?? []" :key="getNodeModelKey(item)" :label="item.label" :value="getNodeModelKey(item)">
        <modelLabel :label="item.label" :providerId="item.providerId" :modelId="modelIconKey(item.modelId)" />
      </el-option>
    </el-select>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onScopeDispose } from "vue";
import { ElSelect, ElOption, ElTag, ElCascader } from "element-plus";
import { IconSparkles } from "@tabler/icons-vue";
import * as modelIcons from "@toonflow/model-icons";
import { findNodeModel, getNodeModelKey, type NodeMediaModel } from "@toonflow/nodes-scaffold/nodeAi";
import { groupNodeModels } from "../groupNodeModels";
import { useNodeModelPreferences } from "../modelPreference";
import modelLabel from "./modelLabel.vue";
import modelSelect from "./modelSelect.vue";

const props = defineProps<{ models: NodeMediaModel[]; loading?: boolean; disabled?: boolean; noDataText: string; providerTarget?: HTMLElement; compact?: boolean }>();
const modelIcon = modelIcons?.modelIcon;
function modelIconKey(modelId: string) {
  // ACT: 节点可独立更新，直接传品牌名以兼容未更新的画布宿主。
  if (modelId === "mj-img") return "midjourney";
  return /^(?:vo-|gm-omni-flash-)/i.test(modelId) ? "gemini" : modelId;
}
const model = defineModel<string>({ required: true });
const emit = defineEmits<{ open: [] }>();
const cascader = ref<InstanceType<typeof ElCascader>>();
function closeOutside(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (cascader.value?.$el.contains(target) || cascader.value?.contentRef?.contains(target)) return;
  cascader.value?.togglePopperVisible(false);
}
function onCascaderVisible(visible: boolean) {
  document.removeEventListener("pointerdown", closeOutside, true);
  if (visible) {
    document.addEventListener("pointerdown", closeOutside, true);
    emit("open");
  }
}
onScopeDispose(() => document.removeEventListener("pointerdown", closeOutside, true));
const { rememberNodeModel } = useNodeModelPreferences();
const providers = computed(() => groupNodeModels(props.models));
const selectedModel = computed(() => findNodeModel(props.models, model.value));
const selectedProvider = computed(() => providers.value.find(provider => provider.id === selectedModel.value?.providerId) ?? providers.value[0]);
const compactWidth = computed(() => {
  const label = compactLabel(selectedModel.value?.label ?? "选择模型");
  const units = Array.from(label).reduce((total, character) => total + (/[^\x00-\x7f]/.test(character) ? 2 : 1), 0);
  return `clamp(82px, calc(${units}ch + 54px), 180px)`;
});
function compactLabel(label: string) {
  if (!props.compact || label.length <= 12) return label;
  return label.replace(/^(?:Seedance|GK\s*Imagine|GK|MiniMax)\s*[-·]?\s*/i, "").replace(/\s*·\s*官方直连$/, "");
}
const seedanceGroups = computed(() => {
  const items = selectedProvider.value?.models.filter(item => item.providerId === "tokenGo" && item.modelId.startsWith("seedance-2-")) ?? [];
  const primaryIds = new Set(["seedance-2-5", "seedance-2-0-official"]);
  const order = ["seedance-2-5", "seedance-2-5-promo", "seedance-2-5-special", "seedance-2-0-official", "seedance-2-0-promo", "seedance-2-0-special", "seedance-2-0-manju-special", "seedance-2-0-9tu-special", "seedance-2-0-ecom-special"];
  items.sort((left, right) => (order.indexOf(left.modelId) < 0 ? order.length : order.indexOf(left.modelId))
    - (order.indexOf(right.modelId) < 0 ? order.length : order.indexOf(right.modelId)));
  return [
    { value: "seedancePrimary", label: "Seedance · 官方直连", models: items.filter(item => primaryIds.has(item.modelId)) },
    { value: "seedanceOther", label: "Seedance · 其它版本", models: items.filter(item => !primaryIds.has(item.modelId)) },
  ].filter(group => group.models.length);
});
const groupedModels = computed(() => {
  const option = (item: NodeMediaModel) => ({ value: getNodeModelKey(item), label: compactLabel(item.label), fullLabel: item.label, model: item });
  return [
    ...seedanceGroups.value.filter(group => group.value === "seedancePrimary").flatMap(group => group.models.map(option)),
    ...seedanceGroups.value.filter(group => group.value !== "seedancePrimary").map(group => ({ value: group.value, label: group.label, children: group.models.map(option) })),
    ...(selectedProvider.value?.models ?? []).filter(item => !seedanceGroups.value.some(group => group.models.includes(item))).map(option),
  ];
});

function selectModel(key: string) {
  if (props.disabled) return;
  const next = findNodeModel(props.models, key);
  if (!next) return;
  model.value = getNodeModelKey(next);
  rememberNodeModel(next);
}

function selectProvider(id: string) {
  if (props.disabled) return;
  const provider = providers.value.find(item => item.id === id);
  if (!provider) return;
  // ACT: 仍使用节点原有模型键保存供应商；切换时优先沿用同名模型，不引入第二份持久状态。
  const next = provider.models.find(item => getNodeModelKey(item) === model.value)
    ?? provider.models.find(item => item.modelId === selectedModel.value?.modelId)
    ?? provider.models[0];
  if (next) selectModel(getNodeModelKey(next));
}
</script>

<style scoped lang="scss">
.providerModelSelect {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 280px;
  min-width: 0;

  &.detachedProviderModel {
    flex: 0 1 240px;
    width: 240px;
    max-width: 240px;
  }

  .modelSelect {
    flex: 1;
    min-width: 0;

    // 隐藏模型名前的闪烁光标，仍保留输入搜索和键盘操作。
    :deep(input) { caret-color: transparent; }

    :deep(.el-select__wrapper) {
      gap: 6px;
      padding: 0;
      box-shadow: none;
      background: transparent;
    }
  }

  .groupedModelSelect {
    :deep(.el-input__wrapper) {
      padding: 0;
      box-shadow: none;
      background: transparent;
    }
    :deep(.el-input__inner) { cursor: pointer; pointer-events: none; user-select: none; }
  }

  &.compactModel {
    font-size: 12px;

    :deep(.el-input__wrapper), :deep(.el-select__wrapper) {
      min-height: 30px;
      padding: 0 8px;
      border: 0;
      border-radius: 6px;
      box-shadow: none !important;
      background: transparent;
      &:hover { background: var(--el-fill-color-light); }
    }

    :deep(.el-input__inner) { font-size: 12px; }
    :deep(.el-input__wrapper:focus-within), :deep(.el-select__wrapper:focus-within) {
      outline: 1px solid var(--el-border-color-darker);
      outline-offset: 1px;
    }
  }
}

.providerSelect {
  width: 64px;
  flex-shrink: 0;

  :deep(.el-select__wrapper) {
    padding: 0 6px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    box-shadow: none;
    background: transparent;
  }

  :deep(.el-select__wrapper.is-focused) { border-color: var(--el-color-primary); }

  &.detachedProviderSelect {
    :deep(.el-select__wrapper) { min-height: 30px; font-size: 12px; }
  }
}
.providerOption { display: flex; align-items: center; justify-content: space-between; gap: 16px; }

:global(.videoModelDropdown .el-cascader-menu:first-child),
:global(.videoModelDropdown .el-select-dropdown) {
  min-width: min(240px, calc(100vw - 24px));
}

:global(.videoModelDropdown .el-cascader-menu__wrap.el-scrollbar__wrap) {
  height: min(274px, 60vh);
}

:global(.videoModelDropdown .el-select-dropdown__wrap) {
  max-height: min(274px, 60vh);
}
</style>
