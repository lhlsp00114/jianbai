<template>
  <teleport :to="expandedTarget || 'body'" :disabled="!expanded || !expandedTarget">
    <div v-show="!pickingReference" class="generationPromptPanel nodrag nopan nowheel" :class="{ expandedPanel: expanded }" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop="handleKeydown">
      <el-button class="panelExpandButton" :icon="expanded ? IconMinimize : IconMaximize" text :title="expanded ? '收起编辑提示词' : '展开编辑提示词'" :aria-label="expanded ? '收起编辑提示词' : '展开编辑提示词'" @mousedown.prevent @click.stop="expanded = !expanded" />
      <slot />
    </div>
  </teleport>
  <el-dialog v-model="expanded" class="generationPromptDialog" modalClass="generationPromptMask" title="编辑生成提示词" width="min(820px, calc(100vw - 40px))" alignCenter appendToBody :showClose="false" :closeOnClickModal="false" @opened="focusEditor">
    <div ref="expandedTarget" class="expandedPromptTarget" />
  </el-dialog>
</template>

<script setup lang="ts">
import { provide, ref } from "vue";
import { ElButton, ElDialog } from "element-plus";
import { IconMaximize, IconMinimize } from "@tabler/icons-vue";

const expanded = ref(false);
const pickingReference = ref(false);
const expandedTarget = ref<HTMLElement>();
provide("expandedGenerationPrompt", expanded);
provide("pickingGenerationReference", pickingReference);

function focusEditor() {
  expandedTarget.value?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.repeat || !expanded.value) return;
  event.preventDefault();
  expanded.value = false;
}
</script>

<style scoped lang="scss">
.generationPromptPanel {
  position: relative;

  .panelExpandButton {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 12;
    width: 30px;
    height: 30px;
    padding: 6px;
    border-radius: 7px;
    color: var(--el-text-color-secondary);

    &:hover { color: var(--el-text-color-primary); background: var(--el-fill-color); }
  }

  :deep(.referenceList) { padding-right: 34px; box-sizing: border-box; }
  :deep(.chat-rich-text > [contenteditable]),
  :deep(.chat-placeholder-wrap) { padding-right: 34px; }

  &:not(.expandedPanel) {
    :deep(.promptCard > .el-card__body > .promptInputWrap:first-child) { margin-top: 30px; }
  }

  &.expandedPanel {
    height: 100%;

    :deep(.promptCard) {
      height: 100%;
      border: 0;
      background: transparent;
      box-shadow: none;

      > .el-card__body {
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        height: 100%;
        min-height: 0;
        padding: 20px !important;
      }

      .referenceList { flex: 0 0 auto; max-height: 120px; }
      .referenceActions, .referenceHint, .inpaintInfo { flex-shrink: 0; }
      .promptInputWrap { flex: 1; min-height: 0; margin: 16px 0; }
      &:not(:has(.referenceList, .referenceActions)) .promptInputWrap { margin-top: 28px; }
      .promptFooter { flex-shrink: 0; flex-wrap: wrap; row-gap: 10px; padding-top: 12px; }
    }
  }
}

.expandedPromptTarget { height: 100%; min-height: 0; }
:global(.generationPromptDialog) {
  display: flex;
  flex-direction: column;
  height: min(840px, calc(100dvh - 48px));
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--el-border-color-light);
  border-radius: 14px;
}
:global(.generationPromptDialog .el-dialog__header) { display: none; }
:global(.generationPromptDialog .el-dialog__body) { flex: 1; min-height: 0; padding: 0; }
:global(.generationPromptMask) { background: rgb(0 0 0 / 55%); backdrop-filter: blur(6px); }
</style>
