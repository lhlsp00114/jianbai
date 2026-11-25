<template>
  <nodeSkeleton
    v-bind="nodeProps"
    :topVisible="node.selected"
    :bottomVisible="node.selected"
    :bottomWidth="actions?.mode === 'speed' ? 440 : 720"
    topWidth="max-content"
    :downloadUrl="previewUrl"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    :fullscreenVisible="false"
    style="width: 360px">
    <template #topActions>
      <el-button :icon="IconTextRecognition" :loading="transcribing" :disabled="busy || !outputFile" text title="音频转文本" aria-label="音频转文本" @click.stop="transcribe">转文本</el-button>
      <el-button v-if="transcribing" :icon="IconPlayerStop" text title="取消转文本" aria-label="取消转文本" @click.stop="cancelTranscription">取消</el-button>
      <el-button :icon="IconScissors" :disabled="busy || !previewUrl" text title="截取音频" aria-label="截取音频" @click.stop="actions?.open('clip')">截取</el-button>
      <el-button :icon="IconGauge" :disabled="busy || !previewUrl" text title="音频变速" aria-label="音频变速" @click.stop="actions?.open('speed')">变速</el-button>
      <el-button :icon="IconTransfer" :loading="uploading" :disabled="busy" text title="替换音频" aria-label="替换音频" @click.stop="fileInput?.click()">替换音频</el-button>
      <input ref="fileInput" type="file" accept="audio/*" hidden aria-label="选择替换音频" :disabled="busy" @change="replaceOutput" />
    </template>
    <div v-loading="generating ? { text: elapsedLabel } : uploading" class="audioContent nopan" :aria-busy="generating || uploading">
      <audioPlayer v-if="previewUrl" ref="player" v-model:pcmOptions="pcmOptions" class="audioPreview" :src="previewUrl" :mimeType="outputFile?.mimeType" @loadedmetadata="updateNodeInternals" />
      <div v-else-if="!resultText" class="audioEmpty" role="img" aria-label="暂无生成音频"><icon-music-bolt :size="48" stroke="1.25" aria-hidden="true" /></div>
      <el-select v-if="data.audioResults.length > 1" class="resultSelect nodrag nowheel" :disabled="busy" :modelValue="outputFile?.url" aria-label="选择生成音轨" @update:modelValue="selectAudioResult">
        <el-option v-for="(result, index) in data.audioResults" :key="result.path" :value="result.path" :label="`音轨 ${index + 1}`" />
      </el-select>
      <pre v-if="resultText" class="resultText nodrag nowheel" @pointerdown.stop @wheel.stop>{{ resultText }}</pre>
    </div>
    <template #bottom>
      <div v-if="actions?.mode === 'speed'" ref="speedTarget" />
      <el-card v-else class="promptCard" :class="{ hasPrompt: taskPresentation.prompt }" shadow="never" :bodyStyle="{ padding: '18px 20px 14px' }">
        <referenceItem v-if="refList.length" v-model="refList" :inactiveIndices="inactiveReferenceIndices" @preview="setReferencePreview" @remove="removeReference" />
        <el-button v-if="selectedModel && referenceLimit > 0" class="referenceButton" text size="small" :disabled="busy" @click="selectAssetReference().catch(error => showNodeError(error, '添加音频参考失败'))">添加参考素材</el-button>
        <audioParameters v-model="data.other" :model="selectedModel" section="content" :disabled="busy" />
        <div v-if="taskPresentation.prompt" :class="{ musicStyle: compactMusicPrompt }" :role="compactMusicPrompt ? 'group' : undefined" :aria-label="compactMusicPrompt ? '风格' : undefined">
          <div v-if="compactMusicPrompt" class="musicStyleLabel">风格</div>
          <promptInput v-model="data.promptModel" v-model:text="data.prompt" :references="activeReferenceMentions" :materials="activeMaterialMentions" :selectMaterial="selectMaterialReference" :selectAsset="referenceLimit > 0 ? selectAssetReference : undefined" :placeholder="taskPresentation.placeholder" :compact="compactMusicPrompt" :expandable="!compactMusicPrompt" />
        </div>
        <audioParameters v-if="selectedModel?.modelId === 'music'" v-model="data.other" :model="selectedModel" section="lyrics" :disabled="busy" />
        <audioParameters v-model="data.other" :model="selectedModel" section="controls" :disabled="busy" />
        <div class="promptFooter">
          <modelSelect
            :empty="!models.length"
            :modelValue="selectedModel ? data.model : ''"
            class="modelSelect"
            :loading="modelsLoading"
            :disabled="busy"
            placeholder="选择模型"
            aria-label="音频生成模型"
            noDataText="请先在设置中添加音频模型"
            placement="top-start"
            @update:modelValue="selectModel"
            @visibleChange="(visible: boolean) => visible && loadModels().catch(error => showNodeError(error, '模型读取失败'))">
            <template v-if="!selectedModel" #prefix><icon-music-bolt :size="17" /></template>
            <template #label="{ label }"><modelLabel :label="label" :providerId="selectedModel?.providerId" :modelId="selectedModel?.modelId" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option v-for="item in provider.models" :key="item.modelId" :label="item.label" :value="getNodeModelKey(item)">
                <modelLabel :label="item.label" :providerId="item.providerId" :modelId="item.modelId" />
              </el-option>
            </el-option-group>
          </modelSelect>
          <generationSettings v-model:language="data.language" v-model:sampleRate="data.sampleRate" v-model:format="data.format" v-model:other="data.other" :model="selectedModel" :excludedFields="selectedModel?.audioOptions?.nativeParameters ? [...audioContentFields, ...audioQuickFields] : []" :disabled="busy || !selectedModel" />
          <div class="generationActions">
            <taskRecovery :visible="generationState.recoveryVisible.value" :label="generationState.recoveryLabel.value" :action="generationState.recoverResult" :disabled="cancelling || deleting || uploading" />
            <el-button
              class="sendButton"
              :icon="generating || pendingRecovery ? IconPlayerStop : IconArrowUp"
              :loading="cancelling"
              :disabled="cancelling || deleting || uploading || transcribing || actions?.processing || (!generating && !pendingRecovery && ((!generationPrompt && !selectedModel?.promptOptional) || !selectedModel))"
              :title="generating || pendingRecovery ? '停止本地等待，不会撤销供应商任务或保证退费' : taskPresentation.action"
              :aria-label="generating || pendingRecovery ? '停止本地等待' : taskPresentation.action"
              @click="generating || pendingRecovery ? generationState.cancel().catch(error => showNodeError(error, '停止等待失败')) : startGeneration().catch(error => showNodeError(error, '音频生成失败'))" />
          </div>
        </div>
      </el-card>
    </template>
  </nodeSkeleton>
  <audioActions ref="actions" v-model:pcmOptions="pcmOptions" :file="outputFile" :src="previewUrl" :target="speedTarget" :disabled="generating || deleting || uploading || transcribing" @pause="player?.pause()" />
