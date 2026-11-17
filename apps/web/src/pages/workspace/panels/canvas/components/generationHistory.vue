<template>
  <el-dialog v-model="visible" class="generationHistoryDialog" title="历史记录" width="min(1120px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose>
    <el-tabs v-model="activeType" class="generationHistoryTabs">
      <el-tab-pane label="图片历史" name="image">
        <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
        <div v-loading="loading" class="historyGrid">
          <div v-for="item in imageItems" :key="item.path" class="historyMedia" :title="item.name" @dblclick="openPreview(item)">
            <img :src="mediaUrl(item)" :alt="item.name" loading="lazy" />
            <div class="historyActions">
              <el-tooltip content="查看" placement="top"><el-button text :icon="IconEye" aria-label="查看" @click.stop="openPreview(item)" /></el-tooltip>
              <el-tooltip content="发送画布" placement="top"><el-button text :icon="IconSend" aria-label="发送画布" @click.stop="emit('send', item)" /></el-tooltip>
              <el-tooltip content="复制提示词" placement="top"><el-button text :icon="IconCopy" aria-label="复制提示词" @click.stop="copyPrompt(item)" /></el-tooltip>
              <el-tooltip content="下载" placement="top"><el-button text :icon="IconDownload" aria-label="下载" @click.stop="downloadItem(item)" /></el-tooltip>
            </div>
          </div>
          <el-empty v-if="!loading && !imageItems.length" description="暂无图片历史" />
        </div>
      </el-tab-pane>
      <el-tab-pane label="视频历史" name="video">
        <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
        <div v-loading="loading" class="historyGrid">
          <div v-for="item in videoItems" :key="item.path" class="historyMedia" :title="item.name" @dblclick="openPreview(item)">
            <video :src="mediaUrl(item)" muted preload="metadata" />
            <span class="playMark" aria-hidden="true">▶</span>
            <div class="historyActions">
              <el-tooltip content="查看" placement="top"><el-button text :icon="IconEye" aria-label="查看" @click.stop="openPreview(item)" /></el-tooltip>
              <el-tooltip content="发送画布" placement="top"><el-button text :icon="IconSend" aria-label="发送画布" @click.stop="emit('send', item)" /></el-tooltip>
              <el-tooltip content="复制提示词" placement="top"><el-button text :icon="IconCopy" aria-label="复制提示词" @click.stop="copyPrompt(item)" /></el-tooltip>
              <el-tooltip content="下载" placement="top"><el-button text :icon="IconDownload" aria-label="下载" @click.stop="downloadItem(item)" /></el-tooltip>
            </div>
          </div>
          <el-empty v-if="!loading && !videoItems.length" description="暂无视频历史" />
        </div>
      </el-tab-pane>
      <el-tab-pane label="音频历史" name="audio">
        <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
        <div v-loading="loading" class="audioHistoryList">
          <div v-for="item in audioItems" :key="item.path" class="audioHistoryItem">
            <span :title="item.name">{{ item.name }}</span>
            <audio :src="mediaUrl(item)" controls preload="none" />
            <div class="audioHistoryActions">
              <el-tooltip content="查看" placement="top"><el-button text :icon="IconEye" aria-label="查看" @click="openPreview(item)" /></el-tooltip>
              <el-tooltip content="发送画布" placement="top"><el-button text :icon="IconSend" aria-label="发送画布" @click="emit('send', item)" /></el-tooltip>
              <el-tooltip content="复制提示词" placement="top"><el-button text :icon="IconCopy" aria-label="复制提示词" @click="copyPrompt(item)" /></el-tooltip>
              <el-tooltip content="下载" placement="top"><el-button text :icon="IconDownload" aria-label="下载" @click="downloadItem(item)" /></el-tooltip>
            </div>
          </div>
          <el-empty v-if="!loading && !audioItems.length" description="暂无音频历史" />
        </div>
      </el-tab-pane>
    </el-tabs>
    <el-dialog v-model="previewVisible" class="historyViewerDialog" fullscreen :zIndex="4000" :showClose="false" appendToBody destroyOnClose>
      <div v-if="previewItem" class="historyViewer">
        <header class="viewerToolbar">
          <div class="viewerNavigation">
            <el-button text :icon="IconChevronLeft" :disabled="previewIndex <= 0" aria-label="上一个素材" title="上一个素材" @click="movePreview(-1)" />
            <span>{{ previewIndex + 1 }} / {{ previewSequence.length }}</span>
            <el-button text :icon="IconChevronRight" :disabled="previewIndex < 0 || previewIndex >= previewSequence.length - 1" aria-label="下一个素材" title="下一个素材" @click="movePreview(1)" />
          </div>
          <div class="viewerTitle" :title="previewItem.name">{{ previewItem.name }}</div>
          <div class="viewerActions">
            <el-button text :icon="IconDownload" aria-label="下载" title="下载" @click="downloadItem(previewItem)" />
            <el-button text :icon="IconX" aria-label="关闭预览" title="关闭" @click="previewVisible = false" />
          </div>
        </header>
        <main ref="viewerStage" class="viewerStage" :class="{ panning: isPanning }" :style="viewerMediaStyle" @wheel.prevent.stop="zoomAtPointer" @pointerdown="startImagePan" @pointermove="moveImagePan" @pointerup="endImagePan" @pointercancel="endImagePan" @auxclick.prevent>
          <div class="viewerZoom">
            <el-button :icon="IconMinus" aria-label="缩小" title="缩小" :disabled="viewerZoom <= 20" @click="adjustViewerZoom(-10)" />
            <button type="button" class="zoomReset" title="重置缩放" @click="resetViewerTransform">{{ Math.round(viewerZoom) }}%</button>
            <el-button :icon="IconPlus" aria-label="放大" title="放大" :disabled="viewerZoom >= 400" @click="adjustViewerZoom(10)" />
          </div>
          <div class="viewerMedia" :class="`media${previewItem.mediaType}`">
            <img v-if="previewItem.mediaType === 'image'" :src="mediaUrl(previewItem)" alt="历史图片预览" @load="updateMediaDimensions" />
            <video v-else-if="previewItem.mediaType === 'video'" :src="mediaUrl(previewItem)" controls autoplay playsinline :style="{ transform: `scale(${viewerZoom / 100})` }" @loadedmetadata="updateMediaDimensions" />
            <audio v-else :src="mediaUrl(previewItem)" controls autoplay @loadedmetadata="updateMediaDimensions" />
          </div>
          <aside class="viewerInfo">
            <div v-for="field in previewInfo" :key="field.label" class="infoField">
              <span>{{ field.label }}</span>
              <strong>{{ field.value }}</strong>
            </div>
          </aside>
        </main>
        <footer class="viewerPrompt">
          <div class="promptText" :class="{ expanded: promptExpanded }">
            <p v-if="previewPrompt">{{ previewPrompt }}</p>
            <p v-else class="promptEmpty">没有关联的提示词</p>
          </div>
          <div class="promptActions">
            <el-button v-if="previewPrompt" text :icon="IconCopy" aria-label="复制提示词" title="复制提示词" @click="copyPrompt(previewItem)" />
            <el-button v-if="previewPrompt" text @click="promptExpanded = !promptExpanded">{{ promptExpanded ? "收起" : "展开" }}</el-button>
          </div>
        </footer>
      </div>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElDialog, ElEmpty, ElMessage, ElTabPane, ElTabs } from "element-plus";
