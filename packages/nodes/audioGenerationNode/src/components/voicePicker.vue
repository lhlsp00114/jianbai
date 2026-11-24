<template>
  <el-popover v-model:visible="visible" trigger="click" placement="top-start" width="min(440px, calc(100vw - 32px))" :disabled="disabled" :showArrow="false" :popperStyle="{ padding: '14px', borderRadius: '12px' }">
    <template #reference>
      <button type="button" class="voiceTrigger" :disabled="disabled" :aria-expanded="visible" aria-label="选择和试听音色">
        <span class="voiceLabel">音色</span><span class="voiceValue">{{ selectedLabel }}</span><icon-chevron-down :size="12" />
      </button>
    </template>
    <div class="voiceLibrary nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.esc.stop="visible = false" @keydown.stop @wheel.stop>
      <div class="libraryHeader"><span>音色库 · {{ options.length }}</span><span class="sampleNote">音色示例 · 仅供参考</span></div>
      <el-input v-model="query" placeholder="搜索音色名称或特点" clearable aria-label="搜索音色" />
      <div class="voiceList">
        <div v-for="voice in pageOptions" :key="voice.value" class="voiceItem" :class="{ selected: modelValue === voice.value }">
          <button type="button" class="chooseVoice" :disabled="disabled" :title="`${voice.label} · ${voice.value}`" :aria-pressed="modelValue === voice.value" @click="selectVoice(voice.value)">
            <span class="voiceName">{{ voice.label }}</span>
            <span class="voiceDescription">{{ [voice.gender, voice.language, voice.description].filter(Boolean).join(' · ') }}</span>
          </button>
          <button v-if="voice.previewUrl" type="button" class="previewButton" :disabled="disabled" :aria-label="`${playing === voice.value ? '停止试听' : '试听'} ${voice.label}`" :title="playing === voice.value ? '停止试听' : '试听音色'" @click="preview(voice)">
            <icon-loader-2 v-if="loading && playing === voice.value" class="loadingIcon" :size="15" />
            <icon-player-stop v-else-if="playing === voice.value" :size="15" />
            <icon-player-play v-else :size="15" />
          </button>
          <span v-else class="noPreview">暂无试听</span>
        </div>
      </div>
      <div v-if="pageCount > 1" class="pageControls">
        <button type="button" :disabled="page === 1" aria-label="上一页音色" @click="page--">上一页</button>
        <span>{{ page }} / {{ pageCount }}</span>
        <button type="button" :disabled="page === pageCount" aria-label="下一页音色" @click="page++">下一页</button>
      </div>
      <form v-if="allowCustom" class="customVoice" @submit.prevent="selectVoice(customVoice.trim())">
        <el-input v-model="customVoice" placeholder="输入自定义或克隆音色 ID" :disabled="disabled" aria-label="自定义音色 ID" />
        <el-button nativeType="submit" :disabled="disabled || !customVoice.trim()" text>使用</el-button>
      </form>
      <span v-if="!filteredOptions.length" class="sampleNote">没有匹配的音色</span>
      <span v-if="error" class="previewError" role="alert">{{ error }}</span>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import { ElButton, ElInput, ElPopover } from "element-plus";
import { IconChevronDown, IconLoader2, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-vue";

type VoiceOption = { value: string; label: string; description?: string; gender?: string; language?: string; previewUrl?: string };
const props = defineProps<{ options: VoiceOption[]; disabled?: boolean; modelKey: string; allowCustom?: boolean }>();
const modelValue = defineModel<string>();
const visible = ref(false);
const query = ref("");
const customVoice = ref("");
const page = ref(1);
const playing = ref("");
const loading = ref(false);
const error = ref("");
let audio: HTMLAudioElement | undefined;
const selectedLabel = computed(() => props.options.find(option => option.value === modelValue.value)?.label ?? modelValue.value ?? "请选择");
const filteredOptions = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase();
  return props.options.filter(voice => `${voice.label} ${voice.value} ${voice.description ?? ""} ${voice.gender ?? ""} ${voice.language ?? ""}`.toLocaleLowerCase().includes(keyword));
});
const pageCount = computed(() => Math.max(1, Math.ceil(filteredOptions.value.length / 24)));
const pageOptions = computed(() => filteredOptions.value.slice((page.value - 1) * 24, page.value * 24));
watch([query, () => props.options], () => { page.value = 1; stopPreview(); });
watch(page, stopPreview);

