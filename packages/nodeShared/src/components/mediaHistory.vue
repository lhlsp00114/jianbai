<template>
  <el-popover v-if="inline && replaceable" ref="replacePopover" v-model:visible="replaceVisible" trigger="click" placement="bottom-end" :appendTo="historyTarget" :width="180" :disabled="disabled" :showArrow="false" :persistent="false" :popperStyle="{ padding: '6px' }">
    <template #reference>
      <el-button ref="replaceTrigger" class="historyTrigger nodrag nopan nowheel" :class="{ replaceTrigger: !hideHistory }" :icon="IconTransfer" :disabled="disabled" :aria-expanded="replaceVisible" title="替换素材" aria-label="替换素材" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @keydown.stop />
    </template>
    <div class="replaceMenu nodrag nopan nowheel" role="group" aria-label="替换素材来源" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @keydown.stop @wheel.stop>
      <el-button :icon="IconUpload" :disabled="disabled" text @click="replaceVisible = false; emit('upload')">本地上传</el-button>
      <el-button :icon="IconPhoto" :disabled="disabled" text @click="replaceVisible = false; canvasVisible = true">画布{{ mediaLabel }}</el-button>
    </div>
  </el-popover>
  <el-popover v-if="inline && !hideHistory" ref="historyPopover" v-model:visible="visible" trigger="click" placement="right-start" :appendTo="historyTarget" :width="316" :disabled="historyDisabled" :showArrow="false" :persistent="false" :popperStyle="{ padding: '12px', maxWidth: 'calc(100vw - 24px)' }" @before-enter="emit('open')">
    <template #reference>
      <el-button ref="historyTrigger" class="historyTrigger historyToggle nodrag nopan nowheel" :icon="IconHistory" :disabled="historyDisabled" :aria-expanded="visible" :title="loadError || (loading ? '正在读取历史记录' : items.length < 2 ? '暂无其他版本' : '历史记录')" aria-label="历史记录" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @keydown.stop />
    </template>
    <section v-loading="loading" class="historyPanel nodrag nopan nowheel" aria-label="节点历史" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @keydown.stop @wheel.stop>
      <div class="historyHeader"><span>节点历史</span><span class="historyCount">{{ items.length }} {{ mediaType === 'video' ? '段' : '张' }}</span></div>
      <el-alert v-if="loadError || previewError" :title="loadError || previewError" type="error" :closable="false" />
      <div v-if="!loading && !items.length && !loadError" class="historyEmpty">暂无历史记录</div>
      <div v-if="!loading && pageItems.length" class="historyGrid">
        <div v-for="(item, index) in pageItems" :key="item.url" class="historyTile" :class="{ current: item.url === currentUrl }">
          <button class="selectHistory" type="button" :disabled="disabled" :aria-pressed="item.url === currentUrl" :aria-label="`切换到历史${mediaLabel} ${(page - 1) * historyPageSize + index + 1}`" @click="chooseMedia(item)">
            <promptReferenceThumbnail class="historyThumbnail" :dataType="mediaType === 'video' ? 'VIDEO' : 'IMAGE'" :media="item" />
            <span v-if="item.url === currentUrl" class="currentBadge">当前</span>
            <span v-else-if="item.url === selected?.url && !previewOnly" class="currentBadge">切换中</span>
          </button>
          <el-button class="expandHistory" :icon="IconMaximize" text :disabled="disabled" title="放大预览" :aria-label="`放大历史${mediaLabel} ${(page - 1) * historyPageSize + index + 1}`" @click="chooseMedia(item, true)" />
        </div>
      </div>
      <el-pagination v-model:currentPage="page" :pageSize="historyPageSize" :total="items.length" layout="prev, pager, next" :pagerCount="5" hideOnSinglePage small />
      <template v-if="mediaSrc && selected">
        <img v-if="mediaType === 'image'" class="pendingPreview" :src="mediaSrc" alt="" aria-hidden="true" @load="readPreview" @error="previewFailed" />
        <video v-else class="pendingPreview" :src="mediaSrc" muted playsinline preload="auto" aria-hidden="true" @loadeddata="readPreview" @error="previewFailed" />
      </template>
    </section>
  </el-popover>
  <el-button v-else-if="!inline" :icon="IconHistory" :disabled="disabled" text title="历史记录" aria-label="历史记录" @click.stop="visible = true">历史记录</el-button>
  <el-dialog v-if="inline && replaceable" v-model="canvasVisible" :title="`选择画布${mediaLabel}`" width="min(620px, calc(100vw - 32px))" appendToBody destroyOnClose>
    <div class="canvasImagePicker nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @keydown.stop>
      <el-alert v-if="previewError" :title="previewError" type="error" :closable="false" />
      <el-empty v-if="!canvasMedia.length" :description="`画布中暂无其它可用${mediaLabel}`" />
      <div v-else class="canvasImageGrid">
        <button v-for="item in canvasPageItems" :key="item.key" type="button" class="canvasImageItem" :disabled="disabled || (!!selected && !previewError)" :title="item.name" :aria-label="`使用画布${mediaLabel}：${item.name}`" @click="item.file.url === currentUrl ? canvasVisible = false : chooseMedia(item.file)">
          <promptReferenceThumbnail class="canvasThumbnail" :dataType="mediaType === 'video' ? 'VIDEO' : 'IMAGE'" :media="item.file" />
          <span class="canvasImageName">{{ item.name }}</span>
          <span v-if="item.file.url === currentUrl" class="canvasCurrent">当前{{ mediaLabel }}</span>
        </button>
      </div>
      <el-pagination v-model:currentPage="canvasPage" :pageSize="pageSize" :total="canvasMedia.length" layout="prev, pager, next" hideOnSinglePage />
      <img v-if="mediaSrc && selected && mediaType === 'image'" class="pendingPreview" :src="mediaSrc" alt="" aria-hidden="true" @load="readPreview" @error="previewFailed" />
      <video v-else-if="mediaSrc && selected" class="pendingPreview" :src="mediaSrc" muted playsinline preload="auto" aria-hidden="true" @loadeddata="readPreview" @error="previewFailed" />
    </div>
  </el-dialog>
  <el-dialog v-if="viewerVisible" v-model="viewerVisible" :title="`${mediaLabel}预览`" width="min(1080px, calc(100vw - 32px))" appendToBody destroyOnClose>
    <div class="historyViewer nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop>
      <div class="historyViewerStage" v-loading="!!selected && !previewReady && !previewError">
        <template v-if="mediaType === 'image' && mediaSrc && !previewError">
          <div
            ref="imageViewport"
            class="imageViewport"
            :class="{ zoomed: imageZoom > 1 }"
            @wheel.prevent.stop="zoomImage(imageZoom + ($event.deltaY < 0 ? 0.25 : -0.25), $event)"
            @pointerdown="startImagePan"
            @pointermove="panImage"
            @lostpointercapture="imagePan = undefined"
            @pointerup="imagePan = undefined"
            @pointercancel="imagePan = undefined"
            @dblclick="zoomImage(1)">
            <img :src="mediaSrc" :style="{ width: `${imageZoom * 100}%`, height: `${imageZoom * 100}%` }" draggable="false" alt="历史图片放大预览" @load="readPreview" @error="previewFailed" />
          </div>
          <div v-if="previewReady" class="imageZoomControls" role="group" aria-label="图片缩放">
            <el-button :icon="IconZoomOut" circle :disabled="imageZoom <= 1" title="缩小图片" aria-label="缩小图片" @click="zoomImage(imageZoom - 0.25)" />
            <el-button :icon="IconZoomIn" circle :disabled="imageZoom >= 5" title="放大图片" aria-label="放大图片" @click="zoomImage(imageZoom + 0.25)" />
            <el-button round @click="zoomImage(1)">适应窗口</el-button>
          </div>
        </template>
        <video v-else-if="mediaType === 'video' && mediaSrc" :key="mediaSrc" ref="viewerVideo" :src="mediaSrc" controls playsinline preload="auto" aria-label="历史视频放大预览" @loadeddata="readViewerVideo" @error="previewFailed" />
        <el-alert v-if="previewError" :title="previewError" type="error" :closable="false" />
      </div>
      <div class="historyViewerVersions" aria-label="节点历史版本" :aria-busy="loading">
        <div class="historyViewerHeader"><span>节点历史</span><span>{{ items.length }} {{ mediaType === 'video' ? '段' : '张' }}</span></div>
        <div v-if="loading" role="status">正在读取历史记录</div>
        <template v-else>
          <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
          <div class="historyViewerGrid">
            <button v-for="(item, index) in viewerPageItems" :key="item.url" type="button" class="historyViewerItem" :class="{ current: item.url === selected?.url }" :aria-label="`查看历史${mediaLabel} ${(viewerPage - 1) * historyPageSize + index + 1}`" :aria-pressed="item.url === selected?.url" @click="switchViewer(item)">
              <promptReferenceThumbnail class="historyViewerThumbnail" :dataType="mediaType === 'video' ? 'VIDEO' : 'IMAGE'" :media="item" />
              <span v-if="item.url === selected?.url" class="historyViewerBadge">当前</span>
            </button>
          </div>
          <el-pagination v-model:currentPage="viewerPage" :pageSize="historyPageSize" :total="items.length" layout="prev, pager, next" :pagerCount="5" hideOnSinglePage small />
        </template>
      </div>
    </div>
  </el-dialog>
  <el-dialog v-if="!inline" v-model="visible" :title="`${mediaType === 'image' ? '图片' : '视频'}历史记录`" width="min(760px, calc(100vw - 32px))" appendToBody destroyOnClose>
    <div v-loading="loading" class="mediaHistory nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop>
      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
      <el-empty v-else-if="!loading && !items.length" description="暂无历史记录" />
      <template v-else-if="items.length">
        <div class="historyContent">
          <div class="historyList" aria-label="历史文件">
            <button
              v-for="item in pageItems"
              :key="item.url"
              type="button"
              class="historyItem"
              :class="{ selected: selected?.url === item.url }"
              :aria-pressed="selected?.url === item.url"
              :title="item.url"
              @click="selected = item">
              <span class="fileName">{{ item.url.split('/').at(-1) }}</span>
              <span v-if="item.url === current?.url.replaceAll('\\', '/')" class="currentLabel">当前结果</span>
            </button>
          </div>
          <div class="historyPreview" v-loading="!!selected && !previewReady && !previewError" :aria-busy="preparingPreview">
            <el-alert v-if="previewError" :title="previewError" type="error" :closable="false" />
            <img v-else-if="mediaSrc && mediaType === 'image'" :src="mediaSrc" alt="历史图片预览" @load="readPreview" @error="previewFailed" />
            <video v-else-if="mediaSrc" :src="mediaSrc" controls playsinline preload="auto" aria-label="历史视频预览" @loadeddata="readPreview" @error="previewFailed" />
          </div>
        </div>
        <el-pagination v-model:currentPage="page" :pageSize="pageSize" :total="items.length" layout="prev, pager, next" hideOnSinglePage />
      </template>
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" :disabled="disabled || loading || !selected || !previewUrl || !previewReady || !!previewError" @click="selectOutput">设为当前结果</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElAlert, ElButton, ElDialog, ElEmpty, ElLoading, ElPagination, ElPopover } from "element-plus";
import { IconHistory, IconMaximize, IconTransfer, IconUpload, IconPhoto, IconZoomIn, IconZoomOut } from "@tabler/icons-vue";
import { useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import { isNodeOutput, type NodeMediaValue } from "@toonflow/nodes-scaffold/values";
import { useMediaPreview } from "../mediaPreview";
import { getMediaMimeType } from "../mediaTypes";
import promptReferenceThumbnail from "./promptReferenceThumbnail.vue";

const props = defineProps<{ mediaType: "image" | "video"; current?: NodeMediaValue; disabled?: boolean; inline?: boolean; replaceable?: boolean; hideHistory?: boolean; getVideoElement?: () => HTMLVideoElement | undefined }>();
const emit = defineEmits<{ select: [value: NodeMediaValue]; upload: []; open: [] }>();
const vLoading = ElLoading.directive;
const { id, node } = useNode();
const { viewport, getNodes } = useVueFlow();
const files = useNodeFiles();
const visible = ref(false);
const replaceVisible = ref(false);
const canvasVisible = ref(false);
const canvasPage = ref(1);
const replacePopover = ref<InstanceType<typeof ElPopover>>();
const historyPopover = ref<InstanceType<typeof ElPopover>>();
const historyTrigger = ref<InstanceType<typeof ElButton>>();
const replaceTrigger = ref<InstanceType<typeof ElButton>>();
const historyTarget = computed(() => {
  const element = (historyTrigger.value ?? replaceTrigger.value)?.$el as HTMLElement | undefined;
  return element?.closest<HTMLElement>(".vue-flow__node") ?? element?.closest<HTMLElement>(".nodeSkeleton") ?? undefined;
});
watch(() => (visible.value || replaceVisible.value) && props.inline ? [viewport.value.x, viewport.value.y, viewport.value.zoom,
  node.computedPosition.x, node.computedPosition.y, node.dimensions.width, node.dimensions.height] : [], () => {
  void historyPopover.value?.popperRef?.popperInstanceRef?.update();
  void replacePopover.value?.popperRef?.popperInstanceRef?.update();
}, { flush: "post" });
const viewerVisible = ref(false);
const imageViewport = ref<HTMLElement>();
const imageZoom = ref(1);
let imagePan: { id: number; x: number; y: number; left: number; top: number } | undefined;
const viewerVideo = ref<HTMLVideoElement>();
type VideoPlayback = { time: number; playing: boolean; muted: boolean; volume: number; rate: number };
let inlinePlayback: { video: HTMLVideoElement; src: string | null; url: string | undefined; state: VideoPlayback } | undefined;
let restoredViewerVideo: HTMLVideoElement | undefined;
const previewOnly = ref(false);
const loading = ref(false);
const loadError = ref("");
const previewReadError = ref("");
const previewReady = ref(false);
const historyFiles = ref<(NodeMediaValue & { modifiedAt?: number })[]>([]);
const currentFile = computed(() => props.current && { ...props.current, url: props.current.url.replaceAll("\\", "/") });
const items = computed(() => {
  const results = new Map(historyFiles.value.map(file => [file.url, file]));
  // 副本只补当前结果，不继承原节点目录的全部历史。
  const current = currentFile.value;
  if (current) results.set(current.url, { ...current, modifiedAt: results.get(current.url)?.modifiedAt });
  return [...results.values()].sort((left, right) => (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0)
    || left.url.localeCompare(right.url, "zh-CN", { numeric: true }));
});
const historyDisabled = computed(() => props.disabled || loading.value || !!loadError.value || items.value.length < 2);
const mediaLabel = computed(() => props.mediaType === "video" ? "视频" : "图片");
const currentUrl = computed(() => currentFile.value?.url);
const selected = ref<NodeMediaValue>();
const page = ref(1);
const viewerPage = ref(1);
const pageSize = 20;
const historyPageSize = computed(() => props.inline ? 9 : pageSize);
const canvasMedia = computed(() => !canvasVisible.value ? [] : getNodes.value.flatMap(source => source.id === id ? [] :
  Object.entries(source.data.outputs ?? {}).flatMap(([handle, output]) => isNodeOutput(output) && output.dataType === (props.mediaType === "video" ? "VIDEO" : "IMAGE")
    ? [{ key: `${source.id}:${handle}`, name: String(source.data.label || mediaLabel.value), file: { ...output.value, url: output.value.url.replaceAll("\\", "/") } }] : [])));
const canvasPageItems = computed(() => canvasMedia.value.slice((canvasPage.value - 1) * pageSize, canvasPage.value * pageSize));
const pageItems = computed(() => items.value.slice((page.value - 1) * historyPageSize.value, page.value * historyPageSize.value));
const viewerPageItems = computed(() => items.value.slice((viewerPage.value - 1) * historyPageSize.value, viewerPage.value * historyPageSize.value));
const previewFile = computed(() => visible.value || viewerVisible.value || canvasVisible.value ? selected.value : undefined);
watch(previewFile, () => { previewReadError.value = ""; }, { flush: "sync" });
const previewUrl = files.useFileUrl(previewFile, () => { previewReadError.value = "历史文件读取失败，文件可能已被移动或删除"; });
const { src: mediaSrc, preparing: preparingPreview, error: mediaError, handleError, handleLoaded } = useMediaPreview(previewUrl, () => props.mediaType);
const previewError = computed(() => previewReadError.value || mediaError.value);
watch([previewFile, mediaSrc], () => { previewReady.value = false; }, { flush: "sync" });

watch(() => props.disabled, disabled => { if (disabled) visible.value = replaceVisible.value = canvasVisible.value = false; });
watch(replaceVisible, open => { if (open) visible.value = false; });
watch(canvasVisible, () => { canvasPage.value = 1; selected.value = undefined; });
function getHistoryPage(url: string | undefined) {
  const index = items.value.findIndex(item => item.url === url);
  return Math.floor(Math.max(0, index) / historyPageSize.value) + 1;
}

watch(visible, open => {
  if (!viewerVisible.value) selected.value = undefined;
  if (open) page.value = getHistoryPage(currentUrl.value);
});
watch(viewerVisible, open => {
  if (open) {
    viewerPage.value = getHistoryPage(selected.value?.url);
    const video = props.getVideoElement?.();
    if (video) {
      inlinePlayback = { video, src: video.getAttribute("src"), url: currentUrl.value, state: getVideoPlayback(video) };
      video.pause();
    }
  } else {
    saveViewerPlayback();
    const playback = inlinePlayback;
    inlinePlayback = undefined;
    if (playback && playback.url === currentUrl.value && playback.video.isConnected && playback.video.getAttribute("src") === playback.src) {
      restoreVideoPlayback(playback.video, playback.state);
    }
    selected.value = undefined;
  }
}, { flush: "sync" });
onBeforeUnmount(() => { viewerVideo.value?.pause(); });

// 内联历史仅在选中节点后检查目录，媒体仍在展开后按页读取。
const shouldReadHistory = computed(() => props.inline ? !props.hideHistory && !props.disabled : visible.value);
watch([shouldReadHistory, () => props.inline ? currentUrl.value : undefined], async ([active, url], _previous, onCleanup) => {
  if (!active) {
    loading.value = false;
    return;
  }
  // 切换到面板中已有的版本时保留当前页和缩略图。
  if (props.inline && visible.value && !loading.value && historyFiles.value.some(file => file.url === url)) return;
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  loadError.value = "";
  loading.value = true;
  try {
    const { entries } = await files.getWorkspaceFiles().list(`assets/${id}`, undefined, { includeModifiedAt: true }).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
      if (error.response?.data?.data?.code !== "ENOENT") throw error;
      return { entries: [] };
    });
    if (cancelled) return;
    historyFiles.value = entries.flatMap(entry => {
      const mimeType = getMediaMimeType({ name: entry.name, type: "" });
      return entry.type === "file" && mimeType?.startsWith(`${props.mediaType}/`)
        ? [{ url: entry.path.replaceAll("\\", "/"), mimeType, modifiedAt: entry.modifiedAt }] : [];
    });
    if (!props.inline) {
      selected.value = currentFile.value ?? items.value[0];
      page.value = getHistoryPage(currentUrl.value);
    }
    if (viewerVisible.value) viewerPage.value = getHistoryPage(selected.value?.url);
  } catch (error) {
    if (!cancelled) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      loadError.value = message || (error instanceof Error ? error.message : "历史记录读取失败");
    }
  } finally {
    if (!cancelled) loading.value = false;
  }
}, { immediate: true });

