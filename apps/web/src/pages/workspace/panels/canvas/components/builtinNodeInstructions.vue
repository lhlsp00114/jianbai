<template>
  <div class="builtinInstructions">
    <el-alert v-if="error" :title="error" type="error" :closable="false" showIcon />
    <div class="instructionLayout">
      <aside class="instructionInfo">
        <span class="nodeLabel">文本节点</span>
        <h3>图片反推提示词</h3>
        <p>分析参考图片，生成可直接用于绘图的提示词。</p>
        <p>保存后，在文本节点点击“图片反推提示词”，上传参考图片并点击生成，即会使用此指令。已进入反推模式的节点，下次生成也会使用最新保存内容。</p>
      </aside>
      <section class="instructionEditor">
        <label :for="editorId">内置生成指令</label>
        <el-input :id="editorId" v-model="content" type="textarea" class="instructionInput" :maxlength="16000" :spellcheck="false" resize="none" :disabled="saving || !loaded" aria-label="图片反推生成指令" />
      </section>
    </div>
    <footer class="instructionActions">
      <el-button :disabled="saving || !loaded || content === defaultImagePromptInstruction" @click="content = defaultImagePromptInstruction">恢复默认</el-button>
      <span role="status">{{ saving ? "正在保存…" : "切换分类或关闭时自动保存，下次生成生效" }}</span>
      <el-button type="primary" :loading="saving" :disabled="!loaded || !dirty || !content.trim()" @click="save">保存</el-button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { translate } from "@toonflow/i18n/vue";
import { defaultImagePromptInstruction, imagePromptInstructionId, readImagePromptInstruction } from "@toonflow/node-text/imagePromptInstruction";
import { saveSettings, settings } from "@/stores/settings";

const editorId = useId();
const content = ref("");
const original = ref("");
const error = ref("");
const saving = ref(false);
const loaded = ref(false);
const dirty = computed(() => loaded.value && content.value !== original.value);

try {
  content.value = original.value = readImagePromptInstruction(settings.value.stores);
  loaded.value = true;
} catch (failure) {
  error.value = failure instanceof Error ? failure.message : translate("读取内置节点指令失败");
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
  saving.value = true;
  error.value = "";
  try {
    await saveSettings(current => {
      if (readImagePromptInstruction(current.stores) !== expected) throw new Error(translate("指令已被其他页面修改，请先复制保留当前内容后重新打开"));
      const stores = current.stores as Record<string, unknown> | undefined;
      return { stores: { ...stores, nodeInstructions: {
        ...(stores?.nodeInstructions as Record<string, unknown> | undefined),
        [imagePromptInstructionId]: next,
      } } };
    });
    original.value = next;
    return true;
  } catch (failure) {
    error.value = axios.isAxiosError(failure) && failure.response?.status === 409
      ? translate("设置已被其他页面修改，请先复制保留当前内容，刷新后重试")
      : failure instanceof Error ? failure.message : translate("保存内置节点指令失败");
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
  .instructionLayout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    flex: 1;
    min-height: 0;
    gap: 24px;
    .instructionInfo {
      overflow-y: auto;
      padding: 18px;
      border: 1px solid var(--el-border-color-lighter);
      border-radius: var(--ui-radius-small);
      .nodeLabel { color: var(--el-text-color-secondary); font-size: 12px; }
      h3 { margin: 12px 0; font-size: 16px; }
      p { color: var(--el-text-color-secondary); line-height: 1.7; }
    }
    .instructionEditor {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      gap: 10px;
      label { font-weight: 600; }
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
    .instructionLayout {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: 120px minmax(0, 1fr);
      gap: 12px;
    }
  }
}
</style>