import { IconChevronLeft, IconChevronRight, IconCopy, IconDownload, IconEye, IconMinus, IconPlus, IconSend, IconX } from "@tabler/icons-vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { getMediaMimeType } from "@toonflow/node-shared/mediaTypes";

type MediaType = "image" | "video" | "audio";
type HistoryNode = { id: string; type: string; label: string; prompt: string; model: string; promptModel?: unknown };
type HistoryItem = { name: string; path: string; nodeId: string; mediaType: MediaType; mimeType: string };

const props = defineProps<{ directory?: string; nodeIds: string[]; nodes: HistoryNode[] }>();
const emit = defineEmits<{ send: [item: HistoryItem] }>();
const visible = defineModel<boolean>({ default: false });
const activeType = ref<MediaType>("image");
const loading = ref(false);
const loadError = ref("");
const entries = ref<HistoryItem[]>([]);
const previewVisible = ref(false);
const previewItem = ref<HistoryItem>();
const previewPrompt = ref("");
const previewDimensions = ref<{ width: number; height: number }>();
const viewerZoom = ref(100);
const viewerOffset = ref({ x: 0, y: 0 });
const viewerStage = ref<HTMLElement>();
const isPanning = ref(false);
const promptExpanded = ref(false);
let panStart: { pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | undefined;
const viewerMediaStyle = computed(() => ({ "--viewerZoom": viewerZoom.value / 100, "--viewerOffsetX": viewerOffset.value.x + "px", "--viewerOffsetY": viewerOffset.value.y + "px" }));
const imageItems = computed(() => entries.value.filter(item => item.mediaType === "image"));
const videoItems = computed(() => entries.value.filter(item => item.mediaType === "video"));
const audioItems = computed(() => entries.value.filter(item => item.mediaType === "audio"));
const previewSequence = computed(() => entries.value.filter(item => item.mediaType === previewItem.value?.mediaType));
const previewIndex = computed(() => previewSequence.value.findIndex(item => item.path === previewItem.value?.path));
const previewInfo = computed(() => {
  const item = previewItem.value;
  if (!item) return [];
  const node = props.nodes.find(entry => entry.id === item.nodeId);
  const dimensions = previewDimensions.value;
  const materialId = item.name.match(/^(?:image|video|audio)([a-f\d]{32})/i)?.[1];
  return [
    ...(dimensions ? [{ label: "尺寸", value: `${dimensions.width} × ${dimensions.height}` }] : []),
    { label: "格式", value: item.mimeType.split("/").at(-1)?.toUpperCase() || item.mimeType },
    ...(node?.model ? [{ label: "生成模型", value: node.model }] : []),
    ...(materialId ? [{ label: "素材编号", value: materialId }] : []),
  ];
});
const mediaUrls = ref<Record<string, string>>({});
const acquiredUrls = new Map<string, { url: Promise<string>; release: () => void }>();
let requestId = 0;

watch([visible, () => props.directory, () => props.nodeIds.join("\n")], async ([open, directory], _previous, onCleanup) => {
  const currentRequest = ++requestId;
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  if (!open || !directory) {
    releaseUrls();
    entries.value = [];
    return;
  }
  releaseUrls();
  loading.value = true;
  loadError.value = "";
  entries.value = [];
  try {
    const files = useWorkspaceFiles(directory);
    const { entries: roots } = await files.list("assets");
    const nodeIds = new Set(props.nodeIds);
    const generationNodeIds = new Set(props.nodes.filter(node => node.type === "remote-imageGenerationNode" || node.type === "remote-videoGenerationNode" || node.type === "remote-audioGenerationNode").map(node => node.id));
    const nodeDirectories = roots.filter(entry => entry.type === "directory" && nodeIds.has(entry.name) && generationNodeIds.has(entry.name));
    const histories = await Promise.all(nodeDirectories.map(entry => files.list(entry.path)));
    if (cancelled || currentRequest !== requestId) return;
    entries.value = histories.flatMap(history => history.entries.flatMap(entry => {
      if (entry.type !== "file") return [];
      const mimeType = getMediaMimeType({ name: entry.name, type: "" });
      const mediaType = mimeType?.split("/")[0];
      if ((mediaType !== "image" && mediaType !== "video" && mediaType !== "audio") || mimeType === "audio/pcm") return [];
      if (!new RegExp(`^${mediaType}[a-f\\d]{32}\\d*\\.[a-z\\d]+$`, "i").test(entry.name)) return [];
      return [{ name: entry.name, path: entry.path, nodeId: entry.path.split("/")[1] ?? "", mediaType: mediaType as MediaType, mimeType }];
    })).sort((left, right) => right.path.localeCompare(left.path, "zh-CN", { numeric: true }));
  } catch (error) {
    if (!cancelled) {
      entries.value = [];
      loadError.value = error instanceof Error ? error.message : "读取历史记录失败";
    }
  } finally {
    if (!cancelled) loading.value = false;
  }
}, { immediate: true });

function mediaUrl(item: HistoryItem) {
  if (mediaUrls.value[item.path]) return mediaUrls.value[item.path];
  void acquireMediaUrl(item).catch(() => {});
  return "";
}

function acquireMediaUrl(item: HistoryItem) {
  let acquired = acquiredUrls.get(item.path);
  if (!acquired) {
    acquired = useWorkspaceFiles(props.directory).acquireUrl(item.path, item.mimeType);
    acquiredUrls.set(item.path, acquired);
    const current = acquired;
    void current.url.then(url => {
      if (acquiredUrls.get(item.path) === current) mediaUrls.value[item.path] = url;
    }).catch(() => {});
  }
  return acquired.url;
}

function taskIdFor(item: HistoryItem) {
  const match = item.name.match(/^(?:image|video|audio)([a-f\d]{32})\d+\.[a-z\d]+$/i);
  if (!match) return "";
  const id = match[1]!;
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

async function copyPrompt(item: HistoryItem) {
  const prompt = await readPrompt(item);
  if (!prompt) return void ElMessage.info("这个素材没有关联的提示词");
  try {
    await navigator.clipboard.writeText(prompt);
    ElMessage.success("提示词已复制");
  } catch {
    ElMessage.error("复制失败，请检查浏览器剪贴板权限");
  }
}

async function readPrompt(item: HistoryItem) {
  const taskId = taskIdFor(item);
  if (!taskId || !props.directory) return "";
  try {
    const query = new URLSearchParams({ directory: props.directory, taskId, path: item.path });
    const response = await fetch(`/api/ai/media/tasks/prompt?${query}`, { headers: { "x-toonflow-workspace": "1" } });
    const result = await response.json() as { code?: number; data?: { prompt?: string } };
    if (!response.ok || result.code !== 200) throw new Error("读取生成提示词失败");
    return result.data?.prompt?.trim() ?? "";
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "读取生成提示词失败");
    return "";
  }
}

async function downloadItem(item: HistoryItem) {
  try {
    const url = await acquireMediaUrl(item);
    const link = document.createElement("a");
    link.href = url;
    link.download = item.name;
    link.click();
  } catch {
    ElMessage.error("下载素材失败");
  }
}

function releaseUrls() {
  for (const acquired of acquiredUrls.values()) acquired.release();
  acquiredUrls.clear();
  mediaUrls.value = {};
}

function openPreview(item: HistoryItem) {
  previewItem.value = item;
  previewPrompt.value = "";
  void readPrompt(item).then(prompt => { if (previewItem.value?.path === item.path) previewPrompt.value = prompt; });
  previewDimensions.value = undefined;
  resetViewerTransform();
  promptExpanded.value = false;
  previewVisible.value = true;
}

function movePreview(direction: number) {
  const next = previewSequence.value[previewIndex.value + direction];
  if (!next) return;
  previewItem.value = next;
  previewPrompt.value = "";
  void readPrompt(next).then(prompt => { if (previewItem.value?.path === next.path) previewPrompt.value = prompt; });
  previewDimensions.value = undefined;
  resetViewerTransform();
  promptExpanded.value = false;
}

function updateMediaDimensions(event: Event) {
  const media = event.currentTarget;
  if (media instanceof HTMLImageElement) previewDimensions.value = { width: media.naturalWidth, height: media.naturalHeight };
  else if (media instanceof HTMLVideoElement) previewDimensions.value = { width: media.videoWidth, height: media.videoHeight };
}

function resetViewerTransform() {
  viewerZoom.value = 100;
  viewerOffset.value = { x: 0, y: 0 };
}

function setViewerZoom(nextZoom: number, clientX?: number, clientY?: number) {
  const zoom = Math.min(400, Math.max(20, nextZoom));
  if (zoom === viewerZoom.value) return;
  if (clientX !== undefined && clientY !== undefined && viewerStage.value) {
    const bounds = viewerStage.value.getBoundingClientRect();
    const anchorX = clientX - bounds.left - bounds.width / 2;
    const anchorY = clientY - bounds.top - bounds.height / 2;
    const ratio = zoom / viewerZoom.value;
    viewerOffset.value = {
      x: anchorX - (anchorX - viewerOffset.value.x) * ratio,
      y: anchorY - (anchorY - viewerOffset.value.y) * ratio,
    };
  }
  viewerZoom.value = zoom;
}

function adjustViewerZoom(amount: number) {
  setViewerZoom(viewerZoom.value + amount);
}

function zoomAtPointer(event: WheelEvent) {
  if (previewItem.value?.mediaType !== "image" || !(event.target instanceof HTMLImageElement)) return;
  setViewerZoom(viewerZoom.value * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
}

function startImagePan(event: PointerEvent) {
  if (previewItem.value?.mediaType !== "image" || event.button !== 1 || !(event.target instanceof HTMLImageElement)) return;
  event.preventDefault();
  panStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: viewerOffset.value.x, offsetY: viewerOffset.value.y };
  isPanning.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function moveImagePan(event: PointerEvent) {
  if (!panStart || panStart.pointerId !== event.pointerId) return;
  viewerOffset.value = { x: panStart.offsetX + event.clientX - panStart.x, y: panStart.offsetY + event.clientY - panStart.y };
}

function endImagePan(event: PointerEvent) {
  if (!panStart || panStart.pointerId !== event.pointerId) return;
  panStart = undefined;
  isPanning.value = false;
}

function handleViewerKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowLeft") { event.preventDefault(); movePreview(-1); }
  if (event.key === "ArrowRight") { event.preventDefault(); movePreview(1); }
}

watch(previewVisible, open => {
  if (open) window.addEventListener("keydown", handleViewerKeydown);
  else window.removeEventListener("keydown", handleViewerKeydown);
});

onBeforeUnmount(releaseUrls);
onBeforeUnmount(() => window.removeEventListener("keydown", handleViewerKeydown));
</script>

<style lang="scss" scoped>
:global(.generationHistoryDialog) {
  display: flex;
  flex-direction: column;
  height: min(800px, 85dvh);
  max-height: calc(100dvh - 32px);
  overflow: hidden;
}

:global(.generationHistoryDialog > .el-dialog__body) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.generationHistoryTabs {
  display: flex;
  flex-direction: column;
  height: 100%;
  :deep(.el-tabs__header) { flex-shrink: 0; margin-bottom: 16px; }
  :deep(.el-tabs__content) { flex: 1; min-height: 0; overflow: hidden; }
  :deep(.el-tab-pane) { display: flex; flex-direction: column; height: 100%; gap: 12px; }
  :deep(.el-alert) { flex-shrink: 0; }
  :deep(.el-tabs__nav-wrap::after) { height: 1px; }
}

.historyGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  grid-auto-rows: max-content;
  gap: 12px;
  flex: 1;
  min-height: 0;
  align-content: start;
  overflow: auto;

  .historyMedia {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 1;
    overflow: hidden;
    padding: 0;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    background: var(--el-fill-color-light);
    cursor: default;

    img, video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
    video { background: #111; }
    &:hover { border-color: var(--el-color-primary); }
    .playMark { position: absolute; color: white; text-shadow: 0 1px 5px #000; pointer-events: none; }

    .historyActions {
      position: absolute;
      right: 8px;
      bottom: 8px;
      z-index: 2;
      display: flex;
      gap: 2px;
      padding: 4px;
      border: 1px solid rgb(255 255 255 / 18%);
      border-radius: 8px;
      background: rgb(20 22 27 / 88%);
      opacity: 0;
      transition: opacity 120ms ease;

      :deep(.el-button) { width: 32px; height: 32px; margin: 0; color: #fff; }
    }

    &:hover .historyActions, &:focus-within .historyActions { opacity: 1; }
  }
}

.audioHistoryList {
  display: grid;
  gap: 10px;
  flex: 1;
  overflow: auto;
  min-height: 0;
  align-content: start;

  .audioHistoryItem {
    display: grid;
    grid-template-columns: minmax(100px, 1fr) minmax(200px, 2fr) auto;
    align-items: center;
    gap: 16px;
    min-height: 56px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--el-border-color-lighter);

    span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    audio { width: 100%; height: 36px; }

    .audioHistoryActions { display: flex; gap: 2px; white-space: nowrap; }
  }
}

:global(.el-dialog.historyViewerDialog) {
  display: flex;
  flex-direction: column;
  width: 100vw !important;
  height: 100dvh;
  max-height: none;
  margin: 0;
  overflow: hidden;
  background: #111315;
}

:global(.el-dialog.historyViewerDialog .el-dialog__header) {
  display: none;
}

:global(.el-dialog.historyViewerDialog .el-dialog__body) {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 0;
}

.historyViewer { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; color: #f5f5f5; background: #111315; outline: none; }

.viewerToolbar {
  display: grid;
  grid-template-columns: 1fr minmax(0, 1.5fr) 1fr;
  align-items: center;
  gap: 16px;
  min-height: 54px;
  padding: 0 18px;
  border-bottom: 1px solid #303338;
  background: #1b1d20;

  .viewerNavigation, .viewerActions { display: flex; align-items: center; gap: 6px; }
  .viewerNavigation { justify-self: start; color: #d7d9dc; font-size: 13px; font-variant-numeric: tabular-nums; }
  .viewerActions { justify-self: end; }
  .viewerTitle { overflow: hidden; color: #d7d9dc; font-size: 13px; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
  :deep(.el-button) { width: 36px; height: 36px; margin: 0; color: #e5e7eb; }
  :deep(.el-button:hover) { background: #303338; }
}

.viewerStage { position: relative; display: grid; flex: 1; min-height: 0; place-items: center; overflow: hidden; background: #0c0d0e; touch-action: none; }
.viewerStage.panning { cursor: grabbing; }

.viewerMedia { position: absolute; inset: 0; display: grid; width: 100%; height: 100%; place-items: center; overflow: hidden; }
.viewerMedia img, .viewerMedia video { display: block; max-width: calc(100% - 32px); max-height: calc(100% - 32px); object-fit: contain; transform-origin: center; transition: transform 100ms ease; }
.viewerMedia {
  img {
    position: absolute;
    top: 50%;
    left: 50%;
    width: auto;
    height: auto;
    -webkit-user-drag: none;
    transform: translate(-50%, -50%) translate(var(--viewerOffsetX), var(--viewerOffsetY)) scale(var(--viewerZoom));
  }
}
.viewerStage.panning {
  .viewerMedia img { transition: none; }
}
.viewerMedia video { width: 100%; }
.viewerMedia audio { width: min(80%, 720px); }

.viewerZoom { position: absolute; top: 16px; right: 18px; z-index: 2; display: flex; align-items: center; gap: 6px; }
.viewerZoom :deep(.el-button), .zoomReset { width: 38px; height: 38px; border: 1px solid #3b3e43; border-radius: 8px; color: #f2f3f4; background: #1b1d20; }
.zoomReset { width: 54px; font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer; }

.viewerInfo { position: absolute; top: 68px; right: 18px; z-index: 2; display: grid; gap: 18px; width: 220px; max-height: calc(100% - 90px); overflow: auto; padding: 16px; border: 1px solid #373a3f; border-radius: 12px; background: rgb(29 31 34 / 94%); box-shadow: 0 8px 24px rgb(0 0 0 / 22%); }
.infoField { display: grid; gap: 5px; min-width: 0; }
.infoField span { color: #969ba2; font-size: 12px; }
.infoField strong { overflow-wrap: anywhere; color: #f3f4f5; font-size: 13px; font-weight: 500; line-height: 1.45; }

.viewerPrompt { display: flex; align-items: center; gap: 8px; width: min(720px, calc(100% - 32px)); max-height: min(180px, 28vh); align-self: center; margin: 12px 0 16px; padding: 10px 12px; border: 1px solid #373a3f; border-radius: 10px; background: #1b1d20; }
.promptText { flex: 1; min-width: 0; max-height: 3.2em; overflow: auto; }
.promptText:not(.expanded) { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.promptText.expanded { max-height: min(160px, 24vh); }
.promptText p { margin: 0; color: #f0f1f2; font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.promptText .promptEmpty { color: #969ba2; }
.promptActions { display: flex; flex: 0 0 auto; align-items: center; }
.promptActions :deep(.el-button) { margin: 0; color: #c3c7cc; }

@media (max-width: 640px) {
  .historyGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .historyGrid .historyMedia .historyActions { opacity: 1; }
  .audioHistoryList .audioHistoryItem { grid-template-columns: 1fr; gap: 6px; }
  .viewerToolbar { grid-template-columns: 1fr auto; padding: 0 8px; gap: 4px; }
  .viewerTitle { display: none; }
  .viewerInfo { top: 58px; right: 8px; width: 180px; padding: 12px; gap: 12px; }
  .viewerZoom { top: 8px; right: 8px; }
  .viewerPrompt { width: calc(100% - 16px); margin: 8px 0; }
}
</style>
