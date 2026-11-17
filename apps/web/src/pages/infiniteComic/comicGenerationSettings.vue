<template>
  <div class="comicGenerationSettings">
    <providerModelSelect v-model="value.model" :models="models" :disabled="disabled" noDataText="请在设置中配置图片模型" @open="$emit('refresh')" />
    <label>分辨率<el-select v-model="value.size" :disabled="disabled"><el-option v-for="item in sizeOptions" :key="item" :value="item" :label="item" /></el-select></label>
    <label>比例<el-select v-model="value.ratio" :disabled="disabled"><el-option v-for="item in ratioOptions" :key="item" :value="item" :label="item" /></el-select></label>
    <modelForm v-model="value.other" :rules="model?.rules" :disabled="disabled" />
    <label>每页生成次数<el-select :modelValue="value.generationCount ?? 1" :disabled="disabled" @update:modelValue="(count: number) => value.generationCount = count"><el-option v-for="count in [1, 2, 3, 4]" :key="count" :value="count" :label="`${count} 次`" /></el-select></label>
    <small>每次为独立计费请求，分别保存为版本；供应商单次返回多张时全部保留。</small>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useNodeModelSelection, type NodeMediaModel } from "@toonflow/nodes-scaffold/nodeAi";
import { useImageModelForm } from "@toonflow/node-shared/useModelForm";
import providerModelSelect from "@toonflow/node-shared/providerModelSelect";
import modelForm from "@toonflow/node-shared/modelForm";
import type { ComicProject } from "./comicProject";

const props = defineProps<{ models: NodeMediaModel[]; disabled: boolean }>();
defineEmits<{ refresh: [] }>();
const value = defineModel<ComicProject["settings"]>({ required: true });
const model = useNodeModelSelection(() => props.models, computed({ get: () => value.value.model, set: model => { value.value.model = model; } }));
const { sizeOptions, ratioOptions } = useImageModelForm(value, model);
</script>

<style scoped lang="scss">
.comicGenerationSettings {
  display: grid; gap: 16px;
  label { display: grid; gap: 8px; font-size: 13px; }
  small { color: var(--el-text-color-secondary); line-height: 1.6; font-size: 12px; }
  :deep(.providerModelSelect) { width: 100%; }
}
</style>
