<template>
  <nodeSkeleton v-bind="nodeProps" class="imageLayerNode" contentPadding="8px" :fullscreenVisible="false"
    :topVisible="node.selected && !fullscreen && layers.length > 0" topWidth="max-content" :style="{ width: `${nodePanelWidth}px` }">
    <template #top><div ref="toolbarTarget" /></template>
    <div v-if="fullscreen" class="layerPlaceholder" :style="{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }" />
    <teleport :to="fullscreenDialog ?? 'body'" :disabled="!fullscreen">
    <div class="layerContent" :class="{ fullscreenContent: fullscreen }" @keydown="editorKeydown">
      <div v-if="fullscreen || toolbarTarget" class="fullscreenHeader">
        <strong v-if="fullscreen">图层编辑</strong>
        <teleport :to="toolbarTarget ?? 'body'" :disabled="fullscreen">
          <div class="layerTools" role="group" aria-label="图层操作" @keydown="editorKeydown" @click.stop>
            <button type="button" title="撤销图层修改（Ctrl/Cmd+Z）" aria-label="撤销图层修改" :disabled="historyIndex <= 0 || arranging || !!rendering || restoringHistory" @click="restoreHistory(-1)"><icon-arrow-back-up :size="15" />撤销</button>
            <button type="button" title="重做图层修改（Ctrl/Cmd+Shift+Z）" aria-label="重做图层修改" :disabled="historyIndex >= layerHistory.length - 1 || arranging || !!rendering || restoringHistory" @click="restoreHistory(1)"><icon-arrow-forward-up :size="15" />重做</button>
            <button type="button" title="自动排列图层，恢复生成位置及前后顺序" :disabled="arranging || !layers.length" @click="initializeLayout(true)"><icon-wand :size="15" />自动排列</button>
            <button type="button" title="仅查看所选图层（不影响合并）" :aria-pressed="!!soloLayerId" :disabled="!soloLayerId && (!selectedLayer || selectedLayer.visible === false)" @click="soloLayerId = soloLayerId ? undefined : selectedLayer?.id"><icon-focus-2 :size="15" />单层查看</button>
            <button type="button" title="将所选图层提取为独立图片，保留透明背景与位置" :disabled="!canCompose || !selectedLayer || selectedLayer.visible === false || (selectedLayer.opacity ?? 100) <= 0" @click="renderImage('extract')"><icon-photo-plus :size="15" />提取图层</button>
            <button type="button" :disabled="!canExportPsd" :aria-busy="rendering === 'psd'" @click="renderImage('psd')">
              <icon-download :size="15" />{{ rendering === 'psd' ? '正在导出…' : '下载 PSD' }}
            </button>
          </div>
        </teleport>
        <el-button v-if="fullscreen" size="small" @click="fullscreenDialog?.close()">关闭</el-button>
      </div>
      <div class="layerWorkspace" :class="{ withLayerRail: showLayerRail }">
        <div class="layerStage">
          <div class="layerPreview" :style="{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }">
            <div v-for="layer in layers" :key="layer.id" v-show="!soloLayerId || soloLayerId === layer.id" class="layerPlane" :style="layerStyle(layer)">
              <layerImage :layer="layer" :style="imageStyle(layer)" />
            </div>
            <div v-if="editing && selectedLayer && selectedLayer.visible !== false" class="layerPlane" :style="{ ...layerStyle(selectedLayer), opacity: 1 }">
              <span class="layerSelection" :style="imageStyle(selectedLayer)" />
            </div>
            <span v-if="soloLayerId" class="soloHint">单层查看 · 不影响合并</span>
            <div v-if="data.splitStatus === 'processing' || data.splitStatus === 'failed'" class="layerStatus"
              :class="{ failed: data.splitStatus === 'failed' }" :role="data.splitStatus === 'failed' ? 'alert' : 'status'" aria-live="polite">
              <span v-if="data.splitStatus === 'processing'" class="statusSpinner" aria-hidden="true" />
              <span>{{ data.splitStatus === 'processing' ? '正在拆分图层' : data.splitError || '图层分离失败' }}</span>
            </div>
            <button v-if="editing && canMove" type="button" class="layerMove nodrag nopan"
              :aria-label="`移动${selectedLayer?.label}，方向键移动1像素，Shift加方向键移动10像素`" :title="`拖动以移动${selectedLayer?.label}，Esc取消本次拖动`"
              @click.stop @pointerdown.stop="startMove" @pointermove="moveLayer" @pointerup="finishMove"
              @lostpointercapture="cancelMove" @pointercancel="cancelMove" @keydown="nudgeLayer">
              <icon-arrows-move class="moveHint" :size="15" aria-hidden="true" />
            </button>
            <button v-if="editing && canMove" type="button" class="layerResize nodrag nopan"
              title="拖动缩放选中图层" aria-label="拖动缩放选中图层"
              @click.stop @pointerdown.stop="startMove($event, true)" @pointermove="moveLayer"
              @pointerup="finishMove" @lostpointercapture="cancelMove" @pointercancel="cancelMove"
              @keydown.left.prevent.stop="nudgeScale(-5)" @keydown.right.prevent.stop="nudgeScale(5)">
              <icon-arrows-diagonal :size="14" aria-hidden="true" />
            </button>
            <div v-if="layers.length" class="previewActions nodrag nopan" @click.stop @dblclick.stop>
              <button type="button" aria-label="放大预览" title="放大预览" :disabled="!canCompose" @click="showPreview">
                <icon-arrows-maximize :size="14" aria-hidden="true" />
              </button>
              <button v-if="!fullscreen" type="button" :aria-expanded="editing" aria-label="图层调整" title="图层调整"
                @click="toggleControls">
                <icon-adjustments-horizontal :size="14" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div v-if="editing && selectedLayer" class="layerControls nodrag nopan nowheel" @click.stop @dblclick.stop>
            <div class="layerAdjustments" :key="selectedLayer.id">
              <label v-for="{ field, label, min, max } in adjustments" :key="field">
                <span>{{ label }}</span>
                <input type="range" :min="min" :max="max" :value="adjustmentValue(selectedLayer, field)" :disabled="selectedLayer.locked"
                  @input="adjustLayer($event, selectedLayer, field)" @change="adjustLayer($event, selectedLayer, field)" />
                <span class="adjustmentValue">{{ adjustmentValue(selectedLayer, field) }}%</span>
              </label>
              <button type="button" class="resetButton" :disabled="selectedLayer.locked" @click="resetLayer(selectedLayer)">重置</button>
            </div>
            <div class="layerFooter">
              <button v-if="!fullscreen" type="button" class="expandEditor" @click="openFullscreen">全屏编辑</button>
              <span v-else>合并可见图层生成新图片</span>
              <el-button class="mergeButton" type="primary" size="small" :loading="rendering === 'merge'"
                :disabled="!canCompose" @click="renderImage('merge')">合并</el-button>
            </div>
          </div>
        </div>
        <aside v-if="showLayerRail" class="layerSidebar nodrag nopan nowheel" aria-label="图层面板" @click.stop @dblclick.stop @pointerdown.stop>
          <div class="layerSidebarHeader">
            <span>图层</span>
            <span class="layerCount">{{ layers.length }}</span>
            <button type="button" class="iconButton" title="上移所选图层" aria-label="上移所选图层"
              :disabled="selectedLayer?.locked || selectedLayerIndex <= 0 || displayLayers[selectedLayerIndex - 1]?.locked" @click="selectedLayer && reorderLayer(selectedLayer, displayLayers[selectedLayerIndex - 1])">
              <icon-chevron-up :size="15" aria-hidden="true" />
            </button>
            <button type="button" class="iconButton" title="下移所选图层" aria-label="下移所选图层"
              :disabled="selectedLayer?.locked || selectedLayerIndex < 0 || selectedLayerIndex >= displayLayers.length - 1 || displayLayers[selectedLayerIndex + 1]?.locked"
              @click="selectedLayer && reorderLayer(selectedLayer, displayLayers[selectedLayerIndex + 1])">
              <icon-chevron-down :size="15" aria-hidden="true" />
            </button>
          </div>
          <div class="layerList" role="group" aria-label="选择图层">
            <div v-for="layer in displayLayers" :key="layer.id" class="layerRow"
              :class="{ active: layer === selectedLayer, dropBefore: dropTarget?.id === layer.id && !dropTarget.after, dropAfter: dropTarget?.id === layer.id && dropTarget.after }"
              @dragover.prevent.stop="overLayer($event, layer)" @drop.prevent.stop="dropLayer(layer)">
              <input v-if="renamingLayerId === layer.id" :ref="focusRename" v-model="layerName" class="layerNameInput" maxlength="100" aria-label="图层名称"
                @blur="finishRename" @keydown.enter.prevent.stop="finishRename" @keydown.esc.prevent.stop="renamingLayerId = undefined" @keydown.stop />
              <button v-else type="button" class="layerSelect" :draggable="!layer.locked" :aria-pressed="layer === selectedLayer" :title="`${layer.label} · 双击改名，拖拽排序`" @click="selectLayer(layer)"
                @dblclick.stop="startRename(layer)" @keydown.f2.prevent.stop="startRename(layer)"
                @dragstart.stop="startLayerDrag($event, layer)" @dragend.stop="finishLayerDrag">
                <span class="layerThumbnail"><layerImage :layer="layer" thumbnail /></span>
                <span>{{ layer.label }}</span>
              </button>
              <button type="button" class="iconButton" :aria-label="`显示${layer.label}`" :aria-pressed="layer.visible !== false"
                :title="layer.visible === false ? '显示图层' : '隐藏图层'" @click="layer.visible = layer.visible === false">
                <icon-eye v-if="layer.visible !== false" :size="15" aria-hidden="true" />
                <icon-eye-off v-else :size="15" aria-hidden="true" />
              </button>
              <button type="button" class="iconButton" :aria-label="`锁定${layer.label}`" :aria-pressed="layer.locked === true"
                :title="layer.locked ? '解锁图层' : '锁定图层'" @click="layer.locked = !layer.locked">
                <icon-lock v-if="layer.locked" :size="14" aria-hidden="true" />
                <icon-lock-open v-else :size="14" aria-hidden="true" />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
    </teleport>
  </nodeSkeleton>
  <teleport to="body">
    <dialog ref="fullscreenDialog" class="fullscreenDialog" aria-label="图层编辑" @close="fullscreen = false" />
  </teleport>
  <imageViewer v-if="previewUrl" :urlList="[previewUrl]" :downloadUrl="previewUrl" downloadName="图层合并.png" @close="closePreview" />
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, watch, type CSSProperties } from "vue";
import { IconAdjustmentsHorizontal, IconArrowBackUp, IconArrowForwardUp, IconArrowsDiagonal, IconArrowsMaximize, IconArrowsMove, IconChevronDown, IconChevronUp, IconDownload, IconEye, IconEyeOff, IconFocus2, IconLock, IconLockOpen, IconPhotoPlus, IconStack2, IconWand } from "@tabler/icons-vue";
import { writePsd, type Layer } from "ag-psd";
import { useVueFlow } from "@vue-flow/core";
import { ElButton } from "element-plus";
import { nodeSkeleton, uploadNodeFile, useNode, useNodeFiles, type NodeData } from "@toonflow/nodes-scaffold/runtime";
import { emptyMediaCardWidth, getMediaPreviewSize } from "@toonflow/node-shared/mediaPreviewSize";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import imageViewer from "@toonflow/node-shared/imageViewer";
import layerImage from "./layerImage.vue";
import { arrangeLayers, layerBounds, validLayerBox, type LayerLayout } from "./layerLayout";

