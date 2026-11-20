<template>
  <section class="storyboardNode" :class="{ selected }">
    <div v-if="toolbarVisible" class="storyboardTools nodrag nopan nowheel">
      <canvasToolbar class="storyboardToolbar">
        <span class="toolLabel">比例</span>
        <el-select class="ratioSelect" size="small" :modelValue="board.ratio" aria-label="比例" :disabled="busy" @change="changeRatio">
          <el-option v-for="ratio in storyboardRatios" :key="ratio" :label="ratio" :value="ratio" />
        </el-select>
        <span class="toolLabel">网格</span>
        <el-select class="gridSelect" size="small" :modelValue="gridPreset" aria-label="网格" :disabled="busy" @change="changeGridPreset">
          <el-option v-for="size in storyboardSizes" :key="size" :value="size" :label="`${size}×${size}`" />
          <el-option v-if="gridPreset === 'customCurrent'" value="customCurrent" :label="`${board.rows}×${board.columns}`" disabled />
          <el-option value="custom" label="自定义" />
        </el-select>
        <span class="toolbarDivider" aria-hidden="true" />
        <el-button text :icon="IconLayoutGrid" :disabled="busy || !count" @click="run(compose)">拼接</el-button>
        <el-button text :bg="board.numbered" :icon="IconListNumbers" :disabled="busy" :aria-pressed="board.numbered" @click="update({ numbered: !board.numbered })">序号</el-button>
        <el-button text :icon="IconTrash" :disabled="busy || !count" @click="update({ shots: board.shots.map(() => null) })">清空</el-button>
        <span class="toolbarDivider" aria-hidden="true" />
        <el-button text :icon="IconBoxMultiple" :disabled="busy || !count" @click="run(() => releaseShots(true))">转普通组</el-button>
        <el-button text :icon="IconDeselect" :disabled="busy || !count" @click="run(() => releaseShots(false))">解组</el-button>
      </canvasToolbar>
      <canvasToolbar v-if="customGridOpen" class="customGrid">
        <form class="customGridForm" @submit.prevent="applyCustomGrid">
          <label>行 <el-input-number v-model="customRows" size="small" :min="1" :max="storyboardMaxSide" :step="1" :stepStrictly="true" :disabled="busy" aria-label="行数" /></label>
          <label>列 <el-input-number v-model="customColumns" size="small" :min="1" :max="storyboardMaxSide" :step="1" :stepStrictly="true" :disabled="busy" aria-label="列数" /></label>
          <el-button text nativeType="submit" :disabled="busy">应用</el-button>
          <el-button text @click="customGridOpen = false">取消</el-button>
        </form>
      </canvasToolbar>
    </div>
    <div class="storyboardTitle">{{ data.label || '分镜格子' }} <span>{{ count }} 张</span></div>
    <div class="storyboardGrid" :style="{ '--storyboardColumns': board.columns, '--storyboardRatio': board.ratio.replace(':', '/') }">
      <div
        v-for="(shot, index) in board.shots" :key="index"
        class="storyboardCell nodrag nopan"
        :class="{ activeSlot: dropSlot === index, draggingSlot: draggingSlot === index }"
        :data-storyboard-id="id" :data-storyboard-slot="index"
        :data-storyboard-busy="busy"
        @dragover.stop="onDragOver($event, index)" @dragleave="dropSlot = undefined"
        @drop.stop="onDrop($event, index)" @dblclick.stop>
        <button
          type="button" class="shotButton"
          :title="shot?.label || '上传图片'"
          :aria-label="shot ? `第 ${index + 1} 格 · ${shot.label}` : `第 ${index + 1} 格 · 上传图片`"
          :disabled="busy" :class="{ movable: shot }"
          @pointerdown="startDrag($event, index)" @pointermove="moveDrag"
          @pointerup="finishDrag" @pointercancel="stopDrag" @lostpointercapture="stopDrag"
          @click.stop="clickSlot($event, index)">
          <stackImage v-if="shot" :key="shot.id" :media="shot.media" :label="shot.label" @loaded="shotSizes.set(shot.id, $event)" />
          <icon-plus v-else :size="19" aria-hidden="true" />
          <span v-if="board.numbered && shot" class="shotNumber">{{ formatShotNumber(index) }}</span>
        </button>
        <button v-if="shot" type="button" class="removeShot" :disabled="busy" :aria-label="`移除第 ${index + 1} 格`" @click.stop="removeShot(index)">
          <icon-x :size="14" aria-hidden="true" />
        </button>
      </div>
    </div>
    <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFilesSelected" />
  </section>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from "vue";