function stopPreview() {
  const current = audio;
  audio = undefined;
  if (current) {
    current.onended = null;
    current.onerror = null;
    current.pause();
    current.removeAttribute("src");
    current.load();
  }
  playing.value = "";
  loading.value = false;
}
async function preview(voice: VoiceOption) {
  if (props.disabled || !voice.previewUrl) return;
  if (playing.value === voice.value) return stopPreview();
  window.dispatchEvent(new Event("toonflow:voice-preview"));
  error.value = "";
  const current = new Audio(voice.previewUrl);
  audio = current;
  playing.value = voice.value;
  loading.value = true;
  const fail = () => {
    if (audio !== current) return;
    stopPreview();
    error.value = "试听音频暂时无法播放，请检查网络后重试。";
  };
  current.onended = () => { if (audio === current) stopPreview(); };
  current.onerror = fail;
  try { await current.play(); if (audio === current) loading.value = false; }
  catch { fail(); }
}
function selectVoice(value: string) {
  if (props.disabled || !value.trim()) return;
  modelValue.value = value;
  visible.value = false;
}
watch(visible, open => {
  if (!open) stopPreview();
  else {
    query.value = "";
    error.value = "";
    customVoice.value = props.options.some(option => option.value === modelValue.value) ? "" : modelValue.value ?? "";
    page.value = 1;
  }
});
watch([() => props.modelKey, () => props.disabled], () => { visible.value = false; stopPreview(); });
window.addEventListener("toonflow:voice-preview", stopPreview);
onScopeDispose(() => { window.removeEventListener("toonflow:voice-preview", stopPreview); stopPreview(); });
</script>

<style scoped lang="scss">
.voiceTrigger {
  display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; min-height: 30px; padding: 5px 10px;
  border: 1px solid transparent; border-radius: 8px; background: var(--el-fill-color-light); color: var(--el-text-color-regular);
  font: inherit; font-size: 12px; cursor: pointer; user-select: none;
  &:hover, &:focus-visible { border-color: var(--el-border-color); }
  &:disabled { opacity: .5; cursor: not-allowed; }
  .voiceLabel { color: var(--el-text-color-secondary); }
  .voiceValue { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  svg { flex-shrink: 0; }
}
.voiceLibrary {
  display: grid; gap: 12px;
  .libraryHeader { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px; }
  .sampleNote { font-size: 11px; color: var(--el-text-color-secondary); }
  .voiceList {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; max-height: min(330px, 45vh); overflow-y: auto; overscroll-behavior: contain;
    .voiceItem {
      display: flex; align-items: center; min-width: 0; padding: 3px; border: 1px solid transparent; border-radius: 8px; background: var(--el-fill-color-light);
      &.selected { border-color: var(--el-color-primary); }
      button { border: 0; background: transparent; color: var(--el-text-color-primary); font: inherit; cursor: pointer; border-radius: 5px; }
      button:focus-visible { outline: 1px solid var(--el-color-primary); }
      .chooseVoice {
        flex: 1; display: grid; gap: 4px; min-width: 0; padding: 8px; text-align: left;
        .voiceName { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .voiceDescription { font-size: 11px; color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      }
      .previewButton { flex-shrink: 0; display: grid; place-items: center; width: 28px; height: 28px; &:hover { background: var(--el-fill-color); } }
      .noPreview { flex-shrink: 0; padding-right: 5px; color: var(--el-text-color-placeholder); font-size: 10px; }
      .loadingIcon { animation: voiceLoading 1s linear infinite; }
    }
  }
  .previewError { font-size: 12px; color: var(--el-color-danger); }
  .pageControls {
    display: flex; align-items: center; justify-content: center; gap: 14px; color: var(--el-text-color-secondary); font-size: 11px;
    button { border: 0; border-radius: 6px; padding: 5px 8px; background: var(--el-fill-color-light); color: inherit; font: inherit; cursor: pointer; &:disabled { opacity: .4; cursor: default; } }
  }
  .customVoice { display: flex; align-items: center; gap: 8px; padding-top: 10px; border-top: 1px solid var(--el-border-color-lighter); }
}
@keyframes voiceLoading { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .voiceLibrary .voiceList .voiceItem .loadingIcon { animation: none; } }
</style>
