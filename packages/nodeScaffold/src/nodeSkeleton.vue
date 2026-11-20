<template>
  <div v-if="documentTarget" class="nodeDocumentPlaceholder" :style="canvasSize" aria-hidden="true" />
  <teleport :to="documentTarget ?? 'body'" :disabled="!documentTarget">
  <div ref="skeletonElement" v-bind="$attrs" class="nodeSkeleton" :class="{ documentNode: documentTarget, previewVisible: previewReady && !loading && !readOnly && !documentTarget, resized: !!resizedStyle.height, resizing: !!resize, hasTitleMeta: !!$slots.titleMeta }" :style="resizedStyle" @wheel.capture="zoomCanvas" @dblclick.stop="focusNode" @contextmenu="openMenu($event)">
    <el-dropdown
      v-if="!readOnly"
      ref="menu"
      trigger="contextmenu"
      virtualTriggering
      :virtualRef="menuAnchor"
      placement="bottom-start"
      :showArrow="false"
      :showTimeout="0"
      :hideTimeout="0"
      @command="handleCommand">
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item v-if="assetOutputs.length && saveNodeToAssets" command="saveAsset" :icon="IconFolderPlus">保存到素材库</el-dropdown-item>
          <el-dropdown-item v-if="assetOutputs.length && sendNodeToAgent" command="sendToAgent" :icon="IconSend" :disabled="sendingToAgent">发送到 Agent</el-dropdown-item>
          <slot name="contextActions" />
          <el-dropdown-item :divided="!!(assetOutputs.length && (saveNodeToAssets || sendNodeToAgent))" command="copy" :icon="IconCopy">复制节点</el-dropdown-item>
          <el-dropdown-item command="duplicate" :icon="IconCopyPlus">创建副本</el-dropdown-item>
          <el-dropdown-item v-if="reloadRemoteNode" command="reload" :icon="IconRefresh" :disabled="loading || reloading">重新加载插件</el-dropdown-item>
          <el-dropdown-item command="delete" :icon="IconTrash">删除节点</el-dropdown-item>
          <el-dropdown-item divided command="clipboard" :icon="IconCopy" :disabled="!copyNodeToClipboard || copyingToClipboard">
            复制到剪贴板
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
    <div
      v-if="!readOnly && (documentTarget || (topVisible && slotsVisible))"
      class="floatingSlot topSlot nodrag nopan nowheel"
      :style="{ width: typeof topWidth === 'number' ? `${topWidth}px` : topWidth }"
      @pointerdown.stop
      @mousedown.stop
      @dblclick.stop
      @keydown.stop
      @contextmenu.stop>
      <slot name="top">
        <el-card class="mediaToolbar" shadow="never" :bodyStyle="{ padding: '6px' }">
          <slot name="topActions" />
          <el-divider direction="vertical" />
          <slot name="topRightActions" />
          <el-button
            v-if="fullscreenVisible"
            :icon="focusOnToolbar ? IconFocus2 : IconMaximize"
            :disabled="!focusOnToolbar && !downloadUrl"
            text
            :title="focusOnToolbar ? '聚焦节点' : '全屏'"
            :aria-label="focusOnToolbar ? '聚焦节点' : '全屏'"
            @click.stop="focusOnToolbar ? focusNode() : emit('fullscreen')" />
          <el-button
            :tag="downloadUrl ? 'a' : 'button'"
            :href="downloadUrl || undefined"
            :download="downloadName"
            :icon="IconDownload"
            :disabled="!downloadUrl"
            :loading="downloading"
            :aria-busy="downloading"
            text
            :title="downloading ? '正在保存…' : '下载'"
            aria-label="下载"
            @downloadstate="downloading = $event.detail"
            @click.stop />
        </el-card>
      </slot>
    </div>
    <div
      v-if="!readOnly && $slots.bottom && (documentTarget || (bottomVisible && slotsVisible))"
      class="floatingSlot bottomSlot nodrag nopan nowheel"
      :style="{ width: typeof bottomWidth === 'number' ? `${bottomWidth}px` : bottomWidth }"
      @pointerdown.stop
      @mousedown.stop
      @dblclick.stop
      @keydown.stop
      @contextmenu.stop>
      <slot name="bottom" />
    </div>
    <div v-show="!documentTarget" class="titleBar">
      <component :is="icon ?? IconBox" class="titleIcon" :size="14" aria-hidden="true" />
      <input
        v-if="editingLabel && !readOnly"
        ref="labelInput"
        v-model="labelDraft"
        class="labelInput nodrag nopan"
        aria-label="节点名称"
        @pointerdown.stop
        @mousedown.stop
        @dblclick.stop
        @keydown.stop
        @keydown.enter="confirmLabel"
        @keydown.esc.prevent="editingLabel = false"
        @blur="saveLabel" />
      <span
        v-else
        class="labelText"
        :tabindex="readOnly ? undefined : 0"
        :title="readOnly ? label : `${label}（双击编辑名称）`"
        @dblclick="!readOnly && ($event.stopPropagation(), editLabel())"
        @keydown.enter.stop.prevent="editLabel">
        {{ label }}
      </span>
      <div v-if="$slots.titleMeta || !readOnly" class="nodeTitleTools">
        <div v-if="$slots.titleMeta" class="nodeTitleResolution"><slot name="titleMeta" /></div>
        <div v-if="!readOnly" class="nodeTitleRemove nodrag nopan" @pointerdown.stop @mousedown.stop @dblclick.stop>
          <el-button :icon="IconTrash" text title="移除节点" aria-label="移除节点" @click.stop="deleteNode" :loading="deleting" />
        </div>
      </div>
    </div>
    <div class="cardContainer">
      <el-card
        class="contentCard"
        :data-connection-snap="!readOnly && !loading && !documentTarget ? 'true' : undefined"
        :class="{ selected: node.selected, selectionFrame }"
        shadow="never"
        :bodyStyle="{ padding: contentPadding }"
        :style="{ minHeight: `${cardHeight}px` }">
        <div v-if="loading" class="loadingContent" role="status" aria-label="节点加载中">
          <icon-loader2 class="loadingIcon" :size="24" aria-hidden="true" />
          <span>加载中...</span>
        </div>
        <slot v-else-if="previewReady || documentTarget" />
      </el-card>
      <template v-for="group in handleGroups" :key="group.type">
        <handle
          v-for="(item, index) in group.items"
          :id="item.id"
          :key="item.id"
          v-show="!documentTarget"
          class="nodeHandle"
          :class="{
            connected: isHandleConnected(item),
            connectedNodeActive: isHandleNodeActive(item),
            linking: localStartHandle?.id === item.id && localStartHandle.type === group.type,
          }"
          :type="group.type"
          :connectable="!readOnly && !loading"
          :position="group.position"
          :isValidConnection="validateConnection"
          :data-connection-status="getHandleStatus(item)"
          :style="{ top: `${((index + 1) / (group.items.length + 1)) * 100}%` }"
          :title="`${item.label ?? item.id} · ${Array.isArray(item.dataType) ? item.dataType.join(' / ') : item.dataType}`"
          :aria-label="`${item.label ?? item.id} · ${Array.isArray(item.dataType) ? item.dataType.join(' / ') : item.dataType}`">
          <span class="handleIcon" aria-hidden="true"><span class="handlePlus" /></span>
        </handle>
      </template>
      <button
        v-if="!readOnly && !loading && !documentTarget"
        class="resizeCorner nodrag nopan"
        type="button"
        aria-label="调整节点大小（方向键微调，双击恢复默认尺寸）"
        title="拖动调整大小，双击恢复默认尺寸"
        @pointerdown.stop.prevent="startResize"
        @pointermove.stop="moveResize"
        @pointerup.stop="finishResize"
        @pointercancel="finishResize"
        @lostpointercapture="finishResize"
        @keydown.stop="resizeWithKeyboard"
        @mousedown.stop
        @click.stop
        @dblclick.stop.prevent="resetNodeSize" />
    </div>
  </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onScopeDispose, ref, shallowRef, watch, watchEffect, type Component, type ShallowRef } from "vue";
