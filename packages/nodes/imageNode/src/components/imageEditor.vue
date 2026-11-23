<template>
  <div class="imageEditor" :class="{ editing: mode, cropping: mode === 'crop', previewUnavailable: preparingPreview || previewError }" :style="{ '--imageRatio': imageRatio }" :aria-busy="preparingPreview">
    <img ref="sourceImage" :src="previewSrc" :alt="alt" draggable="false" :title="mode || preparingPreview || previewError ? undefined : focusOnDoubleClick ? '双击聚焦节点' : '双击放大预览'" @dblclick.stop="onImageDoubleClick" @load="imageLoaded" @error="handleError" />
    <div v-if="preparingPreview || previewError" class="previewStatus" role="status">{{ preparingPreview ? "正在生成兼容预览…" : previewError }}</div>
    <canvas
      v-if="mode && mode !== 'crop' && mode !== 'color'"
      ref="paintCanvas"
      class="paintCanvas nodrag nopan nowheel"
      :class="{ smartEdit: mode === 'smartEdit' }"
      :style="{ aspectRatio: `${sourceImage?.naturalWidth} / ${sourceImage?.naturalHeight}`, cursor: tool === 'text' ? 'text' : 'crosshair' }"
      :aria-label="mode === 'smartEdit' ? '智能改图标注画布' : '图片标记画布'"
      @pointerdown.stop.prevent="startStroke"
      @pointermove.stop.prevent="moveStroke"
      @pointerup.stop.prevent="finishStroke"
      @pointercancel.stop="cancelStroke"
      @lostpointercapture="cancelStroke"
      @mousedown.stop
      @dblclick.stop
      @contextmenu.stop.prevent />
    <imageCrop v-if="mode === 'crop' && sourceImage" class="cropLayer" :width="sourceImage.naturalWidth" :height="sourceImage.naturalHeight" :toolbarTarget="toolbarTarget" :busy="busy" :disabled="disabled" :active="node.selected" @cancel="cancel" @confirm="saveEditedImage({ kind: 'crop', rect: $event })" />
    <imageColorAdjust v-if="mode === 'color' && sourceImage" :image="sourceImage" :busy="busy" :disabled="disabled" :active="node.selected" @cancel="cancel" @confirm="saveEditedImage({ kind: 'color', settings: $event })" />
    <textarea
      v-if="textDraft"
      ref="textInput"
      v-model="textDraft.text"
      class="textInput nodrag nopan nowheel"
      :class="{ markTextInput: mode === 'mark' }"
      :style="textStyle"
      :rows="Math.max(1, textDraft.text.split('\n').length)"
      aria-label="标记文本"
      placeholder="输入文本"
      wrap="off"
      @pointerdown.stop
      @mousedown.stop
      @dblclick.stop
      @keydown.stop="handleTextKey"
      @blur="commitText" />
  </div>
  <teleport v-if="mode && mode !== 'crop' && mode !== 'color' && toolbarTarget" :to="toolbarTarget">
    <div class="paintToolbar" :class="{ markToolbar: mode === 'mark' }" :aria-label="mode === 'mark' ? '图片标记工具' : '智能改图工具'" role="group" @keydown.esc.stop.prevent="!busy && cancel()">
      <el-button :icon="IconBrush" :type="tool === 'brush' ? 'primary' : 'default'" :disabled="busy" text title="画笔" aria-label="画笔" :aria-pressed="tool === 'brush'" @click="tool = 'brush'" />
      <template v-if="mode === 'mark'">
        <el-button :icon="IconSquare" :type="tool === 'rectangle' ? 'primary' : 'default'" :disabled="busy" text title="矩形" aria-label="矩形" :aria-pressed="tool === 'rectangle'" @click="tool = 'rectangle'" />
        <el-button :icon="IconCircle" :type="tool === 'circle' ? 'primary' : 'default'" :disabled="busy" text title="圆形" aria-label="圆形" :aria-pressed="tool === 'circle'" @click="tool = 'circle'" />
        <el-button :icon="IconTypography" :type="tool === 'text' ? 'primary' : 'default'" :disabled="busy" text title="文本" aria-label="文本" :aria-pressed="tool === 'text'" @click="tool = 'text'" />
      </template>
      <template v-if="mode === 'smartEdit'">
        <el-button :icon="IconMapPin" :type="tool === 'marker' ? 'primary' : 'default'" :disabled="busy" text title="编号标记" aria-label="编号标记" :aria-pressed="tool === 'marker'" @click="tool = 'marker'" />
        <el-button :icon="IconArrowUpRight" :type="tool === 'arrow' ? 'primary' : 'default'" :disabled="busy" text title="箭头" aria-label="箭头" :aria-pressed="tool === 'arrow'" @click="tool = 'arrow'" />
        <el-button :icon="IconTypography" :type="tool === 'text' ? 'primary' : 'default'" :disabled="busy" text title="文字" aria-label="文字" :aria-pressed="tool === 'text'" @click="tool = 'text'" />
      </template>
      <el-button :icon="IconEraser" :type="tool === 'eraser' ? 'primary' : 'default'" :disabled="busy" text title="橡皮擦" aria-label="橡皮擦" :aria-pressed="tool === 'eraser'" @click="tool = 'eraser'" />
      <span v-if="mode === 'mark'" class="toolDivider" aria-hidden="true" />
      <input v-if="mode === 'mark'" v-model="color" type="color" class="brushColor" :disabled="busy" title="标记颜色" aria-label="标记颜色" />
      <label class="brushSize">
        {{ tool === 'text' ? '字号' : '粗细' }}
        <input v-model.number="toolSize" type="range" :min="minToolSize" max="60" :disabled="busy" :style="{ '--rangeProgress': sizeProgress }" :aria-label="tool === 'text' ? '文本字号' : '画笔粗细'" />
        <span>{{ toolSize }}</span>
      </label>
      <span v-if="mode === 'mark'" class="toolDivider" aria-hidden="true" />
      <el-button :icon="IconArrowBackUp" :disabled="busy || !strokeCount" text title="撤销" aria-label="撤销" @click="undo" />
      <el-button :icon="IconArrowForwardUp" :disabled="busy || strokeCount === historyLength" text title="重做" aria-label="重做" @click="redo" />
      <el-button :icon="mode === 'mark' ? IconRotateClockwise : IconTrash" :disabled="busy || !hasDrawing" text title="清空标记" aria-label="清空标记" @click="clear" />
      <el-button v-if="mode === 'mark'" class="saveButton" :icon="IconCheck" :disabled="!hasDrawing && !textDraft?.text.trim()" :loading="busy" @click="saveMark">保存</el-button>
      <el-button class="closeButton" :icon="IconX" :disabled="busy" text :title="mode === 'mark' ? '退出标记' : '退出智能改图'" :aria-label="mode === 'mark' ? '退出标记' : '退出智能改图'" @click="cancel" />
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElMessage } from "element-plus";
import { IconBrush, IconEraser, IconSquare, IconCircle, IconTypography, IconArrowBackUp, IconArrowForwardUp, IconTrash, IconCheck, IconX, IconMapPin, IconArrowUpRight, IconRotateClockwise } from "@tabler/icons-vue";
import { uploadNodeFile, useNodeFiles } from "@toonflow/nodes-scaffold/runtime";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { useMediaPreview } from "@toonflow/node-shared/mediaPreview";
import { getMediaPreviewSize } from "@toonflow/node-shared/mediaPreviewSize";
import { drawPaintSegment, usePaintCanvas } from "@toonflow/node-shared/usePaintCanvas";
import { useImageVariationNode } from "../useImageVariationNode";
import { getOutpaintLayout, type OutpaintDraftInput } from "../imageOutpaint";
import imageCrop from "./imageCrop.vue";
import imageColorAdjust from "./imageColorAdjust.vue";
import { createColorRenderer, type ColorSettings } from "../imageColor";

