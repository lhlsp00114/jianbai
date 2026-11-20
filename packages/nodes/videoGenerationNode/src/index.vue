<template>
  <nodeSkeleton
    ref="skeleton"
    v-bind="nodeProps"
    v-model:bottomVisible="node.selected"
    :topVisible="node.selected"
    contentPadding="2px"
    :resizeAspectRatio="previewUrl && videoPreviewSize ? videoPreviewSize.width / videoPreviewSize.height : undefined"
    selectionFrame
    topWidth="max-content"
    toolbarAction="focus"
    :downloadUrl="previewUrl"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    @fullscreen="player?.enterFullscreen()"
    :bottomWidth="660"
    :style="nodePreviewStyle">
    <template v-if="videoResolution" #titleMeta><span :title="`${videoResolution} 像素`" :aria-label="`视频分辨率：${videoResolution}`">{{ videoResolution }}</span></template>
    <template #contextActions><eagleMenuItem :file="outputFile" /></template>
    <template #topActions>
      <el-button :icon="IconMusic" text :disabled="!outputFile || generating || deleting || uploading || actions?.processing" @click.stop="actions?.open('extractAudio')">提取音轨</el-button>
      <el-button :icon="IconLayersSubtract" text :disabled="!outputFile || generating || deleting || uploading || actions?.processing" @click.stop="actions?.open('separate')">分离音视频</el-button>
      <el-button :icon="IconScissors" text :disabled="!outputFile || generating || deleting || uploading || actions?.processing" @click.stop="actions?.open('trim')">截取片段</el-button>
      <el-button :icon="IconMovie" text :loading="actions?.creatingAnalysis" :disabled="!outputFile || generating || deleting || uploading || actions?.processing || actions?.creatingAnalysis" @click.stop="actions?.createFrameAnalysis()">逐帧拉片</el-button>
    </template>
    <template #topRightActions>
      <el-dropdown trigger="click" placement="bottom-end" :disabled="!player?.ready || player?.capturing || generating || deleting || uploading" @command="player?.captureFrame($event)">
        <el-button :icon="IconPhotoScan" :loading="player?.capturing" :disabled="!player?.ready || player?.capturing || generating || deleting || uploading" text title="截取视频帧" aria-label="截取视频帧" />
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="current" :icon="IconPhotoScan">截取当前帧</el-dropdown-item>
            <el-dropdown-item command="first" :icon="IconPlayerSkipBack">截取首帧</el-dropdown-item>
            <el-dropdown-item command="last" :icon="IconPlayerSkipForward">截取尾帧</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>
    <div v-loading="generating || uploading" class="videoContent nopan" :class="{ empty: !outputFile }" :aria-busy="generating || uploading">
      <input ref="fileInput" type="file" accept="video/*" hidden aria-label="选择替换视频" :disabled="generating || deleting || uploading" @change="replaceOutput" />
      <videoPlayer
        v-if="previewUrl"
        ref="player"
        :src="previewUrl"
        label="生成视频"
        @loadedmetadata="resizeVideo" />
      <div v-else class="videoEmpty" role="img" aria-label="暂无生成视频">
        <videoGenerationIcon :size="30" stroke="1.4" />
      </div>
      <mediaHistory v-if="node.selected" mediaType="video" inline replaceable :current="outputFile" :disabled="generating || deleting || uploading || player?.capturing || actions?.processing" @open="skeleton?.focusNode()" @select="outputs.video = { dataType: 'VIDEO', value: $event }" @upload="fileInput?.click()" />
    </div>
    <template #bottom>
      <generationPromptPanel>
        <template #actions>
          <div ref="providerTarget" />
          <taskRecovery compact :visible="generationState.recoveryVisible.value" :label="generationState.recoveryLabel.value" :action="generationState.recoverResult" :disabled="cancelling || deleting || uploading" />
        </template>
        <el-card class="promptCard" shadow="never" :bodyStyle="{ padding: '14px 16px 12px' }">
          <referenceActions presetPrompts :materials="materialMentions" :selectMaterial="selectMaterialReference" :selectAsset="selectAssetReference" :disabled="generating || deleting || uploading" />
          <referenceItem
            v-if="refList.length"
            v-model="refList"
            :inactiveMedia="selectedMode === 'text'"
            @preview="setReferencePreview"
            @remove="removeReference" />
          <div v-if="selectedMode === 'text' && mediaCounts.image + mediaCounts.video + mediaCounts.audio" class="referenceHint">
            文生视频模式不使用已连接的图片、视频或音频，连线会保留。
          </div>
          <div v-else-if="frameMode" class="referenceHint">
            {{ selectedMode === "startFrameOptional" ? "仅一张图片时作为尾帧；两张图片按顺序作为首帧、尾帧" : "图片引用按顺序作为首帧、尾帧" }}
          </div>
          <promptInput v-model="data.promptModel" v-model:text="data.prompt" :references="referenceMentions" :materials="materialMentions" :selectMaterial="selectMaterialReference" :selectAsset="selectAssetReference" expandable />
          <div class="promptFooter">
            <providerModelSelect
              v-model="data.model"
              :models="models"
              :providerTarget="providerTarget"
              :loading="modelsLoading"
              :disabled="generating || deleting"
              noDataText="请先在设置中添加视频模型"
              @open="loadModels().catch(error => showNodeError(error, '模型读取失败'))" />
            <generationSettings
              v-model:duration="data.duration"
              v-model:resolution="data.resolution"
              v-model:ratio="data.ratio"
              v-model:mode="data.mode"
              v-model:generateAudio="data.generateAudio"
              v-model:other="data.other"
              :ratios="ratioOptions"
              :model="selectedModel"
              :disabled="generating || deleting || !selectedModel" />
            <promptPresets :disabled="generating || deleting || uploading" />
            <div class="generationActions">
              <mediaPrice v-if="generationInput" :input="{ ...generationInput, mediaType: 'video' }" :supported="selectedModel?.supportsPrice === true" />
              <el-button v-if="pendingRecovery" class="sendButton" :icon="IconPlayerStop" :loading="cancelling" :disabled="deleting || uploading" title="放弃任务" aria-label="放弃任务" @click="generationState.cancel().catch(error => showNodeError(error, '停止生成失败'))" />
              <el-button
                class="sendButton"
                :icon="generating ? IconPlayerStop : IconArrowUp"
                :disabled="cancelling || deleting || uploading || (!generating && !pendingRecovery && (!generationPrompt || !selectedModel))"
                :title="generating ? '停止生成' : pendingRecovery ? '复查任务' : '生成视频'"
                :aria-label="generating ? '停止生成' : pendingRecovery ? '复查任务' : '生成视频'"
                @click="generating ? generationState.cancel().catch(error => showNodeError(error, '停止生成失败')) : startGeneration().catch((error) => showNodeError(error, '视频生成失败'))" />
            </div>
          </div>
        </el-card>
      </generationPromptPanel>
    </template>
  </nodeSkeleton>
  <videoActions ref="actions" :file="outputFile" :src="previewUrl" :disabled="generating || deleting || uploading" />
