<template>
  <div class="compareViewer" :class="{ expanded, zoomed: zoom > 1 }">
    <div v-if="visibleSides.length || expanded" class="viewToolbar nodrag nopan" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @keydown.stop>
      <div v-if="ready" class="modeButtons" role="group" aria-label="对比方式">
        <el-button v-for="item in modes" :key="item.id" :icon="item.icon" text :title="item.label" :aria-label="item.label" :aria-pressed="mode === item.id" @click="mode = item.id" />
        <template v-if="mode === 'toggle'">
          <el-button v-for="side in sides" :key="side.id" text :aria-pressed="activeSide === side.id" :aria-label="'显示图片 ' + side.label" @click="activeSide = side.id">{{ side.label }}</el-button>
        </template>
      </div>
      <div class="viewActions">
        <template v-if="expanded">
          <el-button :icon="IconZoomOut" text title="缩小" aria-label="缩小" :disabled="zoom <= 1" @click="changeZoom(-0.5)" />
          <el-button text title="重置视图" aria-label="重置视图" @click="resetView">{{ Math.round(zoom * 100) }}%</el-button>
          <el-button :icon="IconZoomIn" text title="放大" aria-label="放大" :disabled="zoom >= 4" @click="changeZoom(0.5)" />
        </template>
        <el-button v-else :icon="IconMaximize" text title="放大对比" aria-label="放大对比" @click="emit('expand')" />
      </div>
    </div>
    <div class="previewStage" :class="{ sideBySide, panning: drag }" :style="stageStyle" @wheel="zoomAtPointer" @pointerdown="startPan" @pointermove="movePan" @pointerup="endPan" @pointercancel="endPan" @lostpointercapture="endPan">
      <div v-for="side in visibleSides" :key="side.id" class="previewLayer" :class="{ clipped: ready && mode === 'slider' && side.id === 'left' }">
        <img :src="side.url" :alt="'图片 ' + side.label" draggable="false" @error="emit('imageError', side.id, ($event.target as HTMLImageElement).getAttribute('src') ?? '')" />
        <span v-if="ready && mode !== 'slider'" class="sideLabel">{{ side.label }}</span>
      </div>
      <template v-if="ready && mode === 'slider'">
        <div class="divider" aria-hidden="true"><icon-arrows-horizontal :size="16" /></div>
        <input v-model.number="split" class="splitControl nodrag nopan" type="range" min="0" max="100" step="1" aria-label="图片对比分割位置" @pointerdown="startSlide" @pointermove="moveSlide" @mousedown.stop @click.stop @dblclick.stop @keydown.stop />
      </template>
      <div v-if="!visibleSides.length" class="emptyPreview">
        <icon-photo :size="24" />
        <span>连线或从画布选图</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { ElButton } from "element-plus";
import { IconArrowsHorizontal, IconLayoutColumns, IconMaximize, IconPhoto, IconSeparatorVertical, IconSwitchHorizontal, IconZoomIn, IconZoomOut } from "@tabler/icons-vue";

type CompareMode = "slider" | "sideBySide" | "toggle";
type Side = "left" | "right";
const props = defineProps<{ leftUrl: string; rightUrl: string; expanded?: boolean }>();
const emit = defineEmits<{ expand: []; imageError: [side: Side, url: string] }>();
const mode = defineModel<CompareMode>("mode", { required: true });
const split = defineModel<number>("split", { required: true });
const activeSide = defineModel<Side>("activeSide", { required: true });
const modes = [
  { id: "sideBySide", label: "并排对比", icon: IconLayoutColumns },
  { id: "slider", label: "滑块对比", icon: IconSeparatorVertical },
  { id: "toggle", label: "切换对比", icon: IconSwitchHorizontal },
] as const;
const sides = computed(() => [
  { id: "left", label: "A", url: props.leftUrl },
  { id: "right", label: "B", url: props.rightUrl },
] as const);
const ready = computed(() => !!props.leftUrl && !!props.rightUrl);
const sideBySide = computed(() => ready.value && mode.value === "sideBySide");
const visibleSides = computed(() => {
  if (!ready.value) return sides.value.filter(side => side.url);
  if (mode.value === "toggle") return sides.value.filter(side => side.id === activeSide.value);
  return mode.value === "slider" ? [...sides.value].reverse() : sides.value;
});
const zoom = ref(1);
const offset = ref({ x: 0, y: 0 });
const drag = shallowRef<{ id: number; buttons: number; x: number; y: number; width: number; height: number; startX: number; startY: number }>();
const stageStyle = computed(() => ({
  "--split": split.value + "%",
  "--zoom": zoom.value,
  "--panX": offset.value.x + "%",
  "--panY": offset.value.y + "%",
}));

function setOffset(x: number, y: number) {
  const limit = (zoom.value - 1) * 50;
  offset.value = { x: Math.max(-limit, Math.min(limit, x)), y: Math.max(-limit, Math.min(limit, y)) };
}

function changeZoom(delta: number, anchorX = 0, anchorY = 0) {
  const previous = zoom.value;
  zoom.value = Math.max(1, Math.min(4, previous + delta));
  const ratio = zoom.value / previous;
  setOffset(anchorX + (offset.value.x - anchorX) * ratio, anchorY + (offset.value.y - anchorY) * ratio);
}