const props = defineProps<{ src: string; alt: string; toolbarTarget?: HTMLElement; disabled?: boolean; focusOnDoubleClick?: boolean }>();
const emit = defineEmits<{ load: [event: Event]; error: [error: Error]; focus: []; preview: []; close: [] }>();
const { src: previewSrc, preparing: preparingPreview, error: previewError, handleError, handleLoaded } = useMediaPreview(() => props.src, "image");
watch(previewError, message => { if (message) emit("error", new Error(message)); });
const { node } = useNode();
const { addNodes, addEdges, removeNodes, findNode, getNodes, nodeTypes, fitView, onPaneClick } = useVueFlow();
const files = useNodeFiles();
const createVariation = useImageVariationNode();
const getCanvas = inject<(() => { id: string } | undefined) | undefined>("canvas", undefined);
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
const sourceImage = ref<HTMLImageElement>();
const imageRatio = ref(1);
const paintCanvas = ref<HTMLCanvasElement>();
const mode = ref<"mark" | "smartEdit" | "crop" | "color">();

function onImageDoubleClick() {
  if (mode.value || preparingPreview.value || previewError.value) return;
  if (props.focusOnDoubleClick) emit("focus");
  else emit("preview");
}

const busy = ref(false);
let operation: AbortController | undefined;
const {
  tool, color, minToolSize, toolSize, sizeProgress, strokeCount, historyLength, hasDrawing,
  textInput, textDraft, textStyle, startStroke, moveStroke, finishStroke, cancelStroke,
  clear, undo, redo, commitText, handleTextKey, getStrokes, reset,
} = usePaintCanvas(paintCanvas, busy, {
  canDraw: () => !!props.toolbarTarget && !props.disabled,
  canCommitText: () => mode.value === "mark" || mode.value === "smartEdit",
});