import { Handle, Position, getTransformForBounds, pointToRendererPoint, useNode, useVueFlow, wheelDelta } from "@vue-flow/core";
import {
  IconRefresh,
  IconTrash,
  IconCopy,
  IconCopyPlus,
  IconFolderPlus,
  IconDownload,
  IconMaximize,
  IconFocus2,
  IconBox,
  IconLoader2,
  IconSend,
} from "@tabler/icons-vue";
import { ElCard, ElButton, ElDivider, ElDropdown, ElDropdownMenu, ElDropdownItem, ElMessage } from "element-plus";
import type { DropdownInstance } from "element-plus";
import { getAssetOutputs, validateConnection } from "./connection";
import { useNodeEvent } from "./nodeEvent";
import type { NodeConnectionFeedback, NodeData, NodeHandle } from "./connection";
import type { NodeOutput } from "./values";
import type { NodeDocumentContext } from "./nodeDocument";

defineOptions({ inheritAttrs: false });

const topVisible = defineModel<boolean>("topVisible", { default: false });
const bottomVisible = defineModel<boolean>("bottomVisible", { default: false });
const emit = defineEmits<{ fullscreen: [] }>();
const downloading = ref(false);
const props = withDefaults(
  defineProps<
    NodeData & {
      icon?: Component;
      loading?: boolean;
      readOnly?: boolean;
      previewReady?: boolean;
      contentPadding?: string | number;
      resizeAspectRatio?: number;
      selectionFrame?: boolean;
      topWidth?: string | number;
      bottomWidth?: string | number;
      downloadUrl?: string;
      downloadName?: string;
      fullscreenVisible?: boolean;
      toolbarAction?: "fullscreen" | "focus";
    }
  >(),
  {
    label: "未命名节点",
    handles: () => [],
    outputs: () => ({}),
    previewReady: true,
    contentPadding: '8px',
    selectionFrame: false,
    readOnly: false,
    fullscreenVisible: true,
    toolbarAction: "fullscreen",
    topWidth: "20vw",
    bottomWidth: "20vw",
  }
);
const handleGroups = computed(() => [
  { type: "target" as const, position: Position.Left, items: props.handles.filter((item) => item.type === "target") },
  { type: "source" as const, position: Position.Right, items: props.handles.filter((item) => item.type === "source") },
]);
const cardHeight = computed(() => Math.max(100, ...handleGroups.value.map((group) => (group.items.length + 1) * 44)));
const { id: nodeId, node } = useNode();
const documentContext = inject<NodeDocumentContext | undefined>("nodeDocument", undefined);
const documentTarget = computed(() => props.readOnly ? undefined : documentContext?.targets.get(nodeId));
const focusOnToolbar = computed(() => props.toolbarAction === "focus" && !documentTarget.value);
const skeletonElement = ref<HTMLElement>();
const canvasSize = shallowRef<{ width: string; height: string }>();
let documentLease: symbol | undefined;
function mountDocument(target: HTMLElement) {
  if (props.readOnly) throw new Error("只读节点不能挂载到工作区文档");
  const element = skeletonElement.value;
  if (!documentContext || !element || !target.isConnected) throw new Error("节点视图尚未就绪");
  if (!documentTarget.value) canvasSize.value = {
    width: `${element.offsetWidth || node.dimensions.width || 220}px`,
    height: `${element.offsetHeight || node.dimensions.height || 128}px`,
  };
  const lease = Symbol();
  documentLease = lease;
  // ACT: 只移动原节点的界面，保留画布中的运行实例和尺寸；同一节点仅允许一个文档显示位置。
  documentContext.targets.set(nodeId, target);
  return () => {
    if (documentLease !== lease) return;
    documentLease = undefined;
    documentContext.targets.delete(nodeId);
    void nextTick(() => {
      if (!documentTarget.value) updateNodeInternals([nodeId]);
    });
  };
}
watch(() => props.loading, loading => {
  if (props.readOnly) return;
  if (loading) {
    if (documentContext?.mounts.get(nodeId) === mountDocument) documentContext.mounts.delete(nodeId);
  } else documentContext?.mounts.set(nodeId, mountDocument);
}, { immediate: true });
onScopeDispose(() => {
  documentLease = undefined;
  if (documentContext?.mounts.get(nodeId) !== mountDocument) return;
  documentContext.mounts.delete(nodeId);
  documentContext.targets.delete(nodeId);
});
const selectionConnection = inject<ShallowRef<NodeConnectionFeedback | undefined> | undefined>("selectionConnection", undefined);
const nodeEvent = useNodeEvent();
if (!props.readOnly) node.isValidTargetPos = (...args) => !props.readOnly && nodeEvent.emit("canConnect", ...args);
const {
  d3Zoom,
  d3Selection,
  zoomActivationKeyCode,
  zoomOnPinch,
  setViewport,
  minZoom,
  maxZoom,
  viewport,
  vueFlowRef,
  addNodes,
  addEdges,
  toObject,
  getNodes,
  getSelectedNodes,
  findNode,
  addSelectedNodes,
  removeSelectedElements,
  removeNodes,
  removeEdges,
  updateNodeInternals,
  screenToFlowCoordinate,
  connectionLookup,
  connectionStartHandle,
  connectionEndHandle,
  connectionStatus,
  onPaneClick,
  onPaneContextMenu,
  onSelectionContextMenu,
  onConnectStart,
  onMoveStart,
  onNodeContextMenu,
  onNodeDragStart,
  onNodeClick,
  onSelectionStart,
} = useVueFlow();
const batchHistory = inject<((action: () => Promise<void>) => Promise<void>) | undefined>("batchCanvasHistory", undefined);
const resizedStyle = computed(() => {
  const style = typeof node.style === "function" ? node.style(node) : node.style;
  return props.readOnly || documentTarget.value ? {} : {
    ...(style?.width ? { width: style.width } : {}),
    ...(style?.height ? { height: style.height } : {}),
  };
});
const resize = shallowRef<{
  element: HTMLElement;
  pointerId: number;
  point: { x: number; y: number };
  width: number;
  height: number;
  resolve: () => void;
}>();

