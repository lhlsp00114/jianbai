<template>
  <div class="builtinInstructions">
    <el-alert v-if="error" :title="error" type="error" :closable="false" showIcon />
    <div v-if="!comic" class="instructionMode">
      <span class="modeLabel">节点类型</span>
      <el-segmented :modelValue="nodeType" class="modeSwitch" :options="nodeTypeOptions" :disabled="saving" block aria-label="节点类型" @change="selectNodeType" />
    </div>
    <div class="instructionLayout">
      <aside class="instructionInfo">
        <nav class="instructionList" aria-label="内置指令列表">
          <template v-for="group in instructionGroups" :key="group.label">
            <span v-if="group.label" class="groupLabel">{{ group.label }}</span>
            <button v-for="item in group.items" :key="item.id" type="button" :class="{ selected: selectedId === item.id }" :aria-pressed="selectedId === item.id" :disabled="saving" @click="selectInstruction(item.id)"><component v-if="item.icon" :is="item.icon" :size="16" aria-hidden="true" />{{ item.label }}</button>
          </template>
        </nav>
      </aside>
      <section class="instructionEditor">
        <header class="instructionHeading">
          <div>
            <span class="nodeLabel">{{ selectedInstruction.nodeLabel }}</span>
            <h3>{{ selectedInstruction.label }}</h3>
          </div>
          <label :for="editorId">{{ comic || nodeType === "image" ? "内置提示词" : "内置生成指令" }}</label>
        </header>
        <div class="instructionDescription">
          <p>{{ selectedInstruction.description }}</p>
          <p>{{ selectedInstruction.help }}</p>
        </div>
        <el-input :id="editorId" v-model="content" type="textarea" class="instructionInput" :maxlength="16000" :spellcheck="false" resize="none" :disabled="saving || !loaded" :aria-label="selectedInstruction.label" />
      </section>
    </div>
    <footer class="instructionActions">
      <el-button :disabled="saving || !loaded || content === selectedInstruction.defaultContent" @click="content = selectedInstruction.defaultContent">恢复默认</el-button>
      <span role="status">{{ saving ? "正在保存…" : "切换分类或关闭时自动保存，下次生成生效" }}</span>
      <el-button type="primary" :loading="saving" :disabled="!loaded || !dirty || !content.trim()" @click="save">保存</el-button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, onBeforeUnmount, ref, useId, watch, type Component } from "vue";
import { translate } from "@toonflow/i18n/vue";
import { defaultImagePromptInstruction, imagePromptInstructionId, readImagePromptInstruction } from "@toonflow/node-text/imagePromptInstruction";
import { imagePromptPresets, imagePromptPresetColumns, readImagePresetPrompt } from "@toonflow/node-image-generation/promptPresets";
import { defaultOutpaintPromptInstruction, outpaintPromptInstructionId, readOutpaintPromptInstruction } from "@toonflow/node-image/imageOutpaint";
import { comicScriptInstructionId, scriptSystemPrompt, readComicScriptInstruction } from "@/pages/infiniteComic/comicProject";
import { saveSettings, settings } from "@/stores/settings";

const props = defineProps<{ comic?: boolean }>();
const editorId = useId();
type Instruction = { id: string; label: string; nodeLabel: string; description: string; help: string; defaultContent: string; read: (stores: unknown) => string; group?: string; icon?: Component };
type NodeType = "text" | "image";
const nodeType = ref<NodeType>("text");
const nodeTypeOptions = [
  { value: "text", label: "文本节点" },
  { value: "image", label: "图片生成节点" },
];
const textInstructions: Instruction[] = [{
  id: imagePromptInstructionId,
  label: translate("图片反推提示词"),
  nodeLabel: translate("文本节点"),
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
    nodeLabel: translate("图片生成节点"),
    description: preset.description,
    help: translate("保存后，含对应预设标签的节点下次生成会使用最新提示词，并保留标签后补充的文字。"),
    defaultContent: readImagePresetPrompt(undefined, preset.id),
    read: (stores: unknown) => readImagePresetPrompt(stores, preset.id),
    group: preset.group,
    icon: preset.icon,
  })), {
    id: outpaintPromptInstructionId,
    label: translate("扩图提示词"),
    nodeLabel: translate("图片节点 / 图片生成节点"),
    description: translate("扩图时自动使用的默认指令，不显示在扩图输入框中。"),
    help: translate("保存后，两个图片节点下次扩图会使用最新指令。扩图输入框仅用于填写补充要求，可以留空；画布尺寸与原图位置由程序自动附加。"),
    defaultContent: defaultOutpaintPromptInstruction,
    read: readOutpaintPromptInstruction,
    group: "空间与机位",
  }];
