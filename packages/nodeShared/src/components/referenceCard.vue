<template>
  <div ref="card" class="referenceItem" :class="{ labeledReference: (insertable && item.dataType === 'IMAGE') || labelTextReference }" role="group" :title="title" :aria-label="insertable ? `插入提示词：${title}` : title" :aria-busy="preparingPreview" @click="insertable && emit('insert')" @keydown.enter.self.stop.prevent="activate" @keydown.space.self.stop.prevent="activate">
    <el-image
      v-if="item.dataType === 'IMAGE' && mediaSrc && !preparingPreview && !previewError"
      ref="imageRef"
      class="preview"
      :src="mediaSrc"
      :previewSrcList="insertable ? [] : [mediaSrc]"
      previewTeleported
      fit="cover"
      :alt="`预览引用 ${index}`"
      draggable="false"
      @click.stop="insertable && emit('insert')"
      @load="handleLoaded"
      @error="handleError" />
    <video
      v-else-if="item.dataType === 'VIDEO' && mediaSrc && !preparingPreview && !previewError"
      class="preview"
      :src="mediaSrc"
      preload="auto"
      muted
      playsinline
      aria-hidden="true"
      @loadedmetadata="readDuration"
      @loadeddata="readVideoPreview"
      @error="handleError" />
    <component v-else :is="itemIcon" class="typeIcon" :size="21" aria-hidden="true" />
    <el-button
      class="removeButton nodrag nopan"
      :icon="IconX"
      circle
      :aria-label="`删除引用 ${index}`"
      title="删除引用"
      @pointerdown.stop
      @mousedown.stop
      @dblclick.stop
      @click.stop="emit('remove')" />
    <span class="indexBadge" aria-hidden="true">{{ displayName ?? (labelTextReference ? `文本${index}` : insertable && item.dataType === 'IMAGE' ? `图片${index}` : index) }}</span>
    <el-popover
      v-if="hoverPreviewSrc"
      ref="previewPopover"
      :virtualRef="card"
      virtualTriggering
      trigger="hover"
      :triggerKeys="[]"
      :placement="previewPlacement"
      :popperOptions="previewPopperOptions"
      :offset="8"
      width="max-content"
      :showAfter="250"
      :hideAfter="220"
      :showArrow="false"
      :persistent="false"
      :popperStyle="{ padding: '0', overflow: 'hidden', borderRadius: '10px', minWidth: '0', maxWidth: 'calc(100vw - 24px)' }"
      @before-enter="followPreviewAnchor"
      @before-leave="stopFollowingPreviewAnchor">
      <template #default="{ hide }">
        <button v-if="item.dataType === 'IMAGE'" type="button" class="referencePreview" @click.stop="viewerVisible = true; hide()">
          <img :src="hoverPreviewSrc" :style="{ maxHeight: `${previewImageHeight}px` }" alt="" draggable="false" @load="updatePreviewPosition" />
          <span>查看原图</span>
        </button>
        <div v-else class="referencePreview">
          <img :src="hoverPreviewSrc" :style="{ maxHeight: `${previewImageHeight}px` }" alt="视频封面" draggable="false" @load="updatePreviewPosition" />
        </div>
      </template>
    </el-popover>
    <imageViewer v-if="viewerVisible && mediaSrc" :urlList="[mediaSrc]" @close="viewerVisible = false" />
    <div v-if="item.dataType === 'VIDEO' && mediaSrc && !preparingPreview && !previewError" class="videoInfo" aria-hidden="true">
      <icon-player-play :size="12" />
      <span v-if="duration">{{ duration }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElButton, ElImage, ElPopover } from "element-plus";
