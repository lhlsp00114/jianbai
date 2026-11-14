<template>
  <el-image-viewer :urlList="urlList" teleported @close="emit('close')">
    <a
      v-if="downloadUrl"
      class="imageViewerDownload"
      :href="downloadUrl"
      :download="downloadName || 'image.png'"
      title="下载图片"
      aria-label="下载图片">
      <icon-download :size="22" aria-hidden="true" />
    </a>
  </el-image-viewer>
</template>

<script setup lang="ts">
import { ElImageViewer } from "element-plus";
import { IconDownload } from "@tabler/icons-vue";

defineProps<{
  urlList: string[];
  downloadUrl?: string;
  downloadName?: string;
}>();

const emit = defineEmits<{ close: [] }>();
</script>

<style scoped>
.imageViewerDownload {
  position: absolute;
  z-index: 1;
  top: 40px;
  right: 92px;
  display: flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  color: #fff;
  background-color: rgba(24, 27, 33, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 50%;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
  text-decoration: none;
}

.imageViewerDownload:hover {
  background-color: #3b4352;
}
</style>