function startResize(event: PointerEvent) {
  if (props.readOnly || props.loading || documentTarget.value || event.button !== 0 || resize.value) return;
  const element = event.currentTarget as HTMLElement;
  const skeleton = skeletonElement.value;
  if (!skeleton) return;
  const action = () => new Promise<void>(resolve => {
    resize.value = {
      element, pointerId: event.pointerId,
      point: screenToFlowCoordinate({ x: event.clientX, y: event.clientY }),
      width: skeleton.offsetWidth, height: skeleton.offsetHeight, resolve,
    };
    node.resizing = true;
    element.setPointerCapture(event.pointerId);
  });
  void (batchHistory ? batchHistory(action) : action()).catch(error => {
    finishResize();
    ElMessage.error(error instanceof Error ? error.message : "节点缩放失败");
  });
}

function setNodeSize(width: number, height: number, primary: "width" | "height" = "width") {
  const titleHeight = skeletonElement.value?.querySelector<HTMLElement>(".titleBar")?.offsetHeight ?? 24;
  const style = typeof node.style === "function" ? node.style(node) : node.style;
  const ratio = props.resizeAspectRatio;
  const body = skeletonElement.value?.querySelector<HTMLElement>(".cardContainer > .contentCard > .el-card__body");
  if (ratio && Number.isFinite(ratio) && ratio > 0 && body && skeletonElement.value) {
    const padding = getComputedStyle(body);
    const horizontalInset = skeletonElement.value.offsetWidth - body.clientWidth + parseFloat(padding.paddingLeft) + parseFloat(padding.paddingRight);
    const verticalInset = skeletonElement.value.offsetHeight - body.clientHeight + parseFloat(padding.paddingTop) + parseFloat(padding.paddingBottom);
    // 内容按媒体比例联动，标题、边框和内边距不参与等比缩放。
    const minContentHeight = cardHeight.value + titleHeight - verticalInset;
    const contentHeight = primary === "width"
      ? Math.max((width - horizontalInset) / ratio, minContentHeight)
      : Math.max(height - verticalInset, minContentHeight);
    const contentWidth = Math.max(contentHeight * ratio, 160 - horizontalInset);
    width = contentWidth + horizontalInset;
    height = contentWidth / ratio + verticalInset;
  }
  node.style = { ...style, width: `${Math.max(160, width)}px`, height: `${Math.max(cardHeight.value + titleHeight, height)}px` };
}

