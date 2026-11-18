<template>
  <el-segmented :modelValue="activePanel" class="panelSwitcher" :options="options" size="small" aria-label="切换面板" @change="emit('change', $event)">
    <template #default="{ item }">
      <span class="panelOption">
        <component :is="item.icon" :size="15" aria-hidden="true" />
        {{ item.label }}
      </span>
    </template>
  </el-segmented>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { IconBook, IconFileText, IconVector } from "@tabler/icons-vue";

const props = defineProps<{ activePanel: "comic" | "canvas" | "document"; showComic?: boolean }>();
const emit = defineEmits<{ change: [value: string | number | boolean] }>();
const options = computed(() => [
  ...(props.showComic ? [{ label: "漫画", value: "comic", icon: IconBook }] : []),
  { label: "画布", value: "canvas", icon: IconVector },
  { label: "文档", value: "document", icon: IconFileText },
]);
</script>

<style scoped lang="scss">
.panelSwitcher {
  --el-border-radius-base: var(--ui-radius-large);
  --el-segmented-color: var(--el-text-color-secondary);
  --el-segmented-item-selected-color: var(--el-text-color-primary);
  --el-segmented-item-selected-bg-color: color-mix(in srgb, var(--el-text-color-primary) 12%, var(--el-bg-color));
  --el-segmented-item-hover-bg-color: color-mix(in srgb, var(--el-text-color-primary) 6%, transparent);
  min-height: 28px;
  padding: 2px;
  border: 1px solid var(--el-border-color-light);
  font-size: 12px;

  .panelOption {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 2px;
    line-height: 22px;
    font-weight: 500;
  }
}
</style>