function imageLoaded(event: Event) {
  const image = event.target as HTMLImageElement;
  if (image.currentSrc !== previewSrc.value) return;
  handleLoaded(event);
  if (image.naturalWidth && image.naturalHeight) imageRatio.value = image.naturalWidth / image.naturalHeight;
  emit("load", event);
}

function cancel() {
  const wasOpen = !!mode.value;
  operation?.abort();
  mode.value = undefined;
  reset();
  if (wasOpen) emit("close");
}
watch(previewSrc, cancel, { flush: "sync" });
watch(() => getCanvas?.()?.id, cancel, { flush: "sync" });
onPaneClick(exitSmartEdit);
watch(mode, (value, _, onCleanup) => {
  if (value !== "smartEdit") return;
  window.addEventListener("keydown", handleSmartEditEscape, true);
  onCleanup(() => window.removeEventListener("keydown", handleSmartEditEscape, true));
});
onBeforeUnmount(cancel);

function exitSmartEdit() {
  if (mode.value === "smartEdit" && !busy.value) cancel();
}

function handleSmartEditEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || !node.selected || textDraft.value) return;
  if (event.target instanceof Element && event.target.closest("[role='dialog'], [role='combobox'][aria-expanded='true']")) return;
  event.preventDefault();
  event.stopPropagation();
  exitSmartEdit();
}

async function start(value: "mark" | "smartEdit" | "crop" | "color") {
  const image = sourceImage.value;
  if (props.disabled || busy.value || preparingPreview.value || previewError.value || !image?.complete || !image.naturalWidth || !image.naturalHeight) return;
  operation?.abort();
  mode.value = undefined;
  reset();
  tool.value = "brush";
  mode.value = value;
  await nextTick();
  if (!paintCanvas.value) return;
  paintCanvas.value.width = image.naturalWidth;
  paintCanvas.value.height = image.naturalHeight;
}


function createCanvas() {
  const source = sourceImage.value;
  if (!source?.naturalWidth || !paintCanvas.value) throw new Error("图片尚未加载完成");
  const canvas = document.createElement("canvas");
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建绘画画布");
  return { canvas, context };
}

function toFile(canvas: HTMLCanvasElement) {
  return new Promise<File>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(new File([blob], "image.png", { type: "image/png" })) : reject(new Error("图片编码失败")), "image/png"));
}