</template>

<script setup lang="ts">
import taskRecovery from "@toonflow/node-shared/taskRecovery";
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElButton, ElCard, ElLoading, ElOption, ElOptionGroup, ElSelect } from "element-plus";
import { IconArrowUp, IconGauge, IconMusicBolt, IconPlayerStop, IconScissors, IconTransfer, IconTextRecognition } from "@tabler/icons-vue";
import { findNodeModel, getNodeModelIdentity, getNodeModelKey, nodeSkeleton, nodeTools, useNode, useNodeModelMemory, useNodeModelSelection, z, type NodeAudioRequest, type NodeAudioResult, type NodeMediaResult, type NodeHandle, type NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import modelLabel from "@toonflow/node-shared/modelLabel";
import modelSelect from "@toonflow/node-shared/modelSelect";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { useNodeGeneration } from "@toonflow/node-shared/useNodeGeneration";
import { useAudioTranscription } from "@toonflow/node-shared/useAudioTranscription";
import { getMediaMimeType } from "@toonflow/node-shared/mediaTypes";
import type { PcmOptions } from "@toonflow/node-shared/pcmPreview";
import { useNodeReferences, referenceKey } from "@toonflow/node-shared/useNodeReferences";
import { getPromptText } from "@toonflow/node-shared/promptText";
import { getModelFormValues, useModelForm } from "@toonflow/node-shared/useModelForm";
import audioPlayer from "@toonflow/node-audio/audioPlayer";
import audioActions from "@toonflow/node-audio/audioActions";
import promptInput from "@toonflow/node-shared/promptInput";
import referenceItem from "@toonflow/node-shared/referenceItem";
import generationSettings from "./components/generationSettings.vue";
import audioParameters from "./components/audioParameters.vue";
import { formatOptions, languageOptions, sampleRateOptions, audioReferenceLimit, validateAudioParameters, audioTaskPresentation, getAudioRules, audioContentFields, audioQuickFields } from "./audioSettings";

defineOptions({
  inheritAttrs: false,
  icon: IconMusicBolt,
  handles: [
    { id: "in", type: "target", dataType: ["IMAGE", "AUDIO", "STRING"], label: "参考素材（按模型限制参与）" },
    { id: "audio", type: "source", dataType: "AUDIO", label: "音频输出" },
    { id: "text", type: "source", dataType: "STRING", label: "文本 / 音色信息" },
  ] satisfies NodeHandle[],
});
const vLoading = ElLoading.directive;
const { id, node, nodeProps, nodeEvent, handles, outputs, files, ai, updateNodeInternals } = useNode({ label: "音频生成", onModelsChanged: () => void refreshProviderModels() });
const { getEdges } = useVueFlow();
const availableHandles = handles.value.map(handle => ({ ...handle }));
type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;
const data = computed(() => node.data as { prompt: string; promptModel: PromptModel; model: string; language: string; sampleRate: number; format: string; other: Record<string, unknown>; audioResults: NodeAudioResult[] });
data.value.prompt ??= "";
data.value.promptModel ??= [];
data.value.model ??= "";
data.value.language ??= "zh-CN";
data.value.sampleRate ??= 24000;
data.value.format ??= "wav";
data.value.other ??= {};
data.value.audioResults ??= [];
const { refList, referenceMentions, materialMentions, selectMaterialReference, selectAssetReference, setReferencePreview, removeReference } = useNodeReferences();
const models = shallowRef<NodeMediaModel[]>([]);
const modelsLoading = ref(false);
const uploading = ref(false);
const deleting = ref(false);
const fileInput = ref<HTMLInputElement>();
const player = ref<InstanceType<typeof audioPlayer>>();
const actions = ref<InstanceType<typeof audioActions>>();
const speedTarget = ref<HTMLElement>();
const outputFile = computed(() => outputs.value.audio?.dataType === "AUDIO" ? outputs.value.audio.value : undefined);
const resultText = computed(() => outputs.value.text?.dataType === "STRING" ? outputs.value.text.value : "");
const pcmOptions = ref<Partial<PcmOptions>>({});
watch(() => outputFile.value?.url, () => { pcmOptions.value = {}; }, { flush: "sync" });
const { processing: transcribing, transcribe, cancel: cancelTranscription, cancelAndWait: cancelTranscriptionAndWait } = useAudioTranscription(outputFile);
let disposed = false;
let generationController: AbortController | undefined;
let generation: Promise<void> | undefined;
let modelsRequest: Promise<void> | undefined;
let modelsRefreshPending = false;
const generationState = useNodeGeneration(outputs, () => generationController?.abort(), { ai, applyResults });
const { generating, elapsedLabel, pendingRecovery, cancelling } = generationState;
const busy = computed(() => generating.value || uploading.value || deleting.value || transcribing.value || !!actions.value?.processing);
watch(busy, value => { if (!value && modelsRefreshPending) void refreshProviderModels(); });
const selectedModel = useNodeModelSelection(models, computed({ get: () => data.value.model, set: value => { data.value.model = value; } }));
const modelMemory = useNodeModelMemory("audio");
useModelForm(data, selectedModel);
const modelGroups = computed(() => groupNodeModels(models.value));
const taskPresentation = computed(() => audioTaskPresentation(selectedModel.value, data.value.other));
const compactMusicPrompt = computed(() => selectedModel.value?.modelId === "music" && selectedModel.value.audioOptions?.nativeParameters === true && data.value.other.operation !== "lyrics");
watch(() => {
  const model = selectedModel.value;
  const native = model?.audioOptions?.nativeParameters;
  const textOnly = native && (["whisper-1", "voice-clone"].includes(model.modelId)
    || model.modelId === "music" && ["lyrics", "persona", "import"].includes(String(data.value.other.operation)));
  const textExpected = textOnly || native && model.modelId === "voice-design";
  const connected = new Set(getEdges.value.filter(edge => edge.source === id).map(edge => edge.sourceHandle));
  return availableHandles.filter(handle => handle.type === "target" || !model || connected.has(handle.id)
    || (handle.id === "audio" ? !textOnly || !!outputFile.value : textExpected || !!resultText.value));
}, next => {
  // 已连线或已有结果的端口保留，切换模型不能让脚手架移除用户的连线。
  if (JSON.stringify(handles.value) !== JSON.stringify(next)) handles.value = next;
}, { immediate: true });
const referenceLimit = computed(() => audioReferenceLimit(selectedModel.value, data.value.other));
const inactiveReferenceIndices = computed(() => {
  let count = 0;
  return refList.value.flatMap((item, index) => {
    if (item.dataType === "STRING") return taskPresentation.value.prompt ? [] : [index];
    if (selectedModel.value?.audioOptions && item.dataType !== "AUDIO") return [index];
    return count++ >= referenceLimit.value ? [index] : [];
  });
});
const activeReferenceMentions = computed(() => referenceMentions.value.filter(item => {
  const index = refList.value.findIndex(reference => referenceKey(reference) === item.id);
  return index < 0 || !inactiveReferenceIndices.value.includes(index);
}));
const activeMaterialMentions = computed(() => materialMentions.value.filter(item => !selectedModel.value?.audioOptions?.nativeParameters
  || item.dataType === "STRING" && taskPresentation.value.prompt || item.dataType === "AUDIO" && referenceLimit.value > 0));
function getGenerationPrompt(strict = false) {
  if (!taskPresentation.value.prompt) return "";
  const prompt = data.value.promptModel.length ? getPromptText(data.value.promptModel, referenceId => {
    const reference = referenceMentions.value.find(item => item.id === referenceId);
    if (!reference && strict) throw new Error("提示词引用已失效，请重新选择参考素材");
    return reference?.value ?? "";
  }) : data.value.prompt;
  const mentioned = new Set<number>();
  const resolved = prompt.replace(/\{\{ref (\d+)\}\}/g, (marker, value) => {
    const index = Number(value) - 1;
    const item = refList.value[index];
    if ((!item || inactiveReferenceIndices.value.includes(index)) && strict) throw new Error(`参考 ${value} 不存在或不参与当前音频任务`);
    mentioned.add(index);
    return item?.dataType === "STRING" ? item.value ?? "" : selectedModel.value?.audioOptions ? "" : marker;
  });
  return [resolved.trim(), ...refList.value.flatMap((item, index) => item.dataType === "STRING" && !mentioned.has(index) && item.value?.trim() ? [item.value.trim()] : [])].filter(Boolean).join("\n\n");
}
const generationPrompt = computed(() => getGenerationPrompt());
const generationInput = computed<Omit<NodeAudioRequest, "directory"> | undefined>(() => {
  const choice = selectedModel.value;
  if (!choice) return;
  return {
    ...getNodeModelIdentity(choice),
    prompt: generationPrompt.value,
    ...(choice.audioOptions?.nativeParameters ? {} : { language: data.value.language, sampleRate: data.value.sampleRate, format: data.value.format }),
    other: choice.audioOptions?.nativeParameters
      ? Object.fromEntries(getAudioRules(choice, data.value.other).map(rule => [String(rule.field), data.value.other[String(rule.field)]]))
      : Object.keys(data.value.other).length ? { ...data.value.other } : undefined,
    outputDirectory: `assets/${id}`,
    images: refList.value.flatMap((item, index) => !inactiveReferenceIndices.value.includes(index) && item.dataType === "IMAGE" && item.value ? [{ path: item.value.url, mimeType: item.value.mimeType }] : []),
    audios: refList.value.flatMap((item, index) => !inactiveReferenceIndices.value.includes(index) && item.dataType === "AUDIO" && item.value ? [{ path: item.value.url, mimeType: item.value.mimeType }] : []),
  };
});
const previewUrl = files.useFileUrl(outputFile, error => showNodeError(error, "音频读取失败"));

function selectAudioResult(path: string) {
  const result = data.value.audioResults.find(item => item.path === path);
  if (result) outputs.value.audio = { dataType: "AUDIO", value: { url: result.path, mimeType: result.mimeType } };
}

function applyResults(results: NodeMediaResult[]) {
  const audioResults = results.filter((result): result is NodeAudioResult => result.mediaType === "audio");
  data.value.audioResults = audioResults.filter(result => result.mimeType.startsWith("audio/"));
  const text = [...new Set(audioResults.flatMap(result => result.text ? [result.text] : []))].join("\n\n");
  outputs.value.text = text ? { dataType: "STRING", value: text } : undefined;
  outputs.value.audio = undefined;
  if (data.value.audioResults[0]) selectAudioResult(data.value.audioResults[0].path);
}

onMounted(() => {
  window.addEventListener("toonflow:plugin-installed", refreshProviderModels);
  window.addEventListener("toonflow:provider-config-changed", refreshProviderModels);
  void refreshProviderModels();
});
onScopeDispose(() => {
  disposed = true;
  window.removeEventListener("toonflow:plugin-installed", refreshProviderModels);
  window.removeEventListener("toonflow:provider-config-changed", refreshProviderModels);
  generationController?.abort();
});

async function refreshProviderModels(event?: Event) {
  if (event?.type === "toonflow:plugin-installed" && (event as CustomEvent<{ type?: string }>).detail?.type !== "provider") return;
  modelsRefreshPending = true;
  if (disposed || busy.value) return;
  try {
    await modelsRequest;
    if (disposed || busy.value) return;
    modelsRefreshPending = false;
    await loadModels();
  } catch (error) {
    if (!disposed) showNodeError(error, "模型读取失败");
  }
}

function loadModels() {
  if (modelsRequest) return modelsRequest;
  modelsLoading.value = true;
  modelsRequest = ai.getMediaModels().then(items => {
    if (disposed) return;
    if (busy.value) {
      modelsRefreshPending = true;
      return;
    }
    models.value = items.filter(item => item.type === "audio");
    // ACT: 仅空配置选择默认模型（优先上次手动选择的），临时不可用的模型保持原选择，避免静默换供应商。
    if (!data.value.model) {
      const choice = findNodeModel(models.value, modelMemory.get()) ?? modelGroups.value[0]?.models[0];
      data.value.model = choice ? getNodeModelKey(choice) : "";
    }
  }).finally(() => {
    modelsLoading.value = false;
    modelsRequest = undefined;
  });
  return modelsRequest;
}

function selectModel(value: string) {
  data.value.model = value;
  if (value) modelMemory.set(value);
}

async function startGeneration() {
  if (cancelling.value) throw new Error("任务正在取消，请稍后重试");
  if (busy.value || disposed) throw new Error("音频正在处理或节点已关闭，请稍后重试");
  if (pendingRecovery.value) {
    generation = generationState.resume().catch(error => showNodeError(error, "音频任务复查失败"));
    return { status: "generating" };
  }
  const currentInput = generationInput.value;
  if (!currentInput) throw new Error("请先选择音频模型");
  const input = { ...currentInput, prompt: getGenerationPrompt(true) };
  if (!generationPrompt.value && !selectedModel.value?.promptOptional) throw new Error("请输入生成提示词或待朗读文本");
  if (selectedModel.value?.maxPromptLength && input.prompt.length > selectedModel.value.maxPromptLength) throw new Error(`输入文本最多支持 ${selectedModel.value.maxPromptLength} 个字符`);
  if (refList.value.some((item, index) => !inactiveReferenceIndices.value.includes(index) && item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
  if (selectedModel.value) validateAudioParameters(selectedModel.value, input.other ?? {}, input.audios?.length ?? 0, input.prompt);
  if (!selectedModel.value?.audioOptions?.nativeParameters && (!languageOptions.some(item => item.value === data.value.language) || !sampleRateOptions.includes(data.value.sampleRate) || !formatOptions.includes(data.value.format))) throw new Error("请重新选择有效的语种、采样率和输出格式");
  const workspace = files.getWorkspaceFiles();
  const controller = new AbortController();
  generationController = controller;
  generation = generationState.run(async () => {
    const { directory } = await workspace.list();
    controller.signal.throwIfAborted();
    const results = await generationState.generate("audio", { ...input, directory }, controller.signal);
    controller.signal.throwIfAborted();
    if (!results.length) throw new Error("供应商未返回结果");
    applyResults(results);
  }).catch(error => showNodeError(error, "音频生成失败")).finally(() => {
    generationController = undefined;
  });
  return { status: "generating" };
}

async function replaceOutput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || busy.value || disposed) return;
  const mimeType = getMediaMimeType(file);
  if (!mimeType.startsWith("audio/")) return void showNodeError("请选择音频文件", "音频替换失败");
  if (!file.size || file.size > 100 * 1024 * 1024) return void showNodeError("音频不能为空且不能超过 100 MB", "音频替换失败");
  uploading.value = true;
  try {
    const workspace = files.getWorkspaceFiles();
    const url = await files.uploadFile(file);
    if (disposed) {
      await workspace.remove(url);
      return;
    }
    // ACT: 替换不删除旧音频，保留复制节点与撤销记录的文件引用。
    outputs.value.audio = { dataType: "AUDIO", value: { url, mimeType } };
    outputs.value.text = undefined;
    data.value.audioResults = [];
  } catch (error) {
    showNodeError(error, "音频替换失败");
  } finally {
    uploading.value = false;
  }
}

nodeEvent.on("save", reason => {
  if (uploading.value || (reason === "reload" && busy.value)) throw new Error("音频处理中，请完成或取消后再刷新节点");
});
nodeEvent.on("delete", async () => {
  if (uploading.value) throw new Error("音频正在替换，请稍后删除节点");
  deleting.value = true;
  try {
    await generationState.cancel(false);
    await Promise.all([generation, actions.value?.cancelAndWait(), cancelTranscriptionAndWait()]);
    await files.removeNodeFiles();
  } finally {
    deleting.value = false;
  }
});

function getConfig() {
  const native = selectedModel.value?.audioOptions?.nativeParameters;
  return {
    config: { providerId: selectedModel.value?.providerId ?? "", modelId: selectedModel.value?.modelId ?? "", ...(!native ? { language: data.value.language, sampleRate: data.value.sampleRate, format: data.value.format } : {}), other: { ...data.value.other } },
    models: models.value,
    languages: native ? [] : languageOptions,
    sampleRates: native ? [] : sampleRateOptions,
    formats: native ? [] : formatOptions,
    inputLimits: { text: "unlimited", audio: referenceLimit.value, image: selectedModel.value?.audioOptions ? 0 : 1 },
  };
}

nodeTools.register({
  name: "getConfig",
  description: "读取音频模型、参数 rules 与当前操作的素材限制。audioOptions.nativeParameters 为 true 时所有模型参数通过 other 设置，固定语种、采样率、格式不适用；超额媒体置暗且不参与提交",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) {
    signal?.throwIfAborted();
    await loadModels();
    signal?.throwIfAborted();
    return getConfig();
  },
});
nodeTools.register({
  name: "setConfig",
  description: "修改音频生成模型、语种、采样率、格式或自定义配置 other；先用 getConfig 查询选项，providerId 与 modelId 必须同时提供；other 按目标模型 rules 的 field 和值要求填写，仅更新传入字段，其余保留，切换模型时使用新模型默认值；不修改提示词、不启动生成",
  parameters: z.strictObject({
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    language: z.string().optional(),
    sampleRate: z.number().int().positive().optional(),
    format: z.string().optional(),
    other: z.record(z.string(), z.json()).optional(),
  }).refine(args => (args.providerId === undefined) === (args.modelId === undefined), "providerId 与 modelId 必须同时提供"),
  async execute(args, { signal }) {
    signal?.throwIfAborted();
    if (busy.value || disposed) throw new Error("音频正在处理或节点已关闭，请稍后修改配置");
    await loadModels();
    signal?.throwIfAborted();
    if (busy.value || disposed) throw new Error("音频正在处理或节点已关闭，请稍后修改配置");
    const choice = args.modelId === undefined ? selectedModel.value : findNodeModel(models.value, { providerId: args.providerId ?? "", modelId: args.modelId });
    if (!choice) throw new Error("请选择 getConfig 返回的有效音频模型");
    if (choice.audioOptions?.nativeParameters && [args.language, args.sampleRate, args.format].some(value => value !== undefined)) throw new Error("当前模型使用专属参数，请根据 rules 通过 other 设置语种、采样率或格式");
    if (args.language !== undefined && !languageOptions.some(item => item.value === args.language)) throw new Error("请选择 getConfig 返回的有效语种");
    if (args.sampleRate !== undefined && !sampleRateOptions.includes(args.sampleRate)) throw new Error("请选择 getConfig 返回的有效采样率");
    if (args.format !== undefined && !formatOptions.includes(args.format)) throw new Error("请选择 getConfig 返回的有效输出格式");
    const other = getModelFormValues(choice, choice === selectedModel.value ? data.value.other : {}, args.other);
    data.value.model = getNodeModelKey(choice);
    if (args.language !== undefined) data.value.language = args.language;
    if (args.sampleRate !== undefined) data.value.sampleRate = args.sampleRate;
    if (args.format !== undefined) data.value.format = args.format;
    data.value.other = other;
    return getConfig();
  },
});
nodeTools.register({
  name: "setPrompt",
  description: "修改此节点的音频生成提示词或待朗读文本，仅接收 prompt，支持 {{ref 1}} 等参考标记；语种 language、采样率 sampleRate、格式 format 等配置须先用 node:getConfig 查询能力，再单独调用 node:setConfig；不启动生成",
  parameters: z.strictObject({ prompt: z.string() }),
  execute({ prompt }) {
    if (deleting.value || disposed) throw new Error("节点正在删除或已关闭，请稍后修改");
    data.value.prompt = prompt;
    data.value.promptModel = prompt.split("\n").map(text => [{ type: "Write", text }]);
    return { prompt };
  },
});
nodeTools.register({
  name: "generateAudio",
  description: "使用当前模型与参数启动音频任务；素材按当前操作限制参与，超额素材排除；支持音频、音色信息或转写文本结果。立即返回已开始，用 getGenerationStatus 查询结果、cancelGeneration 停止本地等待",
  parameters: z.strictObject({}),
  execute(_args, { signal }) {
    signal?.throwIfAborted();
    return startGeneration();
  },
});
</script>

