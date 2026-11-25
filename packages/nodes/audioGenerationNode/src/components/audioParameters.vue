<template>
  <div v-if="rules.length" :class="section === 'controls' ? 'audioControls' : 'audioWriting'" class="nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @keydown.stop @wheel.stop>
    <template v-if="section !== 'controls'">
      <div v-for="rule in rules" :key="String(rule.field)" class="writingField" :class="{ shortField: ['title', 'negativeTags'].includes(String(rule.field)) }">
        <div class="writingLabel">
          {{ rule.title }}<span v-if="!required(rule)" class="optionalLabel">可选</span>
          <el-button v-if="section === 'lyrics'" class="expandLyrics" :icon="IconMaximize" :disabled="disabled" text circle title="展开编辑歌词" aria-label="展开编辑歌词" @click.stop="lyricsExpanded = true" />
        </div>
        <el-input :modelValue="String(other[String(rule.field)] ?? '')" :disabled="disabled" :type="['instructions', 'lyrics', 'infillLyrics', 'previewText', 'audioUrls'].includes(String(rule.field)) ? 'textarea' : 'text'" :autosize="{ minRows: section === 'lyrics' ? 5 : 2, maxRows: section === 'lyrics' ? 10 : 7 }" :placeholder="placeholders[String(rule.field)] ?? rule.props?.placeholder" :aria-label="String(rule.title)" resize="none" @update:modelValue="value => update(String(rule.field), value)" />
      </div>
      <el-dialog v-if="section === 'lyrics'" v-model="lyricsExpanded" title="编辑歌词" width="min(800px, calc(100vw - 32px))" alignCenter appendToBody :closeOnClickModal="false" @opened="lyricsEditor?.focus()">
        <el-input ref="lyricsEditor" class="lyricsEditor nodrag nopan nowheel" :modelValue="String(other.lyrics ?? '')" type="textarea" :disabled="disabled" :placeholder="placeholders.lyrics" aria-label="歌词" resize="none" @update:modelValue="value => update('lyrics', value)" @keydown.stop @wheel.stop />
      </el-dialog>
    </template>
    <template v-else>
      <template v-for="rule in rules" :key="String(rule.field)">
      <voicePicker v-if="rule.field === 'voice' && voiceOptions.some(option => option.previewUrl)" :modelValue="String(other.voice ?? '')" :options="voiceOptions" :modelKey="`${model?.providerId}/${model?.modelId}`" :allowCustom="!Array.isArray(rule.options)" :disabled="disabled" @update:modelValue="value => update('voice', value)" />
      <el-select v-else-if="Array.isArray(rule.options)" class="parameterSelect" :title="`${rule.title}：${displayValue(rule)}`" :modelValue="other[String(rule.field)] as string | number | undefined" :disabled="disabled" :filterable="rule.field === 'voice'" placement="top-start" :aria-label="String(rule.title)" @update:modelValue="value => update(String(rule.field), value)">
        <template #prefix><span class="chipLabel">{{ rule.title }}</span></template>
        <template v-if="rule.field === 'operation' && sunoOperationGroups.length">
          <el-option-group v-for="group in sunoOperationGroups" :key="group.label" :label="group.label">
            <el-option v-for="option in group.options" :key="String(option.value)" :label="String(option.label)" :value="option.value as string | number" />
          </el-option-group>
        </template>
        <template v-else>
          <el-option v-for="option in rule.options" :key="String(option.value)" :label="String(option.label)" :value="option.value as string | number" />
        </template>
      </el-select>
      <el-popover v-else trigger="click" placement="top-start" :width="rule.field === 'voice' ? 280 : 230" :showArrow="false" :disabled="disabled" :popperStyle="{ padding: '14px', borderRadius: '12px' }">
        <template #reference>
          <button type="button" class="parameterChip" :disabled="disabled" :title="`${rule.title}：${displayValue(rule)}`" :aria-label="`${rule.title}：${displayValue(rule)}`">
            <span class="chipLabel">{{ rule.title }}</span><span class="chipValue">{{ displayValue(rule) }}</span><icon-chevron-down :size="12" />
          </button>
        </template>
        <div class="parameterEditor nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @keydown.stop @wheel.stop>
          <span class="editorLabel">{{ rule.title }}</span>
          <el-input-number v-if="rule.type === 'inputNumber' || isSpeechSpeed(rule)" :modelValue="numericValue(rule)" :min="isSpeechSpeed(rule) ? 0.25 : rule.props?.min" :max="isSpeechSpeed(rule) ? 4 : rule.props?.max" :step="isSpeechSpeed(rule) ? 0.05 : 1" :controls="false" :placeholder="rule.field === 'duration' ? '自动' : '请输入'" :aria-label="String(rule.title)" @update:modelValue="value => update(String(rule.field), isSpeechSpeed(rule) ? value == null ? '' : String(value) : value ?? null)" />
          <el-input v-else :modelValue="String(other[String(rule.field)] ?? '')" :placeholder="rule.field === 'voice' ? '输入供应商音色 ID' : '请输入'" :aria-label="String(rule.title)" @update:modelValue="value => update(String(rule.field), value)" />
        </div>
      </el-popover>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElButton, ElDialog, ElInput, ElInputNumber, ElOption, ElOptionGroup, ElPopover, ElSelect } from "element-plus";
