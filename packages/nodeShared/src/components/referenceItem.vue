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
      :key="referenceKey(item)"
      :item="item"
      :displayName="displayNames?.get(referenceKey(item))"
      :labelTextReference="insertImages && item.dataType === 'STRING'"
      :insertable="canInsertReference(item, index)"
      :index="index + 1"
      :class="{ inactiveReference: (inactiveMedia && isMedia(item)) || inactiveIndices?.includes(index) }"
      :title="(inactiveMedia && isMedia(item)) || inactiveIndices?.includes(index) ? '当前模式不使用此素材，不会上传，连线保留' : undefined"
      tabindex="0"
      :aria-keyshortcuts="item.dataType === 'IMAGE' && canInsertReference(item, index) ? 'Alt+ArrowLeft Alt+ArrowRight Shift+Enter' : 'Alt+ArrowLeft Alt+ArrowRight'"
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
import { referenceKey } from "../useNodeReferences";
import referenceCard from "./referenceCard.vue";

const props = defineProps<{ inactiveMedia?: boolean; inactiveIndices?: number[]; insertImages?: boolean; insertVideos?: boolean; displayNames?: ReadonlyMap<string, string> }>();
const items = defineModel<NodeInputValue[]>({ required: true });
const emit = defineEmits<{ remove: [item: NodeInputValue]; preview: [item: NodeInputValue, url: string]; insert: [item: NodeInputValue] }>();

function canInsertReference(item: NodeInputValue, index: number) {
  const enabled = item.dataType === "IMAGE" ? props.insertImages : item.dataType === "VIDEO" && props.insertVideos;
  return !!enabled && !!item.value && !props.inactiveMedia && !props.inactiveIndices?.includes(index);
}

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