<style scoped lang="scss">
.audioContent {
  position: relative;
  min-height: 144px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;

  .resultSelect { width: 100%; }
  .resultText { width: 100%; max-height: 200px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; padding: 12px; margin: 0; box-sizing: border-box; user-select: text; }

  .nodeSkeleton.resized & {
    height: 100%;
    min-height: 0;
    align-items: flex-start;

    .audioEmpty { height: 100%; min-height: 0; }
  }

  .audioPreview { display: block; width: 100%; border-radius: var(--el-border-radius-base); }
  .audioEmpty { display: grid; place-items: center; width: 100%; min-height: 144px; color: var(--el-text-color-placeholder); }
  :deep(.el-loading-mask) {
    pointer-events: none;
    .el-loading-text { color: var(--el-text-color-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
  }
}
.promptCard {
  container-type: inline-size;
  border-radius: 16px;
  &:not(.hasPrompt) :deep(.audioWriting) { border-bottom: 0; margin-bottom: 0; }
  .referenceButton { margin-bottom: 10px; }
  :deep(.promptInputWrap) { margin: 12px 0 16px; }
  .musicStyle {
    margin: 8px 0;
    .musicStyleLabel { margin-bottom: 4px; color: var(--el-text-color-regular); font-size: 12px; }
    :deep(.promptInputWrap) { margin: 0; }
  }
  .promptFooter {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;

    .modelSelect {
      flex: 0 1 280px;
      width: 280px;
      min-width: 0;
      &:deep(.el-select__wrapper) { gap: 6px; padding: 0; box-shadow: none; background: transparent; }
    }
    .generationActions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      flex-shrink: 0;

      .sendButton {
        width: 32px;
        height: 32px;
        margin-left: 0;
        padding: 0;
        --el-button-bg-color: var(--el-color-primary);
        --el-button-border-color: transparent;
        --el-button-text-color: var(--ui-primary-foreground, #fff);
        --el-button-hover-bg-color: var(--el-color-primary-dark-2);
        --el-button-hover-border-color: transparent;
        --el-button-hover-text-color: var(--ui-primary-foreground, #fff);
        --el-button-active-bg-color: var(--el-color-primary-dark-2);
        --el-button-active-text-color: var(--ui-primary-foreground, #fff);
      }
    }
  }
}
</style>
