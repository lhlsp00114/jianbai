<template>
  <nodeSkeleton
    v-bind="nodeProps"
    :class="{ outpaintNode: outpaintVisible }"
    v-model:bottomVisible="node.selected"
    :topVisible="node.selected && !outpaintVisible"
    topWidth="max-content"
    contentPadding="2px"
    :resizeAspectRatio="(previewUrl || inpaintGuideUrl) && imageWidth ? imageWidth / 240 : undefined"
    selectionFrame
    toolbarAction="focus"
    :downloadUrl="previewUrl"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    @fullscreen="previewVisible = true"
    :bottomWidth="660"
    :style="nodePreviewStyle">
    <template v-if="imageResolution" #titleMeta><span :title="`${imageResolution} 像素`" :aria-label="`图片分辨率：${imageResolution}`">{{ imageResolution }}</span></template>
    <template #contextActions><eagleMenuItem :file="outputFile" /></template>
    <template v-if="editor?.mode && editor.mode !== 'smartEdit'" #top><div ref="paintToolbar" /></template>
    <template #topActions>
      <el-button :icon="IconSparkles" :disabled="generating || deleting || uploading || editor?.busy || lighting?.generating || multiAngle?.generating || gridSplit?.splitting || panorama?.busy || !previewUrl" text title="智能改图" aria-label="智能改图" @click.stop="startEditor('smartEdit')">智能改图</el-button>
      <el-button class="panoramaButton" :icon="IconPanoramaHorizontal" :disabled="generating || deleting || uploading || editor?.busy || lighting?.generating || multiAngle?.generating || gridSplit?.splitting || panorama?.busy || !previewUrl" text title="全景图" aria-label="全景图" @click.stop="panorama?.open($event)">全景图<icon-chevron-down class="menuChevron" :size="14" /></el-button>
      <el-button :icon="IconBrush" :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl || gridSplit?.splitting" text title="局部重绘" aria-label="局部重绘" @click.stop="startEditor('inpaint')">局部重绘</el-button>
      <el-button :icon="IconArrowsMaximize" :disabled="generating || deleting || uploading || editor?.busy || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl || gridSplit?.splitting || outpaintPrompt?.creating" text title="扩图" aria-label="扩图" @click.stop="openOutpaint">扩图</el-button>
      <el-button :icon="IconSun" :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl || gridSplit?.splitting" text title="打光" aria-label="打光" @click.stop="openLighting">打光</el-button>
      <el-button :icon="IconCameraRotate" :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl || gridSplit?.splitting" text title="多角度" aria-label="多角度" @click.stop="openMultiAngle">多角度</el-button>
      <el-button :icon="IconLayoutGrid" :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl" :loading="gridSplit?.splitting" text title="宫格切分" aria-label="宫格切分" @click.stop="gridSplit?.open($event)">宫格切分</el-button>
      <el-button :icon="IconTransfer" :loading="uploading" :disabled="generating || deleting || lighting?.generating || multiAngle?.generating || panorama?.busy" text title="替换图片" aria-label="替换图片" @click.stop="fileInput?.click()">替换图片</el-button>
      <imageEditMenu :loading="creatingRotation" :disabled="generating || deleting || uploading || editor?.busy || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl || gridSplit?.splitting" @rotate="createRotation(outputFile)" @crop="startEditor('crop')" @color="startEditor('color')" />
    </template>
    <template #topRightActions>
      <el-button :icon="IconPencil" :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl || gridSplit?.splitting" text title="标记" aria-label="标记" @click.stop="startEditor('mark')" />
    </template>
    <div v-loading="generating || uploading" class="imageContent" :class="{ outpainting: outpaintVisible, nopan: !outpaintVisible }" :aria-busy="generating || uploading">
      <input ref="fileInput" type="file" accept="image/*" hidden aria-label="选择替换图片" :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy" @change="replaceOutput" />
      <div v-if="previewUrl" class="editorPreview" :style="{ visibility: outpaintVisible ? 'hidden' : undefined }">
        <imageEditor
          ref="editor"
          :src="previewUrl"
          :toolbarTarget="editor?.mode === 'smartEdit' ? smartEditToolbar : paintToolbar"
          :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy"
          alt="生成图片"
          @preview="previewVisible = true"
          @load="resizeImage"
          @error="showNodeError('无法预览该图片', '图片预览失败')" />
      </div>
      <div v-else-if="inpaintGuideUrl" class="inpaintGuide">
        <img :src="inpaintGuideUrl" :alt="data.inpaint?.mode === 'outpaint' ? '扩图范围预览' : '局部重绘标注图'" draggable="false" @load="resizeImage" @error="showNodeError('无法读取编辑预览图', '编辑预览读取失败')" />
        <span>{{ data.inpaint?.mode === 'outpaint' ? '画布边缘为待扩展区域' : '红色标注为重绘区域' }}</span>
      </div>
      <div v-else class="imageEmpty" role="img" aria-label="暂无生成图片">
        <icon-photo :size="30" stroke="1.4" aria-hidden="true" />
      </div>
      <imageOutpaint v-if="outpaintVisible" ref="outpaintPrompt" :src="imagePreviewUrl" :target="outpaintTarget" :sourceWidth="imageNaturalWidth" :sourceHeight="imageNaturalHeight" :models="models" :createDraft="createOutpaint" :disabled="generating || deleting || uploading || editor?.busy || lighting?.generating || multiAngle?.generating || panorama?.busy || gridSplit?.splitting" @close="outpaintVisible = false" />
      <mediaHistory
        v-if="node.selected && !editor?.mode && !outpaintVisible"
        mediaType="image"
        inline
        replaceable
        :current="outputFile"
        :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || gridSplit?.splitting"
        @select="outputs.image = { dataType: 'IMAGE', value: $event }"
        @upload="fileInput?.click()" />
    </div>
    <template v-if="editor?.mode !== 'mark' && editor?.mode !== 'crop' && editor?.mode !== 'color'" #bottom>
      <div v-if="lightingVisible" ref="lightingTarget" />
      <div v-else-if="multiAngleVisible" ref="multiAngleTarget" />
      <div v-else-if="editor?.mode === 'smartEdit'" class="smartEditArea">
        <div ref="smartEditToolbar" />
        <imageSmartEdit :editor="editor" :settings="{ model: data.model ?? '', size: data.size ?? '', ratio: data.ratio ?? '' }" :disabled="generating || deleting || uploading" />
      </div>
      <div v-else-if="outpaintVisible" ref="outpaintTarget" />
      <generationPromptPanel v-else>
        <template v-if="editor?.mode !== 'inpaint'" #actions>
          <div ref="providerTarget" />
          <taskRecovery compact :visible="generationState.recoveryVisible.value" :label="generationState.recoveryLabel.value" :action="generationState.recoverResult" :disabled="cancelling || deleting || uploading" />
        </template>
        <el-card class="promptCard" shadow="never" :bodyStyle="{ padding: '14px 16px 12px' }">
          <referenceActions :materials="materialMentions" :selectMaterial="selectMaterialReference" :selectAsset="selectAssetReference" :disabled="generating || deleting || uploading || editor?.busy" />
          <el-button v-if="inpaintGuideUrl && editor?.mode !== 'inpaint'" class="inpaintInfo" text :icon="data.inpaint?.mode === 'outpaint' ? IconArrowsMaximize : IconBrush" @click="inpaintPreviewVisible = true">{{ data.inpaint?.mode === 'outpaint' ? '查看扩图范围' : '查看重绘标注' }}</el-button>
          <referenceItem
            v-if="refList.length"
            v-model="refList"
            @preview="setReferencePreview"
            @remove="removeReference" />
          <promptInput v-if="editor?.mode === 'inpaint'" v-model="data.inpaintPromptModel" v-model:text="data.inpaintPrompt" :references="referenceMentions" :materials="materialMentions" :selectMaterial="selectMaterialReference" :selectAsset="selectAssetReference" expandable />
          <promptInput v-else ref="generationPromptInput" v-model="data.promptModel" v-model:text="data.prompt" :presets="imagePromptPresets" :references="referenceMentions" :materials="materialMentions" :selectMaterial="selectMaterialReference" :selectAsset="selectAssetReference" expandable />
          <div class="promptFooter">
            <providerModelSelect
              v-if="editor?.mode !== 'inpaint'"
              v-model="data.model"
              :models="models"
              :providerTarget="providerTarget"
              :loading="modelsLoading"
              :disabled="generating || deleting"
              noDataText="请先在设置中添加图片模型"
              @open="loadModels().catch(error => showNodeError(error, '模型读取失败'))" />
            <imageGenerationSettings
              v-if="editor?.mode !== 'inpaint'"
              v-model:size="data.size"
              v-model:ratio="data.ratio"
              v-model:other="data.other"
              :model="selectedModel"
              :sizes="sizeOptions"
              :ratios="ratioOptions"
              :disabled="generating || deleting || !selectedModel" />
            <promptPresets v-if="editor?.mode !== 'inpaint'" :presets="imagePromptPresets" :columns="imagePromptPresetColumns" :selected="data.prompt" :disabled="generating || deleting || uploading" @select="insertPromptPreset($event).catch(error => showNodeError(error, '插入提示词预设失败'))" />
            <el-button v-if="editor?.mode === 'inpaint'" class="confirmButton" type="primary" :icon="IconCheck" :loading="editor.busy" :disabled="deleting || uploading || !generationPrompt" @click="confirmInpaint().catch(error => showNodeError(error, '重绘节点创建失败'))">确认</el-button>
            <div v-else class="generationActions">
              <mediaPrice v-if="priceInput" :input="{ ...priceInput, mediaType: 'image' }" :supported="selectedModel?.supportsPrice === true" />
              <el-button v-if="pendingRecovery" class="sendButton" :icon="IconPlayerStop" :loading="cancelling" :disabled="deleting || uploading" title="放弃任务" aria-label="放弃任务" @click="generationState.cancel().catch(error => showNodeError(error, '停止生成失败'))" />
              <el-button
                class="sendButton"
                :icon="generating ? IconPlayerStop : IconArrowUp"
                :disabled="cancelling || deleting || uploading || (!generating && (editor?.busy || (!pendingRecovery && (!generationPrompt || !selectedModel))))"
                :title="generating ? '停止生成' : pendingRecovery ? '复查任务' : '生成图片'"
                :aria-label="generating ? '停止生成' : pendingRecovery ? '复查任务' : '生成图片'"
                @click="generating ? generationState.cancel().catch(error => showNodeError(error, '停止生成失败')) : startGeneration().catch((error) => showNodeError(error, '图片生成失败'))" />
            </div>
          </div>
        </el-card>
      </generationPromptPanel>
    </template>
  </nodeSkeleton>
  <imageLighting v-if="lightingVisible" ref="lighting" :src="imagePreviewUrl" :source="outputFile" :target="lightingTarget" :disabled="generating || deleting || uploading || gridSplit?.splitting" @close="lightingVisible = false" />
  <imageMultiAngle v-if="multiAngleVisible" ref="multiAngle" :src="imagePreviewUrl" :source="outputFile" :target="multiAngleTarget" :disabled="generating || deleting || uploading || gridSplit?.splitting" @close="multiAngleVisible = false" />
  <imagePanorama ref="panorama" :src="imagePreviewUrl" :source="outputFile" :disabled="generating || deleting || uploading || editor?.busy || lighting?.generating || multiAngle?.generating || gridSplit?.splitting" @open="openPanorama" />
  <imageGridSplit ref="gridSplit" :src="imagePreviewUrl" :disabled="generating || deleting || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy" :active="node.selected" />
  <imageViewer v-if="inpaintPreviewVisible && inpaintGuideUrl" :urlList="[inpaintGuideUrl]" :downloadUrl="inpaintGuideUrl" downloadName="inpaint-guide.png" @close="inpaintPreviewVisible = false" />
  <imageViewer
    v-if="previewVisible && previewUrl"
    :urlList="[imagePreviewUrl]"
    :downloadUrl="imagePreviewUrl"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    @close="previewVisible = false" />