defineOptions({
  icon: IconStack2,
  handles: [{ id: "in", type: "target", dataType: "IMAGE", label: "来源图片" }],
});

type LayerPosition = { offsetX: number; offsetY: number };
type LayerData = { id: string; label: string; url: string; mimeType: string; visible?: boolean; locked?: boolean; scale?: number; scaleOrigin?: "layer"; opacity?: number; imageLayer?: LayerLayout } & Partial<LayerPosition>;
type AdjustmentField = "scale" | "opacity";
type LayerNodeData = NodeData & {
  layers?: LayerData[];
  canvasWidth?: number;
  canvasHeight?: number;
  previewWidth?: number;
  splitStatus?: "processing" | "completed" | "failed";
  splitError?: string;
  referenceImage?: { url: string; mimeType: string };
  layoutVersion?: number;
};
const { node, nodeProps } = useNode({ label: "图层分离" });
const { getWorkspaceFiles } = useNodeFiles();
const { addNodes, addSelectedNodes, findNode, getNodes, getSelectedNodes, nodeTypes, removeSelectedElements } = useVueFlow();
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
const getCanvas = inject<() => { id: string } | undefined>("canvas");
const data = computed(() => node.data as LayerNodeData);
const layers = computed(() => Array.isArray(data.value.layers) ? data.value.layers.filter(layer =>
  typeof layer?.id === "string" && typeof layer.label === "string" && typeof layer.url === "string"
  && !!layer.url && typeof layer.mimeType === "string" && layer.mimeType.startsWith("image/"),
) : []);
const displayLayers = computed(() => [...layers.value].reverse());
const selectedLayerId = ref<string>();
const soloLayerId = ref<string>();
const renamingLayerId = ref<string>();
const layerName = ref("");
const layerHistory = shallowRef<string[]>([]);
const historyIndex = ref(-1);
const restoringHistory = ref(false);
const draggingLayerId = ref<string>();
const dropTarget = ref<{ id: string; after: boolean }>();
const arranging = ref(false);
let layoutController: AbortController | undefined;
const selectedLayer = computed(() => displayLayers.value.find(layer => layer.id === selectedLayerId.value) ?? displayLayers.value[0]);
const selectedLayerIndex = computed(() => selectedLayer.value ? displayLayers.value.indexOf(selectedLayer.value) : -1);
const controlsVisible = ref(true);
const fullscreen = ref(false);
const toolbarTarget = ref<HTMLElement>();
const fullscreenDialog = ref<HTMLDialogElement>();
const editing = computed(() => fullscreen.value || (node.selected && controlsVisible.value));
const canMove = computed(() => !!selectedLayer.value && selectedLayer.value.visible !== false && (selectedLayer.value.opacity ?? 100) > 0 && !selectedLayer.value.locked);
const rendering = ref<"preview" | "merge" | "extract" | "psd">();
const previewUrl = ref("");
const canExportPsd = computed(() => !arranging.value && !rendering.value && !moveDraft.value && !adjustmentDraft.value && layers.value.length > 0);
const canCompose = computed(() => canExportPsd.value && layers.value.some(layer => layer.visible !== false && (layer.opacity ?? 100) > 0));
let renderController: AbortController | undefined;
const canvasWidth = computed(() => data.value.canvasWidth || 1);
const canvasHeight = computed(() => data.value.canvasHeight || 1);
const previewWidth = computed(() => data.value.previewWidth || emptyMediaCardWidth);
const showLayerRail = computed(() => layers.value.length > 0 || data.value.splitStatus === "processing" || data.value.splitStatus === "failed");
const nodePanelWidth = computed(() => previewWidth.value + (showLayerRail.value ? 156 : 0));
const adjustments = [
  { field: "scale", label: "缩放", min: 10, max: 300 },
  { field: "opacity", label: "不透明度", min: 0, max: 100 },
] as const;
const adjustmentDraft = shallowRef<{ layer: LayerData; field: AdjustmentField; value: number }>();
const moveDraft = shallowRef<{
  layer: LayerData;
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
  position: LayerPosition;
  initialScale?: number;
  scale?: number;
}>();