function moveResize(event: PointerEvent) {
  const state = resize.value;
  if (!state || event.pointerId !== state.pointerId) return;
  if (props.readOnly || props.loading || documentTarget.value || findNode(nodeId) !== node) return finishResize();
  const point = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
  const deltaX = point.x - state.point.x;
  const deltaY = point.y - state.point.y;
  const ratio = props.resizeAspectRatio;
  const horizontalChange = ratio && Number.isFinite(ratio) && ratio > 0 ? deltaX / ratio : deltaX;
  setNodeSize(state.width + deltaX, state.height + deltaY, Math.abs(horizontalChange) >= Math.abs(deltaY) ? "width" : "height");
}

function finishResize(event?: PointerEvent) {
  const state = resize.value;
  if (!state || (event && event.pointerId !== state.pointerId)) return;
  resize.value = undefined;
  node.resizing = false;
  if (state.element.hasPointerCapture(state.pointerId)) state.element.releasePointerCapture(state.pointerId);
  state.resolve();
}

function resizeWithKeyboard(event: KeyboardEvent) {
  if (props.readOnly || props.loading || documentTarget.value || resize.value) return;
  const skeleton = skeletonElement.value;
  if (!skeleton || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const dx = event.key === "ArrowLeft" ? -10 : event.key === "ArrowRight" ? 10 : 0;
  const dy = event.key === "ArrowUp" ? -10 : event.key === "ArrowDown" ? 10 : 0;
  setNodeSize(skeleton.offsetWidth + dx, skeleton.offsetHeight + dy, dx ? "width" : "height");
}

async function resetNodeSize() {
  if (props.readOnly || props.loading || documentTarget.value || resize.value) return;
  const action = async () => {
    if (props.readOnly || props.loading || documentTarget.value || findNode(nodeId) !== node) return;
    const style = typeof node.style === "function" ? node.style(node) : node.style;
    if (style?.width === undefined && style?.height === undefined) return;
    const { width, height, ...rest } = style;
    node.style = rest;
    await nextTick();
    updateNodeInternals([nodeId]);
  };
  try {
    await (batchHistory ? batchHistory(action) : action());
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "恢复节点尺寸失败");
  }
}

