<template>
  <div v-if="active" class="layerSplit">
    <div class="splitToolbar nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop role="toolbar" aria-label="图层分离工具">
      <el-button :icon="IconX" text title="退出图层分离" aria-label="退出图层分离" :disabled="splitting" @click="close" />
      <span><component :is="IconStack2" :size="16" aria-hidden="true" />图层分离</span>
      <template v-if="mode === 'selection'">
        <el-button :icon="IconArrowBackUp" text title="撤销框选" aria-label="撤销框选" :disabled="splitting || !selectionUndo.length" @click="undoSelection" />
        <el-button :icon="IconArrowForwardUp" text title="重做框选" aria-label="重做框选" :disabled="splitting || !selectionRedo.length" @click="redoSelection" />
      </template>
    </div>
    <section class="splitPanel nodrag nopan nowheel" aria-label="图层分离" @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop @keydown.esc.stop.prevent="close">
      <el-input
        v-if="mode === 'description'" v-model="prompt" class="splitDescription" type="textarea" :rows="2" resize="none"
        :disabled="splitting" placeholder="描述要拆分的元素，例如人物和背景" aria-label="图层分离描述" />
      <div class="splitActions">
        <div class="modeSwitch" role="group" aria-label="拆分方式">
          <button type="button" :aria-pressed="mode === 'auto'" :disabled="splitting" @click="mode = 'auto'">
            <icon-stack2 :size="15" aria-hidden="true" />智能拆分
          </button>
          <button type="button" :aria-pressed="mode === 'selection'" :disabled="splitting" @click="mode = 'selection'">
            <icon-marquee :size="15" aria-hidden="true" />框选拆分
          </button>
          <button type="button" :aria-pressed="mode === 'description'" :disabled="splitting" @click="mode = 'description'">
            <icon-pencil :size="15" aria-hidden="true" />按描述拆分
          </button>
        </div>
        <div class="splitSubmit">
          <label class="extractText" title="请模型将图中文字作为独立图片图层返回">
            <el-switch v-model="extractText" size="small" :disabled="splitting" aria-label="提取文字图层" />
            提取文字
          </label>
          <el-button class="confirmSplit" type="primary" :loading="splitting" :disabled="!canSplit" @click="splitLayers">
            {{ splitting ? '正在拆分' : '确认拆分' }}
          </el-button>
        </div>
      </div>
    </section>
  </div>
  <teleport v-if="active && target && mode === 'selection'" :to="target">
    <div ref="selectionSurface" class="layerSelectionSurface nodrag nopan nowheel" @pointerdown.stop.prevent="startSelection" @pointermove.stop.prevent="moveSelection" @pointerup.stop="finishSelection" @pointercancel.stop="cancelSelection" @lostpointercapture="cancelSelection">
      <img :src="src" alt="框选要拆分的元素" draggable="false" @load="readImageSize" />
      <div v-for="(rect, index) in selections" :key="index" class="selectionBox" :style="selectionStyle(rect)"><small>{{ index + 1 }}</small></div>
      <span v-if="!selections.length" class="selectionHint">在图片上拖动框选，可框选多个区域</span>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElButton, ElInput, ElMessage, ElSwitch } from "element-plus";
import { IconArrowBackUp, IconArrowForwardUp, IconMarquee, IconPencil, IconStack2, IconX } from "@tabler/icons-vue";
import { useNode, useNodeAi, useNodeFiles, uploadNodeFile } from "@toonflow/nodes-scaffold/runtime";
import { getMediaPreviewSize } from "@toonflow/node-shared/mediaPreviewSize";
import { showNodeError } from "@toonflow/node-shared/showNodeError";

type Selection = { x: number; y: number; width: number; height: number };
const props = defineProps<{ src: string; source?: { url: string; mimeType: string }; target?: HTMLElement; disabled?: boolean }>();
const { id, node } = useNode();
const { addNodes, addEdges, findNode, fitBounds, getNodes, nodeTypes } = useVueFlow();
const ai = useNodeAi();
const files = useNodeFiles();
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
const getCanvas = inject<() => { id: string } | undefined>("canvas");
const active = ref(false);
const mode = ref<"auto" | "description" | "selection">("auto");
const prompt = ref("");
const extractText = ref(false);
const splitting = ref(false);
const selectionSurface = ref<HTMLElement>();
const imageSize = ref({ width: 0, height: 0 });
const selections = ref<Selection[]>([]);
const selectionUndo = ref<Selection[][]>([]);
const selectionRedo = ref<Selection[][]>([]);
const drag = ref<{ pointerId: number; x: number; y: number }>();
const canSplit = computed(() => !props.disabled
  && (mode.value !== "description" || !!prompt.value.trim())
  && (mode.value !== "selection" || (!drag.value && selections.value.length > 0)));
