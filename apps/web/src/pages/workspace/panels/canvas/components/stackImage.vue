<template>
  <videoPlayer v-if="mediaSrc && isVideo && playable" :src="mediaSrc" :label="label" readOnly @loadedmetadata="loaded" />
  <video v-else-if="mediaSrc && !previewError && isVideo" :src="mediaSrc" muted playsinline preload="metadata" draggable="false" @loadedmetadata="loaded" @error="handleError" />
  <img v-else-if="mediaSrc && !previewError" :src="mediaSrc" :alt="label || ''" draggable="false" @load="loaded" @error="handleError" @dblclick.stop="emit('zoom', mediaSrc)" />
</template>

<script setup lang="ts">
import { useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import type { NodeMediaValue } from "@toonflow/nodes-scaffold/values";
import { useMediaPreview } from "@toonflow/node-shared/mediaPreview";
import { ElMessage } from "element-plus";
import { computed } from "vue";
import videoPlayer from "@toonflow/node-video/videoPlayer";

const props = defineProps<{ media?: NodeMediaValue; label?: string; video?: boolean; playable?: boolean }>();
const isVideo = computed(() => props.video === true);
const emit = defineEmits<{ loaded: [size: { width: number; height: number }]; zoom: [url: string] }>();
const { useFileUrl } = useNodeFiles();
const fileUrl = useFileUrl(() => props.media, error => ElMessage.error(error instanceof Error ? error.message : "读取堆叠图片失败"));
const { src: mediaSrc, error: previewError, handleLoaded, handleError } = useMediaPreview(fileUrl, () => isVideo.value ? "video" : "image");

function loaded(event: Event) {
  handleLoaded(event);
  const media = event.target as HTMLImageElement | HTMLVideoElement;
  const width = "videoWidth" in media ? media.videoWidth : media.naturalWidth;
  const height = "videoHeight" in media ? media.videoHeight : media.naturalHeight;
  if (width && height) emit("loaded", { width, height });
}
</script>