async function saveEditedImage(edit: { kind: "crop"; rect: { x: number; y: number; width: number; height: number } } | { kind: "color"; settings: ColorSettings }) {
  const image = sourceImage.value;
  if (busy.value || props.disabled || mode.value !== edit.kind || !image?.naturalWidth || !image.naturalHeight) return;
  const label = edit.kind === "crop" ? "裁剪" : "调色";
  const rect = edit.kind === "crop" ? edit.rect : { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
  const source = props.src;
  const canvasId = getCanvas?.()?.id;
  const nodeId = crypto.randomUUID();
  const controller = operation = new AbortController();
  let canvas: HTMLCanvasElement | undefined;
  let colorRenderer: ReturnType<typeof createColorRenderer> | undefined;
  busy.value = true;
  try {
    if (!nodeTypes?.value?.["remote-imageNode"]) throw new Error("请先启用图片节点插件");
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) throw new Error("裁剪区域无效");
    const x = Math.max(0, Math.min(image.naturalWidth - 1, Math.round(rect.x)));
    const y = Math.max(0, Math.min(image.naturalHeight - 1, Math.round(rect.y)));
    const width = Math.max(1, Math.min(image.naturalWidth - x, Math.round(rect.width)));
    const height = Math.max(1, Math.min(image.naturalHeight - y, Math.round(rect.height)));
    if (width > 16384 || height > 16384 || width * height > 64 * 1024 * 1024) throw new Error("图片尺寸过大，请缩小后再保存");
    const workspace = files.getWorkspaceFiles();
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    if (edit.kind === "color") {
      colorRenderer = createColorRenderer(canvas, image, width, height);
      colorRenderer.render(edit.settings);
    } else {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法创建裁剪画布");
      context.drawImage(image, x, y, width, height, 0, 0, width, height);
    }
    const file = await toFile(canvas);
    controller.signal.throwIfAborted();
    if (!file.size || file.size > 100 * 1024 * 1024) throw new Error("处理后的图片不能为空且不能超过 100 MB");
    if (findNode(node.id) !== node || getCanvas?.()?.id !== canvasId || props.src !== source) throw new Error("原图片或画布已变化，请重新编辑");
    const url = await uploadNodeFile(workspace, nodeId, file);
    await batchHistory(async () => {
      controller.signal.throwIfAborted();
      if (findNode(node.id) !== node || getCanvas?.()?.id !== canvasId || props.src !== source) throw new Error("原图片或画布已变化，请重新编辑");
      if (!nodeTypes?.value?.["remote-imageNode"]) throw new Error("图片节点插件已停用");
      const previewSize = getMediaPreviewSize(width, height);
      const outputWidth = previewSize.width + 6;
      const outputHeight = previewSize.height + 38;
      const x = node.computedPosition.x + (node.dimensions.width || 320) + 80;
      let y = node.computedPosition.y;
      for (const other of [...getNodes.value].sort((left, right) => left.computedPosition.y - right.computedPosition.y)) {
        const position = other.computedPosition;
        if (position.x < x + outputWidth && position.x + (other.dimensions.width || 320) > x
          && position.y < y + outputHeight && position.y + (other.dimensions.height || 300) > y) {
          y = position.y + (other.dimensions.height || 300) + 40;
        }
      }
      try {
        addNodes({ id: nodeId, type: "remote-imageNode", position: { x, y }, data: {
          label, outputs: { image: { dataType: "IMAGE", value: { url, mimeType: "image/png" } } },
        } });
        await nextTick();
        controller.signal.throwIfAborted();
        if (findNode(node.id) !== node || getCanvas?.()?.id !== canvasId || props.src !== source || !findNode(nodeId)) throw new Error("画布已变化，请重新编辑");
        addEdges({ id: crypto.randomUUID(), source: node.id, sourceHandle: "image", target: nodeId, targetHandle: "in" });
      } catch (error) {
        // 仅撤回未完成的画布节点，不删除已保存的素材。
        removeNodes(nodeId, true, false);
        throw error;
      }
    });
    cancel();
    await nextTick();
    if (getCanvas?.()?.id === canvasId && findNode(node.id) === node && findNode(nodeId)) {
      await fitView({ nodes: [node.id, nodeId], padding: 0.2, maxZoom: 1, duration: 200 });
    }
  } catch (error) {
    if (!controller.signal.aborted) showNodeError(error, `${label}图片保存失败`);
  } finally {
    colorRenderer?.dispose();
    if (canvas) canvas.width = canvas.height = 0;
    if (operation === controller) operation = undefined;
    busy.value = false;
  }
}

