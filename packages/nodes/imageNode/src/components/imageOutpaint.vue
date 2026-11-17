<template>
  <div class="outpaintEditor" @keydown.esc.stop.prevent="!creating && emit('close')">
    <div class="outpaintWorkspace">
      <div ref="stage" class="outpaintStage nodrag" :style="stageStyle" @pointerdown="startDrag($event, 'move')" @dblclick.stop>
        <img class="sourceImage" :src="src" :style="sourceStyle" alt="扩图原图" draggable="false" />
        <div class="outpaintFrame" aria-label="拖动边框调整扩图范围">
          <button v-for="handle in handles" :key="handle" class="resizeHandle" :class="handle" type="button" :disabled="disabled || creating" :aria-label="`调整${handleLabels[handle]}扩展范围`" @pointerdown.stop.prevent="startDrag($event, handle)" @keydown="resizeWithKeyboard($event, handle)" />
        </div>
      </div>
    </div>
    <teleport :to="target ?? 'body'" :disabled="!target">
      <div v-show="!!target" class="outpaintControls nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @keydown.esc.stop.prevent="!creating && emit('close')">
        <div class="ratioToolbar">
          <el-select :modelValue="expansionScale" class="scaleSelect" :disabled="disabled || creating" aria-label="扩展倍数" @update:modelValue="selectScale">
            <template #label>{{ expansionScale }}x</template>
            <el-option v-for="scale in scaleOptions" :key="scale" :label="scale + 'x'" :value="scale" />
          </el-select>
          <el-button v-for="ratio in ratioOptions" :key="ratio" :type="targetRatio === ratio ? 'primary' : 'default'" text :disabled="disabled || creating" @click="selectRatio(ratio)">{{ ratio }}</el-button>
          <el-button class="closeButton" text :icon="IconX" :disabled="creating" title="关闭扩图" aria-label="关闭扩图" @click="emit('close')" />
        </div>
        <div class="outpaintPromptBar">
          <div class="modelToolbar">
            <providerModelSelect v-model="modelKey" :models="models" :loading="modelsLoading" :disabled="disabled || creating" noDataText="请先在设置中添加图片模型" @open="loadModels" />
          </div>
          <div class="promptRow">
            <el-input v-model="prompt" class="promptField" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" resize="none" :disabled="disabled || creating" placeholder="补充扩图要求（可选）" aria-label="扩图提示词" />
            <el-button class="generateButton" type="primary" :icon="IconArrowUp" :loading="creating" :disabled="disabled || creating || !selectedModel" title="生成扩图" aria-label="生成扩图" @click="confirm" />
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import { ElButton, ElInput, ElOption, ElSelect } from "element-plus";
import { IconArrowUp, IconX } from "@tabler/icons-vue";
import { getNodeModelKey, useNode, useNodeModelSelection, useNodeToolsContext, type NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";
import providerModelSelect from "@toonflow/node-shared/providerModelSelect";
import { readLastNodeModel } from "@toonflow/node-shared/modelPreference";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { outpaintRatioOptions, type OutpaintDraftInput } from "../imageOutpaint";

type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const props = defineProps<{
  createDraft: (input: OutpaintDraftInput, signal: AbortSignal) => Promise<{ nodeId: string }>;
  src: string;
  sourceWidth: number;
  sourceHeight: number;
  models?: NodeMediaModel[];
  disabled?: boolean;
  target?: HTMLElement;
}>();
const emit = defineEmits<{ close: [] }>();
const { node, ai } = useNode();
const nodeData = computed(() => node.data as { model?: string; size?: string });
const getNodeTools = useNodeToolsContext();
const models = shallowRef<NodeMediaModel[]>(props.models ?? []);
const modelKey = ref(nodeData.value.model ?? "");
const selectedModel = useNodeModelSelection(models, modelKey);
const modelsLoading = ref(false);
const prompt = ref("");
const creating = ref(false);
const expansionScale = ref(1.5);
const targetRatio = ref("original");
const frame = ref({ width: 0, height: 0, left: 0, top: 0 });
const stage = ref<HTMLElement>();
const dragScale = ref(0);
const scaleOptions = [1.5, 2, 3];
const handles: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const handleLabels: Record<ResizeHandle, string> = { n: "上", s: "下", e: "右", w: "左", ne: "右上", nw: "左上", se: "右下", sw: "左下" };
const ratioOptions = outpaintRatioOptions;
const aspectRatio = computed(() => {
  if (targetRatio.value === "original") return props.sourceWidth / props.sourceHeight || 1;
  if (targetRatio.value === "custom") return frame.value.width / frame.value.height || props.sourceWidth / props.sourceHeight || 1;
  const [width = 1, height = 1] = targetRatio.value.split(":").map(Number);
  return width / height;
});
const stageScale = computed(() => dragScale.value || Math.min(
  275 / Math.max(props.sourceWidth / 2 + frame.value.left, frame.value.width - frame.value.left - props.sourceWidth / 2, 1),
  165 / Math.max(props.sourceHeight / 2 + frame.value.top, frame.value.height - frame.value.top - props.sourceHeight / 2, 1),
));
const stageStyle = computed(() => ({
  width: `${frame.value.width * stageScale.value}px`, height: `${frame.value.height * stageScale.value}px`,
  left: `calc(50% - ${(props.sourceWidth / 2 + frame.value.left) * stageScale.value}px)`,
  top: `calc(50% - ${(props.sourceHeight / 2 + frame.value.top) * stageScale.value}px)`,
}));
const sourceStyle = computed(() => ({
  left: `${frame.value.left * stageScale.value}px`, top: `${frame.value.top * stageScale.value}px`,
  width: `${props.sourceWidth * stageScale.value}px`, height: `${props.sourceHeight * stageScale.value}px`,
}));
let creationController: AbortController | undefined;
let drag: { handle: ResizeHandle | "move"; pointerId: number; x: number; y: number; scale: number; frame: typeof frame.value } | undefined;

watch(() => props.models, value => { if (value) models.value = value; }, { immediate: true });
watch([() => props.sourceWidth, () => props.sourceHeight], resetFrame, { immediate: true });
onMounted(() => { void loadModels(); window.addEventListener("keydown", handleEscape, true); });
onScopeDispose(() => { creationController?.abort(); stopDrag(); window.removeEventListener("keydown", handleEscape, true); });
defineExpose({ creating });

async function loadModels() {
  if (modelsLoading.value) return;
  modelsLoading.value = true;
  try {
    models.value = (await ai.getMediaModels()).filter(model => model.type === "image");
    if (!modelKey.value) {
      const first = readLastNodeModel("image", models.value) ?? models.value[0];
      if (first) modelKey.value = getNodeModelKey(first);
    }
  } catch (error) { showNodeError(error, "图片模型读取失败"); }
  finally { modelsLoading.value = false; }
}

function resetFrame() {
  if (!props.sourceWidth || !props.sourceHeight) return;
  const height = Math.max(props.sourceWidth / aspectRatio.value, props.sourceHeight) * expansionScale.value;
  const width = height * aspectRatio.value;
  frame.value = { width, height, left: (width - props.sourceWidth) / 2, top: (height - props.sourceHeight) / 2 };
}

function selectScale(value: number) { expansionScale.value = value; resetFrame(); }
function selectRatio(value: string) { targetRatio.value = value; resetFrame(); }

function handleEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.isComposing || creating.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  emit("close");
}

