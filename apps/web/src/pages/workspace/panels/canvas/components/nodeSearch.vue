<template>
  <el-card v-if="visible" class="nodeListPanel" shadow="never" role="dialog" aria-label="节点列表" @dblclick.stop>
    <div class="nodeSearch">
      <div class="nodeToolbar">
        <el-input ref="searchInput" v-model="query" class="searchInput" :prefixIcon="IconSearch" placeholder="搜索节点名称或类型" aria-label="搜索节点名称或类型" aria-controls="canvasSearchResults" :aria-activedescendant="results[activeIndex] ? `canvasSearchResult-${activeIndex}` : undefined" clearable @keydown="navigateResults" />
        <el-button class="toolbarButton" text :icon="IconX" aria-label="关闭节点列表" title="关闭节点列表" @click="visible = false" />
      </div>
      <div id="canvasSearchResults" ref="resultList" class="resultList" role="listbox" aria-label="画布节点">
        <button
          v-for="(item, index) in results"
          :id="`canvasSearchResult-${index}`"
          :key="item.node.id"
          class="nodeResult"
          type="button"
          role="option"
          tabindex="-1"
          :aria-selected="activeIndex === index"
          @mouseenter="activeIndex = index"
          @click="selectNode(index)">
          <mentionThumbnail v-if="item.thumbnail" class="nodeThumbnail" :thumbnail="item.thumbnail" :directory="props.directory"><icon-photo :size="18" aria-hidden="true" /></mentionThumbnail>
          <span v-else class="nodeThumbnail"><icon-photo :size="18" aria-hidden="true" /></span>
          <span class="nodeLabel">{{ item.label }}</span>
          <span class="nodeType">{{ item.node.type === 'canvasGroup' ? '分组' : item.node.type?.replace(/^remote-/, '') }}</span>
        </button>
        <p v-if="!results.length" class="empty">没有匹配的节点</p>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { translate } from "@toonflow/i18n/vue";
import { useVueFlow } from "@vue-flow/core";
import { IconPhoto, IconSearch, IconX } from "@tabler/icons-vue";
import type { NodeOutput } from "@toonflow/nodes-scaffold/values";
import type { InputInstance } from "element-plus";

const props = defineProps<{ directory?: string; disabled?: boolean }>();
const flow = useVueFlow();
const visible = defineModel<boolean>({ default: false });
const query = ref("");
const activeIndex = ref(0);
const searchInput = ref<InputInstance>();
const resultList = ref<HTMLElement>();
const results = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase();
  return flow.getNodes.value.filter(node => !node.hidden).map(node => ({
    node, label: String(node.data.label || node.type || translate("未命名节点")), thumbnail: nodeThumbnail(node.data.outputs),
  })).filter(item => `${item.label} ${item.node.type} ${item.node.id}`.toLocaleLowerCase().includes(keyword));
});
function nodeThumbnail(outputs: Record<string, NodeOutput | undefined> | undefined) {
  const output = Object.values(outputs ?? {}).find(item => item?.dataType === "IMAGE" || item?.dataType === "MASK");
  return output && (output.dataType === "IMAGE" || output.dataType === "MASK") ? { url: output.value.url, mimeType: output.value.mimeType } : undefined;
}
watch(query, () => { activeIndex.value = 0; });
watch(visible, open => {
  if (open) void nextTick(() => searchInput.value?.focus());
});
watch(activeIndex, async index => {
  await nextTick();
  resultList.value?.children[index]?.scrollIntoView({ block: "nearest" });
});
watch(() => props.disabled, disabled => { if (disabled) visible.value = false; });

function open() {
  if (props.disabled) return;
  query.value = "";
  activeIndex.value = 0;
  visible.value = true;
}

function toggle() {
  if (visible.value) visible.value = false;
  else open();
}

function navigateResults(event: Event | KeyboardEvent) {
  if (!(event instanceof KeyboardEvent) || event.isComposing || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "ArrowDown") activeIndex.value = Math.min(activeIndex.value + 1, results.value.length - 1);
  else if (event.key === "ArrowUp") activeIndex.value = Math.max(activeIndex.value - 1, 0);
  else void selectNode(activeIndex.value);
}

async function selectNode(index: number) {
  const node = results.value[index]?.node;
  if (!node || props.disabled) return;
  visible.value = false;
  flow.removeSelectedElements();
  flow.addSelectedNodes([node]);
  flow.nodesSelectionActive.value = false;
  await nextTick();
  await flow.fitView({ nodes: [node.id], padding: 0.4, maxZoom: 1.4, duration: 200 });
}

defineExpose({ open, toggle });
</script>

<style lang="scss" scoped>
.nodeListPanel {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(360px, calc(100vw - 24px));
  height: min(86dvh, 860px);
  max-height: calc(100dvh - 100px);

  :deep(.el-card__body) {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    box-sizing: border-box;
    padding: 8px;
  }
}

.nodeSearch {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;

  .nodeToolbar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 8px;
    height: 32px;
    margin-bottom: 8px;

    .searchInput { flex: 1; min-width: 0; }
    .toolbarButton { flex-shrink: 0; width: 28px; height: 28px; margin: 0; padding: 0; }
  }

  .resultList {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;

    .nodeResult {
      display: flex;
      align-items: center;
      gap: 8px;
      box-sizing: border-box;
      width: 100%;
      min-height: 36px;
      padding: 2px 4px;
      border: 0;
      border-radius: var(--el-border-radius-base);
      background: transparent;
      color: var(--el-text-color-primary);
      font: inherit;
      text-align: left;
      cursor: pointer;

      &:hover, &[aria-selected="true"] { background: var(--el-fill-color); }
      .nodeThumbnail {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 32px;
        width: 32px;
        height: 32px;
        overflow: hidden;
        border-radius: 8px;
        background: var(--el-fill-color);
        color: var(--el-text-color-secondary);
        img { width: 100%; height: 100%; object-fit: cover; }
      }
      .nodeLabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .nodeType { flex-shrink: 0; color: var(--el-text-color-secondary); font-size: 12px; }
    }
    .empty { margin: 24px 0; color: var(--el-text-color-secondary); text-align: center; }
  }
}
</style>