onScopeDispose(() => finishResize());
watch(() => [props.readOnly, props.loading, documentTarget.value], () => finishResize());
const localStartHandle = computed(() => (connectionStartHandle.value?.nodeId === nodeId ? connectionStartHandle.value : undefined));
const localEndHandle = computed(() => (connectionEndHandle.value?.nodeId === nodeId ? connectionEndHandle.value : undefined));
const localSelectionConnection = computed(() => (selectionConnection?.value?.nodeId === nodeId ? selectionConnection.value : undefined));
const connectedHandles = computed<Set<string>>((previous) => {
  const connected = new Set(
    props.handles.filter((item) => connectionLookup.value.get(`${nodeId}-${item.type}-${item.id}`)?.size).map((item) => `${item.type}-${item.id}`)
  );
  return previous?.size === connected.size && [...connected].every((key) => previous.has(key)) ? previous : connected;
});

async function focusNode() {
  if (documentTarget.value) return;
  slotsHiddenByInteraction.value = false;
  const element = skeletonElement.value;
  await nextTick();
  const flowElement = vueFlowRef.value;
  if (!flowElement || !element?.isConnected) return;
  const flowRect = flowElement.getBoundingClientRect();
  if (flowRect.width <= 0 || flowRect.height <= 0) return;
  const rects = [element, ...element.querySelectorAll<HTMLElement>(":scope > .floatingSlot")]
    .filter((item) => item.getClientRects().length)
    .map((item) => item.getBoundingClientRect());
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const origin = pointToRendererPoint({ x: left - flowRect.left, y: top - flowRect.top }, viewport.value);
  const targetViewport = getTransformForBounds(
    {
      ...origin,
      width: (Math.max(...rects.map((rect) => rect.right)) - left) / viewport.value.zoom,
      height: (Math.max(...rects.map((rect) => rect.bottom)) - top) / viewport.value.zoom,
    },
    flowRect.width, flowRect.height, minZoom.value, maxZoom.value, 0.1
  );
  await setViewport(targetViewport, { duration: 300 });
}

const nodeFocusActions = inject<Map<string, () => Promise<void>>>("nodeFocusActions");
watch(documentTarget, (target, _, onCleanup) => {
  if (!nodeFocusActions || target) return;
  nodeFocusActions.set(nodeId, focusNode);
  onCleanup(() => {
    if (nodeFocusActions.get(nodeId) === focusNode) nodeFocusActions.delete(nodeId);
  });
}, { immediate: true });

defineExpose({ focusNode });

function zoomCanvas(event: WheelEvent) {
  if (documentTarget.value) return;
  if (document.fullscreenElement) return;
  if (!(zoomActivationKeyCode.value === true || (event.ctrlKey && zoomOnPinch.value)) || !d3Zoom.value || !d3Selection.value) return;
  const bounds = d3Selection.value.node()?.getBoundingClientRect();
  if (!bounds) return;
  event.preventDefault();
  event.stopPropagation();
  d3Zoom.value.scaleBy(d3Selection.value, 2 ** wheelDelta(event), [event.clientX - bounds.left, event.clientY - bounds.top]);
}

const slotsHiddenByInteraction = ref(false);
// ACT: 多选只操作节点；未选中的节点仍可通过 v-model 主动打开槽位。
const slotsVisible = computed(() => !slotsHiddenByInteraction.value && (!node.selected || getSelectedNodes.value.length <= 1));
onSelectionStart(() => {
  slotsHiddenByInteraction.value = true;
});
onNodeDragStart(({ nodes }) => {
  if (nodes.some((item) => item.id === nodeId)) slotsHiddenByInteraction.value = true;
});
onNodeClick(({ node: clickedNode }) => {
  if (clickedNode.id === nodeId) slotsHiddenByInteraction.value = false;
});
const editingLabel = ref(false);
const labelDraft = ref("");
const labelInput = ref<HTMLInputElement>();

const reloadRemoteNode = inject<((type: string) => Promise<void>) | undefined>("reloadRemoteNode", undefined);
const reloading = ref(false);
const deleting = ref(false);
const menu = ref<DropdownInstance>();
const menuAnchor = shallowRef({ getBoundingClientRect: () => new DOMRect() });
onPaneClick(() => menu.value?.handleClose());
onPaneContextMenu(() => menu.value?.handleClose());
onSelectionContextMenu(() => menu.value?.handleClose());
onConnectStart(() => menu.value?.handleClose());
onMoveStart(() => menu.value?.handleClose());
onNodeContextMenu(({ event, node }) => {
  if (node.id === nodeId) void openMenu(event);
  else menu.value?.handleClose();
});

