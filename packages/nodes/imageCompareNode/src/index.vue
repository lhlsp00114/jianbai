<template>
  <nodeSkeleton v-bind="nodeProps" class="compareNode" contentPadding="0" :style="{ width: emptyMediaCardWidth + 'px' }">
    <div class="comparePanel">
      <comparePreview v-model:mode="mode" v-model:split="split" v-model:activeSide="activeSide" :leftUrl="left.failed.value ? '' : left.url.value" :rightUrl="right.failed.value ? '' : right.url.value" @imageError="markFailed" @expand="expanded = true" />
      <div class="compareInputs nodrag nopan" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop>
        <div v-for="slot in slots" :key="slot.id" class="compareInput">
          <el-button text :icon="IconPhoto" :title="slot.source.value?.node.data?.label || '从画布选图'" :aria-label="'从画布选取图片 ' + slot.label" @click="startPicking(slot.id)">
            {{ slot.label }}<span class="inputName">{{ slot.failed.value || slot.invalid.value ? "读取失败" : slot.url.value ? slot.source.value?.node.data?.label || "已连接" : slot.source.value ? "等待图片" : "选图" }}</span>
          </el-button>
          <el-button v-if="slot.source.value" text :icon="IconX" :aria-label="'断开图片 ' + slot.label" :title="'断开图片 ' + slot.label" @click="removeInput(slot.id)" />
        </div>
      </div>
    </div>
  </nodeSkeleton>
  <el-dialog v-model="expanded" title="图片对比" class="compareDialog" width="min(1200px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose>
    <comparePreview v-if="expanded" v-model:mode="mode" v-model:split="split" v-model:activeSide="activeSide" :leftUrl="left.failed.value ? '' : left.url.value" :rightUrl="right.failed.value ? '' : right.url.value" expanded @imageError="markFailed" />
  </el-dialog>
  <teleport to="body">
    <div v-if="picking" class="pickBanner" :style="{ zIndex: bannerZIndex }" role="status">
      <icon-photo :size="18" />
      <span>点击画布中的图片，为图片 {{ picking === "left" ? "A" : "B" }} 选图</span>
      <el-button text :icon="IconX" aria-label="取消选图" title="取消选图 (Esc)" @click="finishPicking" />
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, inject, onScopeDispose, ref, watch } from "vue";
import { useVueFlow, type Connection } from "@vue-flow/core";
import { ElButton, ElDialog, ElMessage, useZIndex } from "element-plus";
import { IconPhoto, IconSeparatorVertical, IconX } from "@tabler/icons-vue";
import { nodeSkeleton, useNode, useNodeInputs, validateConnection, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import { emptyMediaCardWidth } from "@toonflow/node-shared/mediaPreviewSize";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import comparePreview from "./comparePreview.vue";

defineOptions({
  inheritAttrs: false,
  icon: IconSeparatorVertical,
  handles: [
    { id: "left", type: "target", dataType: "IMAGE", label: "图片 A" },
    { id: "right", type: "target", dataType: "IMAGE", label: "图片 B" },
  ] satisfies NodeHandle[],
});

type Side = "left" | "right";
const { id, node, nodeProps, nodeEvent, files } = useNode({ label: "图片对比" });
const flow = useVueFlow();
const { getTargetSources, getSourceValue } = useNodeInputs(flow);
const getCanvas = inject<() => { id: string } | undefined>("canvas");
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
const { nextZIndex } = useZIndex();
const split = ref(50);
const mode = ref<"slider" | "sideBySide" | "toggle">("slider");
const activeSide = ref<Side>("left");
const expanded = ref(false);
const picking = ref<Side>();
const bannerZIndex = ref(0);
const pickEvents = ["pointerdown", "mousedown", "click", "dblclick"] as const;
let pickingElement: HTMLElement | undefined;
let spacePressed = false;

function inputEdges(side: Side) {
  return flow.getEdges.value.filter(edge => edge.target === id && edge.targetHandle === side);
}

nodeEvent.on("canConnect", (connection, { edges }) => !edges.some(edge =>
  edge.target === id && edge.targetHandle === connection.targetHandle,
));

function imageInput(side: Side, label: string) {
  const source = computed(() => getTargetSources(id, side)[0]);
  const output = computed(() => {
    try {
      const target = source.value;
      const value = target && getSourceValue(target.node.id, target.handle.id);
      return { media: value?.dataType === "IMAGE" ? value.value : undefined, invalid: !!value && value.dataType !== "IMAGE" };
    } catch {
      return { media: undefined, invalid: true };
    }
  });
  const invalid = computed(() => output.value.invalid);
  const failed = ref(false);
  const url = files.useFileUrl(() => output.value.media, () => { failed.value = true; });
  watch(() => output.value.media, () => { failed.value = false; }, { flush: "sync" });
  return { id: side, label, source, url, invalid, failed };
}

const left = imageInput("left", "A");
const right = imageInput("right", "B");
const slots = [left, right];
function markFailed(side: Side, url: string) {
  const input = side === "left" ? left : right;
  if (input.url.value === url) input.failed.value = true;
}

function startPicking(side: Side) {
  const element = flow.vueFlowRef.value;
  if (!element || !flow.nodesConnectable.value || element.classList.contains("pickingReference")) return;
  pickingElement = element;
  picking.value = side;
  bannerZIndex.value = nextZIndex();
  element.classList.add("pickingReference", "pickingComparison");
  for (const event of pickEvents) element.addEventListener(event, pickImage, true);
  window.addEventListener("keydown", pickKey, true);
  window.addEventListener("keyup", pickKey, true);
  window.addEventListener("blur", resetSpace);
}

function resetSpace() { spacePressed = false; }

function finishPicking() {
  pickingElement?.classList.remove("pickingReference", "pickingComparison");
  for (const event of pickEvents) pickingElement?.removeEventListener(event, pickImage, true);
  window.removeEventListener("keydown", pickKey, true);
  window.removeEventListener("keyup", pickKey, true);
  window.removeEventListener("blur", resetSpace);
  pickingElement = undefined;
  picking.value = undefined;
  resetSpace();
}

function pickKey(event: KeyboardEvent) {
  if (event.code === "Space") spacePressed = event.type === "keydown";
  if (event.type !== "keydown" || event.key !== "Escape" || event.isComposing) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  finishPicking();
}

function pickImage(event: MouseEvent) {
  const side = picking.value;
  if (!side || event.button !== 0 || spacePressed || !(event.target instanceof Element)) return;
  const sourceId = event.target.closest<HTMLElement>(".vue-flow__node")?.dataset.id;
  if (!sourceId && !event.target.closest(".vue-flow__pane")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!sourceId || event.type !== "click") return;
  const handleId = event.target.closest<HTMLElement>(".vue-flow__handle.source")?.dataset.handleid;
  try {
    const sourceNode = flow.findNode(sourceId);
    if (!sourceNode || sourceNode.connectable === false || node.connectable === false || !flow.nodesConnectable.value) {
      ElMessage.info("请选择已有图片的节点");
      return;
    }
    const previous = inputEdges(side);
    const edges = flow.getEdges.value.filter(edge => !previous.includes(edge));
    const handles: NodeHandle[] = sourceNode.data?.handles ?? [];
    const connection = handles.flatMap<Connection>(handle => {
      if (handle.type !== "source" || (handleId && handleId !== handle.id) || getSourceValue(sourceId, handle.id)?.dataType !== "IMAGE") return [];
      return [{ source: sourceId, sourceHandle: handle.id, target: id, targetHandle: side }];
    }).find(candidate => validateConnection(candidate, { sourceNode, targetNode: node, nodes: flow.getNodes.value, edges }));
    if (!connection) {
      ElMessage.info("请选择已有图片的节点");
      return;
    }
    finishPicking();
    if (previous.length === 1 && previous[0].source === connection.source && previous[0].sourceHandle === connection.sourceHandle) return;
    void batchHistory(async () => {
      flow.addEdges({ ...connection, id: crypto.randomUUID() });
      if (previous.length) flow.removeEdges(previous);
    }).catch(error => showNodeError(error, "连接图片失败"));
  } catch (error) {
    showNodeError(error, "读取画布图片失败");
  }
}

function removeInput(side: Side) {
  const edges = inputEdges(side);
  if (edges.length) flow.removeEdges(edges);
}

watch(() => getCanvas?.()?.id, finishPicking);
onScopeDispose(finishPicking);
</script>

<style scoped lang="scss">
// The legacy "right" input ID also contributes a right-position class in Vue Flow.
:global(.compareNode .cardContainer .nodeHandle.vue-flow__handle-left.target) {
  left: -12px;
  right: auto;
  transform: translate(-50%, -50%);
}
:global(.compareNode .cardContainer .nodeHandle.target::before) { inset: -4px; }
:global(.compareNode .cardContainer .nodeHandle.vue-flow__handle-left.target .handleIcon) { width: 16px; height: 16px; border-width: 1px; }
:global(.compareNode .cardContainer .nodeHandle.target .handlePlus) { transform: scale(.65); }

.comparePanel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;

  .compareInputs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    padding: 4px 6px;

    .compareInput {
      display: flex;
      align-items: center;
      min-width: 0;
      gap: 2px;

      .el-button { min-width: 0; margin: 0; padding-inline: 7px; border-radius: 8px; }
      .el-button:first-child { flex: 1; justify-content: flex-start; overflow: hidden; }
      .el-button:first-child :deep(span) { min-width: 0; }
      .inputName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-inline-start: 6px; color: var(--el-text-color-secondary); }
    }
  }
}

.pickBanner {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100vw - 32px);
  padding: 6px 8px 6px 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-primary);
  box-shadow: var(--el-box-shadow-light);
}
:global(.pickingComparison .vue-flow__node *) { cursor: crosshair !important; }
</style>