</template>

<script setup lang="ts">
import taskRecovery from "@toonflow/node-shared/taskRecovery";
import { computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import { ElButton, ElCard, ElLoading, ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus";
import { IconArrowUp, IconPlayerStop, IconMusic, IconLayersSubtract, IconScissors, IconMovie, IconPhotoScan, IconPlayerSkipBack, IconPlayerSkipForward } from "@tabler/icons-vue";
import videoGenerationIcon from "@toonflow/node-shared/videoGenerationIcon";
import { findNodeModel, getNodeModelIdentity, getNodeModelKey, nodeSkeleton, nodeTools, useNode, useNodeModelSelection, z, type NodeMediaModel, type NodeVideoRequest, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import { readLastNodeModel, rememberNodeModel } from "@toonflow/node-shared/modelPreference";
import providerModelSelect from "@toonflow/node-shared/providerModelSelect";
import eagleMenuItem from "@toonflow/node-shared/eagleMenuItem";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { useNodeGeneration } from "@toonflow/node-shared/useNodeGeneration";
import { getModelFormValues, useModelForm } from "@toonflow/node-shared/useModelForm";
import { useNodeReferences } from "@toonflow/node-shared/useNodeReferences";
import { getPromptText } from "@toonflow/node-shared/promptText";
import promptInput from "@toonflow/node-shared/promptInput";
import promptPresets from "@toonflow/node-shared/promptPresets";
import generationPromptPanel from "@toonflow/node-shared/generationPromptPanel";
import { getCompositionPrompt } from "@toonflow/node-shared/compositionPrompts";
import { getColorPrompt } from "@toonflow/node-shared/colorPrompts";
import { getCameraPrompt, isCameraSettings } from "@toonflow/node-shared/cameraPrompts";
import videoPlayer from "@toonflow/node-video/videoPlayer";
import { getMediaMimeType } from "@toonflow/node-shared/mediaTypes";
import { emptyMediaCardWidth, getMediaPreviewSize } from "@toonflow/node-shared/mediaPreviewSize";
import videoActions from "@toonflow/node-video/videoActions";
import referenceItem from "@toonflow/node-shared/referenceItem";
import referenceActions from "@toonflow/node-shared/referenceActions";
import mediaHistory from "@toonflow/node-shared/mediaHistory";
import mediaPrice from "@toonflow/node-shared/mediaPrice";
import generationSettings from "./components/generationSettings.vue";

defineOptions({
  inheritAttrs: false,
  icon: videoGenerationIcon,
  handles: [
    { id: "in", type: "target", dataType: ["IMAGE", "VIDEO", "AUDIO", "STRING"], label: "图片、视频、音频、文本输入" },
    { id: "video", type: "source", dataType: "VIDEO", label: "视频输出" },
  ] satisfies NodeHandle[],
});
const vLoading = ElLoading.directive;
const { id, node, nodeProps, nodeEvent, outputs, files, ai, updateNodeInternals } = useNode({
  label: "视频生成",
  onModelsChanged: () => void refreshProviderModels(),
});
type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;
const data = computed(() => node.data as { colorPreset?: string; colorPresetData?: unknown; cameraSettings?: unknown; compositionPreset?: string; prompt: string; promptModel: PromptModel; model: string; duration?: number; resolution: string; ratio: string; mode: string; generateAudio: boolean; other: Record<string, unknown> });
data.value.prompt ??= "";
data.value.promptModel ??= [];
data.value.model ??= "";
data.value.resolution ??= "";
data.value.mode ??= "";
data.value.generateAudio ??= true;
data.value.ratio ??= "9:16";
data.value.other ??= {};
const { refList, referenceMentions, materialMentions, selectMaterialReference, selectAssetReference, setReferencePreview, removeReference } = useNodeReferences();
const models = shallowRef<NodeMediaModel[]>([]);
const modelsLoading = ref(false);
const providerTarget = ref<HTMLElement>();
const uploading = ref(false);
const fileInput = ref<HTMLInputElement>();
let disposed = false;
const deleting = ref(false);
const skeleton = ref<InstanceType<typeof nodeSkeleton>>();
const player = ref<InstanceType<typeof videoPlayer>>();
const actions = ref<InstanceType<typeof videoActions>>();
const videoPreviewSize = ref<ReturnType<typeof getMediaPreviewSize>>();
const videoResolution = ref("");
let generationController: AbortController | undefined;
const generationState = useNodeGeneration(outputs, () => generationController?.abort(), { ai });
const { generating, pendingRecovery, cancelling } = generationState;
let generation: Promise<void> | undefined;
let modelsRequest: Promise<void> | undefined;
watch(generating, value => { if (!value && !disposed && !deleting.value && !models.value.length) void loadModels().catch(error => showNodeError(error, "模型读取失败")); });
const selectedModel = useNodeModelSelection(models, computed({ get: () => data.value.model, set: value => { data.value.model = value; } }));
// ACT: 复用模型已有的比例字段；未声明能力的旧供应商保留通用选项。
function getRatios(choice?: NodeMediaModel) {
  return choice?.imageRatios?.length ? choice.imageRatios : ["16:9", "9:16", "1:1", "4:3", "3:4"];
}
const ratioOptions = computed(() => getRatios(selectedModel.value));
useModelForm(data, selectedModel);
const selectedMode = computed(() => selectedModel.value?.mode?.find((item) => JSON.stringify(item) === data.value.mode) as NodeVideoRequest["mode"]);
const frameMode = computed(() => ["startEndRequired", "endFrameOptional", "startFrameOptional"].includes(String(selectedMode.value)));
const mediaCounts = computed(() => ({
  image: refList.value.filter((item) => item.dataType === "IMAGE").length,
  video: refList.value.filter((item) => item.dataType === "VIDEO").length,
  audio: refList.value.filter((item) => item.dataType === "AUDIO").length,
}));
const matchingModes = computed(() => getMatchingModes(selectedModel.value));

function getMatchingModes(choice?: NodeMediaModel) {
  return (choice?.mode ?? []).filter((mode) => {
    const { image, video, audio } = mediaCounts.value;
    if (Array.isArray(mode)) return image + video + audio > 0 && Object.entries(mediaCounts.value).every(([type, count]) =>
      count <= Number(mode.find((item) => item.startsWith(`${type}Reference:`))?.split(":")[1] ?? 0)
    );
    if (mode === "text") return true;
    if (video || audio) return false;
    if (mode === "singleImage") return image === 1;
    if (mode === "startEndRequired") return image === 2;
    return ["endFrameOptional", "startFrameOptional"].includes(mode) && image >= 1 && image <= 2;
  });
}

function getDurations(choice: NodeMediaModel) {
  return [...new Set((choice.durationResolutionMap ?? []).flatMap((item) => item.duration))].sort((a, b) => a - b);
}

function getResolutions(choice: NodeMediaModel, duration?: number) {
  // ACT: 当前视频分辨率使用 p 单位；出现其他单位时再统一换算。
  return [...new Set((choice.durationResolutionMap ?? []).filter((item) => item.duration.includes(duration!)).flatMap((item) => item.resolution))]
    .sort((left, right) => (Number.parseFloat(left) || Infinity) - (Number.parseFloat(right) || Infinity));
}
// ACT: 只在模型不支持原模式时选默认值；手动切换和连线变化不覆盖已选模式，素材在生成前校验。
watch(selectedModel, choice => {
  if (!choice || choice.mode?.some(item => JSON.stringify(item) === data.value.mode)) return;
  const matches = getMatchingModes(choice);
  const modes = choice.mode ?? [];
  const mode = matches.find(Array.isArray) ?? matches.find((item) => item === "singleImage")
    ?? matches.find((item) => item === "endFrameOptional") ?? matches[0]
    ?? modes.find((item) => JSON.stringify(item) === data.value.mode) ?? modes.find(Array.isArray) ?? modes[0];
  data.value.mode = mode === undefined ? "" : JSON.stringify(mode);
}, { flush: "sync" });
// ACT: 参数在节点内归一化，未选中、未挂载底部设置时也可由 Agent 直接生成。
watch([selectedModel, () => data.value.duration], ([choice]) => {
  if (!choice) return;
  const durations = getDurations(choice);
  if (!durations.includes(data.value.duration!)) data.value.duration = durations[0];
  const resolutions = getResolutions(choice, data.value.duration);
  if (!resolutions.includes(data.value.resolution)) data.value.resolution = resolutions[0] ?? "";
  if (!ratioOptions.value.includes(data.value.ratio)) data.value.ratio = ratioOptions.value.includes("9:16") ? "9:16" : ratioOptions.value[0]!;
  if (choice.audio !== "optional") data.value.generateAudio = choice.audio === true;
}, { flush: "sync" });
const modelGroups = computed(() => groupNodeModels(models.value));
function getGenerationPrompt(prompt: string, references = refList.value) {
  return [
    prompt.trim(),
    getCompositionPrompt(data.value.compositionPreset),
    getColorPrompt(data.value.colorPreset, data.value.colorPresetData),
    getCameraPrompt(data.value.cameraSettings),
    ...references.flatMap((item, index) => (item.dataType === "STRING" && item.value?.trim() ? [`参考 ${index + 1}：\n${item.value.trim()}`] : [])),
  ]
    .filter(Boolean)
    .join("\n\n");
}
const generationPrompt = computed(() => getGenerationPrompt(data.value.prompt));
const generationInput = computed(() => getGenerationInput(data.value.prompt));

function getGenerationInput(prompt: string): Omit<NodeVideoRequest, "directory"> | undefined {
  const choice = selectedModel.value;
  if (!choice) return;
  if (choice.mode?.length && !matchingModes.value.some(item => JSON.stringify(item) === data.value.mode)) return;
  const textOnly = selectedMode.value === "text";
  const references = refList.value;
  const images: NonNullable<NodeVideoRequest["images"]> = [];
  const videos: NonNullable<NodeVideoRequest["videos"]> = [];
  const audios: NonNullable<NodeVideoRequest["audios"]> = [];
  const referenceOrder: NonNullable<NodeVideoRequest["referenceOrder"]> = references.map(item => {
    // 保留文本引用的原编号；文生视频不读取或发送连线中的媒体。
    if (textOnly) return { type: "text" };
    if (item.dataType === "IMAGE" && item.value) {
      const index = images.push({ path: item.value.url, mimeType: item.value.mimeType }) - 1;
      return { type: "image", index };
    }
    if (item.dataType === "VIDEO" && item.value) {
      const index = videos.push({ path: item.value.url, mimeType: item.value.mimeType }) - 1;
      return { type: "video", index };
    }
    if (item.dataType === "AUDIO" && item.value) {
      const index = audios.push({ path: item.value.url, mimeType: item.value.mimeType }) - 1;
      return { type: "audio", index };
    }
    return { type: "text" };
  });
  const firstFrame = frameMode.value && (selectedMode.value !== "startFrameOptional" || images.length > 1) ? images[0] : undefined;
  const lastFrame = frameMode.value ? images[selectedMode.value === "startFrameOptional" && images.length === 1 ? 0 : 1] : undefined;
  return {
    ...getNodeModelIdentity(choice),
    prompt: getGenerationPrompt(prompt, references),
    mode: selectedMode.value,
    duration: data.value.duration,
    resolution: data.value.resolution || undefined,
    ratio: data.value.ratio,
    generateAudio: choice.audio === "optional" ? data.value.generateAudio : choice.audio,
    other: Object.keys(data.value.other).length ? { ...data.value.other } : undefined,
    outputDirectory: `assets/${id}`,
    images: textOnly || frameMode.value ? undefined : images,
    firstFrame,
    lastFrame,
    videos: textOnly ? undefined : videos,
    audios: textOnly ? undefined : audios,
    referenceOrder: referenceOrder.map(reference => frameMode.value && reference.type === "image"
      ? { type: reference.index === 0 && firstFrame ? "firstFrame" : "lastFrame" } : reference),
  };
}
const outputFile = computed(() => outputs.value.video?.dataType === "VIDEO" ? outputs.value.video.value : undefined);
watch(outputFile, () => {
  videoPreviewSize.value = undefined;
  videoResolution.value = "";
  const style = typeof node.style === "function" ? node.style(node) : node.style;
  if (style?.width === undefined && style?.height === undefined) return;
  const { width, height, ...rest } = style;
  node.style = rest;
}, { flush: "sync" });
const nodePreviewStyle = computed(() => ({
  width: outputFile.value ? (videoPreviewSize.value ? `${videoPreviewSize.value.width + 6}px` : undefined) : `${emptyMediaCardWidth}px`,
  "--videoPreviewHeight": videoPreviewSize.value ? `${videoPreviewSize.value.height}px` : undefined,
}));
watch(() => data.value.ratio, async () => {
  if (outputFile.value) return;
  const style = typeof node.style === "function" ? node.style(node) : node.style;
  if (style?.width || style?.height) {
    const { width, height, ...rest } = style;
    node.style = rest;
  }
  await nextTick();
  updateNodeInternals();
});
const previewUrl = files.useFileUrl(
  outputFile,
  (error) => showNodeError(error, "视频读取失败")
);

onMounted(() => {
  window.addEventListener("toonflow:plugin-installed", refreshProviderModels);
  window.addEventListener("toonflow:provider-config-changed", refreshProviderModels);
  void loadModels().catch(error => { if (!disposed) showNodeError(error, "模型读取失败"); });
});
onScopeDispose(() => {
  disposed = true;
  window.removeEventListener("toonflow:plugin-installed", refreshProviderModels);
  window.removeEventListener("toonflow:provider-config-changed", refreshProviderModels);
  generationController?.abort();
});

async function refreshProviderModels(event?: Event) {
  if (event?.type === "toonflow:plugin-installed" && (event as CustomEvent<{ type?: string }>).detail?.type !== "provider") return;
  try {
    await generation;
    if (!disposed && !deleting.value) await loadModels();
  } catch (error) {
    if (!disposed) showNodeError(error, "模型读取失败");
  }
}

async function replaceOutput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || generating.value || deleting.value || uploading.value || disposed) return;
  const mimeType = getMediaMimeType(file);
  if (!mimeType.startsWith("video/")) return void showNodeError("请选择视频文件", "视频替换失败");
  if (!file.size || file.size > 100 * 1024 * 1024) return void showNodeError("视频不能为空且不能超过 100 MB", "视频替换失败");
  uploading.value = true;
  try {
    const workspace = files.getWorkspaceFiles();
    const url = await files.uploadFile(file);
    if (disposed) {
      await workspace.remove(url);
      return;
    }
    // ACT: 保留历史输出文件，避免破坏撤销记录和复制节点的引用。
    outputs.value.video = { dataType: "VIDEO", value: { url, mimeType } };
  } catch (error) {
    showNodeError(error, "视频替换失败");
  } finally {
    uploading.value = false;
  }
}

function loadModels() {
  if (modelsRequest) return modelsRequest;
  modelsLoading.value = true;
  modelsRequest = ai.getMediaModels().then((items) => {
    if (disposed || generating.value || deleting.value) return;
    models.value = items.filter((item) => item.type === "video");
    // ACT: 只给空配置选默认模型（优先上次手动选择的），保留暂时不可用的旧选择及其参数。
    if (!data.value.model) {
      const first = readLastNodeModel("video", models.value) ?? modelGroups.value[0]?.models[0];
      data.value.model = first ? getNodeModelKey(first) : "";
    }
  }).finally(() => {
    modelsLoading.value = false;
    modelsRequest = undefined;
  });
  return modelsRequest;
}

async function startGeneration() {
  if (cancelling.value) throw new Error("任务正在取消，请稍后重试");
  if (generating.value) throw new Error("视频正在生成，请等待完成");
  if (uploading.value) throw new Error("视频正在替换，请等待完成");
  if (deleting.value) throw new Error("节点正在删除");
  if (pendingRecovery.value) {
    generation = generationState.resume().catch(error => showNodeError(error, "视频任务复查失败"));
    return { status: "generating" };
  }
  if (data.value.colorPreset && !getColorPrompt(data.value.colorPreset, data.value.colorPresetData)) throw new Error("所选配色不可用，请重新选择配色后生成");
  if (data.value.cameraSettings && !isCameraSettings(data.value.cameraSettings)) throw new Error("摄影参数已失效，请重新选择相机参数后生成");
  const choice = selectedModel.value;
  if (!choice) throw new Error("请先选择视频模型");
  if (choice.mode?.length && !matchingModes.value.some(item => JSON.stringify(item) === data.value.mode)) {
    throw new Error("所选生成模式与当前素材不匹配：单图参考需要一张图片，首尾帧需要对应图片，混合参考需要模型支持的素材。请补充或调整素材，或手动切换模式。");
  }
  // ACT: 提交时按稳定 ID 解析，避免依赖编辑器挂载及异步重排同步。
  const references = referenceMentions.value;
  const prompt = data.value.promptModel.length ? getPromptText(data.value.promptModel, referenceId => {
    const value = references.find(reference => reference.id === referenceId)?.value;
    if (value === undefined) throw new Error("提示词引用的素材已失效，请重新选择引用");
    return value;
  }) : data.value.prompt;
  const input = getGenerationInput(prompt);
  if (!choice || !input) throw new Error("请先选择视频模型");
  if (!input.prompt) throw new Error("请输入生成提示词");
  if (refList.value.some(item => (selectedMode.value !== "text" || item.dataType === "STRING") && item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
  for (const match of input.prompt.matchAll(/\{\{ref (\d+)\}\}/g)) {
    const reference = refList.value[Number(match[1]) - 1];
    if (selectedMode.value === "text" && reference?.dataType !== "STRING") throw new Error(`文生视频不使用媒体参考 ${match[1]}，请移除提示词中的该引用或切换参考模式`);
    if (reference?.dataType === "STRING" && !reference.value?.trim()) throw new Error(`参考 ${match[1]} 的文本为空，请补充内容或移除提示词中的引用`);
  }
  const workspace = files.getWorkspaceFiles();
  const controller = new AbortController();
  generationController = controller;
  rememberNodeModel(choice);
  // ACT: 工具立即返回；任务身份先保存，卸载只停止等待，重新打开后复查。
  generation = generationState.run(() => workspace
    .list()
    .then(({ directory }) => {
      controller.signal.throwIfAborted();
      return generationState.generate("video", { ...input, directory }, controller.signal);
    })
    .then(([result]) => {
      controller.signal.throwIfAborted();
      if (!result) throw new Error("供应商未返回视频");
      outputs.value.video = { dataType: "VIDEO", value: { url: result.path, mimeType: result.mimeType } };
    }))
    .catch((error) => showNodeError(error, "视频生成失败"))
    .finally(() => {
      generationController = undefined;
    });
  return { status: "generating" };
}

nodeEvent.on("save", (reason) => {
  if (reason === "reload" && (generating.value || uploading.value || deleting.value)) throw new Error("视频处理中，请完成后再刷新节点");
});
nodeEvent.on("delete", async () => {
  if (uploading.value) throw new Error("视频正在替换，请稍后删除节点");
  deleting.value = true;
  try {
    await generationState.cancel(false);
    await generation;
    await files.removeNodeFiles();
  } finally {
    deleting.value = false;
  }
});

async function resizeVideo(event: Event) {
  const video = event.currentTarget as HTMLVideoElement;
  if (!video.videoWidth || !video.videoHeight) return;
  videoResolution.value = `${video.videoWidth} × ${video.videoHeight}`;
  videoPreviewSize.value = getMediaPreviewSize(video.videoWidth, video.videoHeight);
  await nextTick();
  updateNodeInternals();
}

function getConfig() {
  return {
    config: {
      providerId: selectedModel.value?.providerId ?? "",
      modelId: selectedModel.value?.modelId ?? "",
      duration: data.value.duration,
      resolution: data.value.resolution,
      ratio: data.value.ratio,
      mode: selectedMode.value,
      generateAudio: data.value.generateAudio,
      other: data.value.other,
    },
    models: models.value,
    ratios: ratioOptions.value,
    matchingModes: matchingModes.value,
  };
}

nodeTools.register({
  name: "getConfig",
  description: "读取此视频生成节点的当前配置、自定义配置 other、可选视频模型能力、当前模型比例及适合当前引用的模式，models 中的 rules 声明自定义字段，不含密钥；时长与分辨率须符合 durationResolutionMap",
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
  description: "修改此视频生成节点的模型、时长、分辨率、比例、模式、声音或自定义配置 other；先用 getConfig 查询能力，providerId 与 modelId 必须同时提供；other 按目标模型 rules 的 field 和值要求填写，仅更新传入字段，其余保留，切换模型时使用新模型默认值；mode 使用模型支持的原始字符串或数组，参考素材在生成前校验，文生视频不发送媒体素材；不修改提示词、不启动生成",
  parameters: z.strictObject({
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    duration: z.number().positive().optional(),
    resolution: z.string().min(1).optional(),
    ratio: z.string().regex(/^[1-9]\d{0,3}:[1-9]\d{0,3}$/).optional(),
    mode: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    generateAudio: z.boolean().optional(),
    other: z.record(z.string(), z.json()).optional(),
  }).refine((args) => (args.providerId === undefined) === (args.modelId === undefined), "providerId 与 modelId 必须同时提供"),
  async execute(args, { signal }) {
    signal?.throwIfAborted();
    if (generating.value || deleting.value) throw new Error("节点正在生成或删除，请稍后修改配置");
    await loadModels();
    signal?.throwIfAborted();
    if (generating.value || deleting.value) throw new Error("节点正在生成或删除，请稍后修改配置");
    const choice = args.modelId === undefined ? selectedModel.value
      : findNodeModel(models.value, { providerId: args.providerId ?? "", modelId: args.modelId });
    if (!choice) throw new Error("请选择 getConfig 返回的有效视频模型");
    const ratios = getRatios(choice);
    if (args.ratio !== undefined && !ratios.includes(args.ratio)) throw new Error(`当前模型不支持比例 ${args.ratio}，可选：${ratios.join("、")}`);
    const durations = getDurations(choice);
    if (args.duration !== undefined && !durations.includes(args.duration)) throw new Error(`当前模型不支持时长 ${args.duration}，可选：${durations.join("、")}`);
    const duration = args.duration ?? (durations.includes(data.value.duration!) ? data.value.duration : durations[0]);
    const resolutions = getResolutions(choice, duration);
    if (args.resolution !== undefined && !resolutions.includes(args.resolution)) throw new Error(`当前时长不支持分辨率 ${args.resolution}，可选：${resolutions.join("、")}`);
    const resolution = args.resolution ?? (resolutions.includes(data.value.resolution) ? data.value.resolution : resolutions[0] ?? "");
    if (args.mode !== undefined && !choice.mode?.some((item) => JSON.stringify(item) === JSON.stringify(args.mode))) throw new Error("所选模式不受当前模型支持，请根据模型能力选择");
    if (args.generateAudio !== undefined && choice.audio !== "optional" && args.generateAudio !== (choice.audio === true)) throw new Error("当前模型不支持切换声音，请查看 getConfig 返回的 audio 能力");
    const other = getModelFormValues(choice, choice === selectedModel.value ? data.value.other : {}, args.other);
    data.value.model = getNodeModelKey(choice);
    data.value.duration = duration;
    data.value.resolution = resolution;
    if (args.ratio !== undefined) data.value.ratio = args.ratio;
    if (args.mode !== undefined) data.value.mode = JSON.stringify(args.mode);
    if (args.generateAudio !== undefined) data.value.generateAudio = args.generateAudio;
    data.value.other = other;
    rememberNodeModel(choice);
    return getConfig();
  },
});

nodeTools.register({
  name: "setPrompt",
  description: "修改此节点的视频生成提示词，仅接收 prompt，支持 {{ref 1}} 等参考标记；时长 duration、分辨率等配置须先用 node:getConfig 查询能力，再单独调用 node:setConfig；不启动生成",
  parameters: z.strictObject({ prompt: z.string() }),
  execute({ prompt: value }) {
    if (deleting.value) throw new Error("节点正在删除，请稍后修改");
    data.value.prompt = value;
    data.value.promptModel = value.split("\n").map((text) => [{ type: "Write", text }]);
    return { prompt: value };
  },
});

nodeTools.register({
  name: "generateVideo",
  description: "启动此节点的后台视频生成，使用当前提示词、模型、模式、时长、分辨率、比例和参考素材；立即返回已开始，用 getGenerationStatus 查询完成结果，cancelGeneration 停止生成",
  parameters: z.strictObject({}),
  execute(_args, { signal }) {
    signal?.throwIfAborted();
    return startGeneration();
  },
});
</script>

<style scoped lang="scss">
.videoContent {
  .nodeSkeleton.resized & {
    height: 100%;
    min-height: 0;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    --nodeMediaHeight: 100%;

    .videoEmpty { min-height: 0; height: 100%; }
  }

  position: relative;
  display: grid;
  place-items: center;
  min-height: 144px;
  overflow: hidden;
  border-radius: var(--el-border-radius-base);

  .nodeSkeleton:not(.resized) &.empty .videoEmpty { height: 234px; }

  .videoEmpty {
    display: grid;
    place-items: center;
    width: 100%;
    height: 144px;
    min-height: 144px;
    color: var(--el-text-color-placeholder);
  }

  :deep(.el-loading-mask) {
    pointer-events: none;
  }

}

.promptCard {
  .referenceHint {
    margin: 8px 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }

  .promptFooter {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;

    .generationActions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;

      .sendButton {
        width: 32px;
        height: 32px;
        margin-left: 0;
        padding: 0;
        --el-button-bg-color: var(--el-text-color-primary);
        --el-button-border-color: transparent;
        --el-button-text-color: var(--el-bg-color);
        --el-button-hover-bg-color: var(--el-text-color-regular);
        --el-button-hover-border-color: transparent;
        --el-button-hover-text-color: var(--el-bg-color);
      }
    }
  }
}
</style>