let splitController: AbortController | undefined;
function selectionStyle(rect: Selection) {
  return { left: `${rect.x / imageSize.value.width * 100}%`, top: `${rect.y / imageSize.value.height * 100}%`,
    width: `${rect.width / imageSize.value.width * 100}%`, height: `${rect.height / imageSize.value.height * 100}%` };
}

onBeforeUnmount(() => splitController?.abort());

function open() {
  if (props.disabled || !props.source?.url || !props.src) return;
  mode.value = "auto";
  prompt.value = "";
  extractText.value = false;
  selections.value = [];
  selectionUndo.value = [];
  selectionRedo.value = [];
  active.value = true;
}

function close() {
  if (splitting.value) return;
  active.value = false;
  drag.value = undefined;
}

function readImageSize(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  imageSize.value = { width: image.naturalWidth, height: image.naturalHeight };
}

function pointerPosition(event: PointerEvent) {
  const bounds = selectionSurface.value!.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(imageSize.value.width, (event.clientX - bounds.left) / bounds.width * imageSize.value.width)),
    y: Math.max(0, Math.min(imageSize.value.height, (event.clientY - bounds.top) / bounds.height * imageSize.value.height)),
  };
}

function startSelection(event: PointerEvent) {
  if (mode.value !== "selection" || splitting.value || drag.value || !event.isPrimary || event.button !== 0 || !imageSize.value.width) return;
  const point = pointerPosition(event);
  drag.value = { pointerId: event.pointerId, ...point };
  selectionSurface.value?.setPointerCapture(event.pointerId);
  selections.value.push({ x: point.x, y: point.y, width: 0, height: 0 });
}

function moveSelection(event: PointerEvent) {
  const start = drag.value;
  if (!start || start.pointerId !== event.pointerId) return;
  const point = pointerPosition(event);
  const index = selections.value.length - 1;
  selections.value[index] = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) };
}

function finishSelection(event: PointerEvent) {
  if (drag.value?.pointerId !== event.pointerId) return;
  moveSelection(event);
  drag.value = undefined;
  const last = selections.value.at(-1);
  if (last && (last.width < 2 || last.height < 2)) {
    selections.value.pop();
    return;
  }
  selectionUndo.value.push(selections.value.slice(0, -1));
  selectionRedo.value = [];
}

function cancelSelection(event: PointerEvent) {
  if (drag.value?.pointerId !== event.pointerId) return;
  drag.value = undefined;
  selections.value.pop();
}

function undoSelection() {
  if (!selectionUndo.value.length || splitting.value || drag.value) return;
  selectionRedo.value.push(selections.value.map(rect => ({ ...rect })));
  selections.value = selectionUndo.value.pop()!;
}

function redoSelection() {
  if (!selectionRedo.value.length || splitting.value || drag.value) return;
  selectionUndo.value.push(selections.value.map(rect => ({ ...rect })));
  selections.value = selectionRedo.value.pop()!;
}