function startDrag(event: PointerEvent, handle: ResizeHandle | "move") {
  if (event.button !== 0 || props.disabled || creating.value || !stage.value || !props.sourceWidth) return;
  event.preventDefault();
  event.stopPropagation();
  stopDrag();
  drag = { handle, pointerId: event.pointerId, x: event.clientX, y: event.clientY, scale: stage.value.getBoundingClientRect().width / frame.value.width, frame: { ...frame.value } };
  dragScale.value = stageScale.value;
  window.addEventListener("pointermove", moveDrag);
  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("pointercancel", stopDrag);
}

function resizeFrame(handle: ResizeHandle, dx: number, dy: number, start: typeof frame.value) {
  const west = handle.includes("w");
  const north = handle.includes("n");
  const horizontal = west || handle.includes("e");
  const vertical = north || handle.includes("s");
  const minimumWidth = west ? start.width - start.left : props.sourceWidth + start.left;
  const minimumHeight = north ? start.height - start.top : props.sourceHeight + start.top;
  const width = horizontal ? Math.max(minimumWidth, Math.min(16384, start.width + dx * (west ? -1 : 1))) : start.width;
  const height = vertical ? Math.max(minimumHeight, Math.min(16384, start.height + dy * (north ? -1 : 1))) : start.height;
  frame.value = { width, height, left: west ? start.left + width - start.width : start.left, top: north ? start.top + height - start.height : start.top };
  targetRatio.value = "custom";
  expansionScale.value = Math.round(Math.max(width / props.sourceWidth, height / props.sourceHeight) * 100) / 100;
}

