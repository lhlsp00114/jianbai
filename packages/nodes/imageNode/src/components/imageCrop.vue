<template>
  <div ref="cropSurface" class="imageCrop nodrag nopan nowheel" :style="{ aspectRatio: `${width} / ${height}` }" @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop @contextmenu.stop.prevent>
    <div class="cropShade" aria-hidden="true"><div :style="selectionStyle" /></div>
    <div ref="selection" class="cropSelection" :style="selectionStyle" tabindex="0" role="group" aria-label="裁剪区域，方向键移动，拖动边角调整大小" @pointerdown.stop.prevent="startDrag($event, 'move')" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag" @keydown="moveWithKeyboard($event, 'move')">
      <div class="cropGrid" aria-hidden="true" />
      <button v-for="handle in handles" :key="handle.direction" type="button" class="cropHandle" :class="handle.direction" :disabled="busy || disabled" :aria-label="handle.label" @pointerdown.stop.prevent="startDrag($event, handle.direction)" @keydown.stop="moveWithKeyboard($event, handle.direction)" />
    </div>
    <teleport v-if="toolbarTarget" :to="toolbarTarget">
      <div class="cropToolbar" role="toolbar" aria-label="裁剪图片">
        <el-select v-model="ratio" class="cropRatio" :disabled="busy || disabled" aria-label="裁剪比例" @change="resetSelection" @visibleChange="ratioOpen = $event">
          <el-option label="原图比例" value="original" />
          <el-option v-for="item in ['1:1', '4:3', '3:4', '16:9', '9:16']" :key="item" :label="item" :value="item" />
        </el-select>
        <el-button class="confirmButton" :loading="busy" :disabled="disabled || !!drag" @click="emit('confirm', { ...rect })">确认</el-button>
        <el-button :icon="IconX" :disabled="busy" text title="取消裁剪" aria-label="取消裁剪" @click="emit('cancel')" />
      </div>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElButton, ElSelect, ElOption } from "element-plus";
import { IconX } from "@tabler/icons-vue";

type CropRect = { x: number; y: number; width: number; height: number };
const props = defineProps<{ width: number; height: number; toolbarTarget?: HTMLElement; busy: boolean; disabled?: boolean; active: boolean }>();
const emit = defineEmits<{ cancel: []; confirm: [rect: CropRect] }>();
const cropSurface = ref<HTMLElement>();
const selection = ref<HTMLElement>();
const ratio = ref("original");
const ratioOpen = ref(false);
const rect = ref<CropRect>({ x: 0, y: 0, width: props.width, height: props.height });
const drag = ref<{ pointerId: number; direction: string; x: number; y: number; rect: CropRect }>();
const handles = [
  { direction: "nw", label: "调整左上角" }, { direction: "n", label: "调整上边" },
  { direction: "ne", label: "调整右上角" }, { direction: "e", label: "调整右边" },
  { direction: "se", label: "调整右下角" }, { direction: "s", label: "调整下边" },
  { direction: "sw", label: "调整左下角" }, { direction: "w", label: "调整左边" },
];
const aspect = computed(() => {
  if (ratio.value === "original") return 0;
  const [width, height] = ratio.value.split(":").map(Number);
  return width! / height!;
});
const selectionStyle = computed(() => ({
  left: `${rect.value.x / props.width * 100}%`, top: `${rect.value.y / props.height * 100}%`,
  width: `${rect.value.width / props.width * 100}%`, height: `${rect.value.height / props.height * 100}%`,
}));

function resetSelection() {
  endDrag();
  const width = aspect.value ? Math.min(props.width, props.height * aspect.value) : props.width;
  const height = aspect.value ? width / aspect.value : props.height;
  rect.value = { x: (props.width - width) / 2, y: (props.height - height) / 2, width, height };
}
watch(() => [props.width, props.height], resetSelection);

function getPoint(event: PointerEvent) {
  const bounds = cropSurface.value!.getBoundingClientRect();
  return { x: (event.clientX - bounds.left) / bounds.width * props.width, y: (event.clientY - bounds.top) / bounds.height * props.height };
}

function startDrag(event: PointerEvent, direction: string) {
  if (props.busy || props.disabled || event.button !== 0 || drag.value) return;
  selection.value?.focus({ preventScroll: true });
  drag.value = { pointerId: event.pointerId, direction, ...getPoint(event), rect: { ...rect.value } };
  selection.value?.setPointerCapture(event.pointerId);
}