import { IconChevronDown, IconMaximize } from "@tabler/icons-vue";
import type { NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";
import { audioContentFields, audioQuickFields, getAudioRules } from "../audioSettings";
import voicePicker from "./voicePicker.vue";

const props = defineProps<{ model?: NodeMediaModel; section: "content" | "lyrics" | "controls"; disabled?: boolean }>();
const other = defineModel<Record<string, unknown>>({ required: true });
const lyricsExpanded = ref(false);
const lyricsEditor = ref<InstanceType<typeof ElInput>>();
type AudioRule = NonNullable<NodeMediaModel["rules"]>[number];
const voiceOptions = computed(() => {
  const rule = props.model?.rules?.find(rule => rule.field === "voice");
  const options = rule?.voiceLibrary ?? rule?.options;
  return Array.isArray(options) ? options.map(option => ({
    value: String(option.value), label: String(option.label),
    description: typeof option.description === "string" ? option.description : undefined,
    gender: typeof option.gender === "string" ? option.gender : undefined,
    language: typeof option.language === "string" ? option.language : undefined,
    previewUrl: typeof option.previewUrl === "string" && /^https?:\/\//i.test(option.previewUrl) ? option.previewUrl : undefined,
  })) : [];
});
const sunoContentFields = ["title", "negativeTags", ...audioContentFields.filter(field => !["title", "negativeTags", "lyrics"].includes(field))];
const sunoOperationCategories = [
  { label: "音乐创作", operations: ["generate", "lyrics", "inspo", "sample"] },
  { label: "歌曲改编与编辑", operations: ["extend", "cover", "upload_cover", "upload_extend", "replace_section", "concat", "mashup"] },
  { label: "音轨分离与添加", operations: ["stems", "stems_all", "add_vocals", "add_instrumental", "add_stem"] },
  { label: "音频导入与音色", operations: ["import", "persona"] },
];
const rules = computed(() => {
  if (!props.model?.audioOptions?.nativeParameters) return [];
  const fields = {
    content: props.model.modelId === "music" ? sunoContentFields : audioContentFields,
    lyrics: ["lyrics"],
    controls: audioQuickFields,
  }[props.section];
  const available = getAudioRules(props.model, other.value);
  return fields.flatMap(field => available.filter(rule => rule.field === field));
});
const sunoOperationGroups = computed(() => {
  if (props.model?.modelId !== "music") return [];
  const options = rules.value.find(rule => rule.field === "operation")?.options;
  if (!Array.isArray(options)) return [];
  const groups = sunoOperationCategories.map(({ label, operations }) => ({
    label,
    options: options.filter(option => operations.includes(String(option.value))),
  }));
  const otherOptions = options.filter(option => !sunoOperationCategories.some(group => group.operations.includes(String(option.value))));
  return [...groups, { label: "其他操作", options: otherOptions }].filter(group => group.options.length);
});
watch(() => rules.value.length, count => {
  if (!count) lyricsExpanded.value = false;
});
const placeholders: Record<string, string> = {
  instructions: "描述语气、口音或情绪，例如：轻声、舒缓地朗读",
  lyrics: "填写歌曲歌词",
  infillLyrics: "填写需要替换的这一段歌词",
  audioUrl: "填写源音频地址，或连接音频素材，二选一",
  audioUrls: "填写 1–4 个音频地址，每行一个；也可连接音频素材",
  coverAudioUrl: "填写翻唱源音频地址，或连接音频素材，二选一",
  sourceAudioUrl: "可选，提供原曲音频以额外返回拼接后的整首歌曲",
  clipId: "填写作品结果中的 source_id 或导入音频返回的引用",
  secondClipId: "填写另一首作品的 source_id",
  continueClipId: "填写需要续写的作品 source_id",
  coverClipId: "填写需要翻唱的作品 source_id",
  personaName: "为歌手音色命名，最多 50 个字符",
  previewText: "输入用于试听这个音色的文本",
  voiceId: "为音色设置 ID，以字母开头，至少 8 位",
  sampleUrl: "填写样本音频地址，或通过画布连接音频素材，二选一",
  title: "歌曲名称", negativeTags: "不希望出现的风格，例如：重金属、说唱",
};
function required(rule: AudioRule) {
  if (rule.field === "lyrics" && props.model?.modelId === "music" && other.value.operation === "upload_cover" && other.value.mode !== "instrumental") return true;
  if (props.model?.modelId === "music" && ["audioUrl", "audioUrls", "coverAudioUrl", "clipId", "secondClipId", "continueClipId", "coverClipId", "personaName", "infillLyrics"].includes(String(rule.field))) return true;
  return Array.isArray(rule.validate) && rule.validate.some(item => "required" in item && item.required);
}
function update(field: string, value: unknown) { other.value = { ...other.value, [field]: value }; }
function isSpeechSpeed(rule: AudioRule) { return props.model?.modelId === "gpt-4o-mini-tts" && rule.field === "speed"; }
function numericValue(rule: AudioRule) {
  const value = other.value[String(rule.field)];
  return value === "" || value == null ? undefined : Number(value);
}
function displayValue(rule: AudioRule) {
  const value = other.value[String(rule.field)];
  if (value === undefined || value === null || value === "") return rule.field === "duration" ? "自动" : rule.field === "personaId" ? "不使用" : "未设置";
  const option = Array.isArray(rule.options) ? rule.options.find(item => item.value === value) : undefined;
  if (option) return String(option.label);
  return `${value}${rule.field === "duration" ? ' 秒' : rule.field === "speed" ? '×' : ''}`;
}
</script>

<style scoped lang="scss">
.audioWriting {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 20px;
  padding: 4px 0 16px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  .writingField {
    grid-column: 1 / -1;
    min-width: 0;
    &.shortField { grid-column: auto; }
    .writingLabel { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; color: var(--el-text-color-regular); font-size: 12px; }
    .optionalLabel { color: var(--el-text-color-placeholder); font-size: 11px; }
    .expandLyrics { margin-left: auto; width: 24px; height: 24px; padding: 4px; color: var(--el-text-color-secondary); }
    :deep(.el-input__wrapper), :deep(.el-textarea__inner) { padding: 2px 0; background: transparent; box-shadow: none; border-radius: 0; font-size: 13px; line-height: 1.7; }
    &:focus-within { :deep(.el-input__wrapper), :deep(.el-textarea__inner) { box-shadow: 0 1px 0 var(--el-border-color); } }
  }
}
.lyricsEditor :deep(.el-textarea__inner) { height: min(55vh, 640px); line-height: 1.7; }
.audioControls {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(148px, 100%), 1fr));
  align-items: center;
  gap: 8px;
  padding: 4px 0 16px;
  .parameterSelect {
    width: 100%;
    min-width: 0;
    .chipLabel { color: var(--el-text-color-secondary); font-size: 12px; }
    :deep(.el-select__wrapper) { min-height: 30px; padding: 5px 10px; border-radius: 8px; background: var(--el-fill-color-light); box-shadow: none; font-size: 12px; }
    :deep(.el-select__wrapper.is-focused) { box-shadow: 0 0 0 1px var(--el-border-color) inset; }
  }
  .parameterChip {
    display: inline-flex; align-items: center; gap: 6px;
    width: 100%; min-width: 0; min-height: 30px; padding: 5px 10px; box-sizing: border-box;
    border: 1px solid transparent; border-radius: 8px;
    background: var(--el-fill-color-light); color: var(--el-text-color-regular); font: inherit; font-size: 12px;
    cursor: pointer; user-select: none;
    &:hover, &:focus-visible { background: var(--el-fill-color-light); border-color: var(--el-border-color); }
    &:disabled { opacity: .5; cursor: not-allowed; }
    .chipLabel { flex-shrink: 0; color: var(--el-text-color-secondary); }
    .chipValue { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
    svg { flex-shrink: 0; }
  }
}
@container (max-width: 520px) {
  .audioWriting { grid-template-columns: minmax(0, 1fr); }
}
.parameterEditor {
  display: grid; gap: 10px;
  .editorLabel { color: var(--el-text-color-secondary); font-size: 12px; }
  .el-input-number, .el-select { width: 100%; }
}
</style>
