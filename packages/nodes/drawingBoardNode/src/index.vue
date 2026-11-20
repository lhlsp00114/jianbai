<template>
  <nodeSkeleton v-bind="nodeProps" contentPadding="0" :style="{ width: '360px' }" :downloadUrl="previewUrl" :downloadName="(nodeProps.label || '手绘画板') + '.png'" @fullscreen="openBoard">
    <button class="boardPreview nodrag nopan" type="button" :style="{ aspectRatio: savedRatio.replace(':', ' / ') }" :aria-label="previewUrl ? '编辑手绘画板' : '开始绘制'" @click.stop="openBoard" @dblclick.stop>
      <img v-if="previewUrl" :src="previewUrl" alt="手绘画板预览" draggable="false" />
      <template v-else><icon-brush :size="32" /><span>开始绘制</span></template>
    </button>
  </nodeSkeleton>

  <el-dialog v-model="editing" title="手绘画板" width="min(1120px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose :closeOnClickModal="false" :closeOnPressEscape="!busy" :showClose="!busy">
    <div v-if="editing" class="boardEditor nodrag nopan nowheel">
      <div class="boardToolbar" role="group" aria-label="手绘工具">
        <el-button v-for="item in drawingTools" :key="item.id" :icon="item.icon" text :disabled="busy" :aria-pressed="tool === item.id" :aria-label="item.label" :title="item.label" @click="tool = item.id" />
        <span class="divider" aria-hidden="true" />
        <div class="palette" role="group" aria-label="常用颜色">
          <button v-for="swatch in palette" :key="swatch.color" type="button" :style="{ '--swatch': swatch.color }" :aria-pressed="color === swatch.color" :aria-label="swatch.label" :title="swatch.label" :disabled="busy" @click="color = swatch.color" />
          <span class="customColor">
            <icon-plus :size="14" aria-hidden="true" />
            <input v-model="color" type="color" :disabled="busy" title="自定义颜色" aria-label="自定义颜色" />
          </span>
        </div>
        <label class="sizeControl">
          {{ tool === 'text' ? '字号' : '粗细' }}
          <input v-model.number="toolSize" type="range" :min="minToolSize" max="60" :style="{ '--rangeProgress': sizeProgress }" :disabled="busy" :aria-label="tool === 'text' ? '字号' : '粗细'" />
          <span>{{ toolSize }}</span>
        </label>
        <span class="divider" aria-hidden="true" />
        <el-button :icon="IconArrowBackUp" text :disabled="busy || !strokeCount" title="撤销" aria-label="撤销" @click="undo" />
        <el-button :icon="IconArrowForwardUp" text :disabled="busy || strokeCount === historyLength" title="重做" aria-label="重做" @click="redo" />
        <el-button :icon="IconRotateClockwise" text :disabled="busy || !hasDrawing" title="清空画板" aria-label="清空画板" @click="clear" />
        <el-button :icon="IconGridDots" text :disabled="busy" :aria-pressed="grid" title="显示网格" aria-label="显示网格" @click="grid = !grid" />
        <span class="divider" aria-hidden="true" />
        <el-select :modelValue="ratio" class="ratioSelect" :disabled="busy" aria-label="画板比例" placement="bottom-end" @update:modelValue="changeRatio">
          <el-option v-for="(value, name) in ratios" :key="name" :label="name" :value="name">
            <span class="ratioOption"><i :style="{ width: 18 * Math.min(1, value) + 'px', height: 18 * Math.min(1, 1 / value) + 'px' }" />{{ name }}</span>
          </el-option>
        </el-select>
        <el-button class="saveButton" :icon="IconCheck" :loading="busy" :disabled="!paintCanvas" @click="save">保存</el-button>
      </div>

      <div class="boardSurface" :class="{ showGrid: grid }" :style="{ '--boardRatio': ratios[ratio] }">
        <canvas ref="paintCanvas" :width="size.width" :height="size.height" :style="{ cursor: tool === 'text' ? 'text' : 'crosshair' }" aria-label="手绘画布"
          @pointerdown.stop.prevent="startStroke" @pointermove.stop.prevent="moveStroke" @pointerup.stop.prevent="finishStroke"
          @pointercancel.stop="cancelStroke" @lostpointercapture="cancelStroke" @contextmenu.prevent />
        <textarea v-if="textDraft" ref="textInput" v-model="textDraft.text" class="textInput" :style="textStyle" :rows="Math.max(1, textDraft.text.split('\n').length)" placeholder="输入文字" aria-label="画板文字" wrap="off" @keydown.stop="handleTextKey" @blur="commitText" />
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onScopeDispose, ref, toRaw, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElButton, ElDialog, ElOption, ElSelect } from "element-plus";
import { IconArrowBackUp, IconArrowForwardUp, IconBrush, IconCheck, IconCircle, IconEraser, IconGridDots, IconPlus, IconRotateClockwise, IconSquare, IconTypography } from "@tabler/icons-vue";
import { nodeSkeleton, uploadNodeFile, useNode, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import { getMediaPreviewSize } from "@toonflow/node-shared/mediaPreviewSize";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { usePaintCanvas, type PaintStroke, type PaintTool } from "@toonflow/node-shared/usePaintCanvas";

defineOptions({
  inheritAttrs: false,
  icon: IconBrush,
  handles: [{ id: "image", type: "source", dataType: "IMAGE", label: "手绘参考图" }] satisfies NodeHandle[],
});

const ratios = { "1:1": 1, "4:3": 4 / 3, "3:4": 3 / 4, "16:9": 16 / 9, "9:16": 9 / 16 };
type BoardRatio = keyof typeof ratios;
type BoardDrawing = { ratio: BoardRatio; grid: boolean; strokes: PaintStroke[] };

const { id, node, nodeProps, nodeEvent, outputs, files } = useNode({ label: "手绘画板" });
const { addNodes, findNode, getNodes, nodeTypes } = useVueFlow();
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
const data = node.data as typeof node.data & { drawing?: BoardDrawing };
const savedRatio = computed(() => data.drawing && Object.hasOwn(ratios, data.drawing.ratio) ? data.drawing.ratio : "16:9");
const previewUrl = files.useFileUrl(
  () => outputs.value.image?.dataType === "IMAGE" ? outputs.value.image.value : undefined,
  error => showNodeError(error, "手绘图片读取失败"),
);
const editing = ref(false);
const busy = ref(false);
const grid = ref(true);
const ratio = ref<BoardRatio>("16:9");
const size = computed(() => ({
  width: Math.round(1024 * Math.min(1, ratios[ratio.value])),
  height: Math.round(1024 * Math.min(1, 1 / ratios[ratio.value])),
}));
const paintCanvas = ref<HTMLCanvasElement>();
const palette = [
  { color: "#1f1f1f", label: "黑色" },
  { color: "#ffffff", label: "白色" },
  { color: "#ff3b30", label: "红色" },
  { color: "#ffcc00", label: "黄色" },
  { color: "#34c759", label: "绿色" },
  { color: "#0a84ff", label: "蓝色" },
];
const {
  tool, color, minToolSize, toolSize, sizeProgress, strokeCount, historyLength, hasDrawing,
  textInput, textDraft, textStyle, startStroke, moveStroke, finishStroke, cancelStroke,
  clear, undo, redo, commitText, handleTextKey, getStrokes, reset, resize,
} = usePaintCanvas(paintCanvas, busy, {
  canDraw: () => editing.value,
  defaultColor: palette[0].color,
  defaultBrushSize: 8,
});
const drawingTools = [
  { id: "brush", label: "画笔", icon: IconBrush },
  { id: "rectangle", label: "矩形", icon: IconSquare },
  { id: "circle", label: "圆形", icon: IconCircle },
  { id: "text", label: "文字", icon: IconTypography },
  { id: "eraser", label: "橡皮擦", icon: IconEraser },
] satisfies { id: PaintTool; label: string; icon: typeof IconBrush }[];
let disposed = false;
onScopeDispose(() => { disposed = true; });

nodeEvent.on("save", reason => {
  if (reason === "reload" && busy.value) throw new Error("手绘画板正在保存");
});
nodeEvent.on("delete", () => {
  if (busy.value) throw new Error("手绘画板正在保存，请稍后删除");
  return files.removeNodeFiles();
});

function openBoard() {
  if (editing.value || busy.value) return;
  grid.value = data.drawing?.grid ?? true;
  ratio.value = savedRatio.value;
  tool.value = "brush";
  editing.value = true;
}

watch(paintCanvas, canvas => {
  if (canvas && editing.value) reset(structuredClone(Array.isArray(data.drawing?.strokes) ? toRaw(data.drawing.strokes) : []));
}, { flush: "post" });

async function changeRatio(value: BoardRatio) {
  if (busy.value || !Object.hasOwn(ratios, value) || ratio.value === value) return;
  commitText();
  const previous = size.value;
  ratio.value = value;
  await nextTick();
  resize(previous);
}

async function save() {
  const canvas = paintCanvas.value;
  if (busy.value || !canvas || !editing.value) return;
  const imageType = "remote-imageNode";
  if (!nodeTypes?.value?.[imageType]) return showNodeError(new Error("请先启用图片节点插件"), "手绘画板保存失败");
  commitText();
  cancelStroke();
  const drawing: BoardDrawing = { ratio: ratio.value, grid: grid.value, strokes: getStrokes() };
  const imageId = crypto.randomUUID();
  let workspace: ReturnType<typeof files.getWorkspaceFiles> | undefined;
  let uploaded = false;
  let committed = false;
  busy.value = true;
  try {
    workspace = files.getWorkspaceFiles();
    const image = document.createElement("canvas");
    image.width = canvas.width;
    image.height = canvas.height;
    const context = image.getContext("2d");
    if (!context) throw new Error("无法创建手绘图片");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, image.width, image.height);
    context.drawImage(canvas, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => image.toBlob(result => result ? resolve(result) : reject(new Error("手绘图片编码失败")), "image/png"));
    if (disposed || findNode(id) !== node) return;
    const url = await uploadNodeFile(workspace, imageId, new File([blob], "drawing.png", { type: blob.type }));
    uploaded = true;
    await batchHistory(async () => {
      if (disposed || findNode(id) !== node || !nodeTypes?.value?.[imageType]) throw new Error("画布节点已变化，请重新保存");
      const x = node.computedPosition.x + node.dimensions.width + 80;
      let y = node.computedPosition.y;
      const preview = getMediaPreviewSize(image.width, image.height);
      for (const other of [...getNodes.value].sort((left, right) => left.computedPosition.y - right.computedPosition.y)) {
        const position = other.computedPosition;
        if (position.x < x + preview.width + 6 && position.x + other.dimensions.width > x
          && position.y < y + preview.height + 6 && position.y + other.dimensions.height > y) {
          y = position.y + other.dimensions.height + 40;
        }
      }
      const output = { dataType: "IMAGE" as const, value: { url, mimeType: "image/png" } };
      addNodes({ id: imageId, type: imageType, position: { x, y }, data: { label: `${node.data.label || "手绘画板"} · 图片`, outputs: { image: output } } });
      data.drawing = drawing;
      outputs.value.image = output;
      committed = true;
    });
    editing.value = false;
  } catch (error) {
    if (!disposed) showNodeError(error, "手绘画板保存失败");
  } finally {
    if (uploaded && !committed && workspace) {
      await workspace.remove(`assets/${imageId}`, true).catch(error => showNodeError(error, "手绘图片临时文件清理失败"));
    }
    busy.value = false;
  }
}
</script>

