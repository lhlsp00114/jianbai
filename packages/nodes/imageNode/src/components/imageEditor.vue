<template>
  <div class="imageEditor" :class="{ editing: mode, cropping: mode === 'crop', previewUnavailable: preparingPreview || previewError }" :style="{ '--imageRatio': imageRatio }" :aria-busy="preparingPreview">
    <img ref="sourceImage" :src="previewSrc" :alt="alt" draggable="false" title="双击放大预览" @dblclick.stop="!mode && !preparingPreview && !previewError && emit('preview')" @load="imageLoaded" @error="handleError" />
    <div v-if="preparingPreview || previewError" class="previewStatus" role="status">{{ preparingPreview ? "正在生成兼容预览…" : previewError }}</div>
    <canvas
      v-if="mode && mode !== 'crop' && mode !== 'color'"
      ref="paintCanvas"
      class="paintCanvas nodrag nopan nowheel"
      :class="{ inpaint: mode === 'inpaint', smartEdit: mode === 'smartEdit' }"
      :style="{ aspectRatio: `${sourceImage?.naturalWidth} / ${sourceImage?.naturalHeight}`, cursor: tool === 'text' ? 'text' : 'crosshair' }"
      :aria-label="mode === 'inpaint' ? '涂抹需要重绘的区域' : mode === 'smartEdit' ? '智能改图标注画布' : '图片标记画布'"
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
    <div class="paintToolbar" @keydown.esc.stop.prevent="!busy && cancel()">
      <el-button class="exitButton" :icon="IconX" :disabled="busy" text :title="mode === 'mark' ? '取消标记' : mode === 'smartEdit' ? '退出智能改图' : '取消局部重绘'" :aria-label="mode === 'mark' ? '取消标记' : mode === 'smartEdit' ? '退出智能改图' : '取消局部重绘'" @click="cancel">{{ mode === 'smartEdit' ? '返回' : mode === 'mark' ? '标记' : '局部重绘' }}</el-button>
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
      <input v-if="mode === 'mark'" v-model="color" type="color" class="brushColor" :disabled="busy" title="画笔颜色" aria-label="画笔颜色" />
      <label class="brushSize">{{ tool === 'text' ? '字号' : '粗细' }}<input v-model.number="toolSize" type="range" :min="tool === 'text' ? 12 : 2" max="60" :disabled="busy" :aria-label="tool === 'text' ? '文本字号' : '画笔粗细'" /><span>{{ toolSize }}</span></label>
      <el-button :icon="IconArrowBackUp" :disabled="busy || !strokeCount" text title="撤销" aria-label="撤销" @click="undo" />
      <el-button :icon="IconArrowForwardUp" :disabled="busy || strokeCount === historyLength" text title="恢复" aria-label="恢复" @click="redo" />
      <el-button :icon="IconTrash" :disabled="busy || !hasDrawing" text title="清空标记" aria-label="清空标记" @click="clear" />
      <el-button v-if="mode === 'mark'" class="saveButton" :icon="IconCheck" :disabled="!hasDrawing && !textDraft?.text.trim()" :loading="busy" type="primary" @click="saveMark">保存</el-button>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElMessage } from "element-plus";
import { IconBrush, IconEraser, IconSquare, IconCircle, IconTypography, IconArrowBackUp, IconArrowForwardUp, IconTrash, IconCheck, IconX, IconMapPin, IconArrowUpRight } from "@tabler/icons-vue";
import { uploadNodeFile, useNodeFiles } from "@toonflow/nodes-scaffold/runtime";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { useMediaPreview } from "@toonflow/node-shared/mediaPreview";
import { useImageVariationNode } from "../useImageVariationNode";
import { buildInpaintPrompt, type InpaintDraftInput } from "../imageInpaint";
import imageCrop from "./imageCrop.vue";
import imageColorAdjust from "./imageColorAdjust.vue";
import { createColorRenderer, type ColorSettings } from "../imageColor";

