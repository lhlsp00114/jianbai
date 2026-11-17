<template>
  <el-select :modelValue="selected ? value : ''" filterable :loading="loading" :disabled="disabled" placeholder="选择文本模型" noDataText="请在设置中添加文本模型" @update:modelValue="value = $event" @visibleChange="(visible: boolean) => visible && $emit('refresh')">
    <template #label="{ label }"><modelLabel :label="label" :providerId="selected?.providerId" :modelId="selected?.modelId" /></template>
    <el-option-group v-for="provider in groups" :key="provider.id" :label="provider.label">
      <el-option v-for="model in provider.models" :key="getNodeModelKey(model)" :value="getNodeModelKey(model)" :label="model.label"><modelLabel :label="model.label" :providerId="model.providerId" :modelId="model.modelId" /></el-option>
    </el-option-group>
  </el-select>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { getNodeModelKey, useNodeModelSelection, type NodeAiModel } from "@toonflow/nodes-scaffold/nodeAi";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import modelLabel from "@toonflow/node-shared/modelLabel";
const props = defineProps<{ models: NodeAiModel[]; disabled?: boolean; loading?: boolean }>();
defineEmits<{ refresh: [] }>();
const value = defineModel<string>({ required: true });
const selected = useNodeModelSelection(() => props.models, value);
const groups = computed(() => groupNodeModels(props.models));
</script>