const comicInstructions: Instruction[] = [{
  id: comicScriptInstructionId,
  label: translate("漫画脚本提示词"),
  nodeLabel: translate("AI 漫画创作"),
  description: translate("用于第一步生成分页脚本和分格画面描述。"),
  help: translate("可调整编剧和分镜要求。请保留 JSON 输出格式（pages、number、script、description），以便程序读取草稿。"),
  defaultContent: scriptSystemPrompt,
  read: readComicScriptInstruction,
}];
const instructions = computed(() => {
  if (props.comic) return comicInstructions;
  return nodeType.value === "image" ? imageInstructions : textInstructions;
});
const instructionGroups = computed(() => nodeType.value === "image"
  ? imagePromptPresetColumns.flat().map(label => ({ label, items: instructions.value.filter(item => item.group === label) })).filter(group => group.items.length)
  : [{ label: "", items: instructions.value }]);
const selectedId = ref(instructions.value[0].id);
const selectedInstruction = computed(() => instructions.value.find(item => item.id === selectedId.value) ?? instructions.value[0]);
const content = ref("");
const original = ref("");
const error = ref("");
const saving = ref(false);
const loaded = ref(false);
const dirty = computed(() => loaded.value && content.value !== original.value);
watch(content, () => {
  if (loaded.value && !saving.value) error.value = "";
}, { flush: "sync" });

function loadInstruction() {
  loaded.value = false;
  error.value = "";
  content.value = original.value = "";
  try {
    content.value = original.value = selectedInstruction.value.read(settings.value.stores);
    loaded.value = true;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : translate("读取内置指令失败");
  }
}
loadInstruction();

async function selectNodeType(value: string | number) {
  const next = String(value) as NodeType;
  if (next === nodeType.value || !await save()) return;
  nodeType.value = next;
  selectedId.value = instructions.value[0].id;
  loadInstruction();
}

async function selectInstruction(id: string) {
  if (id === selectedId.value || !await save()) return;
  selectedId.value = id;
  loadInstruction();
}

async function save(): Promise<boolean> {
  if (saving.value) return false;
  if (!dirty.value) return true;
  if (!content.value.trim() || content.value.length > 16000) {
    error.value = translate("请输入 1–16000 字符的指令，当前修改已保留");
    return false;
  }
  const next = content.value;
  const expected = original.value;
  const instruction = selectedInstruction.value;
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
  gap: 16px;
  > :deep(.el-alert) { flex-shrink: 0; }
  .instructionMode {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--ui-radius-small);
    background: var(--el-fill-color-light);
    .modeLabel { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 600; }
    .modeSwitch { width: min(100%, 360px); }
  }
  .instructionLayout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    flex: 1;
    min-height: 0;
    gap: 24px;
    .instructionInfo {
      min-width: 0;
      overflow-y: auto;
      padding: 12px;
      border: 1px solid var(--el-border-color-lighter);
      border-radius: var(--ui-radius-small);
      .instructionList {
        display: flex;
        flex-direction: column;
        gap: 6px;
        .groupLabel { margin: 12px 12px 4px; color: var(--el-text-color-secondary); font-size: 12px; }
        button {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          min-width: 0;
          padding: 9px 10px;
          border: 1px solid transparent;
          border-radius: var(--ui-radius-small);
          background: transparent;
          color: var(--el-text-color-regular);
          font: inherit;
          text-align: left;
          cursor: pointer;
          &:hover, &.selected { background: var(--el-fill-color-light); color: var(--el-color-primary); }
          &.selected { border-color: var(--el-border-color); }
          &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
          &:disabled { cursor: default; }
          svg { flex-shrink: 0; }
        }
      }
    }
    .instructionEditor {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      gap: 10px;
      .instructionHeading {
        display: flex;
        flex-shrink: 0;
        align-items: end;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px 16px;
        .nodeLabel { color: var(--el-text-color-secondary); font-size: 12px; }
        h3 { margin: 4px 0 0; font-size: 16px; }
        label { font-weight: 600; }
      }
      .instructionDescription {
        flex-shrink: 0;
        padding: 10px 12px;
        border-left: 2px solid var(--el-color-primary);
        background: var(--el-fill-color-light);
        p { margin: 0; color: var(--el-text-color-secondary); line-height: 1.6; }
        p + p { margin-top: 4px; font-size: 12px; }
      }
      .instructionInput { flex: 1; min-height: 0; :deep(.el-textarea__inner) { height: 100%; padding: 14px; line-height: 1.8; } }
    }
  }
  .instructionActions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    border-top: 1px solid var(--el-border-color-lighter);
    padding-top: 12px;
    span { flex: 1; color: var(--el-text-color-secondary); font-size: 12px; }
    :deep(.el-button) { margin: 0; }
  }
  @media (max-width: 640px) {
    .instructionMode {
      align-items: stretch;
      flex-direction: column;
      gap: 8px;
      .modeSwitch { width: 100%; }
    }
    .instructionLayout {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: 120px minmax(0, 1fr);
      gap: 12px;
    }
  }
}
</style>
