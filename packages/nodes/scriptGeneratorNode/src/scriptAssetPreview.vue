<template>
  <div class="assetArtwork">
    <img v-if="previewUrl" :src="previewUrl" :alt="asset.name || '资产图片'" />
    <span v-else>{{ statusText }}</span>
    <div v-if="generating" class="generationOverlay" role="status" aria-live="polite">
      <span class="generationSpinner" aria-hidden="true" />
      <strong>正在生成</strong>
    </div>
    <el-button v-if="previewUrl" class="previewButton" :icon="IconMaximize" text title="预览图片" aria-label="预览图片" @click.stop="viewerVisible = true" />
    <el-image-viewer v-if="viewerVisible && previewUrl" :urlList="[previewUrl]" teleported @close="viewerVisible = false" />
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElButton, ElImageViewer } from "element-plus";
import { IconMaximize } from "@tabler/icons-vue";
import { useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import { assetImage, type ScriptAsset } from "./scriptData";

const props = defineProps<{ asset: ScriptAsset }>();
const { findNode } = useVueFlow();
const files = useNodeFiles();
const viewerVisible = ref(false);
const generationNode = computed(() => props.asset.imageNodeId ? findNode(props.asset.imageNodeId) : undefined);
const generating = computed(() => ["submitting", "running"].includes(generationNode.value?.data.mediaTask?.state));
const statusText = computed(() => {
  const state = generationNode.value?.data.mediaTask?.state;
  if (state === "failed") return "生成失败，可重新生成";
  if (state === "cancelled") return "生成已取消";
  if (state === "interrupted") return "生成中断，请到关联节点复查";
  if (state === "succeeded") return "结果待恢复，请到关联节点查看";
  if (props.asset.imageNodeId && !generationNode.value) return "关联节点已不存在，请重新选择图片";
  return props.asset.imageNodeId ? "等待生成图片" : "尚未添加素材图片";
});
const media = computed(() => assetImage(props.asset, (id, handle) => findNode(id)?.data.outputs?.[handle])?.output.value);
const previewUrl = files.useFileUrl(media, () => undefined);
</script>
<style scoped lang="scss">
.assetArtwork {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 154px;
  overflow: hidden;
  border-radius: 5px 5px 0 0;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
  font-size: 11px;

  img { width: 100%; height: 154px; object-fit: cover; }

  .generationOverlay {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: #fff;
    background: rgb(12 12 14 / 76%);
    font-size: 14px;

    .generationSpinner {
      width: 28px;
      height: 28px;
      border: 3px solid rgb(255 255 255 / 30%);
      border-top-color: var(--el-color-primary-light-3);
      border-radius: 50%;
      animation: generationSpin 0.8s linear infinite;
    }

    strong { font-weight: 600; }
  }

  .previewButton {
    position: absolute;
    right: 8px;
    bottom: 8px;
    color: #fff;
    background: #0009;
  }
}

@keyframes generationSpin { to { transform: rotate(360deg); } }
</style>