async function splitLayers() {
  if (splitting.value || !canSplit.value || !props.source?.url || !props.src || !active.value) return;
  if (!nodeTypes?.value?.["remote-imageLayerNode"]) return void ElMessage.error("请先启用图层分离节点");
  splitting.value = true;
  const controller = splitController = new AbortController();
  const referenceNodeId = `${id}-layerReference-${crypto.randomUUID()}`;
  const layerNodeId = crypto.randomUUID();
  const outputDirectory = `assets/${layerNodeId}`;
  const canvasId = getCanvas?.()?.id;
  const selectionMode = mode.value === "selection";
  const splitPrompt = mode.value === "description" ? prompt.value.trim()
    : selectionMode ? "仅将输入图中保留的选框区域元素拆分成独立图层。"
    : "将输入图片中的主要元素拆分成独立图层。";
  const taskPrompt = extractText.value
    ? `${splitPrompt}\n将目标范围内可辨认的文字单独拆为透明图片图层，尽量保持原文字、样式与位置，并在下方图层移除这些文字。没有可辨认文字时不要添加文字。`
    : splitPrompt;
  let workspace: ReturnType<typeof files.getWorkspaceFiles> | undefined;
  let resultNode: typeof node | undefined;
  try {
    workspace = files.getWorkspaceFiles();
    if (findNode(id) !== node || (canvasId && getCanvas?.()?.id !== canvasId)) throw new Error("画布已切换，请重新分离图层");
    const previewWidth = 260;
    const resultWidth = previewWidth + 156 + 2;
    const resultHeight = previewWidth + 18;
    const nodeX = node.computedPosition.x;
    const nodeY = node.computedPosition.y;
    const nodeWidth = node.dimensions.width;
    const nodeHeight = node.dimensions.height;
    const spacing = 24;
    const candidates = [
      { x: nodeX + nodeWidth + spacing, y: nodeY },
      { x: nodeX, y: nodeY + nodeHeight + spacing },
      { x: nodeX - resultWidth - spacing, y: nodeY },
      { x: nodeX, y: nodeY - resultHeight - spacing },
    ];
    const otherNodes = getNodes.value.filter(other => other.id !== id);
    const position = candidates.find(candidate => otherNodes.every(other => {
      const otherPosition = other.computedPosition;
      return candidate.x + resultWidth <= otherPosition.x || candidate.x >= otherPosition.x + other.dimensions.width
        || candidate.y + resultHeight <= otherPosition.y || candidate.y >= otherPosition.y + other.dimensions.height;
    })) ?? candidates[0]!;
    const layerNode = {
      id: layerNodeId,
      type: "remote-imageLayerNode",
      position,
      data: {
        label: `${node.data.label || "图片"} · 图层分离`,
        layers: [],
        canvasWidth: 1,
        canvasHeight: 1,
        previewWidth,
        splitStatus: "processing",
      },
    };
    await batchHistory(async () => {
      controller.signal.throwIfAborted();
      if (findNode(id) !== node || (canvasId && getCanvas?.()?.id !== canvasId)) throw new Error("画布已切换，请重新分离图层");
      addNodes(layerNode);
      resultNode = findNode(layerNodeId);
      if (!resultNode) throw new Error("无法创建图层分离节点");
      addEdges({ id: crypto.randomUUID(), source: id, sourceHandle: "image", target: layerNodeId, targetHandle: "in" });
    });
    await fitBounds({
      x: Math.min(nodeX, position.x),
      y: Math.min(nodeY, position.y),
      width: Math.max(nodeX + nodeWidth, position.x + resultWidth) - Math.min(nodeX, position.x),
      height: Math.max(nodeY + nodeHeight, position.y + resultHeight) - Math.min(nodeY, position.y),
    }, { padding: 0.12, duration: 250 }).catch(() => {});
    const { directory } = await workspace.list();
    let referenceFile: File;
    if (selectionMode) {
      const sourceImage = new Image();
      sourceImage.src = props.src;
      await sourceImage.decode();
      controller.signal.throwIfAborted();
      const left = Math.floor(Math.min(...selections.value.map(rect => rect.x)));
      const top = Math.floor(Math.min(...selections.value.map(rect => rect.y)));
      const right = Math.ceil(Math.max(...selections.value.map(rect => rect.x + rect.width)));
      const bottom = Math.ceil(Math.max(...selections.value.map(rect => rect.y + rect.height)));
      const canvas = document.createElement("canvas");
      canvas.width = right - left;
      canvas.height = bottom - top;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法创建选区图片");
      for (const rect of selections.value) context.drawImage(sourceImage, rect.x, rect.y, rect.width, rect.height, rect.x - left, rect.y - top, rect.width, rect.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("选区图片生成失败")), "image/png"));
      sourceImage.removeAttribute("src");
      canvas.width = canvas.height = 0;
      referenceFile = new File([blob], "selection.png", { type: "image/png" });
    } else {
      const response = await fetch(props.src, { signal: controller.signal });
      if (!response.ok) throw new Error("无法读取待拆分图片");
      referenceFile = new File([await response.blob()], "source-image", { type: props.source.mimeType });
    }
    controller.signal.throwIfAborted();
    const sourceBitmap = await createImageBitmap(referenceFile);
    const sourceRatio = sourceBitmap.width / sourceBitmap.height;
    sourceBitmap.close();
    const ratioOptions = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "5:4", "4:5", "21:9"];
    const ratio = ratioOptions.map(value => ({ value, number: value.split(":").map(Number).reduce((width, height) => width / height) }))
      .sort((left, right) => Math.abs(Math.log(left.number / sourceRatio)) - Math.abs(Math.log(right.number / sourceRatio)))[0]!.value;
    const referencePath = await uploadNodeFile(workspace, referenceNodeId, referenceFile);
    await workspace.mkdir("assets").catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
      if (error.response?.data?.data?.code !== "EEXIST") throw error;
    });
    await workspace.mkdir(outputDirectory);
    const results = await ai.generateImage({
      directory,
      providerId: "tokenGo",
      modelId: "doubao-seedream-5-5",
      prompt: taskPrompt,
      ratio,
      outputDirectory,
      images: [{ path: referencePath, mimeType: referenceFile.type }],
      other: { layerDecomposition: true },
    }, controller.signal);
    controller.signal.throwIfAborted();
    if (!results.length) throw new Error("模型未返回可预览的图片");
    const layers = [];
    let canvasSize = { width: 0, height: 0 };
    for (const [index, result] of results.entries()) {
      controller.signal.throwIfAborted();
      if (index === 0) {
        const bytes = await workspace.read(result.path);
        const blob = new Blob([bytes], { type: result.mimeType });
        const bitmap = await createImageBitmap(blob);
        canvasSize = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
      }
      controller.signal.throwIfAborted();
      layers.push({ id: crypto.randomUUID(), label: result.imageLayer?.name || `图层 ${index + 1}`, url: result.path, mimeType: result.mimeType, visible: true,
        ...(result.imageLayer ? { imageLayer: result.imageLayer } : {}) });
    }

    if (!resultNode || findNode(layerNodeId) !== resultNode || (canvasId && getCanvas?.()?.id !== canvasId)
      || !nodeTypes?.value?.["remote-imageLayerNode"]) throw new Error("画布节点已变化，请重新分离图层");
    const previewSize = getMediaPreviewSize(canvasSize.width, canvasSize.height);
    const completedPreviewWidth = Math.max(160, previewSize.width + 16);
    const completedPanelWidth = completedPreviewWidth + 156;
    Object.assign(resultNode.data, {
      layers,
      referenceImage: { url: referencePath, mimeType: referenceFile.type },
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      previewWidth: completedPreviewWidth,
      splitStatus: "completed",
      splitError: "",
    });
    active.value = false;
    if (layers.length === 1) ElMessage.warning("模型本次只返回了 1 张图片，已保存到图层分离节点");
    else ElMessage.success(`已创建图层分离节点，包含 ${layers.length} 个图层`);
    const { x, y } = position;
    const boundsX = Math.min(nodeX, x);
    const boundsY = Math.min(nodeY, y);
    const boundsRight = Math.max(nodeX + nodeWidth, x + completedPanelWidth + 2);
    const boundsBottom = Math.max(nodeY + nodeHeight, y + (completedPreviewWidth - 16) * canvasSize.height / canvasSize.width + 18);
    await fitBounds({ x: boundsX, y: boundsY, width: boundsRight - boundsX, height: boundsBottom - boundsY }, { padding: 0.12, duration: 250 }).catch(() => {});
  } catch (error) {
    const message = controller.signal.aborted ? "任务已中断，请重新拆分" : error instanceof Error ? error.message : String(error);
    if (resultNode && findNode(layerNodeId) === resultNode && (!canvasId || getCanvas?.()?.id === canvasId)) Object.assign(resultNode.data, { splitStatus: "failed", splitError: message });
    if (!controller.signal.aborted) showNodeError(error, "图层分离失败");
  } finally {
    // ACT: 直接引用任务落盘结果；回填失败也保留参考图和结果，避免丢失已付费图片。
    splitting.value = false;
    splitController = undefined;
  }
}

