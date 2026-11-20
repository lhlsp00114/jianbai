<template>
  <canvas ref="previewCanvas" class="colorPreview" :class="{ ready }" aria-label="调色实时预览" />
  <teleport v-if="panelTarget" :to="panelTarget">
    <section ref="panel" v-show="active" class="colorPanel nodrag nopan nowheel" :style="panelStyle" aria-label="图片调色" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @wheel.stop @keydown.stop>
      <header class="panelHeader">
        <strong>调色</strong>
        <div class="headerActions">
          <el-button :icon="IconRestore" text :disabled="busy || disabled" title="重置全部调整" aria-label="重置全部调整" @click="reset" />
          <el-button :icon="IconX" text :disabled="busy" title="关闭调色" aria-label="关闭调色" @click="emit('cancel')" />
        </div>
      </header>
      <nav class="sectionNav" aria-label="调色栏目">
        <button v-for="(section, index) in colorSections" :key="section.label" type="button" :aria-label="section.label" :aria-pressed="activeSection === index" :title="section.label" @click="scrollToSection(index)">
          <component :is="sectionIcons[index]" :size="17" :strokeWidth="1.6" />
        </button>
      </nav>
      <div ref="scrollArea" class="adjustments" @scroll="updateSection">
        <section v-for="section in colorSections" :key="section.label" class="adjustmentSection" :aria-label="`${section.label}调整`">
          <h4>{{ section.label }}</h4>
          <label v-for="control in section.controls" :key="control.key" class="rangeControl">
            <span>{{ control.label }}<output>{{ settings[control.key] }}</output></span>
            <input v-model.number="settings[control.key]" type="range" :min="control.min" max="100" step="1" :disabled="busy || disabled || !!error" :aria-label="control.label" :style="{ '--rangeProgress': `${(settings[control.key] - control.min) / (100 - control.min) * 100}%` }" @dblclick.stop="!busy && !disabled && (settings[control.key] = 0)" />
          </label>
        </section>
      </div>
      <footer class="panelFooter">
        <span v-if="error" class="renderError" role="alert">{{ error }}</span>
        <el-button :icon="IconDeviceFloppy" :loading="busy" :disabled="disabled || !ready || !!error" @click="emit('confirm', { ...settings })">保存</el-button>
      </footer>
    </section>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton } from "element-plus";
import { IconBulb, IconDroplet, IconAdjustmentsHorizontal, IconFlask, IconRestore, IconX, IconDeviceFloppy } from "@tabler/icons-vue";
import { colorSections, createColorRenderer, createColorSettings, type ColorSettings } from "../imageColor";

const props = defineProps<{ image: HTMLImageElement; busy: boolean; disabled?: boolean; active: boolean }>();
const emit = defineEmits<{ cancel: []; confirm: [settings: ColorSettings] }>();
const { node } = useNode();
const { viewport, vueFlowRef, setViewport } = useVueFlow();
const previewCanvas = ref<HTMLCanvasElement>();
const panel = ref<HTMLElement>();
const scrollArea = ref<HTMLElement>();
const panelTarget = computed(() => previewCanvas.value?.closest<HTMLElement>(".vue-flow__node")
  ?? previewCanvas.value?.closest<HTMLElement>(".nodeSkeleton") ?? undefined);
const panelStyle = ref({ top: "0px", left: "100%", height: "520px", transform: "scale(1)" });
const sectionIcons = [IconBulb, IconDroplet, IconAdjustmentsHorizontal, IconFlask];
const settings = reactive(createColorSettings());
const activeSection = ref(0);
const ready = ref(false);
const error = ref("");
let renderer: ReturnType<typeof createColorRenderer> | undefined;
let frame = 0;
let resizeObserver: ResizeObserver | undefined;

function positionPanel() {
  const target = panelTarget.value;
  if (!target) return;
  const bounds = target.getBoundingClientRect();
  const imageBounds = props.image.getBoundingClientRect();
  const zoom = viewport.value.zoom;
  if (!zoom || !imageBounds.width) return;
  panelStyle.value = {
    top: `${(imageBounds.top - bounds.top) / zoom}px`,
    left: `${(imageBounds.right - bounds.left + 12) / zoom}px`,
    height: `${Math.max(180, Math.min(520, (vueFlowRef.value?.clientHeight ?? window.innerHeight) - 128))}px`,
    transform: `scale(${1 / zoom})`,
  };
  if (!frame && renderer && !error.value) frame = requestAnimationFrame(draw);
}
watch(() => [viewport.value.zoom, node.dimensions.width, node.dimensions.height, props.active], positionPanel, { flush: "post" });

function revealPanel() {
  const target = panelTarget.value;
  if (!target || !panel.value || !vueFlowRef.value || !props.active) return;
  const view = vueFlowRef.value.getBoundingClientRect();
  const bounds = panel.value.getBoundingClientRect();
  if (bounds.right <= view.right - 24 && bounds.bottom <= view.bottom - 64 && bounds.top >= view.top + 64) return;
  const image = props.image.getBoundingClientRect();
  const targetBounds = target.getBoundingClientRect();
  const zoom = viewport.value.zoom;
  const x = node.computedPosition.x + (image.left - targetBounds.left) / zoom;
  const y = node.computedPosition.y + (image.top - targetBounds.top) / zoom;
  const panelWidth = 12 + bounds.width;
  const nextZoom = Math.min(zoom, Math.max(1, view.width - 140 - panelWidth) / (image.width / zoom),
    Math.max(1, view.height - 128) / (image.height / zoom));
  const width = image.width / zoom * nextZoom + panelWidth;
  const height = Math.max(image.height / zoom * nextZoom, bounds.height);
  void setViewport({
    x: (view.width - width) / 2 - x * nextZoom,
    y: (view.height - height) / 2 - y * nextZoom,
    zoom: nextZoom,
  }, { duration: 200 });
}