function chooseMedia(item: NodeMediaValue, preview = false) {
  if (props.disabled || loading.value || (!preview && item.url === currentUrl.value)) return;
  previewOnly.value = preview;
  if (selected.value?.url === item.url && previewReady.value && !previewError.value) completeMediaAction();
  else selected.value = item;
}

function openViewer() {
  if (props.disabled || !currentFile.value) return;
  visible.value = false;
  previewOnly.value = true;
  previewReady.value = false;
  previewReadError.value = "";
  selected.value = currentFile.value;
  viewerVisible.value = true;
}

function switchViewer(item: NodeMediaValue) {
  if (loading.value || selected.value?.url === item.url) return;
  saveViewerPlayback();
  previewOnly.value = true;
  previewReady.value = false;
  previewReadError.value = "";
  selected.value = item;
}

function completeMediaAction() {
  if (props.disabled || loading.value || !selected.value || !previewReady.value || previewError.value) return;
  if (previewOnly.value) {
    viewerVisible.value = true;
    visible.value = false;
  } else selectOutput();
}

function readPreview(event: Event) {
  previewReady.value = handleLoaded(event);
  if (props.inline && !viewerVisible.value && previewReady.value) completeMediaAction();
}

watch(mediaSrc, () => {
  imageZoom.value = 1;
  imageViewport.value?.scrollTo(0, 0);
}, { flush: "sync" });