const props = defineProps<{ src: string; alt: string; toolbarTarget?: HTMLElement; disabled?: boolean }>();
const emit = defineEmits<{ load: [event: Event]; error: [error: Error]; preview: []; close: [] }>();
const { src: previewSrc, preparing: preparingPreview, error: previewError, handleError, handleLoaded } = useMediaPreview(() => props.src, "image");
watch(previewError, message => { if (message) emit("error", new Error(message)); });
const { node } = useNode();
const { addNodes, addEdges, removeNodes, findNode, getNodes, nodeTypes, fitView } = useVueFlow();
const files = useNodeFiles();
const createVariation = useImageVariationNode();
const getCanvas = inject<(() => { id: string } | undefined) | undefined>("canvas", undefined);
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
const sourceImage = ref<HTMLImageElement>();
const imageRatio = ref(1);
const paintCanvas = ref<HTMLCanvasElement>();
const mode = ref<"inpaint" | "mark" | "smartEdit" | "crop" | "color">();
const busy = ref(false);
const tool = ref<"brush" | "eraser" | "rectangle" | "circle" | "text" | "marker" | "arrow">("brush");
const color = ref("#ff4545");
const brushSize = ref(16);
const fontSize = ref(24);
const toolSize = computed({
  get: () => tool.value === "text" ? fontSize.value : brushSize.value,
  set: value => { if (tool.value === "text") fontSize.value = value; else brushSize.value = value; },
});
const strokeCount = ref(0);
const historyLength = ref(0);
const hasDrawing = ref(false);
type Point = { x: number; y: number };
type Stroke = { tool: typeof tool.value | "clear"; color: string; size: number; points: Point[]; text?: string };
const textInput = ref<HTMLTextAreaElement>();
const textDraft = ref<(Stroke & { text: string })>();
const textStyle = computed(() => {
  const canvas = paintCanvas.value;
  const draft = textDraft.value;
  if (!canvas || !draft) return {};
  const scale = canvas.clientWidth / canvas.width;
  const point = draft.points[0]!;
  return { left: `${canvas.offsetLeft + point.x * scale}px`, top: `${canvas.offsetTop + point.y * scale}px`, width: `${Math.max(40, canvas.clientWidth - point.x * scale)}px`, fontSize: `${draft.size * scale}px`, color: draft.color };
});
let strokes: Stroke[] = [];
let draftStroke: Stroke | undefined;
let pointerId: number | undefined;
let operation: AbortController | undefined;

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
  strokes = [];
  strokeCount.value = historyLength.value = 0;
  hasDrawing.value = false;
  textDraft.value = undefined;
  cancelStroke();
  if (wasOpen) emit("close");
}
watch(previewSrc, cancel, { flush: "sync" });
watch(() => getCanvas?.()?.id, cancel, { flush: "sync" });
onBeforeUnmount(cancel);

async function start(value: "inpaint" | "mark" | "smartEdit" | "crop" | "color") {
  const image = sourceImage.value;
  if (props.disabled || busy.value || preparingPreview.value || previewError.value || !image?.complete || !image.naturalWidth || !image.naturalHeight) return;
  operation?.abort();
  mode.value = undefined;
  strokes = [];
  strokeCount.value = historyLength.value = 0;
  hasDrawing.value = false;
  textDraft.value = undefined;
  cancelStroke();
  tool.value = "brush";
  mode.value = value;
  await nextTick();
  if (!paintCanvas.value) return;
  paintCanvas.value.width = image.naturalWidth;
  paintCanvas.value.height = image.naturalHeight;
}

function getPoint(event: PointerEvent): Point {
  const canvas = paintCanvas.value!;
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) / bounds.width * canvas.width)),
    y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) / bounds.height * canvas.height)),
  };
}