async function saveMark() {
  if (busy.value) return;
  commitText();
  if (!hasDrawing.value) return;
  if (!nodeTypes?.value?.["remote-imageNode"]) return void ElMessage.error("请先启用图片节点插件");
  const controller = operation = new AbortController();
  busy.value = true;
  const id = crypto.randomUUID();
  let workspace: ReturnType<typeof files.getWorkspaceFiles> | undefined;
  let committed = false;
  try {
    workspace = files.getWorkspaceFiles();
    const { canvas, context } = createCanvas();
    context.drawImage(sourceImage.value!, 0, 0);
    context.drawImage(paintCanvas.value!, 0, 0);
    const file = await toFile(canvas);
    canvas.width = canvas.height = 0;
    controller.signal.throwIfAborted();
    const path = await uploadNodeFile(workspace, id, file);
    controller.signal.throwIfAborted();
    if (findNode(node.id) !== node || !nodeTypes?.value?.["remote-imageNode"]) throw new Error("画布节点已变化，请重新保存");
    const x = node.computedPosition.x + node.dimensions.width + 80;
    let y = node.computedPosition.y;
    for (const other of [...getNodes.value].sort((left, right) => left.computedPosition.y - right.computedPosition.y)) {
      if (other.computedPosition.x < x + node.dimensions.width && other.computedPosition.x + other.dimensions.width > x && other.computedPosition.y < y + node.dimensions.height && other.computedPosition.y + other.dimensions.height > y) y = other.computedPosition.y + other.dimensions.height + 40;
    }
    await batchHistory(async () => {
      controller.signal.throwIfAborted();
      addNodes([{ id, type: "remote-imageNode", position: { x, y }, data: { label: `${node.data.label || "图片"} - 标记`, outputs: { image: { dataType: "IMAGE", value: { url: path, mimeType: "image/png" } } } } }]);
      addEdges([{ id: crypto.randomUUID(), source: node.id, sourceHandle: "image", target: id, targetHandle: "in" }]);
      committed = true;
    });
    cancel();
  } catch (error) {
    if (!controller.signal.aborted) showNodeError(error, "标记保存失败");
  } finally {
    if (!committed && workspace) await workspace.remove(`assets/${id}`, true).catch(error => {
      if (error?.response?.data?.data?.code !== "ENOENT") showNodeError(error, "标记临时文件清理失败");
    });
    operation = undefined;
    busy.value = false;
  }
}


async function createOutpaint(input: OutpaintDraftInput, signal: AbortSignal) {
  const image = sourceImage.value;
  if (busy.value || props.disabled || !image?.naturalWidth || !image.naturalHeight || !props.src) throw new Error("原图片尚未准备好，无法扩图");
  if (!nodeTypes?.value?.["remote-imageGenerationNode"]) throw new Error("请先启用图片生成节点插件");
  if (!nodeTypes?.value?.["remote-imageNode"]) throw new Error("请先启用图片节点插件，用于显示扩图结果");
  if (!input.model) throw new Error("请选择图片模型");
  const layout = getOutpaintLayout(image.naturalWidth, image.naturalHeight, input);
  if (layout.targetWidth > 16384 || layout.targetHeight > 16384 || layout.targetWidth * layout.targetHeight > 64 * 1024 * 1024) throw new Error("扩展后的图片尺寸过大");
  const source = props.src;
  const controller = operation = new AbortController();
  const requestSignal = AbortSignal.any([signal, controller.signal]);
  const workspace = files.getWorkspaceFiles();
  const nodeId = crypto.randomUUID();
  let canvas: HTMLCanvasElement | undefined;
  busy.value = true;
  try {
    requestSignal.throwIfAborted();
    if (findNode(node.id) !== node || !sourceImage.value || props.src !== source) throw new Error("原图片已变化，请重新操作");
    canvas = document.createElement("canvas");
    canvas.width = layout.targetWidth;
    canvas.height = layout.targetHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建扩图画布");
    context.fillStyle = "#fff";
    if (layout.left) context.fillRect(0, 0, layout.left, layout.targetHeight);
    if (layout.right) context.fillRect(layout.targetWidth - layout.right, 0, layout.right, layout.targetHeight);
    if (layout.top) context.fillRect(0, 0, layout.targetWidth, layout.top);
    if (layout.bottom) context.fillRect(0, layout.targetHeight - layout.bottom, layout.targetWidth, layout.bottom);
    context.drawImage(image, layout.left, layout.top);
    const original = await uploadNodeFile(workspace, nodeId, await toFile(canvas));
    requestSignal.throwIfAborted();
    const directory = `assets/${nodeId}/outpaint`;
    await workspace.mkdir(directory);
    requestSignal.throwIfAborted();
    const path = `${directory}/${original.split("/").at(-1)}`;
    await workspace.rename(original, path);
    requestSignal.throwIfAborted();
    const outpaintContext = `\n\n目标画布：${layout.targetWidth} × ${layout.targetHeight}；原图大小：${layout.sourceWidth} × ${layout.sourceHeight}；原图左上角位置：(${layout.left}, ${layout.top})。`;
    const result = await createVariation({
      label: "扩图", nodeId, prompt: input.prompt,
      model: input.model,
      size: input.size,
      ratio: input.targetRatio,
      inpaint: { source: node.data.outputs?.image?.value?.url ?? "", original: path, guide: path, mask: path, images: [], mode: "outpaint", outpaintContext },
    }, requestSignal);
    if (mode.value) cancel();
    return result;
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    if (operation === controller) operation = undefined;
    busy.value = false;
  }
}