import { IconX, IconFileText, IconPhoto, IconVideo, IconMusic, IconPlayerPlay } from "@tabler/icons-vue";
import textNodeIcon from "./textNodeIcon.vue";
import { useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import type { NodeData } from "@toonflow/nodes-scaffold/connection";
import type { NodeInputValue } from "@toonflow/nodes-scaffold/values";
import { useMediaPreview } from "../mediaPreview";
import imageViewer from "./imageViewer.vue";

const props = defineProps<{ item: NodeInputValue; index: number; insertable?: boolean; labelTextReference?: boolean; displayName?: string }>();
const emit = defineEmits<{ remove: []; preview: [url: string]; insert: [] }>();
const { findNode } = useVueFlow();
const card = ref<HTMLElement>();
const previewPopover = ref<InstanceType<typeof ElPopover>>();
const previewPlacement = ref<"top" | "bottom">("top");
const previewImageHeight = ref(300);
const previewPopperOptions = { strategy: "fixed" as const, modifiers: [{ name: "flip", enabled: false }] };
let previewFrame = 0;
const viewerVisible = ref(false);
const imageRef = ref<InstanceType<typeof ElImage>>();
const previewReadError = ref("");
const duration = ref("");
const videoThumbnail = ref("");
const media = computed(() => props.item.value !== undefined && (props.item.dataType === "IMAGE" || props.item.dataType === "VIDEO") ? { ...props.item.value } : undefined);
const itemIcon = computed(() => props.item.dataType === "IMAGE" ? IconPhoto : props.item.dataType === "VIDEO" ? IconVideo : props.item.dataType === "AUDIO" ? IconMusic : props.item.dataType === "STRING" ? textNodeIcon : IconFileText);
const title = computed(() => {
  const sourceName = props.item.dataType === "IMAGE" || props.item.dataType === "VIDEO" || props.item.dataType === "AUDIO"
    ? findNode<NodeData>(props.item.source)?.data.label?.trim() : "";
  const content = props.item.value === undefined ? "暂无内容" : props.item.dataType === "STRING" ? props.item.value : props.item.dataType === "FILE" ? props.item.value.url.split(/[\\/]/).pop() || "文件" : props.item.dataType === "VIDEO" ? "视频" : props.item.dataType === "AUDIO" ? "音频" : "图片";
  const status = previewError.value || (preparingPreview.value ? "正在生成兼容预览…" : "");
  return `${props.displayName ?? `引用 ${props.index}`}：${sourceName ? `${sourceName}（${content}）` : content}${status ? `（${status}）` : ""}`;
});

watch(media, () => {
  previewReadError.value = "";
  duration.value = "";
  videoThumbnail.value = "";
});
const { useFileUrl } = useNodeFiles();
const previewUrl = useFileUrl(media, error => {
  previewReadError.value = error instanceof Error ? error.message : "读取引用文件失败";
});
const { src: mediaSrc, preparing: preparingPreview, error: mediaError, handleError, handleLoaded } = useMediaPreview(previewUrl, () => props.item.dataType === "VIDEO" ? "video" : "image");
const previewError = computed(() => previewReadError.value || mediaError.value);
const hoverPreviewSrc = computed(() => {
  if (!props.insertable || preparingPreview.value || previewError.value) return "";
  return props.item.dataType === "VIDEO" ? videoThumbnail.value : mediaSrc.value;
});
watch(mediaSrc, () => {
  duration.value = "";
  videoThumbnail.value = "";
  viewerVisible.value = false;
}, { flush: "sync" });

watch([mediaSrc, previewError, preparingPreview, videoThumbnail], ([url, error, preparing, thumbnail]) => {
  emit("preview", error || preparing ? "" : props.item.dataType === "VIDEO" ? thumbnail : url);
}, { immediate: true });
watch(hoverPreviewSrc, available => {
  if (!available) stopFollowingPreviewAnchor();
});
onBeforeUnmount(() => {
  stopFollowingPreviewAnchor();
  emit("preview", "");
});

function updatePreviewPosition() {
  void previewPopover.value?.popperRef?.popperInstanceRef?.update();
}

function followPreviewAnchor() {
  stopFollowingPreviewAnchor();
  let lastRect: DOMRect | undefined;
  function follow() {
    if (!card.value) return;
    const rect = card.value.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    // 给“查看原图”和弹层间距预留空间，离视口顶边太近时挂到下方。
    const placement = spaceAbove >= 116 || spaceAbove >= spaceBelow ? "top" : "bottom";
    const imageHeight = Math.max(1, Math.min(300, Math.floor((placement === "top" ? spaceAbove : spaceBelow) - 50)));
    if (!lastRect || rect.x !== lastRect.x || rect.y !== lastRect.y || rect.width !== lastRect.width || rect.height !== lastRect.height
      || placement !== previewPlacement.value || imageHeight !== previewImageHeight.value) {
      lastRect = rect;
      previewPlacement.value = placement;
      previewImageHeight.value = imageHeight;
      void nextTick(updatePreviewPosition);
    }
    // 画布平移和缩放只改 transform，弹层打开期间跟踪缩略图的实际位置。
    previewFrame = requestAnimationFrame(follow);
  }
  follow();
}

function stopFollowingPreviewAnchor() {
  cancelAnimationFrame(previewFrame);
  previewFrame = 0;
}

function activate(event: KeyboardEvent) {
  if (props.insertable && props.item.dataType === "IMAGE" && event.key === "Enter" && event.shiftKey) {
    viewerVisible.value = !!hoverPreviewSrc.value;
    return;
  }
  if (props.insertable) emit("insert");
  else imageRef.value?.showPreview();
}

function readVideoPreview(event: Event) {
  const video = event.currentTarget as HTMLVideoElement;
  if (!handleLoaded(event) || !video.videoWidth || !video.videoHeight) { videoThumbnail.value = ""; return; }
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 230 / video.videoWidth, 300 / video.videoHeight);
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  videoThumbnail.value = canvas.toDataURL("image/webp");
}