async function reloadNode() {
  if (props.readOnly || props.loading || !reloadRemoteNode || reloading.value) return;
  reloading.value = true;
  try {
    await reloadRemoteNode(node.type);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "节点刷新失败");
  } finally {
    reloading.value = false;
  }
}

async function openMenu(event: MouseEvent | TouchEvent) {
  if (props.readOnly) return;
  event.preventDefault();
  event.stopPropagation();
  menu.value?.handleClose();
  const point = "changedTouches" in event ? event.changedTouches[0] : event;
  if (!point) return;
  menuAnchor.value = { getBoundingClientRect: () => new DOMRect(point.clientX, point.clientY, 0, 0) };
  await nextTick();
  menu.value?.handleOpen();
}

async function deleteNode() {
  if (props.readOnly || deleting.value) return;
  deleting.value = true;
  try {
    await nodeEvent.emit("delete");
    removeNodes(nodeId);
  } catch (error) {
    const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
    ElMessage.error(message || (error instanceof Error ? error.message : "节点删除失败"));
  } finally {
    deleting.value = false;
  }
}

const copyNodeToClipboard = inject<((node: { type?: string; data: NodeData }) => Promise<void>) | undefined>("copyNodeToClipboard", undefined);
const copyingToClipboard = ref(false);
const saveNodeToAssets = inject<((label: string, outputs: { label: string; output: NodeOutput }[]) => void) | undefined>(
  "saveNodeToAssets",
  undefined
);
const sendNodeToAgent = inject<((nodeId: string, outputIds: string[]) => Promise<void>) | undefined>("sendNodeToAgent", undefined);
const sendingToAgent = ref(false);
const assetOutputs = computed(() =>
  props.handles.flatMap((handle) => {
    const output = props.outputs[handle.id];
    if (handle.type !== "source" || !output || (output.dataType === "STRING" && !output.value.trim())) return [];
    return [{ id: handle.id, label: handle.label ?? handle.id, output }];
  })
);

async function handleCommand(command: string) {
  if (props.readOnly) return;
  if (command === "saveAsset") saveNodeToAssets?.(props.label, assetOutputs.value);
  if (command === "sendToAgent" && sendNodeToAgent && assetOutputs.value.length && !sendingToAgent.value) {
    sendingToAgent.value = true;
    try {
      await sendNodeToAgent(nodeId, assetOutputs.value.map(output => output.id));
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "发送到 Agent 失败");
    } finally {
      sendingToAgent.value = false;
    }
  }
  if (command === "clipboard" && copyNodeToClipboard && !copyingToClipboard.value) {
    copyingToClipboard.value = true;
    try {
      const patch = await nodeEvent.emit("copy");
      const data = { ...node.data, ...patch };
      await copyNodeToClipboard({ type: node.type, data });
      ElMessage.success("已复制到剪贴板");
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "节点复制失败");
    } finally {
      copyingToClipboard.value = false;
    }
  }
  if (command === "reload") void reloadNode();
  if (command === "delete") void deleteNode();
  if (command === "copy" || command === "duplicate") {
    let data: NodeData & { mediaTask?: unknown };
    try {
      const patch = await nodeEvent.emit("copy");
      data = JSON.parse(JSON.stringify({ ...node.data, ...patch }));
      delete data.mediaTask;
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "节点复制失败");
      return;
    }
    if (findNode(nodeId) !== node) return;
    const id = crypto.randomUUID();
    const incomingEdges = command === "duplicate" ? toObject().edges.filter((edge) => edge.target === nodeId) : [];
    const copyPosition = { x: node.position.x, y: node.position.y + node.dimensions.height + 32 };
    const nearbyNodes = getNodes.value
      .filter(
        (item) =>
          item.parentNode === node.parentNode &&
          item.position.x < copyPosition.x + node.dimensions.width &&
          item.position.x + item.dimensions.width > copyPosition.x
      )
      .sort((a, b) => a.position.y - b.position.y);
    for (const item of nearbyNodes) {
      if (copyPosition.y < item.position.y + item.dimensions.height + 32 && copyPosition.y + node.dimensions.height + 32 > item.position.y)
        copyPosition.y = item.position.y + item.dimensions.height + 32;
    }
    removeSelectedElements();
    addNodes({
      id,
      zIndex: node.zIndex,
      type: node.type,
      position: copyPosition,
      data: { ...data, label: `${props.label} - 副本` },
      parentNode: node.parentNode,
    });
    addEdges(incomingEdges.map((edge) => ({ ...JSON.parse(JSON.stringify(edge)), id: crypto.randomUUID(), target: id, selected: false })));
    await nextTick();
    const copy = findNode(id);
    if (copy) addSelectedNodes([copy]);
  }
}