async function createSmartEdit(input: { prompt: string; model: string; size: string; ratio: string; preserveOutsideMask: boolean }, signal: AbortSignal) {
  if (busy.value || mode.value !== "smartEdit") throw new Error("请先进入智能改图");
  if (!input.prompt.trim()) throw new Error("请输入改图提示词");
  if (!input.model) throw new Error("请选择图片模型");
  if (!nodeTypes?.value?.["remote-imageGenerationNode"]) throw new Error("请先启用图片生成节点插件");
  const layer = paintCanvas.value;
  if (!layer || !hasDrawing.value) throw new Error("请先添加标记、画笔、箭头或文字作为改图参考");
  const workspace = files.getWorkspaceFiles();
  const controller = operation = new AbortController();
  const requestSignal = AbortSignal.any([signal, controller.signal]);
  const nodeId = crypto.randomUUID();
  let committed = false;
  let canvas: HTMLCanvasElement | undefined;
  let maskCanvas: HTMLCanvasElement | undefined;
  busy.value = true;
  try {
    requestSignal.throwIfAborted();
    if (input.preserveOutsideMask) {
      const mask = createCanvas();
      maskCanvas = mask.canvas;
      for (const stroke of getStrokes()) {
        if (stroke.tool === "clear") mask.context.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        if (stroke.tool === "brush" || stroke.tool === "eraser") {
          stroke.points.forEach((point, index) => drawPaintSegment(stroke, point, stroke.points[index - 1], mask.context));
        }
      }
      if (!mask.context.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data.some((value, index) => index % 4 === 3 && value)) {
        throw new Error("请用画笔涂抹需要修改的区域");
      }
    }
    const drawing = createCanvas();
    canvas = drawing.canvas;
    drawing.context.drawImage(sourceImage.value!, 0, 0);
    const original = await uploadNodeFile(workspace, nodeId, await toFile(canvas));
    requestSignal.throwIfAborted();
    drawing.context.drawImage(layer, 0, 0);
    const guide = await uploadNodeFile(workspace, nodeId, await toFile(canvas));
    requestSignal.throwIfAborted();
    const uploads = [original, guide];
    if (maskCanvas) uploads.push(await uploadNodeFile(workspace, nodeId, await toFile(maskCanvas)));
    requestSignal.throwIfAborted();
    const directory = `assets/${nodeId}/inpaint`;
    await workspace.mkdir(directory);
    const paths = uploads.map(path => `${directory}/${path.split("/").at(-1)}`);
    for (const [index, path] of uploads.entries()) {
      requestSignal.throwIfAborted();
      await workspace.rename(path, paths[index]!);
    }
    const prompt = `请根据第一张图片进行改图。第二张图片是带标记的参考图：编号、箭头、文字及笔迹用于指出修改位置和要求，请理解其含义，不要把这些标记画入结果。保留未被要求修改的内容、构图和画面比例。\n\n改图要求：\n${input.prompt.trim()}`;
    const result = await createVariation({
      label: "智能改图", nodeId, prompt, model: input.model, size: input.size, ratio: input.ratio,
      inpaint: {
        source: node.data.outputs?.image?.value?.url ?? "", original: paths[0]!, guide: paths[1]!,
        mask: paths[2] ?? paths[1]!, images: [], mode: maskCanvas ? "mask" : "guide",
      },
    }, requestSignal);
    committed = true;
    requestSignal.throwIfAborted();
    if (!findNode(result.nodeId) || findNode(node.id) !== node) throw new Error("生成节点创建后画布发生变化");
    return result;
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    if (maskCanvas) maskCanvas.width = maskCanvas.height = 0;
    if (!committed) await workspace.remove(`assets/${nodeId}`, true).catch(error => {
      if (error?.response?.data?.data?.code !== "ENOENT") showNodeError(error, "智能改图素材清理失败");
    });
    operation = undefined;
    busy.value = false;
  }
}