function readDuration(event: Event) {
  const seconds = (event.currentTarget as HTMLVideoElement).duration;
  if (!Number.isFinite(seconds) || seconds < 0) return;
  const totalSeconds = Math.floor(seconds);
  duration.value = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
</script>

<style scoped>
.referenceItem {
  position: relative;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 48px;
  height: 48px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base, 8px);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  cursor: grab;
  user-select: none;

  &:active {
    cursor: grabbing;
  }

  &.referenceGhost {
    opacity: 0.35;
  }

  &:focus-visible {
    outline: 2px solid var(--el-color-primary);
    outline-offset: -2px;
  }

  .preview {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .removeButton {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 18px;
    height: 18px;
    padding: 0;
    margin: 0;
  }

  .indexBadge {
    position: absolute;
    top: 2px;
    left: 2px;
    min-width: 13px;
    padding: 0 2px;
    border-radius: 3px;
    background: var(--el-bg-color-overlay);
    color: var(--el-text-color-primary);
    font-size: 9px;
    line-height: 13px;
    text-align: center;
  }

  &.labeledReference {
    .typeIcon {
      margin-bottom: 14px;
    }

    .removeButton {
      --el-button-bg-color: rgb(0 0 0 / 48%);
      --el-button-border-color: transparent;
      --el-button-text-color: #fff;
      --el-button-hover-bg-color: rgb(0 0 0 / 68%);
      --el-button-hover-border-color: transparent;
      --el-button-hover-text-color: #fff;
      --el-button-active-bg-color: rgb(0 0 0 / 76%);
      --el-button-active-border-color: transparent;
      --el-button-active-text-color: #fff;
      width: 14px;
      height: 14px;
      font-size: 10px;
      opacity: 0;
      pointer-events: none;
    }

    &:hover .removeButton,
    &:focus-visible .removeButton,
    .removeButton:focus-visible {
      opacity: 1;
      pointer-events: auto;
    }

    .indexBadge {
      inset: auto 0 0;
      border-radius: 0;
      background: rgba(0, 0, 0, 0.88);
      color: #fff;
      font-size: 10px;
      line-height: 14px;
      pointer-events: none;
    }
  }

  .videoInfo {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 2px;
    padding: 2px 3px;
    background: color-mix(in srgb, var(--el-bg-color-overlay) 85%, transparent);
    color: var(--el-text-color-primary);
    font-size: 9px;
    line-height: 12px;
  }
}
.referencePreview {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: #1e1e20;
  color: #fff;
  font: inherit;

  &:is(button) { cursor: zoom-in; }

  img {
    display: block;
    width: auto;
    height: auto;
    max-width: min(230px, calc(100vw - 26px));
    margin-inline: auto;
  }

  span {
    display: block;
    padding: 6px 8px;
    line-height: 20px;
    white-space: nowrap;
    text-align: center;
  }

  &:hover span {
    background: #333;
  }

  &:focus-visible {
    outline: 2px solid var(--el-color-primary);
    outline-offset: -2px;
  }
}
</style>