function drawSegment(stroke: Stroke, point: Point, previous = point) {
  const context = paintCanvas.value?.getContext("2d");
  if (!context) return;
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.fillStyle = context.strokeStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.lineCap = context.lineJoin = "round";
  context.beginPath();
  if (point === previous) {
    context.arc(point.x, point.y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  }
}

async function startStroke(event: PointerEvent) {
  const canvas = paintCanvas.value;
  if (!props.toolbarTarget || busy.value || props.disabled || event.button !== 0 || pointerId !== undefined || !canvas) return;
  commitText();
  const stroke: Stroke = { tool: tool.value, color: mode.value === "inpaint" ? "#ff4545" : color.value, size: toolSize.value * canvas.width / canvas.clientWidth, points: [getPoint(event)] };
  if (tool.value === "marker") {
    stroke.text = String(strokes.slice(0, strokeCount.value).filter(item => item.tool === "marker").length + 1);
    commitStroke(stroke);
    return;
  }
  if (tool.value === "text") {
    textDraft.value = { ...stroke, text: "" };
    await nextTick();
    textInput.value?.focus();
    return;
  }
  pointerId = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
  draftStroke = stroke;
  if (stroke.tool === "brush" || stroke.tool === "eraser") drawSegment(stroke, stroke.points[0]!);
}

function moveStroke(event: PointerEvent) {
  if (event.pointerId !== pointerId || busy.value) return;
  const stroke = draftStroke!;
  const point = getPoint(event);
  if (stroke.tool === "brush" || stroke.tool === "eraser") {
    drawSegment(stroke, point, stroke.points.at(-1));
    stroke.points.push(point);
  } else {
    stroke.points[1] = point;
    redraw();
    drawStroke(stroke);
  }
}

function finishStroke(event: PointerEvent) {
  if (event.pointerId !== pointerId) return;
  moveStroke(event);
  const stroke = draftStroke!;
  draftStroke = undefined;
  pointerId = undefined;
  if (paintCanvas.value?.hasPointerCapture(event.pointerId)) paintCanvas.value.releasePointerCapture(event.pointerId);
  if ((stroke.tool === "rectangle" || stroke.tool === "circle") && (!stroke.points[1] || stroke.points[0]!.x === stroke.points[1].x || stroke.points[0]!.y === stroke.points[1].y)) return void redraw();
  commitStroke(stroke);
}

function cancelStroke() {
  const captured = pointerId;
  pointerId = undefined;
  draftStroke = undefined;
  if (captured !== undefined && paintCanvas.value?.hasPointerCapture(captured)) paintCanvas.value.releasePointerCapture(captured);
  redraw();
}

function drawStroke(stroke: Stroke) {
  const canvas = paintCanvas.value;
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;
  if (stroke.tool === "clear") return context.clearRect(0, 0, canvas.width, canvas.height);
  if (stroke.tool === "brush" || stroke.tool === "eraser") return stroke.points.forEach((point, index) => drawSegment(stroke, point, stroke.points[index - 1]));
  const start = stroke.points[0]!;
  context.globalCompositeOperation = "source-over";
  context.fillStyle = context.strokeStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.lineJoin = "miter";
  context.lineCap = "butt";
  if (stroke.tool === "text") {
    context.font = `${stroke.size}px sans-serif`;
    context.textBaseline = "top";
    stroke.text!.split("\n").forEach((line, index) => context.fillText(line, start.x, start.y + index * stroke.size * 1.25));
    return;
  }
  if (stroke.tool === "marker") {
    context.beginPath();
    context.arc(start.x, start.y, stroke.size * 1.15, 0, Math.PI * 2);
    context.fillStyle = stroke.color;
    context.fill();
    context.fillStyle = "#fff";
    context.font = `bold ${stroke.size}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(stroke.text ?? "1", start.x, start.y);
    return;
  }
  const end = stroke.points[1];
  if (!end) return;
  if (stroke.tool === "arrow") {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = stroke.size * 2.4;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
    context.moveTo(end.x, end.y);
    context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
    context.stroke();
    return;
  }
  context.beginPath();
  if (stroke.tool === "rectangle") context.rect(start.x, start.y, end.x - start.x, end.y - start.y);
  else {
    const radius = Math.min(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) / 2;
    context.arc(start.x + Math.sign(end.x - start.x) * radius, start.y + Math.sign(end.y - start.y) * radius, radius, 0, Math.PI * 2);
  }
  context.stroke();
}

function redraw() {
  const canvas = paintCanvas.value;
  canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  hasDrawing.value = false;
  // ACT: 形状预览和历史切换重放矢量操作；超长标记需要分段快照，普通画笔移动仍只增量绘制。
  for (const stroke of strokes.slice(0, strokeCount.value)) {
    drawStroke(stroke);
    if (stroke.tool === "clear") hasDrawing.value = false;
    else if (stroke.tool !== "eraser") hasDrawing.value = true;
  }
}

function commitStroke(stroke: Stroke) {
  strokes.splice(strokeCount.value, strokes.length - strokeCount.value, stroke);
  strokeCount.value = historyLength.value = strokes.length;
  redraw();
}

function clear() {
  if (!busy.value) commitStroke({ tool: "clear", color: "", size: 0, points: [] });
}

function undo() {
  if (busy.value || !strokeCount.value) return;
  strokeCount.value--;
  redraw();
}

function redo() {
  if (busy.value || strokeCount.value === historyLength.value) return;
  strokeCount.value++;
  redraw();
}

function commitText() {
  const draft = textDraft.value;
  textDraft.value = undefined;
  if (draft?.text.trim() && !busy.value && (mode.value === "mark" || mode.value === "smartEdit")) commitStroke(draft);
}

function handleTextKey(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    textDraft.value = undefined;
  } else if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    commitText();
  }
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
      const outputWidth = 240 * width / height + 6;
      const outputHeight = 278;
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

async function createInpaint(input: InpaintDraftInput, signal: AbortSignal) {
  if (busy.value || mode.value !== "inpaint") throw new Error("请先进入局部重绘");
  if (!input.prompt.trim()) throw new Error("请输入重绘提示词");
  if (!nodeTypes?.value?.["remote-imageGenerationNode"]) throw new Error("请先启用图片生成节点插件");
  const layer = paintCanvas.value;
  if (!layer || !layer.getContext("2d")?.getImageData(0, 0, layer.width, layer.height).data.some((value, index) => index % 4 === 3 && value)) throw new Error("请先涂抹需要重绘的区域");
  const workspace = files.getWorkspaceFiles();
  const controller = operation = new AbortController();
  const requestSignal = AbortSignal.any([signal, controller.signal]);
  const nodeId = crypto.randomUUID();
  busy.value = true;
  let committed = false;
  let canvas: HTMLCanvasElement | undefined;
  try {
    requestSignal.throwIfAborted();
    const drawing = createCanvas();
    canvas = drawing.canvas;
    const context = drawing.context;
    context.drawImage(sourceImage.value!, 0, 0);
    const original = await uploadNodeFile(workspace, nodeId, await toFile(canvas));
    requestSignal.throwIfAborted();
    context.globalAlpha = 0.55;
    context.drawImage(layer, 0, 0);
    context.globalAlpha = 1;
    const guide = await uploadNodeFile(workspace, nodeId, await toFile(canvas));
    requestSignal.throwIfAborted();
    const mask = await uploadNodeFile(workspace, nodeId, await toFile(layer));
    requestSignal.throwIfAborted();
    // ACT: 编辑素材放入子目录，避免混入只扫描节点目录顶层的生成历史。
    const directory = `assets/${nodeId}/inpaint`;
    await workspace.mkdir(directory);
    const paths = [original, guide, mask].map(path => `${directory}/${path.split("/").at(-1)}`);
    for (const [index, path] of [original, guide, mask].entries()) {
      requestSignal.throwIfAborted();
      await workspace.rename(path, paths[index]!);
    }
    const result = await createVariation({
      label: "局部重绘", nodeId, prompt: buildInpaintPrompt(input.prompt),
      model: typeof node.data.model === "string" ? node.data.model : "",
      size: typeof node.data.size === "string" ? node.data.size : "",
      ratio: typeof node.data.ratio === "string" ? node.data.ratio : "16:9",
      inpaint: { source: node.data.outputs?.image?.value?.url ?? "", original: paths[0]!, guide: paths[1]!, mask: paths[2]!, images: input.images ?? [] },
    }, requestSignal);
    committed = true;
    cancel();
    return result;
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    if (!committed) await workspace.remove(`assets/${nodeId}`, true).catch(error => {
      if (error?.response?.data?.data?.code !== "ENOENT") showNodeError(error, "重绘临时文件清理失败");
    });
    operation = undefined;
    busy.value = false;
  }
}

async function createSmartEdit(input: { prompt: string; model: string; size: string; ratio: string }, signal: AbortSignal) {
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
  busy.value = true;
  try {
    requestSignal.throwIfAborted();
    const drawing = createCanvas();
    canvas = drawing.canvas;
    drawing.context.drawImage(sourceImage.value!, 0, 0);
    const original = await uploadNodeFile(workspace, nodeId, await toFile(canvas));
    requestSignal.throwIfAborted();
    drawing.context.drawImage(layer, 0, 0);
    const guide = await uploadNodeFile(workspace, nodeId, await toFile(canvas));
    requestSignal.throwIfAborted();
    const directory = `assets/${nodeId}/inpaint`;
    await workspace.mkdir(directory);
    const paths = [original, guide].map(path => `${directory}/${path.split("/").at(-1)}`);
    for (const [index, path] of [original, guide].entries()) {
      requestSignal.throwIfAborted();
      await workspace.rename(path, paths[index]!);
    }
    const prompt = `请根据第一张图片进行改图。第二张图片是带标记的参考图：编号、箭头、文字及笔迹用于指出修改位置和要求，请理解其含义，不要把这些标记画入结果。保留未被要求修改的内容、构图和画面比例。\n\n改图要求：\n${input.prompt.trim()}`;
    const result = await createVariation({
      label: "智能改图", nodeId, prompt, model: input.model, size: input.size, ratio: input.ratio,
      inpaint: { source: node.data.outputs?.image?.value?.url ?? "", original: paths[0]!, guide: paths[1]!, mask: paths[1]!, images: [], mode: "guide" },
    }, requestSignal);
    committed = true;
    requestSignal.throwIfAborted();
    if (!findNode(result.nodeId) || findNode(node.id) !== node) throw new Error("生成节点创建后画布发生变化");
    return result;
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    if (!committed) await workspace.remove(`assets/${nodeId}`, true).catch(error => {
      if (error?.response?.data?.data?.code !== "ENOENT") showNodeError(error, "智能改图素材清理失败");
    });
    operation = undefined;
    busy.value = false;
  }
}

defineExpose({ mode, busy, start, cancel, createInpaint, createSmartEdit, previewSrc });
</script>

<style scoped lang="scss">
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

  img { display: block; width: 100%; max-height: 240px; object-fit: contain; border-radius: var(--el-border-radius-base); }
  &:has(.colorPreview.ready) > img { visibility: hidden; }
  &.cropping img { border-radius: 0; }
  .paintCanvas { position: absolute; max-width: 100%; max-height: 100%; height: 100%; touch-action: none; cursor: crosshair; }
  .paintCanvas.inpaint { opacity: 0.55; }
  .paintCanvas.smartEdit { opacity: 1; }
  .textInput { position: absolute; z-index: 1; box-sizing: border-box; padding: 0; border: 1px dashed currentColor; outline: none; resize: none; overflow: hidden; background: rgb(255 255 255 / 85%); font-family: sans-serif; line-height: 1.25; }
}
.paintToolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-primary);
  box-shadow: var(--el-box-shadow-light);
  white-space: nowrap;

  .el-button { margin: 0; padding: 0 8px; min-width: 32px; }
  .exitButton { margin-right: 4px; }
  .saveButton { margin-left: 8px; padding: 0 12px; }
  .brushColor { width: 26px; height: 26px; padding: 2px; border: 1px solid var(--el-border-color); border-radius: 5px; background: transparent; cursor: pointer; }
  .brushSize { display: flex; align-items: center; gap: 6px; padding: 0 8px; font-size: 12px; input { width: 70px; accent-color: var(--el-color-primary); } span { min-width: 18px; } }
}
</style>