function zoomImage(value: number, event?: WheelEvent) {
  const viewport = imageViewport.value;
  if (!viewport || !previewReady.value) return;
  const zoom = Math.min(5, Math.max(1, value));
  if (zoom === imageZoom.value) return;
  const bounds = viewport.getBoundingClientRect();
  const x = event ? event.clientX - bounds.left : viewport.clientWidth / 2;
  const y = event ? event.clientY - bounds.top : viewport.clientHeight / 2;
  const ratio = zoom / imageZoom.value;
  const left = (viewport.scrollLeft + x) * ratio - x;
  const top = (viewport.scrollTop + y) * ratio - y;
  imageZoom.value = zoom;
  void nextTick(() => {
    if (imageViewport.value === viewport && imageZoom.value === zoom) viewport.scrollTo(left, top);
  });
}

function startImagePan(event: PointerEvent) {
  const viewport = imageViewport.value;
  if (!viewport || imageZoom.value <= 1 || (event.button !== 0 && event.button !== 1)) return;
  event.preventDefault();
  viewport.setPointerCapture(event.pointerId);
  imagePan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
}

function panImage(event: PointerEvent) {
  if (imagePan?.id !== event.pointerId) return;
  imageViewport.value?.scrollTo(imagePan.left + imagePan.x - event.clientX, imagePan.top + imagePan.y - event.clientY);
}