function moveDrag(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = (event.clientX - drag.x) / drag.scale;
  const dy = (event.clientY - drag.y) / drag.scale;
  if (drag.handle === "move") {
    frame.value = { ...drag.frame, left: Math.max(0, Math.min(drag.frame.width - props.sourceWidth, drag.frame.left - dx)), top: Math.max(0, Math.min(drag.frame.height - props.sourceHeight, drag.frame.top - dy)) };
  } else resizeFrame(drag.handle, dx, dy, drag.frame);
}

function stopDrag(event?: PointerEvent) {
  if (event && drag && event.pointerId !== drag.pointerId) return;
  drag = undefined;
  dragScale.value = 0;
  window.removeEventListener("pointermove", moveDrag);
  window.removeEventListener("pointerup", stopDrag);
  window.removeEventListener("pointercancel", stopDrag);
}

function resizeWithKeyboard(event: KeyboardEvent, handle: ResizeHandle) {
  if (props.disabled || creating.value || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const step = event.shiftKey ? 50 : 10;
  resizeFrame(handle, event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0, frame.value);
}

async function confirm() {
  if (creating.value || props.disabled || !selectedModel.value) return;
  const controller = creationController = new AbortController();
  let draftCreated = false;
  creating.value = true;
  try {
    const sizes = selectedModel.value.imageSizes?.length ? selectedModel.value.imageSizes : ["2K"];
    const size = nodeData.value.size && sizes.includes(nodeData.value.size) ? nodeData.value.size : sizes[0]!;
    const ratio = closestRatio();
    const result = await props.createDraft({
      prompt: prompt.value.trim(), targetRatio: ratio, targetWidth: Math.round(frame.value.width), targetHeight: Math.round(frame.value.height),
      left: Math.max(0, Math.min(Math.round(frame.value.width) - props.sourceWidth, Math.round(frame.value.left))),
      top: Math.max(0, Math.min(Math.round(frame.value.height) - props.sourceHeight, Math.round(frame.value.top))), model: modelKey.value, size,
    }, controller.signal);
    draftCreated = true;
    await getNodeTools().call({ nodeId: result.nodeId, name: "node:getConfig", args: {} }, controller.signal);
    await getNodeTools().call({ nodeId: result.nodeId, name: "node:generateImage", args: {} }, controller.signal);
    emit("close");
  } catch (error) {
    if (!controller.signal.aborted) {
      showNodeError(draftCreated ? new Error(`${error instanceof Error ? error.message : "扩图启动失败"}。扩图节点已保留，可在该节点继续。`) : error, "扩图生成失败");
      if (draftCreated) emit("close");
    }
  } finally { creating.value = false; creationController = undefined; }
}

function closestRatio() {
  const supported = selectedModel.value?.imageRatios?.filter(ratio => /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(ratio));
  const choices = supported?.length ? supported : outpaintRatioOptions;
  const sourceRatio = frame.value.width / frame.value.height;
  return choices.toSorted((left, right) => {
    const leftRatio = Number(left.split(":")[0]) / Number(left.split(":")[1]);
    const rightRatio = Number(right.split(":")[0]) / Number(right.split(":")[1]);
    return Math.abs(Math.log(leftRatio / sourceRatio)) - Math.abs(Math.log(rightRatio / sourceRatio));
  })[0]!;
}
</script>

<style scoped lang="scss">
:global(.nodeSkeleton.outpaintNode) { pointer-events: none; }
:global(.nodeSkeleton.outpaintNode > .titleBar),
:global(.nodeSkeleton.outpaintNode > .cardContainer > .nodeHandle),
:global(.nodeSkeleton.outpaintNode > .cardContainer > .resizeCorner) { visibility: hidden !important; }
:global(.nodeSkeleton.outpaintNode > .cardContainer > .contentCard) { border-color: transparent !important; background: transparent !important; box-shadow: none !important; overflow: visible; }
:global(.nodeSkeleton.outpaintNode > .cardContainer > .contentCard > .el-card__body) { overflow: visible !important; }
:global(.nodeSkeleton.outpaintNode > .bottomSlot) { top: calc(50% + 215px) !important; pointer-events: auto; }

.outpaintEditor {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 646px;
  padding: 12px;
  box-sizing: border-box;
  background: transparent;
  color: var(--el-text-color-primary);
  .outpaintWorkspace {
    position: relative;
    width: 100%;
    height: 370px;
    overflow: hidden;
    .outpaintStage {
      position: absolute;
      pointer-events: auto;
      cursor: move;
      touch-action: none;
      background: repeating-conic-gradient(var(--el-fill-color) 0 25%, var(--el-bg-color) 0 50%) 50% / 16px 16px;
      .sourceImage { position: absolute; display: block; object-fit: fill; user-select: none; pointer-events: none; }
      .outpaintFrame {
        position: absolute;
        inset: 0;
        border: 1px solid var(--el-text-color-primary);
        box-sizing: border-box;
        .resizeHandle { position: absolute; z-index: 1; width: 12px; height: 12px; padding: 0; border: 2px solid var(--el-bg-color); border-radius: 2px; background: var(--el-text-color-primary); touch-action: none; }
        .n, .s { left: calc(50% - 6px); cursor: ns-resize; }
        .n { top: -6px; } .s { bottom: -6px; }
        .e, .w { top: calc(50% - 6px); cursor: ew-resize; }
        .e { right: -6px; } .w { left: -6px; }
        .ne, .sw { cursor: nesw-resize; }
        .nw, .se { cursor: nwse-resize; }
        .ne { top: -6px; right: -6px; } .nw { top: -6px; left: -6px; }
        .se { right: -6px; bottom: -6px; } .sw { bottom: -6px; left: -6px; }
      }
    }
  }
}
.outpaintControls {
  display: grid;
  justify-items: center;
  gap: 10px;
  width: 100%;
  color: var(--el-text-color-primary);
  .ratioToolbar {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 2px;
    max-width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 12px;
    background: var(--el-bg-color-overlay);
    box-shadow: var(--el-box-shadow-light);
    .scaleSelect { width: 76px; :deep(.el-select__wrapper) { box-shadow: none; } }
    .el-button { margin: 0; padding: 8px; }
    .closeButton { color: var(--el-text-color-secondary); }
  }
  .outpaintPromptBar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    min-width: 0;
    padding: 10px 14px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 16px;
    background: var(--el-bg-color-overlay);
    box-shadow: var(--el-box-shadow-light);
    .modelToolbar {
      display: flex;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--el-border-color-lighter);
      :deep(.providerModelSelect) { width: 360px; max-width: 100%; }
    }
    .promptRow {
      display: flex;
      align-items: center;
      gap: 12px;
      .promptField { flex: 1; min-width: 0; :deep(.el-textarea__inner) { padding: 8px 0; box-shadow: none; background: transparent; } }
      .generateButton { flex: none; width: 36px; height: 36px; margin: 0; padding: 0; border-radius: 50%; --el-button-bg-color: var(--el-text-color-primary); --el-button-border-color: transparent; --el-button-text-color: var(--el-bg-color); --el-button-hover-bg-color: var(--el-text-color-regular); --el-button-hover-border-color: transparent; --el-button-hover-text-color: var(--el-bg-color); }
    }
  }
}
</style>
