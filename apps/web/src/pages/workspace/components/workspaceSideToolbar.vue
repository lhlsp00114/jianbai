<template>
  <div
    class="sideToolbar nodrag nopan nowheel"
    role="toolbar"
    aria-label="左侧工具栏"
    aria-orientation="vertical"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
    @dblclick.stop
    @contextmenu.stop.prevent
    @wheel.stop>
    <el-tooltip :showArrow="false" :content="nodePanelVisible ? '关闭添加节点' : '添加节点'" placement="right" :hideAfter="0" :enterable="false" :triggerKeys="[]">
      <el-button class="sideToolButton addNodeButton" :class="{ active: nodePanelVisible }" text :aria-pressed="nodePanelVisible" aria-label="添加节点" @click="emit('openTool', 'nodes')">
        <icon-x v-if="nodePanelVisible" :size="22" aria-hidden="true" />
        <icon-plus v-else :size="22" aria-hidden="true" />
      </el-button>
    </el-tooltip>
    <el-tooltip :showArrow="false" content="上传文件" placement="right" :hideAfter="0" :enterable="false" :triggerKeys="[]">
      <el-button class="sideToolButton" text :disabled="uploadDisabled" aria-label="上传文件" @click="emit('openTool', 'upload')">
        <icon-upload :size="22" aria-hidden="true" />
      </el-button>
    </el-tooltip>
    <el-tooltip :showArrow="false" content="创作收藏" placement="right" :hideAfter="0" :enterable="false" :triggerKeys="[]">
      <el-button class="sideToolButton" :class="{ active: libraryVisible }" text :aria-pressed="libraryVisible" aria-label="创作收藏" @click="emit('openTool', 'library')">
        <svg class="creationLibraryIcon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <path d="M7 7H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1" />
          <rect x="7" y="3" width="14" height="15" rx="2" />
          <path d="m14 6 1 2 2 1-2 1-1 2-1-2-2-1 2-1Z M11 15h6" />
        </svg>
      </el-button>
    </el-tooltip>
    <el-tooltip v-if="currentUser?.role !== 'user'" :showArrow="false" :content="assetsVisible ? '关闭素材库' : '打开素材库'" placement="right" :hideAfter="0" :enterable="false" :triggerKeys="[]">
      <el-button class="sideToolButton" :class="{ active: assetsVisible }" text :aria-pressed="assetsVisible" aria-label="素材库" @click="emit('openTool', 'assets')">
        <icon-folder :size="'24'" :stroke="'1.7'" aria-hidden="true" />
      </el-button>
    </el-tooltip>
    <el-tooltip :showArrow="false" :content="historyVisible ? '关闭历史记录' : '历史记录'" placement="right" :hideAfter="0" :enterable="false" :triggerKeys="[]">
      <el-button class="sideToolButton" :class="{ active: historyVisible }" text :aria-pressed="historyVisible" aria-label="历史记录" @click="emit('openTool', 'history')">
        <icon-history :size="'24'" :stroke="'1.7'" aria-hidden="true" />
      </el-button>
    </el-tooltip>
  </div>
</template>

<script setup lang="ts">
import { IconFolder, IconHistory, IconPlus, IconUpload, IconX } from "@tabler/icons-vue";
import { currentUser } from "@/stores/multiTenant";

defineProps<{ nodePanelVisible?: boolean; uploadDisabled?: boolean; libraryVisible?: boolean; assetsVisible?: boolean; historyVisible?: boolean }>();
const emit = defineEmits<{ openTool: [tool: "nodes" | "upload" | "library" | "assets" | "history"] }>();
</script>

<style scoped lang="scss">
.sideToolbar {
  position: absolute;
  top: 50%;
  left: 12px;
  z-index: 8;
  transform: translateY(-50%);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 56px;
  max-height: calc(100% - 160px);
  overflow-y: auto;
  scrollbar-width: none;
  padding: 6px;
  border: 1px solid var(--el-border-color-light);
  border-radius: calc(var(--ui-radius) * 2.25);

  &:not(:has(.sideToolButton)) { display: none; }

  .sideToolButton {
    display: flex;
    flex-shrink: 0;
    width: 42px;
    height: 42px;
    margin: 0;
    padding: 8px;
    border-radius: var(--ui-radius-large);
    color: var(--el-text-color-regular);

    &:hover { color: var(--el-text-color-primary); background: var(--el-fill-color); }
    &.active { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
  }

  .addNodeButton {
    border-radius: 50%;
    background: var(--el-color-white);
    color: var(--el-color-black);

    &:hover, &.active { background: var(--el-color-white); color: var(--el-color-black); }
  }
}
</style>