import { useVueFlow, type Node, type NodeProps } from "@vue-flow/core";
import { ElButton, ElInputNumber, ElMessage, ElOption, ElSelect } from "element-plus";
import { IconBoxMultiple, IconDeselect, IconLayoutGrid, IconListNumbers, IconPlus, IconTrash, IconX } from "@tabler/icons-vue";
import { useNodeFiles, uploadNodeFile, type WorkspaceFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import { getMediaMimeType } from "@toonflow/node-shared/mediaTypes";
import { emptyMediaCardWidth, getMediaPreviewSize } from "@toonflow/node-shared/mediaPreviewSize";
import { createGroupNode } from "../selectionNodes";
import { readStoryboard, storyboardMaxSide, storyboardOption, storyboardRatios, storyboardSizes, validStoryboardSide, type Storyboard, type StoryboardShot } from "../storyboard";
import stackImage from "./stackImage.vue";
import canvasToolbar from "./canvasToolbar.vue";

const props = defineProps<NodeProps>();
defineOptions({ icon: storyboardOption.icon });

const flow = useVueFlow();
const toolbarVisible = computed(() => props.selected && flow.getSelectedNodes.value.length === 1);
const { getWorkspaceFiles } = useNodeFiles();
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory");
const board = computed(() => readStoryboard(props.data.storyboard));
const gridPreset = computed(() => storyboardSizes.find(size => board.value.rows === size && board.value.columns === size) ?? "customCurrent");
const customGridOpen = ref(false);
const customRows = ref<number | undefined>(board.value.rows);
const customColumns = ref<number | undefined>(board.value.columns);
const count = computed(() => board.value.shots.filter(Boolean).length);
const fileInput = ref<HTMLInputElement>();
const busy = ref(false);
const dropSlot = ref<number>();
const draggingSlot = ref<number>();
const shotSizes = new Map<string, { width: number; height: number }>();
watch(() => board.value.shots, shots => {
  const ids = new Set(shots.flatMap(shot => shot ? [shot.id] : []));
  for (const id of shotSizes.keys()) if (!ids.has(id)) shotSizes.delete(id);
});
let uploadSlot = 0;
let drag: { index: number; pointer: number; x: number; y: number; moved: boolean } | undefined;
let suppressSlotClick = false;

watch(toolbarVisible, visible => {
  if (!visible) customGridOpen.value = false;
});

function update(patch: Partial<Storyboard>) {
  flow.updateNodeData(props.id, { storyboard: { ...board.value, ...patch } });
}

function changeRatio(ratio: Storyboard["ratio"]) {
  if (storyboardRatios.includes(ratio)) update({ ratio });
}

function openCustomGrid() {
  customRows.value = board.value.rows;
  customColumns.value = board.value.columns;
  customGridOpen.value = true;
}

function changeGridPreset(value: number | string) {
  if (value === "custom") {
    openCustomGrid();
    return;
  }
  const size = storyboardSizes.find(size => size === value);
  if (size && resizeGrid(size, size)) customGridOpen.value = false;
}

function applyCustomGrid() {
  if (resizeGrid(customRows.value, customColumns.value)) customGridOpen.value = false;
}

function resizeGrid(rows: number | undefined, columns: number | undefined) {
  if (!validStoryboardSide(rows) || !validStoryboardSide(columns)) {
    ElMessage.warning(`行数和列数须为 1–${storyboardMaxSide} 的整数`);
    return false;
  }
  const capacity = rows * columns;
  if (count.value > capacity) {
    ElMessage.warning("当前图片数量超过所选网格容量");
    return false;
  }
  const previous = board.value.shots;
  const shots = previous.slice(capacity).some(Boolean) ? previous.filter(Boolean) : previous.slice(0, capacity);
  update({ rows, columns, shots });
  return true;
}

function selectBoard() {
  const node = flow.findNode(props.id);
  if (!node || node.selected) return;
  flow.removeSelectedElements();
  flow.nodesSelectionActive.value = false;
  flow.addSelectedNodes([node]);
}

function swapSlots(from: number, to: number) {
  const shots = [...board.value.shots];
  const source = shots[from];
  if (!source || from === to || to < 0 || to >= shots.length) return;
  shots[from] = shots[to] ?? null;
  shots[to] = source;
  update({ shots });
}

function clickSlot(event: MouseEvent, index: number) {
  if (suppressSlotClick && event.detail !== 0) return;
  selectBoard();
  if (board.value.shots[index]) return;
  uploadSlot = index;
  fileInput.value?.click();
}

function removeShot(index: number) {
  const shots = [...board.value.shots];
  shots[index] = null;
  update({ shots });
}

function startDrag(event: PointerEvent, index: number) {
  suppressSlotClick = false;
  if (!event.isPrimary || event.button !== 0 || !board.value.shots[index] || busy.value) return;
  drag = { index, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function moveDrag(event: PointerEvent) {
  if (!drag || drag.pointer !== event.pointerId) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
  drag.moved = true;
  draggingSlot.value = drag.index;
  dropSlot.value = getDropSlot(document.elementFromPoint(event.clientX, event.clientY));
}

function getDropSlot(target: Element | null) {
  const cell = target?.closest<HTMLElement>("[data-storyboard-slot]");
  return cell?.dataset.storyboardId === props.id ? Number(cell.dataset.storyboardSlot) : undefined;
}

function finishDrag(event: PointerEvent) {
  if (!drag || drag.pointer !== event.pointerId) return;
  if (drag.moved) {
    suppressSlotClick = true;
    selectBoard();
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const slot = getDropSlot(target);
    if (slot !== undefined) swapSlots(drag.index, slot);
    else if (target?.classList.contains("vue-flow__pane") && flow.vueFlowRef.value?.contains(target)) {
      const { index } = drag;
      const position = flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
      void run(() => moveShotToCanvas(index, position));
    }
  }
  stopDrag();
}

function stopDrag() {
  drag = undefined;
  draggingSlot.value = undefined;
  dropSlot.value = undefined;
}

function onDragOver(event: DragEvent, index: number) {
  const transfer = event.dataTransfer;
  if (!transfer || busy.value) return;
  if (!transfer.types.includes("Files")) return;
  event.preventDefault();
  transfer.dropEffect = "copy";
  dropSlot.value = index;
}

function onDrop(event: DragEvent, index: number) {
  const transfer = event.dataTransfer;
  if (!transfer || busy.value) return;
  event.preventDefault();
  dropSlot.value = undefined;
  if (transfer.files.length) {
    void run(() => uploadImages([...transfer.files], index));
  }
}

function onFilesSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  if (files.length) void run(() => uploadImages(files, uploadSlot));
}

async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  try {
    await action();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "分镜操作失败");
  } finally {
    busy.value = false;
  }
}