function draw() {
  frame = 0;
  try {
    const canvas = previewCanvas.value;
    const size = previewSize();
    if (canvas && (size.width > canvas.width * 1.25 || size.width < canvas.width * 0.75)) renderer?.resize(size.width, size.height);
    renderer?.render(settings);
    ready.value = !!renderer;
  } catch (reason) {
    ready.value = false;
    error.value = reason instanceof Error ? reason.message : "无法显示调色预览";
  }
}

function previewSize() {
  const image = props.image;
  const scale = Math.min(1, 1440 / Math.max(image.naturalWidth, image.naturalHeight),
    Math.max(1, image.getBoundingClientRect().width * window.devicePixelRatio) / image.naturalWidth);
  return { width: Math.max(1, Math.round(image.naturalWidth * scale)), height: Math.max(1, Math.round(image.naturalHeight * scale)) };
}

watch(settings, () => {
  if (!frame && renderer && !error.value) frame = requestAnimationFrame(draw);
});

function reset() {
  Object.assign(settings, createColorSettings());
}

function scrollToSection(index: number) {
  const area = scrollArea.value;
  const section = area?.children[index] as HTMLElement | undefined;
  if (area && section) area.scrollTo({ top: section.offsetTop, behavior: "smooth" });
}

function updateSection() {
  const area = scrollArea.value;
  if (!area) return;
  const sections = [...area.children] as HTMLElement[];
  activeSection.value = area.scrollTop + area.clientHeight >= area.scrollHeight - 2 ? sections.length - 1
    : Math.max(0, sections.findLastIndex(section => section.offsetTop <= area.scrollTop + 20));
}

function handleEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.isComposing || !props.active) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!props.busy) emit("cancel");
}

function contextLost(event: Event) {
  event.preventDefault();
  ready.value = false;
  error.value = "调色预览已中断，请关闭后重新打开";
}

onMounted(() => {
  window.addEventListener("keydown", handleEscape, true);
  previewCanvas.value?.addEventListener("webglcontextlost", contextLost);
  resizeObserver = new ResizeObserver(positionPanel);
  resizeObserver.observe(props.image);
  if (panelTarget.value) resizeObserver.observe(panelTarget.value);
  if (vueFlowRef.value) resizeObserver.observe(vueFlowRef.value);
  positionPanel();
  try {
    const size = previewSize();
    renderer = createColorRenderer(previewCanvas.value!, props.image, size.width, size.height);
    draw();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "无法创建调色预览";
  }
  void nextTick(revealPanel);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", handleEscape, true);
  previewCanvas.value?.removeEventListener("webglcontextlost", contextLost);
  renderer?.dispose();
});
</script>

<style scoped lang="scss">
@use "@toonflow/node-shared/imageToolStyles.scss" as tools;
.colorPreview {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: var(--el-border-radius-base);
  pointer-events: none;
  visibility: hidden;
  &.ready { visibility: visible; }
}

.colorPanel {
  @include tools.surface;
  position: absolute;
  z-index: 5;
  display: flex;
  flex-direction: column;
  width: 292px;
  transform-origin: top left;
  box-sizing: border-box;
  font-size: 12px;
  line-height: 1.5;
  overflow: hidden;

  .panelHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    padding: 10px 10px 8px 16px;
    strong { font-size: 13px; font-weight: 600; }
    .headerActions {
      display: flex;
      .el-button { width: 28px; height: 28px; margin: 0; padding: 6px; color: var(--el-text-color-secondary); }
    }
  }
  .sectionNav {
    display: flex;
    flex-shrink: 0;
    gap: 3px;
    margin: 0 12px 8px;
    padding: 4px 0;
    button {
      @include tools.choice;
      display: grid;
      place-items: center;
      flex: 1;
      height: 28px;
      padding: 0;
    }
  }
  .adjustments {
    position: relative;
    flex: 1;
    min-height: 0;
    padding: 0 16px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--el-border-color) transparent;
    .adjustmentSection {
      padding: 10px 0 14px;
      & + .adjustmentSection { border-top: 1px solid var(--el-border-color-lighter); }
      h4 { margin: 0 0 10px; font-size: 12px; font-weight: 600; }
      .rangeControl {
        display: block;
        margin-top: 8px;
        span { display: flex; justify-content: space-between; color: var(--el-text-color-regular); }
        output { color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
        input {
          @include tools.range;
          display: block;
          width: 100%;
        }
      }
    }
  }
  .panelFooter {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    flex-shrink: 0;
    gap: 10px;
    padding: 10px 12px;
    border-top: 1px solid var(--el-border-color-lighter);
    .el-button { @include tools.action; height: 32px; padding: 0 16px; font-size: 12px; }
    .renderError { color: var(--el-color-danger); font-size: 11px; line-height: 1.5; }
  }
}
</style>