async function editLabel() {
  if (props.readOnly) return;
  labelDraft.value = props.label;
  editingLabel.value = true;
  await nextTick();
  labelInput.value?.select();
}

function saveLabel() {
  if (props.readOnly || !editingLabel.value) return;
  const label = labelDraft.value.trim();
  if (label) node.data.label = label;
  editingLabel.value = false;
}

function confirmLabel(event: KeyboardEvent) {
  if (props.readOnly || event.isComposing) return;
  event.preventDefault();
  saveLabel();
}

function isHandleConnected(item: NodeHandle) {
  return connectedHandles.value.has(`${item.type}-${item.id}`);
}

function isHandleNodeActive(item: NodeHandle) {
  const connections = connectionLookup.value.get(`${nodeId}-${item.type}-${item.id}`);
  if (!connections?.size) return false;
  if (node.selected || node.dragging) return true;
  for (const connection of connections.values()) {
    const otherNode = findNode(item.type === "source" ? connection.target : connection.source);
    if (otherNode?.selected || otherNode?.dragging) return true;
  }
  return false;
}

function getHandleStatus(item: NodeHandle) {
  const selection = localSelectionConnection.value;
  if (selection?.handles.some((handle) => handle.id === item.id && handle.type === item.type)) return selection.status;
  const target = localEndHandle.value;
  return target?.id === item.id && target.type === item.type ? connectionStatus.value : null;
}

watchEffect(() => {
  if (props.readOnly || props.loading) return;
  // 仅同步端口快照供跨节点校验；端口状态由具体 node 维护。
  if (JSON.stringify(node.data.handles) !== JSON.stringify(props.handles)) node.data.handles = props.handles.map((item) => ({ ...item }));
});
watchEffect(() => {
  if (props.readOnly || props.loading) return;
  // 输出由 node 持有，画布仅共享当前值；不使用 JSON 比较或触发端口重测。
  node.data.outputs = props.outputs;
});
// 比较内容，避免内联数组的新引用触发渲染循环。
watch(
  () => JSON.stringify([props.label, props.handles, props.readOnly]),
  () => {
    if (props.readOnly || props.loading) return;
    removeEdges((edges) =>
      edges.filter(
        (edge) =>
          (edge.source === nodeId && !props.handles.some((item) => item.type === "source" && item.id === edge.sourceHandle)) ||
          (edge.target === nodeId && !props.handles.some((item) => item.type === "target" && item.id === edge.targetHandle))
      )
    );
    if (!documentTarget.value) updateNodeInternals([nodeId]);
  },
  { flush: "post" }
);
</script>

<style scoped>
@keyframes nodeAppear {
  from { opacity: 0; }
  to { opacity: 1; }
}