async function uploadImages(files: File[], index: number) {
  const images = files.map(file => ({ file, mimeType: getMediaMimeType(file) })).filter(image => image.mimeType.startsWith("image/"));
  if (!images.length) throw new Error("请选择图片文件");
  const node = flow.findNode(props.id);
  if (!node) return;
  const workspaceFiles = getWorkspaceFiles();
  const state = node.data.storyboard;
  const shots = [...board.value.shots];
  const free = shots.map((shot, slot) => shot ? -1 : slot).filter(slot => slot >= 0);
  const slots = [...free.filter(slot => slot >= index), ...free.filter(slot => slot < index)];
  if (images.length > slots.length) throw new Error(`当前还剩 ${slots.length} 个空格，请扩大网格或减少上传数量`);
  for (const [order, { file, mimeType }] of images.entries()) {
    if (flow.findNode(props.id) !== node || node.data.storyboard !== state) throw new Error("分镜已变化，请重新上传");
    const url = await uploadNodeFile(workspaceFiles, props.id, file);
    shots[slots[order]!] = { id: crypto.randomUUID(), label: file.name, media: { url, mimeType } };
  }
  if (flow.findNode(props.id) !== node || node.data.storyboard !== state) throw new Error("分镜已变化，请重新上传");
  update({ shots });
  if (images.length < files.length) ElMessage.warning("已跳过非图片文件");
}

function imageNode(shot: StoryboardShot, position: Node["position"], parentNode?: string): Node {
  return {
    id: crypto.randomUUID(),
    type: "remote-imageNode",
    position,
    parentNode,
    data: { label: shot.label, outputs: { image: { dataType: "IMAGE", value: { ...shot.media } } } },
  };
}

function ensureImagePlugin() {
  if (!flow.nodeTypes?.value?.["remote-imageNode"]) throw new Error("请先启用图片节点插件");
}

