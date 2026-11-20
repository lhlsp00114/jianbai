<template>
  <teleport :to="expandedTarget || 'body'" :disabled="!expanded || !expandedTarget">
    <div v-show="!pickingReference" class="generationPromptPanel nodrag nopan nowheel" :class="{ expandedPanel: expanded, compactPanel: !guidanceVisible && !expanded, hasPanelActions: !!$slots.actions }" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop="handleKeydown">
      <div v-if="!expanded" class="guidanceReveal" :class="{ guidanceHidden: !guidanceVisible }" :inert="!guidanceVisible" :aria-hidden="!guidanceVisible">
      <div class="guidanceContent">
      <div class="creativeEntries" role="group" aria-label="创作设置">
        <div v-for="entry in creativeEntries" :key="entry.label" class="creativeEntrySlot" :class="{ hasSelection: selectedEntry(entry.name) }">
          <el-tooltip :disabled="!selectedEntry(entry.name) || compositionVisible || colorVisible || cameraVisible" placement="top" :showAfter="250" :showArrow="false" :popperStyle="{ padding: '5px', borderRadius: '12px' }">
            <template #content><div><img v-if="selectedEntry(entry.name)" class="compositionHoverImage" :src="selectedEntry(entry.name)?.image" :alt="selectedEntry(entry.name)?.label" style="display: block; width: 240px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px" /><p v-if="entry.name === 'cameraEntry'" style="max-width: 240px; margin: 7px 0 0; font-size: 12px; line-height: 1.5">{{ cameraSummary }}</p></div></template>
            <button class="creativeEntry" :class="entry.name" type="button" :disabled="entry.name === 'styleEntry'" @click="openEntry(entry.name)">
              <img v-if="selectedEntry(entry.name)" class="entryThumbnail" :src="selectedEntry(entry.name)?.image" alt="" />
              <span v-else class="entryIcon" aria-hidden="true" />
              <span class="entryLabel">{{ selectedEntry(entry.name)?.label || entry.label }}</span>
            </button>
          </el-tooltip>
          <button v-if="selectedEntry(entry.name)" class="clearEntry" type="button" :aria-label="`清除${entry.label}`" @click.stop="clearEntry(entry.name)"><icon-x :size="12" aria-hidden="true" /></button>
        </div>
      </div>
      </div>
      </div>
      <div class="panelActions">
        <el-tooltip v-if="!expanded" content="影视指导" placement="top" :showAfter="250">
          <button class="guidanceToggle" type="button" aria-label="影视指导" :aria-expanded="guidanceVisible" @mousedown.prevent @click.stop="guidanceVisible = !guidanceVisible">
            <span class="guidanceIcon" aria-hidden="true" />
          </button>
        </el-tooltip>
        <slot name="actions" />
        <el-button class="panelExpandButton" :icon="expanded ? IconMinimize : IconMaximize" text :title="expanded ? '收起编辑提示词' : '展开编辑提示词'" :aria-label="expanded ? '收起编辑提示词' : '展开编辑提示词'" @mousedown.prevent @click.stop="expanded = !expanded" />
      </div>
      <slot />
    </div>
  </teleport>
  <el-dialog v-model="expanded" class="generationPromptDialog" modalClass="generationPromptMask" title="编辑生成提示词" width="min(820px, calc(100vw - 40px))" alignCenter appendToBody :showClose="false" :closeOnClickModal="false" @opened="focusEditor">
    <div ref="expandedTarget" class="expandedPromptTarget" />
  </el-dialog>
  <compositionGallery v-model="compositionVisible" v-model:selected="node.data.compositionPreset" />
  <compositionGallery v-model="colorVisible" v-model:selected="node.data.colorPreset" kind="color" :selectedSnapshot="node.data.colorPresetData" />
  <cameraControl v-model="cameraVisible" :settings="node.data.cameraSettings" @update:settings="updateCameraSettings" />
</template>

<script setup lang="ts">
import { computed, provide, ref, watch } from "vue";
import { ElButton, ElDialog, ElTooltip } from "element-plus";
import { IconMaximize, IconMinimize, IconX } from "@tabler/icons-vue";
import compositionGallery from "./compositionGallery.vue";
import cameraControl from "./cameraControl.vue";
import { cameraOptions, isCameraSettings, lensOptions } from "../cameraOptions";
import cameraReferenceImage from "../assets/colors/sageCream.jpg";
import { useNode, useVueFlow } from "@vue-flow/core";
import { compositions } from "./compositionOptions";
import { getColorOptions, getCustomColorOption, isCustomColor, loadCustomColors } from "../customColors";
loadCustomColors();

const creativeEntries = [
  { label: "风格", name: "styleEntry" },
  { label: "配色", name: "colorEntry" },
  { label: "构图", name: "compositionEntry" },
  { label: "相机", name: "cameraEntry" },
];

