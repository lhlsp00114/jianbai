<template>
  <img v-if="url" v-show="thumbnail || layer.visible !== false" class="layerImage" :src="url" :alt="thumbnail ? '' : layer.label" draggable="false"
    @error="showNodeError('无法预览图片', `${layer.label}读取失败`)" />
</template>

<script setup lang="ts">
import { useNodeFiles } from "@toonflow/nodes-scaffold/runtime";
import { showNodeError } from "@toonflow/node-shared/showNodeError";

const props = defineProps<{ layer: { url: string; mimeType: string; label: string; visible?: boolean }; thumbnail?: boolean }>();
const files = useNodeFiles();
const url = files.useFileUrl(() => props.layer, error => {
  if (!props.thumbnail) showNodeError(error, `${props.layer.label}读取失败`);
});
</script>

<style scoped lang="scss">
.layerImage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}
</style>