<style scoped lang="scss">
@use "@toonflow/node-shared/imageToolStyles.scss" as tools;

.boardPreview {
  @include tools.focusRing;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  position: relative;
  width: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font: inherit;
  cursor: pointer;

  &:hover { color: var(--el-text-color-primary); }
  img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
}

.boardEditor {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;

  .boardToolbar {
    @include tools.toolbar;
    max-width: 100%;
    box-sizing: border-box;

    .el-button { min-width: 32px; height: 32px; margin: 0; padding: 0 8px; border-radius: 8px; }
    .el-button[aria-pressed="true"] { @include tools.selected; }
    .saveButton { @include tools.action; padding: 0 10px; }
    .divider { width: 1px; height: 18px; margin: 0 4px; background: var(--el-border-color-lighter); }
    .palette {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 6px;

      button {
        @include tools.focusRing;
        box-sizing: border-box;
        width: 22px;
        height: 22px;
        padding: 0;
        border: 1px solid rgb(0 0 0 / 18%);
        border-radius: 50%;
        background: var(--swatch);
        cursor: pointer;

        &[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--el-bg-color-overlay), 0 0 0 4px #ddd; }
        &:disabled { opacity: 0.5; cursor: not-allowed; }
      }

      .customColor {
        position: relative;
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: #414143;
        color: #fff;

        &:hover { background: #505053; }
        &:has(input:focus-visible) { outline: 2px solid var(--el-color-primary); outline-offset: 1px; }
        &:has(input:disabled) { opacity: 0.5; }

        input {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          margin: 0;
          opacity: 0;
          cursor: pointer;

          &:disabled { cursor: not-allowed; }
        }
      }
    }

    .sizeControl {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 4px;
      color: var(--el-text-color-secondary);
      font-size: 12px;

      input { @include tools.range; width: 70px; }
      span { min-width: 18px; text-align: center; font-variant-numeric: tabular-nums; }
    }

    .ratioSelect {
      width: 72px;
      :deep(.el-select__wrapper) { background: transparent; box-shadow: none; }
    }
  }

  .boardSurface {
    position: relative;
    width: min(100%, calc((100dvh - 190px) * var(--boardRatio)));
    aspect-ratio: var(--boardRatio);
    overflow: hidden;
    border-radius: 14px;
    background: #fff;
    box-shadow: var(--el-box-shadow-light);

    &.showGrid {
      background-image: linear-gradient(to right, #2221 1px, transparent 1px), linear-gradient(to bottom, #2221 1px, transparent 1px);
      background-size: 24px 24px;
    }

    canvas { display: block; width: 100%; height: 100%; touch-action: none; }
    .textInput {
      position: absolute;
      z-index: 1;
      box-sizing: border-box;
      padding: 0;
      border: 0;
      border-radius: 4px;
      outline: 1px solid var(--el-color-primary);
      outline-offset: 2px;
      overflow: hidden;
      resize: none;
      background: rgb(255 255 255 / 80%);
      font-family: sans-serif;
      line-height: 1.25;
    }
  }
}

.ratioOption {
  display: flex;
  align-items: center;
  gap: 8px;

  i { box-sizing: border-box; flex: none; border: 1px solid currentColor; border-radius: 2px; opacity: 0.65; }
}
</style>