.nodeSkeleton {
  position: relative;
  width: 220px;
  color: var(--el-text-color-primary);
  text-align: left;

  &.previewVisible { animation: nodeAppear 140ms ease-out; }

  @media (prefers-reduced-motion: reduce) {
    &.previewVisible { animation: none; }
  }

  &.resized {
    display: flex;
    flex-direction: column;

    .titleBar { flex-shrink: 0; }
    .cardContainer {
      flex: 1;
      min-height: 0;

      .contentCard {
        height: 100%;
        box-sizing: border-box;

        :deep(.el-card__body) {
          height: 100%;
          box-sizing: border-box;
          overflow: auto;
        }
      }
    }
  }

  &.documentNode {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100% !important;
    min-width: 0;

    .floatingSlot {
      position: static;
      width: 100% !important;
      transform: none;

      &.topSlot { order: 0; }
      &.bottomSlot { order: 2; }
    }

    .cardContainer {
      order: 1;
      min-width: 0;
    }
  }

  &:hover .cardContainer .nodeHandle .handleIcon {
    opacity: 1;
  }

  &:hover .titleBar .nodeTitleTools {
    display: flex;
  }

  &.hasTitleMeta:hover .titleBar .labelText {
    visibility: hidden;
  }

  &:hover,
  &.resizing {
    .cardContainer .resizeCorner { opacity: 1; }
  }

  .floatingSlot {
    position: absolute;
    left: 50%;
    z-index: 2;
    transform: translateX(-50%);

    &.topSlot {
      bottom: calc(100% + 1px);
    }
    &.bottomSlot {
      top: calc(100% + 6px);
    }

    .mediaToolbar {
      &:deep(.el-button) {
        width: auto;
        min-width: 32px;
        height: 32px;
        margin: 0;
        padding: 0 8px;
        text-decoration: none;
      }
    }
  }

  .titleBar {
    position: relative;
    display: flex;
    min-height: 24px;
    box-sizing: border-box;
    align-items: center;
    gap: 4px;
    padding: 0 0 0 4px;
    font-size: 13px;
    line-height: 20px;

    .nodeTitleTools {
      position: absolute;
      top: 50%;
      right: -4px;
      transform: translateY(-50%);
      display: none;
      align-items: center;
      gap: 1px;

      .nodeTitleResolution + .nodeTitleRemove .el-button {
        justify-content: flex-start;
      }
    }

    .titleIcon {
      flex-shrink: 0;
      color: var(--el-text-color-secondary);
    }

    .labelText {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--el-text-color-secondary);
      cursor: grab;
      user-select: none;

      &:active {
        cursor: grabbing;
      }
    }

    .labelInput {
      flex: 1;
      min-width: 0;
      width: 100%;
      padding: 0 4px;
      border: 1px solid var(--el-color-primary);
      border-radius: var(--el-border-radius-small);
      outline: none;
      background: var(--el-bg-color);
      color: inherit;
      font: inherit;
      line-height: inherit;
    }

    .nodeTitleResolution {
      color: var(--el-text-color-secondary);
      font-size: 9px;
      line-height: 12px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .nodeTitleRemove {
      display: flex;

      .el-button {
        width: 24px;
        height: 24px;
        margin: 0;
        padding: 0;
        color: var(--el-text-color-secondary);

        &:hover { color: var(--el-text-color-primary); }
      }
    }
  }

  .cardContainer {
    position: relative;

    .resizeCorner {
      position: absolute;
      right: -8px;
      bottom: -8px;
      box-sizing: border-box;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      opacity: 0;
      cursor: nwse-resize;
      touch-action: none;

      &::before {
        content: "";
        position: absolute;
        inset: 2px;
        border-right: 2px solid var(--el-text-color-secondary);
        border-bottom: 2px solid var(--el-text-color-secondary);
        border-bottom-right-radius: 16px;
        transition: border-color 120ms ease-out;
      }

      &:hover::before { border-color: var(--canvasSelectionColor, #fff); }
      &:focus-visible { opacity: 1; outline: 2px solid var(--canvasSelectionColor, #fff); outline-offset: 1px; }
    }

    .contentCard.selectionFrame {
      border-color: transparent;
    }

    .contentCard.selectionFrame.selected {
      border-color: var(--canvasSelectionColor, #fff);
    }

    .contentCard .loadingContent {
      display: flex;
      min-height: 84px;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--el-text-color-secondary);
      font-size: 12px;

      .loadingIcon {
        color: var(--el-color-primary);
        animation: nodeLoading 1s linear infinite;
        @media (prefers-reduced-motion: reduce) {
          animation: none;
        }
      }
    }

    .nodeHandle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border: 0;
      background: transparent;
      color: var(--el-text-color-secondary);

      &.vue-flow__handle-left {
        left: -16px;
      }

      &.vue-flow__handle-right {
        right: -16px;
      }

      &::before {
        content: "";
        position: absolute;
        inset: -14px;
        border-radius: 50%;
      }

      .handleIcon {
        pointer-events: none;
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        box-sizing: border-box;
        border: 1.5px solid currentColor;
        border-radius: 50%;
        background: var(--el-bg-color);
        opacity: 0;
        transition: opacity 120ms ease-out, box-shadow 120ms ease-out;

        .handlePlus {
          position: relative;
          width: 10px;
          height: 10px;

          &::before, &::after { content: ""; position: absolute; background: currentColor; border-radius: 1px; }
          &::before { width: 10px; height: 1.5px; left: 0; top: 4.25px; }
          &::after { width: 1.5px; height: 10px; left: 4.25px; top: 0; }
        }
      }

      &.linking .handleIcon,
      &.connecting .handleIcon,
      &[data-connection-status] .handleIcon {
        opacity: 1;
      }

      &:hover,
      &.linking,
      &.connecting,
      &[data-connection-status="valid"] {
        color: var(--canvasSelectionColor, #fff);
      }

      &[data-connection-status="invalid"] {
        color: var(--el-color-danger);
        cursor: not-allowed;
      }

      &[data-connection-status="valid"] .handleIcon {
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--canvasSelectionColor, #fff) 18%, transparent);
      }

      @media (prefers-reduced-motion: reduce) {
        .handleIcon {
          transform: none;
          transition: none;
        }
      }
    }
  }
}
@keyframes nodeLoading {
  to {
    transform: rotate(360deg);
  }
}
</style>