defineExpose({ active, splitting, open });
</script>

<style scoped lang="scss">
@use "@toonflow/node-shared/imageToolStyles.scss" as tools;
.layerSplit {
  position: absolute;
  z-index: 10;
  inset: 0;
  pointer-events: none;

  .splitToolbar {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 7px;
    transform: translateX(-50%);
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 10px;
    background: var(--el-bg-color-overlay);
    color: var(--el-text-color-primary);
    box-shadow: var(--el-box-shadow-light);
    pointer-events: auto;

    span { display: flex; align-items: center; gap: 6px; padding: 0 8px; font-size: 12px; white-space: nowrap; }
  }

  .splitPanel {
    @include tools.surface(14px);
    position: absolute;
    z-index: 3;
    box-sizing: border-box;
    top: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
    width: max(100%, 560px);
    display: grid;
    gap: 6px;
    padding: 7px 9px;
    pointer-events: auto;

    .splitDescription { font-size: 13px; }

    .splitActions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 6px 12px;
      font-size: 12px;

      .modeSwitch {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 2px;
        padding: 2px;
        border-radius: 10px;
        background: var(--el-fill-color-extra-light);

        button {
          @include tools.choice;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-height: 28px;
          padding: 4px 7px;
          white-space: nowrap;
        }
      }

      .splitSubmit {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 8px;

        .extractText {
          display: flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
          color: var(--el-text-color-secondary);

        }


        .confirmSplit {
          @include tools.action;
          height: 32px;
          padding-inline: 12px;
        }
      }
    }
  }
}

.layerSelectionSurface {
  position: absolute;
  z-index: 1;
  inset: 0;
  pointer-events: auto;
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  cursor: crosshair;
  touch-action: none;

  img { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; user-select: none; }
  .selectionHint { position: absolute; inset: 0; display: grid; place-items: center; color: var(--el-text-color-secondary); pointer-events: none; }
  .selectionBox { position: absolute; border: 1px solid white; background: rgb(255 255 255 / 10%); box-shadow: 0 0 0 1px rgb(0 0 0 / 60%); pointer-events: none; }
}

</style>