function selectLayer(layer: LayerData) {
  selectedLayerId.value = layer.id;
  if (soloLayerId.value) soloLayerId.value = layer.id;
  if (node.selected && getSelectedNodes.value.length === 1) return;
  removeSelectedElements();
  addSelectedNodes([node]);
}

watch(() => data.value.layers, () => {
  for (const layer of layers.value) {
    if (layer.scaleOrigin === "layer") continue;
    const box = layer.imageLayer?.box;
    // 保留旧版以整幅画布为中心缩放后的可见位置，再改用图层自身中心。
    if (validLayerBox(box) && (layer.scale ?? 100) !== 100) {
      const delta = (layer.scale ?? 100) - 100;
      layer.offsetX = (layer.offsetX ?? 0) + delta * ((box[0] + box[2]) / 2 - 0.5);
      layer.offsetY = (layer.offsetY ?? 0) + delta * ((box[1] + box[3]) / 2 - 0.5);
    }
    layer.scaleOrigin = "layer";
  }
}, { immediate: true, flush: "sync" });

watch(() => JSON.stringify({ layers: data.value.layers ?? [], layoutVersion: data.value.layoutVersion }), snapshot => {
  if (restoringHistory.value) return;
  if (snapshot === layerHistory.value[historyIndex.value]) return;
  if (layers.value.length && layerHistory.value.length === 1 && !JSON.parse(layerHistory.value[0]!).layers.length) layerHistory.value = [];
  // ACT: 仅保留本次编辑的最近 30 步元数据，图片文件不复制；重新打开节点后从当前状态开始记录。
  layerHistory.value = [...layerHistory.value.slice(0, historyIndex.value + 1), snapshot].slice(-31);
  historyIndex.value = layerHistory.value.length - 1;
}, { immediate: true });