async function moveShotToCanvas(index: number, position: Node["position"]) {
  ensureImagePlugin();
  const shot = board.value.shots[index];
  if (!shot || !batchHistory) return;
  await batchHistory(async () => {
    flow.addNodes([imageNode(shot, position)]);
    removeShot(index);
  });
}

async function releaseShots(grouped: boolean) {
  ensureImagePlugin();
  const node = flow.findNode(props.id);
  if (!node || !batchHistory) return;
  const { shots, rows, columns, ratio, numbered } = board.value;
  const columnWidths = Array<number>(columns).fill(0);
  const rowHeights = Array<number>(rows).fill(0);
  const items = shots.flatMap((shot, index) => {
    if (!shot) return [];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const source = shotSizes.get(shot.id);
    const preview = source ? getMediaPreviewSize(source.width, source.height) : { width: emptyMediaCardWidth, height: 320 };
    // ACT: 用已加载的缩略图估算节点尺寸，额外留出标题和边框空间。实际组框由现有测量逻辑贴合节点。
    const width = Math.ceil(preview.width + 6);
    const height = Math.ceil(preview.height + 72);
    columnWidths[column] = Math.max(columnWidths[column]!, width);
    rowHeights[row] = Math.max(rowHeights[row]!, height);
    return [{ shot, column, row, index }];
  });
  if (!items.length) return;
  let width = 0;
  const columnOffsets = columnWidths.map(size => {
    const offset = width;
    width += size ? size + 24 : 0;
    return offset;
  });
  let height = 0;
  const rowOffsets = rowHeights.map(size => {
    const offset = height;
    height += size ? size + 24 : 0;
    return offset;
  });
  const group = grouped ? createGroupNode({ ...node.position, width: width - 24, height: height - 24 }, node.parentNode) : undefined;
  if (group) group.data = { ...group.data, storyboardLayout: { rows, columns, ratio, numbered, label: node.data.label } };
  const images = items.map(({ shot, column, row, index }) => {
    const image = imageNode(shot, {
      x: node.position.x + columnOffsets[column]! - (group?.position.x ?? 0),
      y: node.position.y + rowOffsets[row]! - (group?.position.y ?? 0),
    }, group?.id ?? node.parentNode);
    if (group) image.data!.storyboardSlot = index;
    return image;
  });
  await batchHistory(async () => {
    flow.addNodes(group ? [group, ...images] : images);
    flow.removeNodes([node]);
    await nextTick();
    flow.removeSelectedElements();
    const selectedNodes = (group ? [group] : images).flatMap(item => flow.findNode(item.id) ?? []);
    flow.addSelectedNodes(selectedNodes);
    if (group) {
      flow.nodesSelectionActive.value = true;
      flow.updateNodeInternals([group.id]);
    }
  });
}

async function drawShot(files: WorkspaceFiles, context: CanvasRenderingContext2D, shot: StoryboardShot, x: number, y: number, width: number, height: number) {
  const content = await files.read(shot.media.url);
  const url = URL.createObjectURL(new Blob([content], { type: shot.media.mimeType }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => { throw new Error(`无法读取图片「${shot.label}」`); });
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    context.drawImage(image, (image.naturalWidth - sourceWidth) / 2, (image.naturalHeight - sourceHeight) / 2, sourceWidth, sourceHeight, x, y, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function formatShotNumber(index: number) {
  return String(index + 1).padStart(2, "0");
}

async function compose() {
  ensureImagePlugin();
  const node = flow.findNode(props.id);
  if (!node) return;
  const files = getWorkspaceFiles();
  const state = node.data.storyboard;
  const { shots, rows, columns, ratio, numbered } = board.value;
  const [rw, rh] = ratio.split(":").map(Number) as [number, number];
  const composeLongSide = 2048;
  const scale = composeLongSide / Math.max(rw * columns, rh * rows);
  const width = Math.floor(rw * scale);
  const height = Math.floor(rh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width * columns;
  canvas.height = height * rows;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法拼接图片");
  context.fillStyle = "#242424";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const [index, shot] of shots.entries()) {
    const x = index % columns * width;
    const y = Math.floor(index / columns) * height;
    if (shot) await drawShot(files, context, shot, x, y, width, height);
    if (numbered && shot) {
      const fontSize = Math.round(Math.min(width, height) * 0.09);
      const label = formatShotNumber(index);
      const left = x + fontSize * .5;
      const bottom = y + height - fontSize * .45;
      context.font = `700 ${fontSize}px sans-serif`;
      context.textBaseline = "bottom";
      context.strokeStyle = "#000c";
      context.lineWidth = Math.max(2, fontSize * .18);
      context.lineJoin = "round";
      context.strokeText(label, left, bottom);
      context.fillStyle = "#fff";
      context.fillText(label, left, bottom);
    }
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error("生成拼接图片失败")), "image/png");
  });
  if (flow.findNode(props.id) !== node || node.data.storyboard !== state) throw new Error("分镜已变化，请重新拼接");
  const label = `${node.data.label || storyboardOption.label} · 拼接`;
  const result = imageNode({ id: "", label, media: { url: "", mimeType: "image/png" } }, { x: node.position.x + node.dimensions.width + 36, y: node.position.y }, node.parentNode);
  const url = await uploadNodeFile(files, result.id, new File([blob], "storyboard.png", { type: "image/png" }));
  if (flow.findNode(props.id) !== node || node.data.storyboard !== state) throw new Error("分镜已变化，请重新拼接");
  ensureImagePlugin();
  result.data!.outputs.image.value.url = url;
  flow.addNodes([result]);
  ElMessage.success("拼接图片已添加到画布");
}
</script>