</template>

<script setup lang="ts">
import taskRecovery from "@toonflow/node-shared/taskRecovery";
import { computed, inject, nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElButton, ElCard, ElLoading } from "element-plus";
import { IconCheck, IconPhotoAi, IconPhoto, IconArrowUp, IconPlayerStop, IconTransfer, IconLayoutGrid, IconBrush, IconPencil, IconSun, IconCameraRotate, IconPanoramaHorizontal, IconChevronDown, IconSparkles, IconArrowsMaximize } from "@tabler/icons-vue";
import { findNodeModel, getNodeModelIdentity, getNodeModelKey, nodeSkeleton, nodeTools, useNode, useNodeModelSelection, z, type NodeMediaModel, type NodeImageRequest, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import { useNodePersistence } from "@toonflow/nodes-scaffold/nodeDocument";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import { readLastNodeModel, rememberNodeModel } from "@toonflow/node-shared/modelPreference";
import { getMediaMimeType } from "@toonflow/node-shared/mediaTypes";
import providerModelSelect from "@toonflow/node-shared/providerModelSelect";
import eagleMenuItem from "@toonflow/node-shared/eagleMenuItem";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { useNodeGeneration } from "@toonflow/node-shared/useNodeGeneration";
import { useNodeReferences } from "@toonflow/node-shared/useNodeReferences";
import { getModelFormValues, useImageModelForm } from "@toonflow/node-shared/useModelForm";
import promptInput from "@toonflow/node-shared/promptInput";
import promptPresets from "@toonflow/node-shared/promptPresets";
import generationPromptPanel from "@toonflow/node-shared/generationPromptPanel";
import referenceItem from "@toonflow/node-shared/referenceItem";
import referenceActions from "@toonflow/node-shared/referenceActions";
import mediaHistory from "@toonflow/node-shared/mediaHistory";
import mediaPrice from "@toonflow/node-shared/mediaPrice";
import imageGridSplit from "@toonflow/node-image/imageGridSplit";
import imageEditor from "@toonflow/node-image/imageEditor";
import imageSmartEdit from "@toonflow/node-image/imageSmartEdit";
import { useImageRotation } from "@toonflow/node-image/useImageRotation";
import imageEditMenu from "@toonflow/node-image/imageEditMenu";
import { buildInpaintRequest, useImageInpaint, type ImageInpaint } from "@toonflow/node-image/imageInpaint";
import imageLighting from "@toonflow/node-image/imageLighting";
import imagePanorama from "@toonflow/node-image/imagePanorama";
import { buildPanoramaPrompt, panoramaPromptPresets } from "@toonflow/node-image/panoramaPrompt";
import imageMultiAngle from "@toonflow/node-image/imageMultiAngle";
import imageGenerationSettings from "@toonflow/node-shared/imageGenerationSettings";
import imageOutpaint from "@toonflow/node-image/outpaint";
import imageViewer from "@toonflow/node-shared/imageViewer";
import { buildOutpaintPrompt, defaultOutpaintPromptInstruction, readOutpaintPrompt, type OutpaintDraftInput } from "@toonflow/node-image/imageOutpaint";
import { imagePromptPresets, imagePromptPresetColumns, readImagePresetPrompt } from "./imagePromptPresets";

defineOptions({
  inheritAttrs: false,
  icon: IconPhotoAi,
  handles: [
    { id: "in", type: "target", dataType: ["IMAGE", "STRING"], label: "图片、文本输入" },
    { id: "image", type: "source", dataType: "IMAGE", label: "图片输出" },
  ] satisfies NodeHandle[],
});
const vLoading = ElLoading.directive;
const { id, node, nodeProps, nodeEvent, outputs, files, ai, updateNodeInternals } = useNode({
  label: "图片生成",
  onModelsChanged: () => void refreshProviderModels(),
});
const { findNode, nodeTypes, updateNode } = useVueFlow();
const getPersistence = useNodePersistence();
type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;
const data = computed(() => node.data as { prompt: string; promptModel: PromptModel; inpaintPrompt: string; inpaintPromptModel: PromptModel; model: string; size: string; ratio: string; other: Record<string, unknown>; inpaint?: ImageInpaint; mediaTask?: { state: string; applied?: boolean } });
const generationPromptInput = ref<InstanceType<typeof promptInput>>();
data.value.prompt ??= "";
data.value.promptModel ??= [];
data.value.inpaintPrompt ??= "";
data.value.inpaintPromptModel ??= [];
data.value.model ??= "";
data.value.size ??= "";
data.value.ratio ??= "16:9";
data.value.other ??= {};
if (data.value.inpaint?.mode === "outpaint") {
  const savedPrompt = readOutpaintPrompt(data.value.prompt);
  if (savedPrompt.prompt !== data.value.prompt) {
    if (savedPrompt.context) data.value.inpaint.outpaintContext = savedPrompt.context;
    data.value.prompt = savedPrompt.prompt;
    data.value.promptModel = savedPrompt.prompt.split("\n").map(text => [{ type: "Write", text }]);
  }
}
const readPresetPrompt = inject<(id: string) => string>("imagePresetPromptInstruction", id => readImagePresetPrompt(undefined, id));
const readOutpaintInstruction = inject<() => string>("imageOutpaintPromptInstruction", () => defaultOutpaintPromptInstruction);
const previousPanoramaPreset = panoramaPromptPresets.find(preset => buildPanoramaPrompt(preset.mode) === data.value.prompt.trim());
if (previousPanoramaPreset) {
  data.value.prompt = previousPanoramaPreset.value + " ";
  data.value.promptModel = [[{ type: "Write", text: data.value.prompt }]];
}

const { refList, referenceMentions, materialMentions, selectMaterialReference, selectAssetReference, setReferencePreview, removeReference } = useNodeReferences();
const models = shallowRef<NodeMediaModel[]>([]);
const modelsLoading = ref(false);
const providerTarget = ref<HTMLElement>();
const uploading = ref(false);
const fileInput = ref<HTMLInputElement>();
const { createRotation, creatingRotation } = useImageRotation();
const gridSplit = ref<InstanceType<typeof imageGridSplit>>();
const editor = ref<InstanceType<typeof imageEditor>>();
const outpaintPrompt = ref<InstanceType<typeof imageOutpaint>>();
const outpaintTarget = ref<HTMLElement>();
const outpaintVisible = ref(false);
const generateInpaint = useImageInpaint((input, signal, recoveryData) => generationState.generate("image", input, signal, recoveryData));
const paintToolbar = ref<HTMLElement>();
const lighting = ref<InstanceType<typeof imageLighting>>();
const lightingTarget = ref<HTMLElement>();
const lightingVisible = ref(false);
const multiAngle = ref<InstanceType<typeof imageMultiAngle>>();
const multiAngleTarget = ref<HTMLElement>();
const multiAngleVisible = ref(false);
const panorama = ref<InstanceType<typeof imagePanorama>>();
let disposed = false;
const deleting = ref(false);
const previewVisible = ref(false);
const inpaintPreviewVisible = ref(false);
const smartEditToolbar = ref<HTMLElement>();
const imageWidth = ref(0);
const imageResolution = ref("");
const imageNaturalWidth = ref(0);
const imageNaturalHeight = ref(0);
let generationController: AbortController | undefined;
const generationState = useNodeGeneration(outputs, () => generationController?.abort(), {
  ai,
  async recover(results, task, signal) {
    if (!task.recoveryData) return results;
    const recovery = task.recoveryData as { input: NodeImageRequest; inpaint: ImageInpaint };
    if (!recovery.input || !recovery.inpaint) throw new Error("局部重绘任务缺少恢复素材");
    return generateInpaint(recovery.input, recovery.inpaint, signal, results.filter(result => result.mediaType === "image"));
  },
});
const { generating, pendingRecovery, cancelling } = generationState;
let generation: Promise<void> | undefined;
let modelsRequest: Promise<void> | undefined;
watch(generating, value => { if (!value && !disposed && !deleting.value && !models.value.length) void loadModels().catch(error => showNodeError(error, "模型读取失败")); });
const selectedModel = useNodeModelSelection(models, computed({ get: () => data.value.model, set: value => { data.value.model = value; } }));
const { sizeOptions, ratioOptions } = useImageModelForm(data, selectedModel);
const modelGroups = computed(() => groupNodeModels(models.value));
async function insertPromptPreset(id: string) {
  if (generating.value || deleting.value || uploading.value || !generationPromptInput.value) return;
  const preset = imagePromptPresets.find(item => item.id === id);
  if (!preset) return;
  if ("ratio" in preset && selectedModel.value && !ratioOptions.value.includes(preset.ratio)) {
    throw new Error(`${preset.label}需要 ${preset.ratio} 比例，当前模型不支持，请先选择支持此比例的模型`);
  }
  if (!await generationPromptInput.value.insertPreset(id)) return;
  if ("ratio" in preset) data.value.ratio = preset.ratio;
}
const generationPrompt = computed(() => {
  const prompt = (editor.value?.mode === "inpaint" ? data.value.inpaintPrompt : data.value.prompt).trim().replace(/\{\{preset ([a-zA-Z0-9]+)\}\}/g, (value, id: string) => {
    const preset = imagePromptPresets.find(item => item.id === id);
    if (!preset) return value;
    return readPresetPrompt(preset.id);
  });
  return [
    editor.value?.mode !== "inpaint" && data.value.inpaint?.mode === "outpaint" ? buildOutpaintPrompt(prompt, data.value.inpaint.outpaintContext, readOutpaintInstruction()) : prompt,
    ...refList.value.flatMap((item, index) => (item.dataType === "STRING" && item.value?.trim() ? [`参考 ${index + 1}：\n${item.value.trim()}`] : [])),
  ]
    .filter(Boolean)
    .join("\n\n");
});
const generationInput = computed<Omit<NodeImageRequest, "directory"> | undefined>(() => {
  const choice = selectedModel.value;
  if (!choice) return;
  const inpaint = data.value.inpaint;
  const references = refList.value.filter(item => !inpaint || item.dataType !== "IMAGE" || item.value?.url !== inpaint.source);
  const input = {
    ...getNodeModelIdentity(choice),
    prompt: generationPrompt.value,
    size: data.value.size,
    ratio: data.value.ratio,
    other: Object.keys(data.value.other).length ? { ...data.value.other } : undefined,
    outputDirectory: `assets/${id}`,
    images: references.flatMap(item => item.dataType === "IMAGE" && item.value ? [{ path: item.value.url, mimeType: item.value.mimeType }] : []),
  };
  if (inpaint) {
    let imageIndex = (inpaint.mode === "outpaint" ? 2 : 3) + (inpaint.images?.length ?? 0);
    const mapping = refList.value.flatMap((item, index) => item.dataType === "IMAGE" && item.value
      ? [`参考 ${index + 1} / {{ref ${index + 1}}} 对应第 ${item.value.url === inpaint.source ? 1 : imageIndex++} 张图`] : []);
    if (mapping.length) input.prompt += `\n当前节点参考编号对应关系：${mapping.join("；")}。`;
  }
  return input;
});
const priceInput = computed(() => {
  const input = generationInput.value;
  const inpaint = data.value.inpaint;
  if (!input || inpaint && !Array.isArray(inpaint.images)) return;
  return inpaint ? buildInpaintRequest(input, inpaint, inpaint.mode === "outpaint" ? readOutpaintInstruction() : undefined) : input;
});
const outputFile = computed(() => outputs.value.image?.dataType === "IMAGE" ? outputs.value.image.value : undefined);
watch([outputFile, () => data.value.inpaint?.guide], () => { imageResolution.value = ""; imageNaturalWidth.value = imageNaturalHeight.value = 0; outpaintVisible.value = false; }, { flush: "sync" });
const nodePreviewStyle = computed(() => ({
  width: outputFile.value || data.value.inpaint?.guide ? (imageWidth.value ? `${imageWidth.value + 6}px` : undefined) : undefined,
}));
watch(() => data.value.ratio, async () => {
  if (outputFile.value || data.value.inpaint?.guide) return;
  const style = typeof node.style === "function" ? node.style(node) : node.style;
  if (style?.width || style?.height) {
    const { width, height, ...rest } = style;
    node.style = rest;
  }
  await nextTick();
  updateNodeInternals();
});
const inpaintGuideUrl = files.useFileUrl(
  () => data.value.inpaint?.guide ? { url: data.value.inpaint.mode === "outpaint" ? data.value.inpaint.original : data.value.inpaint.guide, mimeType: "image/png" } : undefined,
  error => showNodeError(error, "重绘标注读取失败")
);
const previewUrl = files.useFileUrl(
  outputFile,
  (error) => showNodeError(error, "图片读取失败")
);
const imagePreviewUrl = computed(() => editor.value?.previewSrc || previewUrl.value);
let convertingResult = false;
watch([generating, outputFile, () => data.value.mediaTask?.state, () => data.value.mediaTask?.applied, () => nodeTypes?.value?.["remote-imageNode"]], async () => {
  if (disposed || convertingResult || generating.value || deleting.value || findNode(id) !== node || node.type !== "remote-imageGenerationNode"
    || data.value.inpaint?.mode !== "outpaint" || !outputFile.value
    || data.value.mediaTask?.state !== "succeeded" || !data.value.mediaTask.applied || !nodeTypes?.value?.["remote-imageNode"]) return;
  const context = getPersistence?.();
  if (!context) return;
  convertingResult = true;
  try {
    updateNode(id, { type: "remote-imageNode", data: { ...node.data, outputs: { ...outputs.value } } });
    await nextTick();
    await context.save();
  } catch (error) { showNodeError(error, "扩图结果已保留，图片节点保存失败"); }
}, { immediate: true, flush: "post" });

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
  if (!file || generating.value || deleting.value || uploading.value || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy || disposed) return;
  const mimeType = getMediaMimeType(file);
  if (!mimeType.startsWith("image/")) return void showNodeError("请选择图片文件", "图片替换失败");
  if (!file.size || file.size > 100 * 1024 * 1024) return void showNodeError("图片不能为空且不能超过 100 MB", "图片替换失败");
  uploading.value = true;
  try {
    const workspace = files.getWorkspaceFiles();
    const url = await files.uploadFile(file);
    if (disposed) {
      await workspace.remove(url);
      return;
    }
    // ACT: 保留历史输出文件，避免破坏撤销记录和复制节点的引用。
    outputs.value.image = { dataType: "IMAGE", value: { url, mimeType } };
  } catch (error) {
    showNodeError(error, "图片替换失败");
  } finally {
    uploading.value = false;
  }
}

