<template>
  <div class="builtinInstructions">
    <el-alert v-if="error" :title="error" type="error" :closable="false" showIcon />
    <template v-if="selectedInstruction">
      <header class="instructionToolbar">
        <el-button text :icon="IconArrowLeft" :disabled="saving" @click="backToGrid">返回列表</el-button>
        <h3 :id="editorId">{{ selectedInstruction.label }}</h3>
        <div class="instructionActions">
          <el-popover placement="bottom-end" trigger="click" :width="280">
            <template #reference>
              <el-button text :icon="IconInfoCircle" title="提示词说明" aria-label="提示词说明" />
            </template>
            <div class="instructionHelp">
              <p>{{ selectedInstruction.description }}</p>
              <p>{{ selectedInstruction.help }}</p>
              <p>返回、切换分类或关闭时自动保存。</p>
            </div>
          </el-popover>
          <el-button text :disabled="saving || !loaded || content === selectedInstruction.defaultContent" @click="content = selectedInstruction.defaultContent">恢复默认</el-button>
          <el-button text type="primary" :icon="IconCheck" :loading="saving" :disabled="!loaded || !dirty || !content.trim()" @click="save">保存</el-button>
        </div>
      </header>
      <el-input v-model="content" type="textarea" class="instructionInput" :maxlength="16000" :spellcheck="false" resize="none" :disabled="saving || !loaded" :aria-labelledby="editorId" />
      <span v-if="dirty || saving" class="instructionStatus" role="status">{{ saving ? "正在保存…" : "有未保存的修改" }}</span>
    </template>
    <slot v-else :cards="cards" :selectInstruction="selectInstruction" />
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { IconArrowLeft, IconCheck, IconInfoCircle } from "@tabler/icons-vue";
import { translate } from "@toonflow/i18n/vue";
import { defaultImagePromptInstruction, imagePromptInstructionId, readImagePromptInstruction } from "@toonflow/node-text/imagePromptInstruction";
import { imagePromptPresets, imagePromptPresetColumns, readImagePresetPrompt } from "@toonflow/node-image-generation/promptPresets";
import { defaultOutpaintPromptInstruction, outpaintPromptInstructionId, readOutpaintPromptInstruction } from "@toonflow/node-image/imageOutpaint";
import { comicScriptInstructionId, scriptSystemPrompt, readComicScriptInstruction } from "@/pages/infiniteComic/comicProject";
import { saveSettings, settings } from "@/stores/settings";

const props = defineProps<{ section: "text" | "image" | "comic"; search: string }>();
const editorId = useId();
type Instruction = { id: string; label: string; description: string; help: string; defaultContent: string; read: (stores: unknown) => string; group?: string };
const textInstructions: Instruction[] = [{
  id: imagePromptInstructionId,
  label: translate("图片反推提示词"),
  description: translate("分析参考图片，生成可直接用于绘图的提示词。"),
  help: translate("保存后，在文本节点点击“图片反推提示词”，上传参考图片并点击生成，即会使用此指令。已进入反推模式的节点，下次生成也会使用最新保存内容。"),
  defaultContent: defaultImagePromptInstruction,
  read: readImagePromptInstruction,
}];
const imageInstructions: Instruction[] = [...imagePromptPresets
  .filter(preset => !("mode" in preset))
  .map(preset => ({
    id: preset.id,
    label: preset.label,
    description: preset.description,
    help: translate("保存后，含对应预设标签的节点下次生成会使用最新提示词，并保留标签后补充的文字。"),
    defaultContent: readImagePresetPrompt(undefined, preset.id),
    read: (stores: unknown) => readImagePresetPrompt(stores, preset.id),
    group: preset.group,
  })), {
    id: outpaintPromptInstructionId,
    label: translate("扩图提示词"),
    description: translate("扩图时自动使用的默认指令，不显示在扩图输入框中。"),
    help: translate("保存后，两个图片节点下次扩图会使用最新指令。扩图输入框仅用于填写补充要求，可以留空；画布尺寸与原图位置由程序自动附加。"),
    defaultContent: defaultOutpaintPromptInstruction,
    read: readOutpaintPromptInstruction,
    group: "空间与机位",
  }];
