<template>
  <vue-draggable
    v-model="items"
    class="referenceList"
    aria-label="输入引用"
    :animation="180"
    direction="horizontal"
    ghostClass="referenceGhost"
    filter=".removeButton"
    :preventOnFilter="false">
    <referenceCard
      v-for="(item, index) in items"
      :key="JSON.stringify([item.source, item.sourceHandle])"
      :item="item"
      :labelTextReference="insertImages && item.dataType === 'STRING'"
      :insertable="insertImages && item.dataType === 'IMAGE' && !!item.value"
      :index="index + 1"
      :class="{ inactiveReference: inactiveMedia && isMedia(item) }"
      :title="inactiveMedia && isMedia(item) ? '文生视频模式：此素材不会上传，连线保留' : undefined"
      tabindex="0"
      :aria-keyshortcuts="insertImages && item.dataType === 'IMAGE' && item.value ? 'Alt+ArrowLeft Alt+ArrowRight Shift+Enter' : 'Alt+ArrowLeft Alt+ArrowRight'"
      @keydown.alt.left.stop.prevent="moveReference(index, index - 1)"
      @keydown.alt.right.stop.prevent="moveReference(index, index + 1)"
      @preview="url => emit('preview', item, url)"
      @insert="emit('insert', item)"
      @remove="emit('remove', item)" />
  </vue-draggable>
</template>

<script setup lang="ts">
import { VueDraggable } from "vue-draggable-plus";
import type { NodeInputValue } from "@toonflow/nodes-scaffold/values";
import referenceCard from "./referenceCard.vue";

defineProps<{ inactiveMedia?: boolean; insertImages?: boolean }>();
const items = defineModel<NodeInputValue[]>({ required: true });
const emit = defineEmits<{ remove: [item: NodeInputValue]; preview: [item: NodeInputValue, url: string]; insert: [item: NodeInputValue] }>();

function isMedia(item: NodeInputValue) {
  return typeof item.dataType === "string" && ["IMAGE", "VIDEO", "AUDIO"].includes(item.dataType);
}

function moveReference(from: number, index: number) {
  const item = items.value[from];
  if (!item || from === index || index < 0 || index >= items.value.length) return;
  const next = [...items.value];
  next.splice(from, 1);
  next.splice(index, 0, item);
  items.value = next;
}
</script>

<style scoped lang="scss">
.referenceList {
  display: flex;
  flex: 1;
  gap: 8px;
  min-width: 0;
  min-height: 48px;
  overflow-x: auto;

  .inactiveReference {
    filter: grayscale(1);
    opacity: 0.4;

    &:focus-visible { opacity: 0.7; }
  }
}
</style>
