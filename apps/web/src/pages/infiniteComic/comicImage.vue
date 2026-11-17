<template>
  <el-image v-if="url" class="comicImage" :src="url" :alt="reference.label" fit="contain" :previewSrcList="[url]" previewTeleported />
  <span v-else class="imageStatus">{{ error || '加载图片…' }}</span>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import type { ComicReference } from "./comicProject";
const props = defineProps<{ directory: string; reference: ComicReference }>();
const url = ref("");
const error = ref("");
watch(() => [props.directory, props.reference.path, props.reference.mimeType], async (_, __, onCleanup) => {
  url.value = ""; error.value = "";
  let active = true;
  const preview = useWorkspaceFiles(props.directory).acquireUrl(props.reference.path, props.reference.mimeType);
  onCleanup(() => { active = false; preview.release(); });
  try { const value = await preview.url; if (active) url.value = value; }
  catch { if (active) error.value = "图片无法读取"; }
}, { immediate: true });
</script>

<style scoped lang="scss">
.comicImage { width: 100%; height: 100%; min-height: 0; }
.imageStatus { color: var(--el-text-color-secondary); font-size: 12px; }
</style>