watch(layers, value => {
  if (soloLayerId.value && !value.some(layer => layer.id === soloLayerId.value)) soloLayerId.value = undefined;
});

async function restoreHistory(delta: number) {
  const index = historyIndex.value + delta;
  if (arranging.value || rendering.value || restoringHistory.value || index < 0 || index >= layerHistory.value.length) return;
  layoutController?.abort();
  moveDraft.value = undefined;
  adjustmentDraft.value = undefined;
  renamingLayerId.value = undefined;
  finishLayerDrag();
  restoringHistory.value = true;
  try {
    const snapshot = JSON.parse(layerHistory.value[index]!);
    Object.assign(data.value, { layers: snapshot.layers, layoutVersion: snapshot.layoutVersion });
    historyIndex.value = index;
    await nextTick();
  } finally { restoringHistory.value = false; }
}

function editorKeydown(event: KeyboardEvent) {
  if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable='true']")) return;
  if (event.key === "Escape" && (moveDraft.value || soloLayerId.value)) {
    event.preventDefault();
    event.stopPropagation();
    moveDraft.value = undefined;
    soloLayerId.value = undefined;
    return;
  }
  if (!(event.ctrlKey || event.metaKey) || event.altKey || !["z", "y"].includes(event.key.toLowerCase())) return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) void restoreHistory(event.shiftKey || event.key.toLowerCase() === "y" ? 1 : -1);
}

function startRename(layer: LayerData) {
  if (layer.locked) return;
  selectLayer(layer);
  layerName.value = layer.label;
  renamingLayerId.value = layer.id;
}

function focusRename(element: unknown) {
  if (element instanceof HTMLInputElement && document.activeElement !== element) { element.focus(); element.select(); }
}

function finishRename() {
  const layer = layers.value.find(item => item.id === renamingLayerId.value);
  const label = layerName.value.trim();
  if (layer && !layer.locked && label) layer.label = label;
  renamingLayerId.value = undefined;
}

watch(() => [data.value.layers, data.value.splitStatus], () => void initializeLayout(), { immediate: true });

async function initializeLayout(force = false) {
  if (restoringHistory.value || arranging.value || (!force && data.value.layoutVersion) || data.value.splitStatus === "processing" || !layers.value.length) return;
  const original = layers.value;
  if (!force && original.some(layer => layer.offsetX || layer.offsetY || (layer.scale ?? 100) !== 100 || (layer.opacity ?? 100) !== 100 || layer.locked || layer.visible === false)) return;
  const snapshot = JSON.stringify(original);
  const layoutVersion = data.value.layoutVersion;
  const canvasId = getCanvas?.()?.id;
  const controller = layoutController = new AbortController();
  arranging.value = true;
  try {
    const files = getWorkspaceFiles();
    let reference = data.value.referenceImage;
    let next = original.map(layer => ({ ...layer }));
    if (!next.some(layer => layer.imageLayer)) {
      // 兼容已生成且遗漏位置数据的图层：只读取同目录的恢复描述，不重新请求生成。
      const directory = next[0]!.url.slice(0, next[0]!.url.lastIndexOf("/"));
      const restored = await files.readJson<{ referenceImage?: { url: string; mimeType: string }; layers?: LayerData[] }>(`${directory}/layerLayout.json`).catch((error) => {
        if (error?.response?.status === 404 || error?.response?.data?.data?.code === "ENOENT") return undefined;
        throw error;
      });
      if (!Array.isArray(restored?.layers)) {
        if (force) throw new Error("此任务未保存图层位置，暂时只能手动调整");
        return;
      }
      next = next.map(layer => {
        if (layer.locked) return layer;
        const saved = restored.layers!.find(item => item.url === layer.url);
        if (!saved?.imageLayer || (saved.imageLayer.box !== undefined && !validLayerBox(saved.imageLayer.box))) return layer;
        return { ...layer, imageLayer: saved.imageLayer, label: saved.imageLayer.name || layer.label };
      });
      reference = restored.referenceImage;
    }
    controller.signal.throwIfAborted();
    if (force) for (const layer of next) {
      if (layer.locked) continue;
      delete layer.offsetX;
      delete layer.offsetY;
      delete layer.scale;
    }
    next.sort((a, b) => (a.imageLayer?.zIndex ?? original.findIndex(layer => layer.id === a.id)) - (b.imageLayer?.zIndex ?? original.findIndex(layer => layer.id === b.id)));
    if (reference?.url && reference.mimeType?.startsWith("image/")) {
      next = await arrangeLayers(next, reference, canvasWidth.value / canvasHeight.value, path => files.read(path), controller.signal);
    }
    const unlocked = next.filter(layer => !layer.locked);
    next = original.map(layer => layer.locked ? layer : unlocked.shift()!);
    controller.signal.throwIfAborted();
    if (data.value.layoutVersion !== layoutVersion || JSON.stringify(layers.value) !== snapshot || findNode(node.id) !== node || getCanvas?.()?.id !== canvasId) return;
    await batchHistory(async () => {
      controller.signal.throwIfAborted();
      Object.assign(data.value, { layoutVersion: 1, layers: next, ...(reference ? { referenceImage: reference } : {}) });
    });
  } catch (error) {
    if (!controller.signal.aborted) showNodeError(error, "图层自动排列失败，仍可手动调整");
  } finally {
    arranging.value = false;
    if (layoutController === controller) layoutController = undefined;
  }
}

