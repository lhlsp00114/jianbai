<template>
  <div class="stackNode" :class="{ selected }" @click="selectStack">
    <span v-if="members.length > 2" class="backCard farCard" aria-hidden="true"><stackImage :media="images[(activeIndex + 2) % images.length]?.media" :video="images[(activeIndex + 2) % images.length]?.video" /></span>
    <span v-if="members.length > 1" class="backCard nearCard" aria-hidden="true"><stackImage :media="images[(activeIndex + 1) % images.length]?.media" :video="images[(activeIndex + 1) % images.length]?.video" /></span>
    <button class="frontCard" type="button" :aria-label="`查看堆叠素材，共 ${members.length} 个`" @click="openGallery">
      <stackImage :media="images[activeIndex]?.media" :video="images[activeIndex]?.video" @loaded="resizeCard" @zoom="zoomUrl = $event" />
      <span class="imageCount">{{ activeIndex + 1 }} / {{ members.length }}</span>
    </button>
  </div>
  <el-dialog v-model="galleryVisible" class="stackGallery" fullscreen appendToBody :closeOnPressEscape="!zoomUrl" @click="closeGalleryOnBlank" @closed="zoomUrl = ''">
    <div v-if="galleryVisible" class="stackGalleryItems">
      <div v-for="(image, index) in images" :key="image.id" class="stackGalleryItem" :class="{ videoItem: image.video }" role="button" tabindex="0" :aria-label="`查看素材：${image.label}`" :aria-pressed="index === activeIndex" @click="chooseImage(index)" @keydown.enter.self.prevent="chooseImage(index)" @keydown.space.self.prevent="chooseImage(index)">
        <span class="imageLabel">{{ image.label }}</span>
        <stackImage :media="image.media" :label="image.label" :video="image.video" playable @zoom="zoomUrl = $event" />
      </div>
    </div>
  </el-dialog>
  <imageViewer v-if="zoomUrl" :urlList="[zoomUrl]" @close="zoomUrl = ''" />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useVueFlow, type NodeProps } from "@vue-flow/core";
import { ElDialog } from "element-plus";
import imageViewer from "@toonflow/node-shared/imageViewer";
import stackImage from "./stackImage.vue";
import { getStackMedia, getStackMembers } from "../nodeStacks";

const props = defineProps<NodeProps>();
const flow = useVueFlow();
const members = computed(() => getStackMembers(props).filter(member => flow.findNode(member.id)?.parentNode === props.id));
const activeIndex = computed(() => Math.max(0, Math.min(Number.isSafeInteger(props.data.stackIndex) ? props.data.stackIndex : 0, members.value.length - 1)));
const galleryVisible = ref(false);
const zoomUrl = ref("");
const images = computed(() => members.value.map(member => {
  const node = flow.findNode(member.id);
  return { id: member.id, label: String(node?.data.label || ""), media: getStackMedia(node)?.output.value, video: getStackMedia(node)?.output.dataType === "VIDEO" };
}));

function selectStack(event: MouseEvent) {
  if (flow.multiSelectionActive.value) return;
  event.stopPropagation();
  flow.removeSelectedElements();
  flow.nodesSelectionActive.value = false;
  const node = flow.findNode(props.id);
  if (node) flow.addSelectedNodes([node]);
}

function openGallery(event: MouseEvent) {
  if (flow.multiSelectionActive.value) return;
  selectStack(event);
  galleryVisible.value = true;
}

function chooseImage(index: number) {
  flow.updateNodeData(props.id, { stackIndex: index });
}

function closeGalleryOnBlank(event: MouseEvent) {
  if (!zoomUrl.value && event.target instanceof Element && !event.target.closest(".stackGalleryItem")) galleryVisible.value = false;
}

function resizeCard(size: { width: number; height: number }) {
  const node = flow.findNode(props.id);
  if (!node) return;
  const width = node.dimensions.width;
  if (!Number.isFinite(width) || width <= 0) return;
  const height = Math.round(width * size.height / size.width);
  if (Math.abs(node.dimensions.height - height) < 1) return;
  const style = typeof node.style === "function" ? node.style(node) : node.style;
  flow.updateNode(props.id, { style: { ...style, height: `${height}px` } });
}
</script>

<style lang="scss">
.stackNode {
  position: relative;
  width: 100%;
  height: 100%;
  cursor: grab;

  .backCard, .frontCard {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    background: var(--el-fill-color);
    box-shadow: 0 3px 12px rgb(0 0 0 / 18%);
  }
  .backCard { overflow: hidden; }
  .farCard { transform: translate(7px, -5px) rotate(4deg); }
  .nearCard { transform: translate(-5px, -2px) rotate(-3deg); }
  .backCard img, .backCard video { display: block; width: 100%; height: 100%; object-fit: cover; }
  .frontCard {
    padding: 0;
    overflow: hidden;
    cursor: grab;
    &:active { cursor: grabbing; }

    img, video { display: block; width: 100%; height: 100%; object-fit: contain; }
    .imageCount {
      position: absolute;
      right: 8px;
      bottom: 8px;
      padding: 3px 7px;
      border-radius: 8px;
      background: rgb(0 0 0 / 55%);
      color: white;
      font-size: 12px;
    }
    &:focus-visible { outline: 2px solid var(--canvasSelectionColor, #fff); outline-offset: -2px; }
  }
  &.selected .frontCard { border-color: var(--canvasSelectionColor, #fff); }
}

.stackGallery {
  --el-dialog-bg-color: #000;
  padding: 0;
  background: #000;

  .el-dialog__header { padding: 0; }
  .el-dialog__headerbtn { z-index: 1; }
  .el-dialog__body {
    display: grid;
    place-items: center;
    min-height: 100dvh;
    padding: 0;
    background: #000;
  }
  .stackGalleryItems {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 24px;
    box-sizing: border-box;
    max-width: 100%;
    padding: 64px 32px;

    .stackGalleryItem {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      max-width: 180px;
      padding: 0;
      border: 0;
      background: transparent;
      color: #aaa;
      text-align: left;
      cursor: pointer;

      .imageLabel { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
      &.videoItem { max-width: min(360px, 65vw); }
      .videoPlayer {
        --nodeMediaHeight: auto;
        width: auto;
        height: auto;
        max-width: 100%;
        background: transparent;
        container-type: normal;

        .videoPreview:not(:fullscreen) {
          width: auto;
          height: auto;
          max-width: min(360px, 65vw);
          max-height: min(260px, 65vh);
          border-radius: 8px;
        }
      }
      img { display: block; width: auto; height: auto; max-width: min(180px, 65vw); max-height: 260px; border-radius: 8px; }
      &:focus-visible { outline: 2px solid var(--canvasSelectionColor, #fff); outline-offset: 5px; border-radius: 8px; }
    }
  }
}
</style>
