<template>
  <div class="smartEditPanel nodrag nopan nowheel">
    <promptInput v-model="promptModel" v-model:text="prompt" :references="[]" placeholder="描述你想如何修改图片" expandable />
    <div class="smartEditControls">
      <el-select v-model="settings.model" class="modelSelect" filterable :loading="modelsLoading" :disabled="busy" placeholder="选择图片模型" aria-label="图片模型" noDataText="请先在设置中添加图片模型" placement="top-start" @visible-change="visible => visible && loadModels()">
        <template #label="{ label }"><modelLabel :label="label" :providerId="selectedModel?.providerId" :modelId="selectedModel?.modelId" /></template>
        <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
          <el-option v-for="model in provider.models" :key="getNodeModelKey(model)" :label="model.label" :value="getNodeModelKey(model)">
            <modelLabel :label="model.label" :providerId="model.providerId" :modelId="model.modelId" />
          </el-option>
        </el-option-group>
      </el-select>
      <div class="sizeControls">
        <label>规格<el-select v-model="settings.size" :disabled="busy || !selectedModel" aria-label="图片规格"><el-option v-for="size in sizeOptions" :key="size" :label="size" :value="size" /></el-select></label>
        <label>比例<el-select v-model="settings.ratio" :disabled="busy || !selectedModel" aria-label="图片比例"><el-option v-for="ratio in ratioOptions" :key="ratio" :label="ratio" :value="ratio" /></el-select></label>
      </div>
      <el-button type="primary" :icon="IconSparkles" :loading="busy" :disabled="disabled || modelsLoading || !selectedModel || !prompt.trim()" @click="submit">生成改图</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElButton, ElOption, ElOptionGroup, ElSelect } from "element-plus";
import { IconSparkles } from "@tabler/icons-vue";
import { getNodeModelKey, useNodeAi, useNodeModelSelection, useNodeToolsContext, type NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import modelLabel from "@toonflow/node-shared/modelLabel";
import promptInput from "@toonflow/node-shared/promptInput";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import type imageEditor from "./imageEditor.vue";

const props = defineProps<{ editor: InstanceType<typeof imageEditor>; disabled?: boolean; settings: { model: string; size: string; ratio: string } }>();
const ai = useNodeAi();
const getNodeTools = useNodeToolsContext();
const models = ref<NodeMediaModel[]>([]);
const modelsLoading = ref(false);
const busy = ref(false);
const prompt = ref("");
const promptModel = ref<NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>>([]);
const settings = ref({ ...props.settings });
const modelGroups = computed(() => groupNodeModels(models.value));
const selectedModel = useNodeModelSelection(models, computed({ get: () => settings.value.model, set: value => { settings.value.model = value; } }));
const sizeOptions = computed(() => selectedModel.value?.imageSizes?.length ? selectedModel.value.imageSizes : ["2K"]);
const ratioOptions = computed(() => selectedModel.value?.imageRatios?.length ? selectedModel.value.imageRatios : ["16:9"]);

watch(selectedModel, model => {
  if (!model) return;
  if (!sizeOptions.value.includes(settings.value.size)) settings.value.size = sizeOptions.value[0]!;
  if (!ratioOptions.value.includes(settings.value.ratio)) settings.value.ratio = ratioOptions.value[0]!;
}, { flush: "sync" });
onMounted(loadModels);

async function loadModels() {
  if (modelsLoading.value) return;
  modelsLoading.value = true;
  try {
    models.value = (await ai.getMediaModels()).filter(item => item.type === "image");
    if (!settings.value.model) settings.value.model = modelGroups.value[0]?.models[0] ? getNodeModelKey(modelGroups.value[0].models[0]!) : "";
  } catch (error) { showNodeError(error, "模型读取失败"); }
  finally { modelsLoading.value = false; }
}

async function submit() {
  if (busy.value || !selectedModel.value || !prompt.value.trim()) return;
  busy.value = true;
  const controller = new AbortController();
  try {
    const result = await props.editor.createSmartEdit({ ...settings.value, prompt: prompt.value.trim() }, controller.signal);
    if (!result) throw new Error("智能改图未能创建生成任务");
    await getNodeTools().call({ nodeId: result.nodeId, name: "node:getConfig", args: {} }, controller.signal);
    await getNodeTools().call({ nodeId: result.nodeId, name: "node:generateImage", args: {} }, controller.signal);
    props.editor.cancel();
  } catch (error) { showNodeError(error, "智能改图失败"); }
  finally { busy.value = false; }
}
</script>

<style scoped lang="scss">
.smartEditPanel {
  width: min(100%, 660px);
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);

  .smartEditControls { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
  .modelSelect { flex: 1; min-width: 180px; }
  .sizeControls { display: flex; gap: 8px; }
  .sizeControls label { display: flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; }
  .sizeControls :deep(.el-select) { width: 88px; }
}
</style>