<style scoped lang="scss">
.storyboardNode {
  position: relative;
  width: 560px;
  color: var(--el-text-color-regular);

  .storyboardTitle {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 7px 2px;
    font-size: 13px;
    cursor: grab;

    span { color: var(--el-text-color-secondary); font-size: 11px; }
  }

  .storyboardTools {
    position: absolute;
    z-index: 2;
    bottom: calc(100% + var(--nodeToolbarGap, 6px));
    left: 50%;
    width: max-content;
    transform: translateX(-50%);

    .storyboardToolbar { position: relative; }
    .toolLabel { padding: 0 4px; font-size: 12px; }
    .ratioSelect, .gridSelect { width: 68px; }

    .customGrid {
      top: calc(100% + 6px);
      left: 82px;

      .customGridForm {
        display: flex;
        align-items: center;
        gap: 4px;

        label { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; }
        .el-input-number { width: 88px; }
      }
    }
  }

  .storyboardGrid {
    display: grid;
    grid-template-columns: repeat(var(--storyboardColumns), minmax(0, 1fr));
    gap: 2px;
    padding: 2px;
    overflow: hidden;
    border: 1px solid var(--el-border-color);
    border-radius: 10px;
    background: var(--el-bg-color);

    .storyboardCell {
      position: relative;
      aspect-ratio: var(--storyboardRatio);
      overflow: hidden;
      border-radius: 3px;
      background: var(--el-fill-color);

      .shotButton {
        display: grid;
        width: 100%;
        height: 100%;
        place-items: center;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--el-text-color-secondary);
        cursor: pointer;

        &.movable { cursor: grab; touch-action: none; }
        &:hover { background: var(--el-fill-color-dark); color: var(--el-text-color-primary); }
        &:focus-visible { outline: 2px solid var(--canvasSelectionColor, #fff); outline-offset: -2px; }
        :deep(img) { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      }

      .shotNumber {
        position: absolute;
        bottom: 4px;
        left: 5px;
        color: #fff;
        font-size: 13px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        line-height: 1;
        text-shadow: 0 1px 2px #000, 0 0 4px #000, 0 0 1px #000;
        pointer-events: none;
      }
      .removeShot {
        position: absolute;
        top: 5px;
        right: 5px;
        display: grid;
        place-items: center;
        min-width: 18px;
        height: 18px;
        border: 0;
        border-radius: 4px;
        padding: 0 3px;
        background: rgb(0 0 0 / 65%);
        color: #fff;
        font-size: 11px;
        cursor: pointer;
        opacity: 0;
        pointer-events: none;
      }
      &:hover .removeShot,
      &:focus-within .removeShot { opacity: 1; pointer-events: auto; }
      &.draggingSlot .shotButton { opacity: .6; cursor: grabbing; }
      &.activeSlot::after {
        position: absolute;
        inset: 0;
        border: 2px solid var(--canvasSelectionColor, #fff);
        border-radius: inherit;
        pointer-events: none;
        content: "";
      }
    }
  }

  &.selected .storyboardGrid { border-color: var(--canvasSelectionColor, #fff); }
}
</style>
