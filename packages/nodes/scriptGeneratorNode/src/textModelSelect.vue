<template>
  <el-select v-model="model" class="textModelSelect" filterable :loading="loading" :disabled="disabled" placeholder="选择拆解模型" aria-label="脚本拆解模型" noDataText="请先在设置中配置语言模型" @visible-change="visible => visible && emit('open')">
    <template #label="{ label }"><modelLabel :label="label" :providerId="selected?.providerId" :modelId="selected?.modelId" /></template>
    <el-option-group v-for="group in groups" :key="group.id" :label="group.label">
      <el-option v-for="item in group.models" :key="getNodeModelKey(item)" :value="getNodeModelKey(item)" :label="item.label">
        <modelLabel :label="item.label" :providerId="item.providerId" :modelId="item.modelId" />
      </el-option>
    </el-option-group>
  </el-select>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { ElSelect, ElOption, ElOptionGroup } from "element-plus";
import { findNodeModel, getNodeModelKey, type NodeAiModel } from "@toonflow/nodes-scaffold/runtime";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import modelLabel from "@toonflow/node-shared/modelLabel";
const props = defineProps<{ models: NodeAiModel[]; loading?: boolean; disabled?: boolean }>();
const model = defineModel<string>({ required: true });
const emit = defineEmits<{ open: [] }>();
const groups = computed(() => groupNodeModels(props.models));
const selected = computed(() => findNodeModel(props.models, model.value));
</script>
<style scoped>
.textModelSelect { width: 260px; max-width: 100%; }
</style>
