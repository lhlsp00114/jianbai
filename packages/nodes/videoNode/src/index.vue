<template>
  <nodeSkeleton
    ref="skeleton"
    v-bind="nodeProps"
    :topVisible="node.selected"
    contentPadding="2px"
    :resizeAspectRatio="previewUrl && videoPreviewSize ? videoPreviewSize.width / videoPreviewSize.height : undefined"
    selectionFrame
    topWidth="max-content"
    fullscreenLabel="全屏播放"
    :downloadUrl="exporting ? '' : previewUrl"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    :style="previewUrl && videoPreviewSize ? { width: `${videoPreviewSize.width + 6}px`, '--videoPreviewHeight': `${videoPreviewSize.height}px` } : { width: !outputFile && !exporting ? `${emptyMediaCardWidth}px` : undefined }"
    @fullscreen="player?.enterFullscreen()">
    <template v-if="videoResolution" #titleMeta><span :title="`${videoResolution} 像素`" :aria-label="`视频分辨率：${videoResolution}`">{{ videoResolution }}</span></template>
    <template #contextActions><eagleMenuItem :file="outputFile" /></template>
    <template #topActions>
      <el-button :icon="IconMusic" text :disabled="!outputFile || uploading || exporting || actions?.processing" @click.stop="actions?.open('extractAudio')">提取音轨</el-button>
      <el-button :icon="IconLayersSubtract" text :disabled="!outputFile || uploading || exporting || actions?.processing" @click.stop="actions?.open('separate')">分离音视频</el-button>
      <el-button :icon="IconScissors" text :disabled="!outputFile || uploading || exporting || actions?.processing" @click.stop="actions?.open('trim')">截取片段</el-button>
      <el-button :icon="IconMovie" text :loading="actions?.creatingAnalysis" :disabled="!outputFile || uploading || exporting || actions?.processing || actions?.creatingAnalysis" @click.stop="actions?.createFrameAnalysis()">逐帧拉片</el-button>
    </template>
    <template #topRightActions>
      <el-dropdown trigger="click" placement="bottom-end" :disabled="!player?.ready || player?.capturing || uploading || exporting" @command="player?.captureFrame($event)">
        <el-button :icon="IconPhotoScan" :loading="player?.capturing" :disabled="!player?.ready || player?.capturing || uploading || exporting" text title="截取视频帧" aria-label="截取视频帧" />
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="current" :icon="IconPhotoScan">截取当前帧</el-dropdown-item>
            <el-dropdown-item command="first" :icon="IconPlayerSkipBack">截取首帧</el-dropdown-item>
            <el-dropdown-item command="last" :icon="IconPlayerSkipForward">截取尾帧</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>
    <div class="videoContent nopan" :class="{ empty: !outputFile && !exporting }">
      <div v-if="exporting" class="exportLoading" role="status" aria-label="视频导出中">
        <el-progress type="circle" :percentage="exportProgress" :width="64" :strokeWidth="3" />
        <span>正在导出视频</span>
      </div>
      <videoPlayer
        v-else-if="previewUrl"
        ref="player"
        :src="previewUrl"
        @loadedmetadata="resizeVideo" />
      <input ref="fileInput" class="fileInput" type="file" accept="video/*" aria-label="选择视频" :disabled="uploading || exporting" @change="uploadVideo" />
      <div v-if="!exporting && !outputs.video" class="emptyActions">
        <el-button
          class="nodrag nopan"
          :icon="IconUpload"
          text
          :loading="uploading"
          title="上传视频"
          aria-label="上传视频"
          @dblclick.stop
          @click.stop="fileInput?.click()">上传</el-button>
        <el-button
          v-if="files.pickAsset"
          class="nodrag nopan"
          :icon="IconFolder"
          text
          :disabled="uploading"
          title="从素材库选择视频"
          aria-label="从素材库选择视频"
          @dblclick.stop
          @click.stop="selectAsset">从素材库选择</el-button>
      </div>
      <mediaHistory
        v-if="node.selected"
        mediaType="video"
        inline
        replaceable
        :current="outputFile"
        :disabled="uploading || exporting || player?.capturing || actions?.processing"
        @open="skeleton?.focusNode()"
        @select="outputs.video = { dataType: 'VIDEO', value: $event }"
        @upload="fileInput?.click()" />
    </div>
  </nodeSkeleton>
  <videoActions ref="actions" :file="outputFile" :src="previewUrl" :disabled="uploading || exporting" />
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { IconUpload, IconFolder, IconMusic, IconLayersSubtract, IconScissors, IconMovie, IconPhotoScan, IconPlayerSkipBack, IconPlayerSkipForward } from "@tabler/icons-vue";
import videoIcon from "@toonflow/node-shared/videoIcon";
import { ElButton, ElMessage, ElProgress, ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus";
import { nodeSkeleton, nodeTools, useNode, z, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import videoPlayer from "./components/videoPlayer.vue";
import videoActions from "./components/videoActions.vue";
import { getMediaMimeType } from "@toonflow/node-shared/mediaTypes";
import { emptyMediaCardWidth, getMediaPreviewSize } from "@toonflow/node-shared/mediaPreviewSize";
import mediaHistory from "@toonflow/node-shared/mediaHistory";
import eagleMenuItem from "@toonflow/node-shared/eagleMenuItem";

defineOptions({
  inheritAttrs: false,
  icon: videoIcon,
  handles: [{ id: "video", type: "source", dataType: "VIDEO", label: "视频输出" }] satisfies NodeHandle[],
});
const { node, nodeProps, outputs, nodeEvent, files, updateNodeInternals } = useNode({
  label: "视频",
});
const fileInput = ref<HTMLInputElement>();
const uploading = ref(false);
const skeleton = ref<InstanceType<typeof nodeSkeleton>>();
const player = ref<InstanceType<typeof videoPlayer>>();
const actions = ref<InstanceType<typeof videoActions>>();
const exportProgress = computed(() => (node.data as typeof node.data & { exportProgress?: number }).exportProgress);
const exporting = computed(() => typeof exportProgress.value === "number");
const videoPreviewSize = ref<ReturnType<typeof getMediaPreviewSize>>();
const videoResolution = ref("");

const outputFile = computed(() => outputs.value.video?.dataType === "VIDEO" ? outputs.value.video.value : undefined);
watch(outputFile, () => {
  videoPreviewSize.value = undefined;
  videoResolution.value = "";
  const style = typeof node.style === "function" ? node.style(node) : node.style;
  if (style?.width === undefined && style?.height === undefined) return;
  const { width, height, ...rest } = style;
  node.style = rest;
}, { flush: "sync" });
const previewUrl = files.useFileUrl(
  outputFile,
  (error) => showError(error, "视频读取失败")
);

nodeEvent.on("save", (reason) => {
  if (uploading.value) throw new Error("视频处理中，请完成后再切换或刷新节点");
  if (reason === "reload" && exporting.value) throw new Error("视频正在导出，请完成后再刷新节点");
});
nodeEvent.on("delete", () => {
  if (uploading.value) throw new Error("视频上传中，请稍后删除节点");
  uploading.value = true;
  return files.removeNodeFiles().finally(() => {
    uploading.value = false;
  });
});

nodeTools.register({
  name: "setVideo",
  description: "选择工作区内已有的视频文件作为此节点的输出，path 使用工作区相对路径",
  parameters: z.strictObject({
    path: z.string().min(1).max(4096),
    mimeType: z.string().regex(/^video\/[a-zA-Z0-9.+-]+$/),
  }),
  async execute({ path, mimeType }, { signal }) {
    signal?.throwIfAborted();
    if (uploading.value || exporting.value) throw new Error("视频处理中，请稍后重试");
    uploading.value = true;
    try {
      const content = await files.getWorkspaceFiles().read(path);
      signal?.throwIfAborted();
      if (!content.byteLength || content.byteLength > 100 * 1024 * 1024) throw new Error("视频不能为空且不能超过 100 MB");
      outputs.value.video = { dataType: "VIDEO", value: { url: path, mimeType } };
      return outputs.value.video;
    } finally {
      uploading.value = false;
    }
  },
});

async function resizeVideo(event: Event) {
  const video = event.currentTarget as HTMLVideoElement;
  if (!video.videoWidth || !video.videoHeight) return;
  videoResolution.value = `${video.videoWidth} × ${video.videoHeight}`;
  videoPreviewSize.value = getMediaPreviewSize(video.videoWidth, video.videoHeight);
  await nextTick();
  updateNodeInternals();
}

function uploadVideo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) void setVideoFile(file);
}