const comicInstructions: Instruction[] = [{
  id: comicScriptInstructionId,
  label: translate("漫画脚本提示词"),
  description: translate("用于第一步生成分页脚本和分格画面描述。"),
  help: translate("可调整编剧和分镜要求。请保留 JSON 输出格式（pages、number、script、description），以便程序读取草稿。"),
  defaultContent: scriptSystemPrompt,
  read: readComicScriptInstruction,
}];
const instructions = computed(() => {
  if (props.section === "comic") return comicInstructions;
  if (props.section === "image") return imagePromptPresetColumns.flat().flatMap(group => imageInstructions.filter(item => item.group === group));
  return textInstructions;
});
const cards = computed(() => {
  const query = props.search.trim().toLowerCase();
  return instructions.value.flatMap(item => {
    let preview: string;
    try {
      preview = item.read(settings.value.stores);
    } catch {
      preview = translate("读取内置指令失败");
    }
    if (!item.label.toLowerCase().includes(query) && !preview.toLowerCase().includes(query)) return [];
    return [{ id: item.id, label: item.label, preview }];
  });
});
const selectedInstruction = ref<Instruction>();
const content = ref("");
const original = ref("");
const error = ref("");
const saving = ref(false);
const loaded = ref(false);
const dirty = computed(() => loaded.value && content.value !== original.value);
watch(content, () => {
  if (loaded.value && !saving.value) error.value = "";
}, { flush: "sync" });

function selectInstruction(id: string) {
  const instruction = instructions.value.find(item => item.id === id);
  if (!instruction) return;
  selectedInstruction.value = instruction;
  loaded.value = false;
  error.value = "";
  content.value = original.value = "";
  try {
    content.value = original.value = instruction.read(settings.value.stores);
    loaded.value = true;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : translate("读取内置指令失败");
  }
}
async function backToGrid() {
  if (!await save()) return;
  loaded.value = false;
  error.value = "";
  selectedInstruction.value = undefined;
}

async function save(): Promise<boolean> {
  if (saving.value) return false;
  const instruction = selectedInstruction.value;
  if (!instruction || !dirty.value) return true;
  if (!content.value.trim() || content.value.length > 16000) {
    error.value = translate("请输入 1–16000 字符的指令，当前修改已保留");
    return false;
  }
  const next = content.value;
  const expected = original.value;
  saving.value = true;
  error.value = "";
  try {
    await saveSettings(current => {
      if (instruction.read(current.stores) !== expected) throw new Error(translate("指令已被其他页面修改，请先复制保留当前内容后重新打开"));
      const stores = current.stores as Record<string, unknown> | undefined;
      return { stores: { ...stores, nodeInstructions: {
        ...(stores?.nodeInstructions as Record<string, unknown> | undefined),
        [instruction.id]: next,
      } } };
    });
    original.value = next;
    return true;
  } catch (failure) {
    error.value = axios.isAxiosError(failure) && failure.response?.status === 409
      ? translate("设置已被其他页面修改，请先复制保留当前内容，刷新后重试")
      : failure instanceof Error ? failure.message : translate("保存内置指令失败");
    return false;
  } finally { saving.value = false; }
}

function beforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}
watch([dirty, saving], ([changed, pending]) => {
  window.removeEventListener("beforeunload", beforeUnload);
  if (changed || pending) window.addEventListener("beforeunload", beforeUnload);
});
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
defineExpose({ saveBeforeLeaving: save });
</script>

<style scoped lang="scss">
.builtinInstructions {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  gap: 14px;
  > :deep(.el-alert) { flex-shrink: 0; }
  .instructionToolbar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    h3 { min-width: 0; margin: 0; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
    .instructionActions { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-inline-start: auto; }
    :deep(.el-button) { margin: 0; padding: 0 8px; border-radius: 8px; }
  }
  .instructionInput {
    flex: 1;
    min-height: 0;
    :deep(.el-textarea__inner) {
      height: 100%;
      padding: 14px 16px;
      border-radius: 12px;
      background: var(--el-fill-color-light);
      box-shadow: none;
      line-height: 1.8;
      &:focus { box-shadow: inset 0 0 0 1px var(--el-color-primary); }
    }
  }
  .instructionStatus { flex-shrink: 0; color: var(--el-text-color-secondary); font-size: 12px; }
}
.instructionHelp {
  color: var(--el-text-color-secondary);
  line-height: 1.6;
  p { margin: 0; }
  p + p { margin-top: 8px; }
}
</style>
