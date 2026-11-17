<template>
  <teleport :to="expandedTarget || 'body'" :disabled="!expanded || !expandedTarget">
    <div v-show="!pickingReference" class="generationPromptPanel nodrag nopan nowheel" :class="{ expandedPanel: expanded, hasPanelActions: !!$slots.actions }" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop="handleKeydown">
      <div class="panelActions">
        <slot name="actions" />
        <el-button class="panelExpandButton" :icon="expanded ? IconMinimize : IconMaximize" text :title="expanded ? '收起编辑提示词' : '展开编辑提示词'" :aria-label="expanded ? '收起编辑提示词' : '展开编辑提示词'" @mousedown.prevent @click.stop="expanded = !expanded" />
      </div>
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

  :deep(.promptCard) {
    border-radius: 16px;
    border-color: var(--el-border-color-lighter);
    box-shadow: 0 4px 16px #0000000d;

    > .el-card__body { padding: 10px 12px 12px !important; }

    .referenceActions {
      gap: 4px;
      min-height: 24px;
      margin-bottom: 8px;

      .el-button { height: 24px; padding: 0 7px; font-size: 12px; }
      .el-icon { font-size: 14px; }
    }

    .referenceList { gap: 6px; }
    .promptInputWrap { margin: 10px 0 12px; }
    .referenceHint { font-size: 12px; line-height: 1.5; }

    .promptFooter {
      gap: 8px;
      min-width: 0;

      .providerModelSelect { flex: 0 1 210px; width: 210px; min-width: 0; }
      .modelSelect {
        .el-select__wrapper {
          min-height: 30px;
          padding: 0 8px;
          border-radius: 6px;
          font-size: 12px;
          line-height: 20px;
          transition: background-color 0.15s, color 0.15s;
          cursor: pointer;

          &:hover:not(.is-disabled), &.is-focused:not(.is-disabled) {
            background: var(--el-fill-color-light);
            color: var(--el-text-color-primary);
          }
        }

        .el-select__selection { min-height: 20px; }
        .el-select__input { height: 20px; }
        .el-select__placeholder { display: flex; align-items: center; height: 20px; font-size: 12px; }
        .modelLabel { display: flex; align-items: center; gap: 5px; line-height: 20px; }
        .modelIcon { flex-shrink: 0; }
        .el-select__suffix { align-self: center; }
      }
      .settingsButton { height: 30px; padding: 0 8px; border-radius: 6px; font-size: 12px; }
      .promptPresetsButton {
        flex-shrink: 0;
        width: 30px;
        height: 30px;
        margin: 0;
        padding: 6px;
        border-radius: 6px;
        color: var(--el-text-color-regular);

        &:hover, &:focus-visible { background: var(--el-fill-color-light); color: var(--el-text-color-primary); }
      }
      .mediaPrice { min-height: 30px; padding: 0 4px; font-size: 11px; }
      .generationActions { gap: 6px; }
      .sendButton { width: 32px; height: 32px; border-radius: 10px; }
      .confirmButton { height: 32px; }
    }
  }

  .panelActions {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 12;
    display: flex;
    align-items: center;
    gap: 3px;

    :deep(.compactRecovery) { width: 24px; height: 24px; padding: 4px; }
    :deep(.detachedProviderSelect) {
      width: 56px;
      .el-select__wrapper { min-height: 24px; padding: 0 5px; font-size: 11px; border-color: transparent; }
      .el-select__wrapper:hover { background: var(--el-fill-color-light); }
    }

    .panelExpandButton {
      width: 24px;
      height: 24px;
      margin: 0;
      padding: 4px;
      border-radius: 6px;
      color: var(--el-text-color-secondary);

      &:hover { color: var(--el-text-color-primary); background: var(--el-fill-color); }
    }
  }

  :deep(.referenceList) { box-sizing: border-box; }
  :deep(.chat-rich-text > [contenteditable]),
  :deep(.chat-placeholder-wrap) { padding-right: 0; }

  &.hasPanelActions {
    :deep(.referenceActions) { padding-right: 112px; }
  }

  &:not(.expandedPanel) {
    :deep(.chat-rich-text > [contenteditable]),
    :deep(.chat-placeholder-wrap) { font-size: 13px !important; line-height: 1.7 !important; }
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