defineExpose({ mode, busy, start, cancel, exitSmartEdit, createOutpaint, createSmartEdit, previewSrc });
</script>

<style scoped lang="scss">
@use "@toonflow/node-shared/imageToolStyles.scss" as tools;
.imageEditor {
  position: relative;
  width: 100%;
  display: grid;
  place-items: center;

  &.previewUnavailable { min-height: 144px; }
  .previewStatus {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 16px;
    background: var(--el-fill-color-darker);
    color: var(--el-text-color-secondary);
    font-size: 12px;
    text-align: center;
    overflow: auto;
  }

  .nodeSkeleton.resized & {
    height: 100%;
    container-type: size;

    img,
    .paintCanvas,
    .cropLayer {
      width: min(100cqw, calc(100cqh * var(--imageRatio)));
      height: min(100cqh, calc(100cqw / var(--imageRatio)));
      max-width: none;
      max-height: none;
    }
  }

  img { display: block; width: 100%; object-fit: contain; border-radius: var(--el-border-radius-base); }
  &:has(.colorPreview.ready) > img { visibility: hidden; }
  &.cropping img { border-radius: 0; }
  .paintCanvas { position: absolute; max-width: 100%; max-height: 100%; height: 100%; touch-action: none; cursor: crosshair; }
  .paintCanvas.smartEdit { opacity: 1; }
  .textInput { position: absolute; z-index: 1; box-sizing: border-box; padding: 0; border: 1px dashed currentColor; outline: none; resize: none; overflow: hidden; background: rgb(255 255 255 / 85%); font-family: sans-serif; line-height: 1.25; }

  .markTextInput {
    border: 0;
    border-radius: 4px;
    background: color-mix(in srgb, var(--el-bg-color-overlay) 72%, transparent);
    outline: 1px solid var(--el-color-primary);
    outline-offset: 2px;

    &::placeholder { color: var(--el-text-color-secondary); }
  }
}
.paintToolbar {
  @include tools.toolbar;

  .el-button { margin: 0; padding: 0 8px; min-width: 32px; }
  .el-button[aria-pressed="true"] { @include tools.selected; border-radius: 8px; }
  .closeButton { color: var(--el-text-color-secondary); }
  .brushSize {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px;
    font-size: 12px;
    color: var(--el-text-color-secondary);

    input { @include tools.range; width: 70px; }
    span { min-width: 24px; color: var(--el-text-color-primary); text-align: center; font-variant-numeric: tabular-nums; }
  }

  &.markToolbar {
    .el-button {
      min-width: 32px;
      height: 32px;
      border-radius: 8px;

      :deep(svg) { width: 17px; height: 17px; }
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 1px; }
    }

    .toolDivider {
      width: 1px;
      height: 18px;
      margin: 0 5px;
      background: var(--el-border-color-light);
    }

    .brushColor { @include tools.colorSwatch; }

    .saveButton {
      @include tools.action;
      margin-left: 4px;
      padding: 0 10px;
    }
  }
}
</style>