async function selectAsset() {
  const file = await files.pickAsset?.("video");
  if (file) await setVideoFile(file);
}

async function setVideoFile(file: File) {
  if (uploading.value || exporting.value) return;
  const mimeType = getMediaMimeType(file);
  if (!mimeType.startsWith("video/")) return void ElMessage.error("请选择视频文件");
  if (!file.size || file.size > 100 * 1024 * 1024) return void ElMessage.error("视频不能为空且不能超过 100 MB");
  uploading.value = true;
  try {
    const url = await files.uploadFile(file);
    // ACT: 复制节点可能仍引用旧视频，替换输出不删除共享文件。
    outputs.value.video = { dataType: "VIDEO", value: { url, mimeType } };
  } catch (error) {
    showError(error, "视频替换失败");
  } finally {
    uploading.value = false;
  }
}

function showError(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  ElMessage.error(message || (error instanceof Error ? error.message : fallback));
}
</script>

<style scoped lang="scss">
.videoContent {
  .nodeSkeleton.resized & {
    height: 100%;
    min-height: 0;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    --nodeMediaHeight: 100%;

    .exportLoading { max-height: 100%; box-sizing: border-box; overflow: auto; }
  }

  .nodeSkeleton:not(.resized) &.empty { min-height: 234px; }

  position: relative;
  display: grid;
  place-items: center;
  min-height: 144px;
  overflow: hidden;
  border-radius: var(--el-border-radius-base);

  .exportLoading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 20px;
    color: var(--el-text-color-secondary);
  }

  .fileInput {
    display: none;
  }

  .emptyActions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;

    .el-button { margin: 0; }
  }
}
</style>