const expanded = ref(false);
const { node } = useNode();
const { updateNodeData } = useVueFlow();
const selectedComposition = computed(() => compositions.find(item => item.name === node.data.compositionPreset));
const selectedColor = computed(() => {
  const snapshot = node.data.colorPresetData;
  return isCustomColor(snapshot) && snapshot.name === node.data.colorPreset ? getCustomColorOption(snapshot) : getColorOptions().find(item => item.name === node.data.colorPreset);
});
watch(() => node.data.colorPreset, preset => {
  if (isCustomColor(node.data.colorPresetData) && node.data.colorPresetData.name === preset) return;
  const option = getColorOptions().find(item => item.name === preset);
  node.data.colorPresetData = option && isCustomColor(option) ? { name: option.name, label: option.label, colors: [...option.colors] } : undefined;
}, { immediate: true, flush: "sync" });
const colorVisible = ref(false);
const cameraVisible = ref(false);
const selectedCamera = computed(() => {
  const settings = node.data.cameraSettings;
  return isCameraSettings(settings) ? { label: settings.enabled ? `${settings.focalLength} mm · f/${settings.aperture}` : "相机 · 已关闭", image: cameraReferenceImage } : undefined;
});
const cameraSummary = computed(() => {
  const settings = node.data.cameraSettings;
  if (!isCameraSettings(settings)) return "";
  return `${cameraOptions.find(item => item.id === settings.camera)?.label} · ${lensOptions.find(item => item.id === settings.lens)?.label} · ${settings.focalLength} mm · f/${settings.aperture}${settings.enabled ? "" : " · 已关闭"}`;
});
function openEntry(name: string) {
  if (name === "colorEntry") colorVisible.value = true;
  else if (name === "compositionEntry") compositionVisible.value = true;
  else if (name === "cameraEntry") cameraVisible.value = true;
}
function clearEntry(name: string) {
  if (name === "cameraEntry") updateCameraSettings(undefined);
  else node.data[name === "colorEntry" ? "colorPreset" : "compositionPreset"] = "";
}
function updateCameraSettings(value: unknown) {
  updateNodeData(node.id, { cameraSettings: value });
}
function selectedEntry(name: string) {
  return name === "compositionEntry" ? selectedComposition.value : name === "colorEntry" ? selectedColor.value : name === "cameraEntry" ? selectedCamera.value : undefined;
}
const compositionVisible = ref(false);
const guidanceVisible = ref(true);
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
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 20px;
  background: var(--el-bg-color-overlay);
  box-shadow: 0 4px 16px #0000000d;
  transition: padding 280ms cubic-bezier(.22, 1, .36, 1), border-radius 280ms cubic-bezier(.22, 1, .36, 1);

  .guidanceReveal {
    display: grid;
    grid-template-rows: 1fr;
    opacity: 1;
    transition: grid-template-rows 280ms cubic-bezier(.22, 1, .36, 1), opacity 200ms ease;

    &.guidanceHidden { grid-template-rows: 0fr; opacity: 0; }
    .guidanceContent { min-height: 0; overflow: hidden; }
  }

  &.compactPanel {
    padding: 0;
    border-radius: 16px;
    .panelActions { top: 8px; right: 8px; }
  }

  .creativeEntries {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
    padding: 2px;
    margin-bottom: 8px;
    border-radius: 16px;
    background: transparent;

    .creativeEntrySlot {
      position: relative;
      min-width: 0;
      .creativeEntry { width: 100%; }
      &.hasSelection .creativeEntry { padding-right: 26px; }
      .entryThumbnail { width: 30px; height: 28px; border-radius: 7px; object-fit: cover; flex-shrink: 0; }
      .entryLabel { overflow: hidden; text-overflow: ellipsis; }
      .clearEntry {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        display: grid;
        place-items: center;
        width: 18px;
        height: 18px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: var(--el-fill-color);
        color: var(--el-text-color-secondary);
        cursor: pointer;
        &:hover { background: var(--el-fill-color-darker); color: var(--el-text-color-primary); }
        &:focus-visible { outline: 1px solid #fff; outline-offset: 2px; }
      }
    }

    .creativeEntry {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      box-sizing: border-box;
      min-width: 0;
      height: 44px;
      padding: 0 8px;
      border: 1px solid color-mix(in srgb, var(--entryAccent) 14%, var(--el-border-color-extra-light));
      border-radius: 12px;
      background: linear-gradient(120deg, color-mix(in srgb, var(--entryAccent) 7%, var(--el-bg-color-overlay)), var(--el-fill-color-light));
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--entryAccent) 8%, transparent);
      color: var(--el-text-color-regular);
      font: inherit;
      font-size: 12px;
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
      opacity: 1;
      cursor: default;
      outline: none;
      &:focus { outline: none; }
      &:not(:disabled) {
        cursor: pointer;
        &:hover { border-color: var(--entryAccent); }
        &:focus-visible { outline: 1px solid #fff; outline-offset: 2px; }
      }

      &.styleEntry { --entryAccent: #b7aa90; }
      &.colorEntry { --entryAccent: #c88eac; }
      &.compositionEntry { --entryAccent: #a394d6; }
      &.cameraEntry { --entryAccent: #83abc8; }

      .entryLabel { letter-spacing: .08em; }

      .entryIcon {
        position: relative;
        flex-shrink: 0;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        background: color-mix(in srgb, var(--entryAccent) 10%, var(--el-bg-color));
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--entryAccent) 14%, transparent);

        &::before, &::after { content: ""; position: absolute; box-sizing: border-box; }
      }

      &.styleEntry .entryIcon {
        &::before { inset: 6px 9px 8px 5px; border: 1px solid #c7b99c; border-radius: 3px; transform: rotate(-12deg); }
        &::after { inset: 9px 5px 5px 9px; border-radius: 3px; background: linear-gradient(145deg, #d5c6aa, #83745c); transform: rotate(9deg); box-shadow: 0 2px 4px #0003; }
      }
      &.colorEntry .entryIcon {
        &::before { inset: 5px; border-radius: 50%; background: conic-gradient(#d6889d, #e0b878, #91b99b, #849fcb, #b394cb, #d6889d); }
        &::after { inset: 11px; border-radius: 50%; background: var(--el-bg-color-overlay); }
      }
      &.compositionEntry .entryIcon {
        &::before { inset: 5px; border: 1px solid #b5a6dc; border-radius: 3px; background: linear-gradient(90deg, transparent 31%, #b5a6dc70 31% 35%, transparent 35% 65%, #b5a6dc70 65% 69%, transparent 69%), linear-gradient(transparent 31%, #b5a6dc70 31% 35%, transparent 35% 65%, #b5a6dc70 65% 69%, transparent 69%); }
        &::after { width: 5px; height: 5px; top: 10px; left: 16px; border-radius: 50%; background: #d1c3f2; }
      }
      &.cameraEntry .entryIcon {
        &::before { inset: 4px; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #b3d2e6 0%, #496c89 24%, #152839 46%, #6c849b 50%, #263647 63%, #101a25 68%); box-shadow: 0 1px 4px #0005; }
        &::after { width: 4px; height: 4px; top: 8px; left: 9px; border-radius: 50%; background: #d1e6f5a6; }
      }
    }
  }

  :deep(.promptCard) {
    border-radius: 16px;
    border: 0;
    background: transparent;
    box-shadow: none;

    > .el-card__body { padding: 10px 12px 12px !important; }

    .referenceActions {
      gap: 4px;
      min-height: 24px;
      margin-bottom: 8px;

      .el-button { height: 24px; padding: 0 7px; font-size: 12px; }
      .el-icon { font-size: 14px; }
    }

    .referenceActions .el-button:not(.is-disabled),
    .promptFooter .settingsButton:not(.is-disabled) {
      color: var(--el-text-color-secondary);

      &:hover, &:focus-visible { color: var(--el-text-color-primary); }
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
    top: 72px;
    right: 16px;
    z-index: 12;
    display: flex;
    align-items: center;
    gap: 3px;
    transition: top 280ms cubic-bezier(.22, 1, .36, 1), right 280ms cubic-bezier(.22, 1, .36, 1);

    .guidanceToggle {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--el-text-color-secondary);
      cursor: pointer;

      &[aria-expanded="true"] { color: #baa98d; background: color-mix(in srgb, currentColor 9%, transparent); }
      &:hover { color: var(--el-text-color-primary); background: var(--el-fill-color); }
      &:focus-visible { outline: 1px solid #fff; outline-offset: 2px; }

      .guidanceIcon {
        position: relative;
        box-sizing: border-box;
        width: 16px;
        height: 12px;
        margin-top: 4px;
        border: 1px solid currentColor;
        border-radius: 2px;

        &::before { content: ""; position: absolute; left: -1px; right: -1px; top: -5px; height: 4px; border: 1px solid currentColor; border-radius: 2px 2px 0 0; background: repeating-linear-gradient(120deg, currentColor 0 3px, transparent 3px 6px); transform: rotate(-10deg); transform-origin: left bottom; }
        &::after { content: ""; position: absolute; left: 4px; top: 3px; border-left: 4px solid currentColor; border-top: 2px solid transparent; border-bottom: 2px solid transparent; }
      }
    }

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
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    .panelActions { top: 8px; right: 8px; }

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
