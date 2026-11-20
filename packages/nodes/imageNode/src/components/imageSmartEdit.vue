<template>
  <div class="smartEditPanel nodrag nopan nowheel">
    <div class="modelToolbar">
      <providerModelSelect v-model="settings.model" :models="models" :loading="modelsLoading" :disabled="busy || disabled" noDataText="请先在设置中添加图片模型" @open="loadModels" />
    </div>
    <promptInput v-model="promptModel" v-model:text="prompt" :references="[]" placeholder="描述你想如何修改图片" expandable />
    <div class="smartEditControls">
      <imageGenerationSettings v-model:size="settings.size" v-model:ratio="settings.ratio" :sizes="sizeOptions" :ratios="ratioOptions" :disabled="busy || disabled || !selectedModel" />
      <el-checkbox v-model="preserveOutsideMask" :disabled="busy || disabled">保留涂抹范围外的原图</el-checkbox>
      <el-button class="sendButton" :icon="IconArrowUp" :loading="busy" :disabled="disabled || modelsLoading || !selectedModel || !prompt.trim()" title="生成改图" aria-label="生成改图" @click="submit" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import { ElButton, ElCheckbox } from "element-plus";
import { IconArrowUp } from "@tabler/icons-vue";
import { getNodeModelKey, useNodeAi, useNodeModelSelection, useNodeToolsContext, type NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import imageGenerationSettings from "@toonflow/node-shared/imageGenerationSettings";
import providerModelSelect from "@toonflow/node-shared/providerModelSelect";
import promptInput from "@toonflow/node-shared/promptInput";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import type imageEditor from "./imageEditor.vue";

const props = defineProps<{ editor: InstanceType<typeof imageEditor>; disabled?: boolean; settings: { model: string; size: string; ratio: string } }>();
const ai = useNodeAi();
const getNodeTools = useNodeToolsContext();
const models = shallowRef<NodeMediaModel[]>([]);
const modelsLoading = ref(false);
const busy = ref(false);
let disposed = false;
onScopeDispose(() => { disposed = true; });
const prompt = ref("");
const preserveOutsideMask = ref(false);
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
  if (busy.value || props.disabled || !selectedModel.value || !prompt.value.trim()) return;
  busy.value = true;
  const controller = new AbortController();
  try {
    const result = await props.editor.createSmartEdit({
      ...settings.value, prompt: prompt.value.trim(), preserveOutsideMask: preserveOutsideMask.value,
    }, controller.signal);
    if (!result) throw new Error("智能改图未能创建生成任务");
    await getNodeTools().call({ nodeId: result.nodeId, name: "node:getConfig", args: {} }, controller.signal);
    await getNodeTools().call({ nodeId: result.nodeId, name: "node:generateImage", args: {} }, controller.signal);
    if (!disposed) props.editor.cancel();
  } catch (error) { showNodeError(error, "智能改图失败"); }
  finally { busy.value = false; }
}
</script>

<style scoped lang="scss">
@use "@toonflow/node-shared/imageToolStyles.scss" as tools;

.smartEditPanel {
  @include tools.surface;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 10px 14px;

  .modelToolbar {
    padding-bottom: 8px;
    border-bottom: 1px solid var(--el-border-color-lighter);

    :deep(.providerModelSelect) { width: 360px; max-width: 100%; }
  }

  .smartEditControls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;

    .sendButton {
      @include tools.sendButton;
      margin-left: auto;
    }
  }
}
</style>
