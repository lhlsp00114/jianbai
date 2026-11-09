<template>
  <div class="providerModelSelect nodrag nopan">
    <el-select
      :modelValue="selectedProvider?.id ?? ''"
      class="providerSelect"
      :loading="loading"
      :disabled="disabled"
      :title="selectedProvider?.label ?? '选择 API 供应商'"
      :aria-label="`API 供应商：${selectedProvider?.label ?? '未选择'}`"
      placeholder="API"
      :noDataText="noDataText"
      placement="top-start"
      @update:modelValue="selectProvider"
      @visible-change="visible => visible && emit('open')">
      <template #label>API</template>
      <el-option v-for="provider in providers" :key="provider.id" :label="provider.label" :value="provider.id" />
    </el-select>
    <el-select
      :modelValue="selectedModel ? model : ''"
      class="modelSelect"
      filterable
      :loading="loading"
      :disabled="disabled || !selectedProvider"
      placeholder="选择模型"
      aria-label="生成模型"
      :noDataText="noDataText"
      placement="top-start"
      @update:modelValue="selectModel"
      @visible-change="visible => visible && emit('open')">
      <template v-if="!selectedModel" #prefix><icon-sparkles :size="17" /></template>
      <template #label="{ label }"><modelLabel :label="label" :providerId="selectedModel?.providerId" :modelId="selectedModel?.modelId" /></template>
      <el-option v-for="item in selectedProvider?.models ?? []" :key="getNodeModelKey(item)" :label="item.label" :value="getNodeModelKey(item)">
        <modelLabel :label="item.label" :providerId="item.providerId" :modelId="item.modelId" />
      </el-option>
    </el-select>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ElSelect, ElOption } from "element-plus";
import { IconSparkles } from "@tabler/icons-vue";
import { findNodeModel, getNodeModelKey, type NodeMediaModel } from "@toonflow/nodes-scaffold/nodeAi";
import { groupNodeModels } from "../groupNodeModels";
import { rememberNodeModel } from "../modelPreference";
import modelLabel from "./modelLabel.vue";

const props = defineProps<{ models: NodeMediaModel[]; loading?: boolean; disabled?: boolean; noDataText: string }>();
const model = defineModel<string>({ required: true });
const emit = defineEmits<{ open: [] }>();
const providers = computed(() => groupNodeModels(props.models));
const selectedModel = computed(() => findNodeModel(props.models, model.value));
const selectedProvider = computed(() => providers.value.find(provider => provider.id === selectedModel.value?.providerId) ?? providers.value[0]);

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
}
</style>