function toggleControls() {
  if (node.selected) controlsVisible.value = !controlsVisible.value;
  else if (selectedLayer.value) {
    controlsVisible.value = true;
    selectLayer(selectedLayer.value);
  }
}

function openFullscreen() {
  fullscreenDialog.value?.showModal();
  fullscreen.value = fullscreenDialog.value?.open === true;
}

function showPreview() {
  // 浏览器把原生模态框放在顶层，先关闭编辑窗再打开宿主的图片查看器。
  fullscreenDialog.value?.close();
  void renderImage("preview");
}

function closePreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = "";
}

onBeforeUnmount(() => {
  layoutController?.abort();
  renderController?.abort();
  closePreview();
});

async function renderImage(action: "preview" | "merge" | "extract" | "psd") {
  const exportPsd = action === "psd";
  if (!(exportPsd ? canExportPsd.value : canCompose.value)) return;
  const controller = renderController = new AbortController();
  rendering.value = action;
  const canvasId = getCanvas?.()?.id;
  const fileName = `${String(node.data.label || "图层分离").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 120) || "图层分离"}.psd`;
  const selected = selectedLayer.value;
  const renderLayers = layers.value.filter(layer => exportPsd || (layer.visible !== false && (layer.opacity ?? 100) > 0
    && (action !== "extract" || layer === selected) && (action !== "preview" || !soloLayerId.value || layer.id === soloLayerId.value))).map(layer => ({ ...layer }));
  const canvas = document.createElement("canvas");
  const layerCanvas = exportPsd ? document.createElement("canvas") : undefined;
  try {
    if (!renderLayers.length) throw new Error("没有可导出的图层");
    if ((action === "merge" || action === "extract") && !nodeTypes?.value?.["remote-imageNode"]) throw new Error("请先启用图片节点");
    const workspace = getWorkspaceFiles();
    const width = canvasWidth.value;
    const height = canvasHeight.value;
    const children: Layer[] = [];
    let exportPixels = width * height;
    // ACT: PSD 编码需要同时保留所有图层像素，限制累计像素以控制浏览器内存。
    const maxExportPixels = 64 * 1024 * 1024;
    if (exportPsd && (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
      || width > 30000 || height > 30000 || exportPixels > maxExportPixels)) throw new Error("画布尺寸超出 PSD 导出范围");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context || !width || !height) throw new Error("无法创建图层导出画布");
    for (const layer of renderLayers) {
      const bytes = await workspace.read(layer.url);
      controller.signal.throwIfAborted();
      const bitmap = await createImageBitmap(new Blob([bytes], { type: layer.mimeType }));
      try {
        controller.signal.throwIfAborted();
        const bounds = layerBounds(layer, bitmap.width, bitmap.height, width, height);
        const scale = (layer.scale ?? 100) / 100;
        const drawWidth = bounds.width * scale;
        const drawHeight = bounds.height * scale;
        const x = bounds.x + (bounds.width - drawWidth) / 2 + width * (layer.offsetX ?? 0) / 100;
        const y = bounds.y + (bounds.height - drawHeight) / 2 + height * (layer.offsetY ?? 0) / 100;
        const opacity = (layer.opacity ?? 100) / 100;
        if (layerCanvas) {
          const left = Math.round(x);
          const top = Math.round(y);
          const layerWidth = Math.max(1, Math.round(drawWidth));
          const layerHeight = Math.max(1, Math.round(drawHeight));
          exportPixels += layerWidth * layerHeight;
          if (layerWidth > 30000 || layerHeight > 30000 || exportPixels > maxExportPixels) {
            throw new Error("图层尺寸或累计像素超出 PSD 导出范围");
          }
          layerCanvas.width = layerWidth;
          layerCanvas.height = layerHeight;
          const layerContext = layerCanvas.getContext("2d", { willReadFrequently: true });
          if (!layerContext) throw new Error("无法创建 PSD 图层画布");
          layerContext.drawImage(bitmap, 0, 0, layerWidth, layerHeight);
          const hidden = layer.visible === false;
          children.push({
            name: layer.label, left, top, hidden, opacity,
            imageData: layerContext.getImageData(0, 0, layerWidth, layerHeight),
            ...(layer.locked ? { protected: { all: true } } : {}),
          });
          if (hidden || opacity <= 0) continue;
          context.globalAlpha = opacity;
          context.drawImage(layerCanvas, left, top);
        } else {
          context.globalAlpha = opacity;
          context.drawImage(bitmap, x, y, drawWidth, drawHeight);
        }
      } finally {
        bitmap.close();
      }
    }
    if (exportPsd) {
      controller.signal.throwIfAborted();
      const content = writePsd({ width, height, canvas, children }, { noBackground: true });
      const url = URL.createObjectURL(new Blob([content], { type: "image/vnd.adobe.photoshop" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      let saving = false;
      link.addEventListener("downloadstate", event => {
        saving = (event as CustomEvent<boolean>).detail;
        if (!saving) URL.revokeObjectURL(url);
      });
      document.body.append(link);
      try { link.click(); }
      finally {
        link.remove();
        if (!saving) window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      return;
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(value => value ? resolve(value) : reject(new Error("无法生成合并图片")), "image/png"));
    controller.signal.throwIfAborted();
    if (action === "preview") {
      closePreview();
      previewUrl.value = URL.createObjectURL(blob);
      return;
    }
    if (blob.size > 100 * 1024 * 1024) throw new Error("合并图片不能超过 100 MB");
    const id = crypto.randomUUID();
    const url = await uploadNodeFile(workspace, id, new File([blob], "merged.png", { type: "image/png" }));
    await batchHistory(async () => {
      controller.signal.throwIfAborted();
      if (findNode(node.id) !== node || getCanvas?.()?.id !== canvasId) throw new Error("画布已切换，请重新合并");
      if (!nodeTypes?.value?.["remote-imageNode"]) throw new Error("图片节点插件已停用");
      const preview = getMediaPreviewSize(width, height);
      const x = node.computedPosition.x + node.dimensions.width + 24;
      let y = node.computedPosition.y;
      for (const other of [...getNodes.value].sort((a, b) => a.computedPosition.y - b.computedPosition.y)) {
        const position = other.computedPosition;
        if (position.x < x + preview.width + 6 && position.x + other.dimensions.width > x
          && position.y < y + preview.height + 38 && position.y + other.dimensions.height > y) {
          y = position.y + other.dimensions.height + 24;
        }
      }
      addNodes({ id, type: "remote-imageNode", position: { x, y }, data: {
        label: action === "extract" ? selected!.label : `${node.data.label || "图层分离"} · 合并`,
        outputs: { image: { dataType: "IMAGE", value: { url, mimeType: "image/png" } } },
      } });
    });
    fullscreenDialog.value?.close();
  } catch (error) {
    const messages = { merge: "合并图层失败", extract: "提取图层失败", preview: "预览图层失败", psd: "导出 PSD 失败" };
    if (!controller.signal.aborted) showNodeError(error, messages[action]);
  } finally {
    canvas.width = canvas.height = 0;
    if (layerCanvas) layerCanvas.width = layerCanvas.height = 0;
    rendering.value = undefined;
    renderController = undefined;
  }
}

function reorderLayer(layer: LayerData, other?: LayerData) {
  const savedLayers = data.value.layers;
  if (!other || !savedLayers || other === layer || layer.locked || other.locked) return;
  const next = [...savedLayers];
  const from = next.indexOf(layer);
  const to = next.indexOf(other);
  if (from < 0 || to < 0) return;
  next.splice(from, 1);
  next.splice(to, 0, layer);
  data.value.layoutVersion = 1;
  data.value.layers = next;
}

function startLayerDrag(event: DragEvent, layer: LayerData) {
  if (!event.dataTransfer || layer.locked) { event.preventDefault(); return; }
  layoutController?.abort();
  selectLayer(layer);
  draggingLayerId.value = layer.id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", layer.id);
}

function overLayer(event: DragEvent, layer: LayerData) {
  if (!draggingLayerId.value || draggingLayerId.value === layer.id) { dropTarget.value = undefined; return; }
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const after = event.clientY > bounds.top + bounds.height / 2;
  const dragged = displayLayers.value.find(item => item.id === draggingLayerId.value);
  const next = displayLayers.value.filter(item => item !== dragged);
  if (!dragged || dragged.locked) return;
  next.splice(next.indexOf(layer) + (after ? 1 : 0), 0, dragged);
  if (next.some((item, index) => item.locked && displayLayers.value[index] !== item)) {
    dropTarget.value = undefined;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    return;
  }
  dropTarget.value = { id: layer.id, after };
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

function dropLayer(target: LayerData) {
  const layer = layers.value.find(item => item.id === draggingLayerId.value);
  if (layer && !layer.locked && layer !== target && dropTarget.value?.id === target.id) {
    const next = displayLayers.value.filter(item => item !== layer);
    next.splice(next.indexOf(target) + (dropTarget.value.after ? 1 : 0), 0, layer);
    if (next.some((item, index) => item.locked && displayLayers.value[index] !== item)) { finishLayerDrag(); return; }
    data.value.layoutVersion = 1;
    data.value.layers = next.reverse();
  }
  finishLayerDrag();
}

function finishLayerDrag() {
  draggingLayerId.value = undefined;
  dropTarget.value = undefined;
}

function imageStyle(layer: LayerData): CSSProperties | undefined {
  const box = layer.imageLayer?.box;
  if (!validLayerBox(box)) return;
  return { left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, right: "auto", bottom: "auto", width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%`, objectFit: "fill" };
}

function adjustmentValue(layer: LayerData, field: AdjustmentField) {
  const draft = adjustmentDraft.value;
  return draft?.layer === layer && draft.field === field ? draft.value : (layer[field] ?? 100);
}

function adjustLayer(event: Event, layer: LayerData, field: AdjustmentField) {
  if (layer.locked) { adjustmentDraft.value = undefined; return; }
  const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
  if (event.type === "input") {
    adjustmentDraft.value = { layer, field, value };
    return;
  }
  if (value !== (layer[field] ?? 100)) layer[field] = value;
  adjustmentDraft.value = undefined;
}

function resetLayer(layer: LayerData) {
  if (layer.locked) return;
  delete layer.offsetX;
  delete layer.offsetY;
  delete layer.scale;
  delete layer.opacity;
}

function layerStyle(layer: LayerData): CSSProperties {
  const draft = moveDraft.value;
  const position = draft?.layer === layer ? draft.position : layer;
  const scale = draft?.layer === layer ? draft.scale ?? adjustmentValue(layer, "scale") : adjustmentValue(layer, "scale");
  const box = layer.imageLayer?.box;
  return {
    transform: `translate(${position.offsetX ?? 0}%, ${position.offsetY ?? 0}%) scale(${scale / 100})`,
    transformOrigin: validLayerBox(box) ? `${(box[0] + box[2]) * 50}% ${(box[1] + box[3]) * 50}%` : "50% 50%",
    opacity: adjustmentValue(layer, "opacity") / 100,
  };
}

function startMove(event: PointerEvent, resize = false) {
  const layer = selectedLayer.value;
  const button = event.currentTarget as HTMLButtonElement;
  const bounds = button.parentElement?.getBoundingClientRect();
  if (!layer || !canMove.value || !event.isPrimary || event.button !== 0 || !bounds?.width || !bounds.height) return;
  layoutController?.abort();
  button.setPointerCapture(event.pointerId);
  moveDraft.value = {
    layer,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    width: bounds.width,
    height: bounds.height,
    position: { offsetX: layer.offsetX ?? 0, offsetY: layer.offsetY ?? 0 },
    initialScale: resize ? layer.scale ?? 100 : undefined,
  };
}

function moveLayer(event: PointerEvent) {
  const draft = moveDraft.value;
  if (!draft || draft.pointerId !== event.pointerId) return;
  const deltaX = event.clientX - draft.startX;
  const deltaY = event.clientY - draft.startY;
  if (draft.initialScale !== undefined) {
    const delta = (deltaX * draft.width + deltaY * draft.height) / (draft.width ** 2 + draft.height ** 2);
    moveDraft.value = { ...draft, scale: clampScale(draft.initialScale + delta * 200) };
    return;
  }
  moveDraft.value = {
    ...draft,
    position: {
      offsetX: (draft.layer.offsetX ?? 0) + deltaX / draft.width * 100,
      offsetY: (draft.layer.offsetY ?? 0) + deltaY / draft.height * 100,
    },
  };
}

function finishMove(event: PointerEvent) {
  moveLayer(event);
  const draft = moveDraft.value;
  if (!draft || draft.pointerId !== event.pointerId) return;
  moveDraft.value = undefined;
  const { layer, position, scale } = draft;
  if (!canMove.value || layer !== selectedLayer.value) return;
  if (scale !== undefined) {
    if (scale !== (layer.scale ?? 100)) { data.value.layoutVersion = 1; layer.scale = scale; }
  } else if (position.offsetX !== (layer.offsetX ?? 0) || position.offsetY !== (layer.offsetY ?? 0)) {
    data.value.layoutVersion = 1;
    Object.assign(layer, position);
  }
}

function clampScale(value: number) {
  return Math.max(adjustments[0].min, Math.min(adjustments[0].max, Math.round(value)));
}

function nudgeScale(delta: number) {
  const layer = selectedLayer.value;
  if (layer && canMove.value) layer.scale = clampScale((layer.scale ?? 100) + delta);
}

function cancelMove(event: PointerEvent) {
  if (moveDraft.value?.pointerId === event.pointerId) moveDraft.value = undefined;
}

const arrowOffsets: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function nudgeLayer(event: KeyboardEvent) {
  const offset = arrowOffsets[event.key];
  const layer = selectedLayer.value;
  if (!layer || !canMove.value || !Array.isArray(offset)) return;
  event.preventDefault();
  event.stopPropagation();
  const step = event.shiftKey ? 10 : 1;
  layer.offsetX = (layer.offsetX ?? 0) + offset[0] * step / canvasWidth.value * 100;
  layer.offsetY = (layer.offsetY ?? 0) + offset[1] * step / canvasHeight.value * 100;
}
</script>

<style scoped lang="scss">
@use "@toonflow/node-shared/imageToolStyles.scss" as tools;

.fullscreenDialog {
  @include tools.surface(14px);
  box-sizing: border-box;
  width: min(760px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  padding: 14px;
  overflow: auto;
  &::backdrop { background: rgb(0 0 0 / 52%); }

  .fullscreenContent {
    .fullscreenHeader { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .layerStage .layerPreview {
      width: min(100%, calc(60dvh * v-bind(canvasWidth) / v-bind(canvasHeight)));
      justify-self: center;
    }
  }
}

.layerTools {
  @include tools.surface(8px);
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 4px;

  button {
    @include tools.choice;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 28px;
    padding: 0 6px;
    font-size: 12px;
    white-space: nowrap;

    &[aria-pressed="true"] { background: var(--el-fill-color); color: var(--el-color-primary); }
  }
}

.layerContent {
  width: 100%;
  min-width: 0;

  .layerWorkspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    align-items: start;
    min-width: 0;

    &.withLayerRail { grid-template-columns: minmax(0, 1fr) 148px; }
  }

  .layerSidebar {
    display: grid;
    gap: 5px;
    min-width: 0;
    padding: 5px;
    border: 1px solid var(--el-border-color-light);
    border-radius: 6px;
    background: var(--el-bg-color-overlay);
    color: var(--el-text-color-primary);
    font-size: 12px;

    button {
      min-width: 0;
      padding: 0;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;

      &:hover:enabled { background: var(--el-fill-color); }
      &:disabled { color: var(--el-text-color-disabled); cursor: default; }
    }

    .layerSidebarHeader {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 18px 24px 24px;
      align-items: center;
      min-height: 26px;
      padding: 0 2px 4px;
      border-bottom: 1px solid var(--el-border-color-lighter);
      color: var(--el-text-color-secondary);

      .layerCount { text-align: center; font-variant-numeric: tabular-nums; }
      .iconButton { display: grid; width: 24px; height: 24px; place-items: center; }
    }

    .layerList {
      display: grid;
      gap: 3px;
      max-height: 220px;
      overflow: auto;
      scrollbar-gutter: stable;

      .layerRow {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 24px 24px;
        align-items: center;
        gap: 2px;
        min-width: 0;
        min-height: 32px;
        padding: 2px;
        border-radius: 5px;

        &.active { background: var(--el-fill-color-light); }
        &.dropBefore { box-shadow: inset 0 2px var(--el-color-primary); }
        &.dropAfter { box-shadow: inset 0 -2px var(--el-color-primary); }

        .layerNameInput {
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
          height: 28px;
          padding: 2px 3px;
          border: 1px solid var(--el-color-primary);
          border-radius: 4px;
          background: var(--el-bg-color);
          color: inherit;
          font: inherit;
        }

        .layerSelect {
          display: flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
          min-height: 28px;
          padding-inline: 3px;
          overflow: hidden;
          text-align: left;
          cursor: grab;
          &:active { cursor: grabbing; }

          &[aria-pressed="true"] { color: var(--el-text-color-primary); }

          .layerThumbnail {
            position: relative;
            flex: 0 0 24px;
            height: 24px;
            overflow: hidden;
            border-radius: 3px;
            background: var(--el-fill-color);
          }

          span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        }

        .iconButton {
          display: grid;
          width: 24px;
          height: 26px;
          place-items: center;

          &[aria-pressed="false"] { color: var(--el-text-color-placeholder); }
        }
      }
    }
  }

  .layerStage {
    display: grid;
    gap: 6px;
    min-width: 0;

  .layerPreview {
    width: 100%;
    position: relative;
    overflow: hidden;
    background-color: var(--el-bg-color);
    background-image: linear-gradient(45deg, var(--el-fill-color-light) 25%, transparent 25%),
      linear-gradient(-45deg, var(--el-fill-color-light) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--el-fill-color-light) 75%),
      linear-gradient(-45deg, transparent 75%, var(--el-fill-color-light) 75%);
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    background-size: 16px 16px;

    .layerPlane {
      position: absolute;
      inset: 0;
      pointer-events: none;

      .layerSelection {
        position: absolute;
        inset: 0;
        box-sizing: border-box;
        border: 1px dashed var(--el-color-primary);
      }
    }

    .soloHint {
      position: absolute;
      z-index: 1;
      bottom: 6px;
      left: 6px;
      padding: 3px 5px;
      border-radius: 4px;
      background: var(--el-bg-color-overlay);
      color: var(--el-text-color-secondary);
      font-size: 10px;
      pointer-events: none;
    }

    .layerStatus {
      position: absolute;
      inset: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 16px;
      overflow: hidden;
      background: color-mix(in srgb, var(--el-bg-color) 76%, transparent);
      color: var(--el-text-color-secondary);
      font-size: 13px;
      text-align: center;

      &.failed { color: var(--el-color-danger); }
      span:last-child { max-width: 100%; overflow-wrap: anywhere; }
    }

    .statusSpinner {
      width: 15px;
      height: 15px;
      flex: 0 0 15px;
      border: 2px solid var(--el-border-color);
      border-top-color: var(--el-color-primary);
      border-radius: 50%;
      animation: layerStatusSpin 0.8s linear infinite;
    }

    @keyframes layerStatusSpin { to { transform: rotate(360deg); } }

    .layerMove {
      position: absolute;
      inset: 0;
      display: block;
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: grab;
      touch-action: none;

      &:active { cursor: grabbing; }
      &:focus-visible { outline-offset: -2px; }

      .moveHint {
        position: absolute;
        top: 6px;
        left: 6px;
        box-sizing: border-box;
        width: 25px;
        height: 25px;
        padding: 5px;
        border: 1px solid var(--el-border-color-lighter);
        border-radius: 6px;
        background: var(--el-bg-color-overlay);
        color: var(--el-text-color-primary);
        box-shadow: var(--el-box-shadow-light);
        pointer-events: none;
      }
    }

    .previewActions {
      position: absolute;
      z-index: 1;
      top: 6px;
      right: 6px;
      display: flex;
      gap: 4px;

      button {
        @include tools.choice;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 25px;
        padding: 0 6px;
        background: var(--el-bg-color-overlay);
        font-size: 12px;
        box-shadow: var(--el-box-shadow-light);
      }
    }

    .layerResize {
      @include tools.choice;
      position: absolute;
      right: 6px;
      bottom: 6px;
      display: grid;
      place-items: center;
      width: 25px;
      height: 25px;
      padding: 0;
      background: var(--el-bg-color-overlay);
      cursor: nwse-resize;
      touch-action: none;
    }
  }

  .layerControls {
    display: grid;
    gap: 6px;
    min-width: 0;
    font-size: 12px;
    color: var(--el-text-color-primary);

    button {
      min-width: 0;
      padding: 0;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;

      &:hover:enabled { background: var(--el-fill-color); }
      &:disabled { color: var(--el-text-color-disabled); cursor: default; }
    }

    .layerAdjustments {
      display: grid;
      gap: 2px;
      padding-top: 5px;
      border-top: 1px solid var(--el-border-color-light);

      label {
        display: grid;
        grid-template-columns: 4em minmax(0, 1fr) 3.2em;
        align-items: center;
        gap: 4px;
        min-height: 24px;

        > span:first-child { white-space: nowrap; }

        input {
          width: 100%;
          min-width: 0;
          margin: 0;
          accent-color: var(--el-text-color-primary);
          cursor: pointer;
        }

        .adjustmentValue {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
      }

      .resetButton {
        justify-self: end;
        min-height: 24px;
        padding-inline: 4px;
        color: var(--el-text-color-secondary);
      }
    }

    .layerFooter {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      color: var(--el-text-color-secondary);

      .expandEditor { min-height: 24px; padding-inline: 6px; }

      .mergeButton {
        @include tools.action;
        flex: none;
        padding-inline: 9px;
        background: var(--el-button-bg-color);
        color: var(--el-button-text-color);
        &:hover:enabled { background: var(--el-button-hover-bg-color); }
      }
    }
  }
  }
}
</style>