function getVideoPlayback(video: HTMLVideoElement): VideoPlayback {
  return { time: video.currentTime, playing: !video.paused && !video.ended, muted: video.muted, volume: video.volume, rate: video.playbackRate };
}

function restoreVideoPlayback(video: HTMLVideoElement, state: VideoPlayback) {
  video.currentTime = Number.isFinite(video.duration) ? Math.min(state.time, video.duration) : state.time;
  video.muted = state.muted;
  video.volume = state.volume;
  video.playbackRate = state.rate;
  if (state.playing) void video.play().catch(() => {}); // 自动续播被浏览器拦截时，仍保留位置并可手动播放。
}

function readViewerVideo(event: Event) {
  const video = viewerVideo.value;
  if (!viewerVisible.value || !video || video !== event.currentTarget) return;
  previewReady.value = handleLoaded(event);
  if (!previewReady.value || restoredViewerVideo === video || !inlinePlayback || inlinePlayback.url !== selected.value?.url) return;
  restoredViewerVideo = video;
  restoreVideoPlayback(video, inlinePlayback.state);
}

function saveViewerPlayback() {
  const video = viewerVideo.value;
  if (!video) return;
  if (video === restoredViewerVideo && inlinePlayback && inlinePlayback.url === selected.value?.url) {
    inlinePlayback.state = getVideoPlayback(video);
  }
  restoredViewerVideo = undefined;
  video.pause();
}