function loadModels() {
  if (modelsRequest) return modelsRequest;
  modelsLoading.value = true;
  modelsRequest = ai.getMediaModels().then((items) => {
    if (disposed || generating.value || deleting.value) return;
    models.value = items.filter((item) => item.type === "image");
    // ACT: 只给空配置选默认模型，保留暂时不可用的旧选择及其参数。
    if (!data.value.model) {
      const first = readLastNodeModel("image", models.value) ?? modelGroups.value[0]?.models[0];
      data.value.model = first ? getNodeModelKey(first) : "";
    }
  }).finally(() => {
    modelsLoading.value = false;
    modelsRequest = undefined;
  });
  return modelsRequest;
}

async function confirmInpaint() {
  const inpaintEditor = editor.value;
  if (!inpaintEditor || inpaintEditor.mode !== "inpaint") throw new Error("请先进入局部重绘");
  if (inpaintEditor.busy || generating.value || deleting.value || uploading.value) return;
  if (!generationPrompt.value) throw new Error("请输入重绘提示词");
  if (refList.value.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
  let prompt = generationPrompt.value.replace(/\{\{ref (\d+)\}\}/g, "重绘参考 $1").replace(/^参考 (\d+)：/gm, "重绘参考 $1：");
  const images = refList.value.flatMap(item => item.dataType === "IMAGE" && item.value ? [{ path: item.value.url, mimeType: item.value.mimeType }] : []);
  const imageReferences = refList.value.flatMap((item, index) => item.dataType === "IMAGE" && item.value ? [index + 1] : []);
  if (imageReferences.length) prompt += `\n重绘参考编号对应关系（前两张为原图和区域引导图）：${imageReferences.map((reference, index) => `重绘参考 ${reference} 对应第 ${index + 3} 张图`).join("；")}。`;
  await inpaintEditor.createInpaint({ prompt, images }, new AbortController().signal);
}

async function startGeneration() {
  if (cancelling.value) throw new Error("任务正在取消，请稍后重试");
  if (generating.value) throw new Error("图片正在生成，请等待完成");
  if (panorama.value?.visible) throw new Error("请先关闭全景图，再启动图片生成");
  if (uploading.value) throw new Error("图片正在替换，请等待完成");
  if (deleting.value) throw new Error("节点正在删除");
  if (outpaintVisible.value) throw new Error("请先完成或关闭扩图面板");
  if (lightingVisible.value) throw new Error("请先退出打光，再启动图片生成");
  if (multiAngleVisible.value) throw new Error("请先退出多角度，再启动图片生成");
  if (editor.value?.busy || editor.value?.mode === "mark") throw new Error("请先完成图片标记");
  if (editor.value?.mode === "crop") throw new Error("请先确认或退出图片裁剪");
  if (editor.value?.mode === "inpaint") throw new Error("请先确认局部重绘，再到子节点生成");
  if (pendingRecovery.value) {
    generation = generationState.resume().catch(error => showNodeError(error, "图片任务复查失败"));
    return { status: "generating" };
  }
  const panoramas = panoramaPromptPresets.filter(preset => data.value.prompt.includes(preset.value));
  if (panoramas.length > 1) throw new Error("720全景和360环绕的比例要求不同，请只保留其中一个全景预设");
  const panoramaPreset = panoramas[0];
  if (panoramaPreset && selectedModel.value && !ratioOptions.value.includes(panoramaPreset.ratio)) {
    throw new Error(`${panoramaPreset.label}需要 ${panoramaPreset.ratio} 比例，当前模型不支持，请更换模型`);
  }
  if (panoramaPreset && data.value.ratio !== panoramaPreset.ratio) {
    throw new Error(`${panoramaPreset.label}需要 ${panoramaPreset.ratio} 比例，请在规格中调整后再生成`);
  }
  const input = generationInput.value;
  if (!generationPrompt.value) throw new Error("请输入生成提示词");
  const references = refList.value.filter(item => !data.value.inpaint || item.dataType !== "IMAGE" || item.value?.url !== data.value.inpaint.source);
  if (references.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
  if (!input) throw new Error("请先选择图片模型");
  const workspace = files.getWorkspaceFiles();
  const controller = new AbortController();
  const inpaintData = data.value.inpaint;
  if (selectedModel.value) rememberNodeModel(selectedModel.value);
  generationController = controller;
  // ACT: 工具立即返回；任务身份先保存，卸载只停止等待，重新打开后复查。
  generation = generationState.run(() => workspace.list()
    .then(({ directory }) => {
      controller.signal.throwIfAborted();
      return inpaintData
        ? generateInpaint({ ...input, directory }, inpaintData, controller.signal)
        : generationState.generate("image", { ...input, directory }, controller.signal);
    })
    .then(([result]) => {
      controller.signal.throwIfAborted();
      if (!result) throw new Error("供应商未返回图片");
      outputs.value.image = { dataType: "IMAGE", value: { url: result.path, mimeType: result.mimeType } };
    }))
    .catch((error) => showNodeError(error, "图片生成失败"))
    .finally(() => {
      generationController = undefined;
    });
  return { status: "generating" };
}

nodeEvent.on("save", (reason) => {
  if (reason === "reload" && (editor.value?.mode === "smartEdit" || generating.value || uploading.value || deleting.value || editor.value?.busy || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy)) throw new Error("图片处理中，请完成后再刷新节点");
});
nodeEvent.on("delete", async () => {
  if (editor.value?.mode === "smartEdit") throw new Error("请先退出智能改图，再删除图片生成节点");
  if (uploading.value || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy || (editor.value?.busy && !generating.value)) throw new Error("图片处理中，请稍后删除节点");
  deleting.value = true;
  try {
    await generationState.cancel(false);
    await generation;
    await files.removeNodeFiles();
  } finally {
    deleting.value = false;
  }
});

async function resizeImage(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  if (!image.naturalWidth || !image.naturalHeight) return;
  imageResolution.value = `${image.naturalWidth} × ${image.naturalHeight}`;
  imageNaturalWidth.value = image.naturalWidth;
  imageNaturalHeight.value = image.naturalHeight;
  imageWidth.value = (240 * image.naturalWidth) / image.naturalHeight;
  await nextTick();
  updateNodeInternals();
}

function openPanorama() {
  outpaintVisible.value = false;
  editor.value?.cancel();
  lightingVisible.value = false;
  multiAngleVisible.value = false;
}

function openLighting() {
  if (generating.value || deleting.value || uploading.value || editor.value?.busy || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy || gridSplit.value?.splitting || !previewUrl.value) return;
  editor.value?.cancel();
  outpaintVisible.value = false;
  multiAngleVisible.value = false;
  lightingVisible.value = true;
}

function openMultiAngle() {
  if (generating.value || deleting.value || uploading.value || editor.value?.busy || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy || gridSplit.value?.splitting || !previewUrl.value) return;
  editor.value?.cancel();
  outpaintVisible.value = false;
  lightingVisible.value = false;
  multiAngleVisible.value = true;
}

function startEditor(mode: "inpaint" | "mark" | "smartEdit" | "crop" | "color") {
  if (generating.value || deleting.value || uploading.value || editor.value?.busy || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy || gridSplit.value?.splitting) return;
  lightingVisible.value = false;
  multiAngleVisible.value = false;
  outpaintVisible.value = false;
  editor.value?.start(mode);
}

function openOutpaint() {
  if (generating.value || deleting.value || uploading.value || editor.value?.busy || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy || gridSplit.value?.splitting || !previewUrl.value) return;
  editor.value?.cancel();
  lightingVisible.value = false;
  multiAngleVisible.value = false;
  outpaintVisible.value = true;
}

async function createOutpaint(input: OutpaintDraftInput, signal: AbortSignal) {
  if (!editor.value) throw new Error("请先等待图片加载完成");
  return editor.value.createOutpaint(input, signal);
}

function getConfig() {
  return {
    config: {
      providerId: selectedModel.value?.providerId ?? "",
      modelId: selectedModel.value?.modelId ?? "",
      size: data.value.size,
      ratio: data.value.ratio,
      other: { ...data.value.other },
    },
    models: models.value,
  };
}

nodeTools.register({
  name: "getConfig",
  description: "读取此图片生成节点的当前模型、分辨率、比例、自定义配置 other 及可选图片模型能力，models 中的 rules 声明自定义字段，不含密钥；未声明分辨率或比例时分别使用 2K、16:9",
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
  description: "修改此图片生成节点的模型、分辨率、比例或自定义配置 other；先用 getConfig 查询可选能力，providerId 与 modelId 必须同时提供；other 按目标模型 rules 的 field 和值要求填写，仅更新传入字段，其余保留，切换模型时使用新模型默认值；不修改提示词、不启动生成",
  parameters: z.strictObject({
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    size: z.string().min(1).optional(),
    ratio: z.string().min(1).optional(),
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
    if (!choice) throw new Error("请选择 getConfig 返回的有效图片模型");
    const sizes = choice.imageSizes?.length ? choice.imageSizes : ["2K"];
    const ratios = choice.imageRatios?.length ? choice.imageRatios : ["16:9"];
    if (args.size !== undefined && !sizes.includes(args.size)) throw new Error(`当前模型不支持分辨率 ${args.size}，可选：${sizes.join("、")}`);
    if (args.ratio !== undefined && !ratios.includes(args.ratio)) throw new Error(`当前模型不支持比例 ${args.ratio}，可选：${ratios.join("、")}`);
    const other = getModelFormValues(choice, choice === selectedModel.value ? data.value.other : {}, args.other);
    data.value.model = getNodeModelKey(choice);
    if (args.size !== undefined) data.value.size = args.size;
    if (args.ratio !== undefined) data.value.ratio = args.ratio;
    data.value.other = other;
    rememberNodeModel(choice);
    return getConfig();
  },
});

nodeTools.register({
  name: "setPrompt",
  description: "修改此节点的普通图片生成提示词，仅接收 prompt，支持 {{ref 1}} 等参考标记；分辨率 size、比例 ratio 等配置须先用 node:getConfig 查询能力，再单独调用 node:setConfig；不修改局部重绘提示词，不启动生成",
  parameters: z.strictObject({ prompt: z.string() }),
  execute({ prompt: value }) {
    if (deleting.value) throw new Error("节点正在删除，请稍后修改");
    data.value.prompt = value;
    data.value.promptModel = value.split("\n").map((text) => [{ type: "Write", text }]);
    return { prompt: value };
  },
});

nodeTools.register({
  name: "generateImage",
  description: "启动此节点的后台普通图片生成，使用普通生成提示词、模型、分辨率、比例和参考图片；局部重绘模式下须先退出；立即返回已开始，用 getGenerationStatus 查询完成结果，cancelGeneration 停止生成",
  parameters: z.strictObject({}),
  execute(_args, { signal }) {
    signal?.throwIfAborted();
    return startGeneration();
  },
});
</script>

<style scoped lang="scss">
.panoramaButton {
  &[aria-expanded="true"] .menuChevron { transform: rotate(180deg); }
}

.imageContent {
  &.outpainting { overflow: visible; }
  .editorPreview { width: 100%; height: 100%; }
  .nodeSkeleton.resized & {
    height: 100%;
    min-height: 0;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);

    .inpaintGuide,
    .imageEmpty {
      height: 100%;
      min-height: 0;
    }

    .inpaintGuide img { height: 100%; object-fit: contain; }
  }

  position: relative;
  display: grid;
  place-items: center;
  min-height: 144px;
  overflow: hidden;
  border-radius: var(--el-border-radius-base);

  .inpaintGuide {
    position: relative;
    width: 100%;
    img { display: block; width: 100%; }
    span { position: absolute; bottom: 8px; left: 8px; padding: 4px 8px; border-radius: 4px; background: #0009; color: #fff; font-size: 12px; }
  }

  .imageEmpty {
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
  .inpaintInfo { margin-bottom: 8px; }
  .promptFooter {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;

    .confirmButton { margin-left: auto; }

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
        border-radius: 10px;
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

.smartEditArea { display: grid; justify-items: center; gap: 8px; }
</style>
