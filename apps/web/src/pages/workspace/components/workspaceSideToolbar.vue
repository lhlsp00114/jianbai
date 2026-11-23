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
    <el-tooltip :showArrow="false" content="节点列表" placement="right" :hideAfter="0" :enterable="false" :triggerKeys="[]">
      <el-button class="sideToolButton" text aria-label="节点列表" @click="emit('openTool', 'search')">
        <icon-list :size="22" aria-hidden="true" />
      </el-button>
    </el-tooltip>
    <el-tooltip :showArrow="false" content="创作广场" placement="right" :hideAfter="0" :enterable="false" :triggerKeys="[]">
      <el-button class="sideToolButton" :class="{ active: libraryVisible }" text :aria-pressed="libraryVisible" aria-label="创作广场" @click="emit('openTool', 'library')">
        <icon-apps :size="'24'" :stroke="'1.7'" aria-hidden="true" />
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
    <template v-if="agentVisible !== undefined">
      <div class="sideToolDivider" role="separator" />
      <el-tooltip :showArrow="false" :content="agentVisible ? '关闭见白 Agent' : '打开见白 Agent'" placement="right" :hideAfter="0" :enterable="false" :triggerKeys="[]">
        <agentOrbButton compact :aria-pressed="agentVisible" @click="emit('toggleAgent')" />
      </el-tooltip>
    </template>
  </div>
</template>

<script setup lang="ts">
import { IconApps, IconFolder, IconHistory, IconList, IconPlus, IconUpload, IconX } from "@tabler/icons-vue";
import { currentUser } from "@/stores/multiTenant";
import agentOrbButton from "./agentOrbButton.vue";

withDefaults(defineProps<{
  nodePanelVisible?: boolean;
  uploadDisabled?: boolean;
  libraryVisible?: boolean;
  assetsVisible?: boolean;
  historyVisible?: boolean;
  agentVisible?: boolean;
}>(), { agentVisible: undefined });
const emit = defineEmits<{ openTool: [tool: "nodes" | "upload" | "search" | "library" | "assets" | "history"]; toggleAgent: [] }>();
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
  border: 0;
  border-radius: calc(var(--ui-radius) * 2.25);
  background: var(--el-bg-color-overlay);
  box-shadow: 0 6px 20px #0004;

  &:not(:has(.sideToolButton)) { display: none; }

  .sideToolDivider {
    flex: 0 0 1px;
    width: 24px;
    background: var(--el-border-color-light);
  }

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
    background: var(--el-color-primary);
    color: var(--ui-primary-foreground, #fff);

    &:hover, &.active { background: var(--el-color-primary-dark-2); color: var(--ui-primary-foreground, #fff); }
  }
}
</style>