function changeRect(source: CropRect, direction: string, dx: number, dy: number) {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  if (direction === "move") {
    rect.value = { ...source, x: clamp(source.x + dx, 0, props.width - source.width), y: clamp(source.y + dy, 0, props.height - source.height) };
    return;
  }
  const west = direction.includes("w"), east = direction.includes("e");
  const north = direction.includes("n"), south = direction.includes("s");
  const horizontal = west || east, vertical = north || south;
  const anchorX = west ? source.x + source.width : east ? source.x : source.x + source.width / 2;
  const anchorY = north ? source.y + source.height : south ? source.y : source.y + source.height / 2;
  const maxWidth = horizontal ? (west ? anchorX : props.width - anchorX) : 2 * Math.min(anchorX, props.width - anchorX);
  const maxHeight = vertical ? (north ? anchorY : props.height - anchorY) : 2 * Math.min(anchorY, props.height - anchorY);
  let width = source.width + (west ? -dx : east ? dx : 0);
  let height = source.height + (north ? -dy : south ? dy : 0);
  if (aspect.value) {
    if (!horizontal || (vertical && Math.abs(dy * aspect.value) > Math.abs(dx))) width = height * aspect.value;
    const maximum = Math.min(maxWidth, maxHeight * aspect.value);
    width = clamp(width, Math.min(maximum, Math.max(1, aspect.value)), maximum);
    height = width / aspect.value;
  } else {
    width = clamp(width, 1, maxWidth);
    height = clamp(height, 1, maxHeight);
  }
  rect.value = {
    x: west ? anchorX - width : east ? anchorX : anchorX - width / 2,
    y: north ? anchorY - height : south ? anchorY : anchorY - height / 2,
    width, height,
  };
}

function moveDrag(event: PointerEvent) {
  if (!drag.value || drag.value.pointerId !== event.pointerId || props.busy || props.disabled) return;
  const point = getPoint(event);
  changeRect(drag.value.rect, drag.value.direction, point.x - drag.value.x, point.y - drag.value.y);
}

function endDrag() {
  const pointerId = drag.value?.pointerId;
  drag.value = undefined;
  if (pointerId !== undefined && selection.value?.hasPointerCapture(pointerId)) selection.value.releasePointerCapture(pointerId);
}

function moveWithKeyboard(event: KeyboardEvent, direction: string) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (props.busy || props.disabled || drag.value) return;
  const step = event.shiftKey ? 10 : 1;
  changeRect(rect.value, direction, event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0);
}

function handleEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || !props.active) return;
  if (ratioOpen.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!props.busy) emit("cancel");
}
onMounted(() => { selection.value?.focus({ preventScroll: true }); window.addEventListener("keydown", handleEscape, true); });
onBeforeUnmount(() => { endDrag(); window.removeEventListener("keydown", handleEscape, true); });
</script>

<style scoped lang="scss">
@use "@toonflow/node-shared/imageToolStyles.scss" as tools;
:global(.nodeSkeleton .cardContainer .contentCard:has(.imageCrop)) {
  overflow: visible;
  border-color: transparent;
}
:global(.imageContent:has(.imageCrop)) { overflow: visible; }
:global(.nodeSkeleton .cardContainer .contentCard:has(.imageCrop) > .el-card__body) { overflow: visible; }
:global(.cardContainer:has(.imageCrop) > .resizeCorner) { visibility: hidden; }

.imageCrop {
  position: absolute;
  z-index: 2;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  overflow: visible;
  touch-action: none;
  user-select: none;
  .cropShade {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;

    > div { position: absolute; box-shadow: 0 0 0 10000px rgb(0 0 0 / 55%); }
  }

  .cropSelection {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid white;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 50%), inset 0 0 0 1px rgb(0 0 0 / 25%);
    cursor: move;
    outline: none;

    &:focus-visible { outline: 1px dashed white; outline-offset: 3px; }
    .cropGrid {
      position: absolute;
      inset: 0;
      pointer-events: none;
      &::before, &::after { content: ""; position: absolute; border: 0 solid rgb(255 255 255 / 40%); }
      &::before { inset: 0 calc(100% / 3); border-left-width: 1px; border-right-width: 1px; }
      &::after { inset: calc(100% / 3) 0; border-top-width: 1px; border-bottom-width: 1px; }
    }
    .cropHandle {
      position: absolute;
      width: 26px;
      height: 26px;
      padding: 0;
      border: 0;
      background: transparent;
      transform: translate(-50%, -50%);
      touch-action: none;

      &::after { content: ""; position: absolute; inset: 9px; border-radius: 2px; background: white; box-shadow: 0 0 2px #333; }
      &.nw { left: 0; top: 0; cursor: nwse-resize; }
      &.n { left: 50%; top: 0; cursor: ns-resize; }
      &.ne { left: 100%; top: 0; cursor: nesw-resize; }
      &.e { left: 100%; top: 50%; cursor: ew-resize; }
      &.se { left: 100%; top: 100%; cursor: nwse-resize; }
      &.s { left: 50%; top: 100%; cursor: ns-resize; }
      &.sw { left: 0; top: 100%; cursor: nesw-resize; }
      &.w { left: 0; top: 50%; cursor: ew-resize; }
    }
  }
}
.cropToolbar {
  @include tools.toolbar;

  .cropRatio { width: 116px; }
  .el-button { height: 32px; margin: 0; }
  .confirmButton { @include tools.action; }
}
</style>