function zoomAtPointer(event: WheelEvent) {
  if (!props.expanded || !visibleSides.value.length || !event.deltaY) return;
  event.preventDefault();
  event.stopPropagation();
  if (drag.value) return;
  const stage = event.currentTarget as HTMLElement;
  const { left, top, width, height } = stage.getBoundingClientRect();
  if (!width || !height) return;
  const panelWidth = sideBySide.value ? (width - 1) / 2 : width;
  const x = event.clientX - left;
  const panelLeft = sideBySide.value && x >= width / 2 ? panelWidth + 1 : 0;
  const anchorX = 100 * ((x - panelLeft) / panelWidth - 0.5);
  const anchorY = 100 * ((event.clientY - top) / height - 0.5);
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
  const factor = Math.exp(-Math.max(-120, Math.min(120, pixels)) / 480);
  changeZoom(zoom.value * (factor - 1), anchorX, anchorY);
}

function resetView() {
  zoom.value = 1;
  split.value = 50;
  setOffset(0, 0);
}

function startPan(event: PointerEvent) {
  const middle = props.expanded && event.button === 1;
  if (middle) event.preventDefault();
  if (zoom.value <= 1 || (!middle && event.button !== 0) || drag.value) return;
  const stage = event.currentTarget as HTMLElement;
  const { width, height } = stage.getBoundingClientRect();
  if (!width || !height) return;
  const panelWidth = sideBySide.value ? (width - 1) / 2 : width;
  stage.setPointerCapture(event.pointerId);
  drag.value = { id: event.pointerId, buttons: middle ? 4 : 1, x: event.clientX, y: event.clientY, width: panelWidth, height, startX: offset.value.x, startY: offset.value.y };
}

function movePan(event: PointerEvent) {
  const pan = drag.value;
  if (!pan || pan.id !== event.pointerId) return;
  if (!(event.buttons & pan.buttons)) {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    endPan(event);
    return;
  }
  setOffset(pan.startX + 100 * (event.clientX - pan.x) / pan.width, pan.startY + 100 * (event.clientY - pan.y) / pan.height);
}

function endPan(event: PointerEvent) {
  if (drag.value?.id === event.pointerId) drag.value = undefined;
}

function startSlide(event: PointerEvent) {
  if (event.button !== 0) return;
  event.stopPropagation();
  event.preventDefault();
  const slider = event.currentTarget as HTMLInputElement;
  slider.focus({ preventScroll: true });
  slider.setPointerCapture(event.pointerId);
  moveSlide(event);
}

function moveSlide(event: PointerEvent) {
  const slider = event.currentTarget as HTMLInputElement;
  if (!slider.hasPointerCapture(event.pointerId)) return;
  const rect = slider.parentElement?.getBoundingClientRect();
  if (rect?.width) split.value = Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 100);
}
</script>

<style scoped lang="scss">
.compareViewer {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;

  .viewToolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;

    .modeButtons, .viewActions { display: flex; align-items: center; gap: 2px; }
    .viewActions { margin-inline-start: auto; }
    .el-button { margin: 0; padding: 0 7px; border-radius: 7px; }
    .el-button[aria-pressed="true"] { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
  }

  .previewStage {
    position: relative;
    isolation: isolate;
    flex: 1;
    min-height: 100px;
    aspect-ratio: 3 / 2;
    overflow: hidden;
    background: var(--el-bg-color-overlay);

    .previewLayer {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      background: var(--el-bg-color-overlay);

      &.clipped { clip-path: inset(0 calc(100% - var(--split)) 0 0); }
      img { width: 100%; height: 100%; object-fit: contain; transform: translate(var(--panX), var(--panY)) scale(var(--zoom)); }
      .sideLabel { position: absolute; top: 8px; left: 8px; padding: 2px 6px; border-radius: 5px; background: var(--el-bg-color-overlay); color: var(--el-text-color-primary); font-size: 12px; }
    }

    &.sideBySide {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1px;
      background: var(--el-border-color-lighter);
      .previewLayer { position: relative; min-height: 0; }
      img { position: absolute; inset: 0; }
    }
    .emptyPreview { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--el-text-color-secondary); font-size: 12px; }
    .divider {
      position: absolute;
      inset: 0 auto 0 var(--split);
      width: 2px;
      transform: translateX(-50%);
      background: #fff;
      box-shadow: 0 0 6px #0009;
      pointer-events: none;

      svg { position: absolute; top: 50%; left: 50%; padding: 5px; transform: translate(-50%, -50%); border-radius: 50%; background: #fff; color: #202020; box-sizing: content-box; }
    }
    .splitControl { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ew-resize; touch-action: none; }
    &:has(.splitControl:focus-visible) { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
  }

  &.expanded {
    height: min(72dvh, 820px);
    gap: 8px;
    .viewToolbar { padding: 0; }
    .previewStage { aspect-ratio: auto; border-radius: 12px; }
  }
  &.zoomed .previewStage {
    touch-action: none;
    cursor: grab;
    &:active { cursor: grabbing; }
    .splitControl { left: clamp(0px, calc(var(--split) - 14px), calc(100% - 28px)); right: auto; width: 28px; }
    &.panning, &.panning .splitControl { cursor: grabbing; }
  }
}
</style>