function previewFailed(event: Event) {
  previewReady.value = false;
  handleError(event);
}

async function selectOutput() {
  if (props.disabled || loading.value || !selected.value || !previewUrl.value || !previewReady.value || previewError.value) return;
  const item = selected.value;
  emit("select", { ...item });
  if (!props.inline) {
    visible.value = false;
    return;
  }
  // 让节点先接手文件 URL，随后才释放历史预览。
  await nextTick();
  if (selected.value !== item) return;
  canvasVisible.value = false;
  selected.value = undefined;
}

defineExpose({ openViewer });
</script>

<style scoped lang="scss">
.historyVideoPreview { display: block; width: 100%; max-height: 75vh; background: #000; }

.historyViewer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  min-height: min(620px, 70vh);

  .historyViewerStage {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 0;
    place-items: center;
    overflow: hidden;
    border-radius: 8px;
    background: #111;

    video { display: block; width: 100%; max-height: min(620px, 70vh); object-fit: contain; }

    .imageViewport {
      width: 100%;
      height: min(620px, 70vh);
      overflow: hidden;
      touch-action: none;

      &.zoomed { cursor: grab; }
      &.zoomed:active { cursor: grabbing; }
      img { display: block; max-width: none; max-height: none; object-fit: contain; user-select: none; }
    }

    .imageZoomControls {
      position: absolute;
      right: 12px;
      bottom: 12px;
    }
  }

  .historyViewerVersions {
    min-width: 0;
    padding: 4px;
    overflow: auto;

    .el-pagination { justify-content: center; margin-top: 8px; }
  }

  .historyViewerHeader {
    display: flex;
    justify-content: space-between;
    margin-bottom: 10px;
    color: var(--el-text-color-primary);
    font-weight: 600;

    span + span { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 400; }
  }

  .historyViewerGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }

  .historyViewerItem {
    position: relative;
    aspect-ratio: 1;
    min-width: 0;
    padding: 0;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-fill-color-light);
    cursor: pointer;

    &:hover, &.current { border-color: var(--el-color-primary); }
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
    .historyViewerThumbnail { width: 100%; height: 100%; border-radius: inherit; }
    .historyViewerBadge { position: absolute; bottom: 4px; left: 4px; padding: 1px 5px; border-radius: 4px; background: rgb(20 22 27 / 84%); color: #fff; font-size: 11px; }
  }
}

@media (max-width: 720px) {
  .historyViewer { grid-template-columns: 1fr; min-height: 0; }
  .historyViewerStage { min-height: 50vh; }
  .historyViewerVersions { max-height: 180px; }
  .historyViewerGrid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

.historyTrigger {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 3px;
  border-radius: 6px;
  --el-button-bg-color: rgb(20 22 27 / 78%);
  --el-button-border-color: rgb(255 255 255 / 20%);
  --el-button-text-color: #fff;
  --el-button-hover-bg-color: rgb(20 22 27 / 94%);
  --el-button-hover-border-color: rgb(255 255 255 / 45%);
  --el-button-hover-text-color: #fff;

  &::before { content: ""; position: absolute; inset: -3px; border-radius: 8px; }
  &.historyToggle:disabled { opacity: 0.5; }
  &.replaceTrigger { right: 34px; }
}

.replaceMenu {
  display: flex;
  flex-direction: column;
  gap: 2px;

  .el-button {
    justify-content: flex-start;
    height: 38px;
    margin: 0;
    padding: 0 10px;
    border-radius: 6px;
  }
}

.canvasImagePicker {
  .canvasImageGrid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    max-height: 400px;
    overflow-y: auto;

    .canvasImageItem {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      min-width: 0;
      padding: 8px;
      border: 1px solid var(--el-border-color-light);
      border-radius: 8px;
      background: var(--el-fill-color-light);
      color: var(--el-text-color-primary);
      font: inherit;
      cursor: pointer;

      &:hover:not(:disabled) { border-color: var(--el-color-primary); }
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
      &:disabled { opacity: 0.5; cursor: default; }
      .canvasThumbnail { width: 100%; height: 96px; }
      .canvasImageName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
      .canvasCurrent { color: var(--el-color-primary); font-size: 11px; }
    }
  }

  .el-pagination { justify-content: center; margin-top: 12px; }
  .pendingPreview { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
}

.historyPanel {
  .historyHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 4px 10px;
    font-weight: 600;

    .historyCount { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 400; }
  }

  .historyEmpty { padding: 16px 4px; color: var(--el-text-color-secondary); text-align: center; }
  .historyGrid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;

    .historyTile {
      position: relative;
      aspect-ratio: 1;
      min-width: 0;
      border: 1px solid var(--el-border-color-lighter);
      border-radius: 8px;
      background: var(--el-fill-color-light);

      &:hover,
      &.current { border-color: var(--el-color-primary); }

      .selectHistory {
        position: absolute;
        inset: 0;
        display: block;
        width: 100%;
        padding: 0;
        border: 0;
        border-radius: 7px;
        background: transparent;
        font: inherit;
        cursor: pointer;

        &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
        &:disabled { cursor: default; opacity: 0.5; }
        .historyThumbnail {
          width: 100%;
          height: 100%;
          border-radius: inherit;
          background: transparent;

          :deep(img),
          :deep(video) { object-fit: contain; }
        }

        .currentBadge {
          position: absolute;
          bottom: 4px;
          left: 4px;
          padding: 1px 5px;
          border-radius: 4px;
          background: rgb(20 22 27 / 84%);
          color: #fff;
          font-size: 11px;
        }
      }

      .expandHistory {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 24px;
        height: 24px;
        margin: 0;
        padding: 0;
        border-radius: 5px;
        background: rgb(20 22 27 / 78%);
        color: #fff;
        opacity: 0;

        &:hover,
        &:focus-visible { background: rgb(20 22 27 / 94%); }
      }

      &:hover .expandHistory,
      &:focus-within .expandHistory { opacity: 1; }
      @media (hover: none) {
        .expandHistory { opacity: 1; }
      }
    }
  }

  .el-pagination { justify-content: center; margin-top: 8px; }
  .pendingPreview { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
}

.mediaHistory {
  min-height: 300px;

  .historyContent {
    display: grid;
    grid-template-columns: minmax(140px, 1fr) minmax(0, 2fr);
    gap: 16px;

    .historyList {
      height: 360px;
      overflow: auto;

      .historyItem {
        display: block;
        width: 100%;
        padding: 10px;
        border: 1px solid transparent;
        border-radius: var(--el-border-radius-base);
        background: transparent;
        color: var(--el-text-color-primary);
        font: inherit;
        text-align: left;
        cursor: pointer;

        &:hover { background: var(--el-fill-color-light); }
        &.selected { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
        &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
        .fileName { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .currentLabel { color: var(--el-color-primary); font-size: 12px; }
      }
    }

    .historyPreview {
      display: grid;
      place-items: center;
      height: 360px;
      min-width: 0;
      background: var(--el-fill-color-light);
      border-radius: var(--el-border-radius-base);

      img, video { width: 100%; max-height: 360px; object-fit: contain; }
    }
  }

  .el-pagination { justify-content: center; margin-top: 16px; }
}
</style>
