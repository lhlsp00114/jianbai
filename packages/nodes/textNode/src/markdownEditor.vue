<template>
  <section class="nodeMarkdownEditor" :class="{ compact }">
    <teleport :to="toolbarTarget || 'body'" :disabled="!toolbarTarget">
      <div v-if="compact && toolbarVisible" class="compactToolbar" role="toolbar" aria-label="文本格式工具" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop @keydown.esc.stop="colorOpen = false">
        <div ref="colorPicker" class="colorPicker">
          <button type="button" class="colorButton" title="节点颜色" aria-label="节点颜色" :aria-expanded="colorOpen" :disabled="locked" @mousedown.prevent @click.stop="colorOpen = !colorOpen"><span :style="{ background: selectedBackgroundSwatch }" /></button>
          <div v-if="colorOpen" class="colorPanel" role="dialog" aria-label="节点颜色" @pointerdown.stop @mousedown.stop @click.stop>
            <div class="nodeColors" role="group" aria-label="节点颜色"><button v-for="color in backgroundColors" :key="color.value" type="button" :title="color.label" :aria-label="color.label" :aria-pressed="(backgroundColor || '') === color.value" :disabled="locked" :style="{ '--colorSwatch': color.swatch }" @mousedown.prevent @click="selectBackgroundColor(color.value)"><span :class="{ noColor: !color.value }">{{ (backgroundColor || '') === color.value ? '✓' : '' }}</span></button></div>
          </div>
        </div>
        <span class="toolDivider" />
        <el-dropdown trigger="click" :disabled="locked || !editable || !ready" @command="setTextStyle">
          <button type="button" class="textStyleButton" :disabled="locked || !editable || !ready" aria-label="正文或标题" @mousedown.prevent><icon-letter-t :size="19" />{{ formatState.heading ? '标题 ' + formatState.heading : '正文' }}<icon-chevron-down :size="12" /></button>
          <template #dropdown><el-dropdown-menu><el-dropdown-item :command="0">正文</el-dropdown-item><el-dropdown-item v-for="level in [1, 2, 3]" :key="level" :command="level">标题 {{ level }}</el-dropdown-item></el-dropdown-menu></template>
        </el-dropdown>
        <span class="toolDivider" />
        <button type="button" :class="{ active: formatState.bold }" :aria-pressed="formatState.bold" :disabled="locked || !editable || !ready" title="加粗" aria-label="加粗" @mousedown.prevent @click="run('bold')"><icon-bold :size="19" /></button>
        <button type="button" :class="{ active: formatState.italic }" :aria-pressed="formatState.italic" :disabled="locked || !editable || !ready" title="斜体" aria-label="斜体" @mousedown.prevent @click="run('italic')"><icon-italic :size="19" /></button>
        <span class="toolDivider" />
        <button type="button" :disabled="locked || !editable || !ready" title="分隔线" aria-label="插入分隔线" @mousedown.prevent @click="run('divider')"><icon-minus :size="19" /></button>
        <template v-if="expandable"><span class="toolDivider" /><button type="button" title="展开编辑" aria-label="展开编辑" @mousedown.prevent @click="emit('expand')"><icon-arrows-maximize :size="18" /></button><a class="downloadButton" :href="downloadUrl || undefined" :download="downloadName" :aria-disabled="!downloadUrl" :tabindex="downloadUrl ? 0 : -1" title="下载文本" aria-label="下载文本"><icon-download :size="18" /></a></template>
      </div>
    </teleport>
    <div v-if="!compact" class="editorToolbar" role="toolbar" aria-label="Markdown 编辑工具">
      <div class="toolbarGroup">
        <el-button class="toolButton" :class="{ active: editor?.isActive('heading') }" text :disabled="locked || sourceMode || !ready" title="标题" aria-label="标题" :aria-pressed="!!editor?.isActive('heading')" @mousedown.prevent @click="run('heading')"><icon-heading :size="17" /></el-button>
        <el-button class="toolButton" :class="{ active: editor?.isActive('bold') }" text :disabled="locked || sourceMode || !ready" title="加粗" aria-label="加粗" :aria-pressed="!!editor?.isActive('bold')" @mousedown.prevent @click="run('bold')"><icon-bold :size="17" /></el-button>
        <el-button class="toolButton" :class="{ active: editor?.isActive('italic') }" text :disabled="locked || sourceMode || !ready" title="斜体" aria-label="斜体" :aria-pressed="!!editor?.isActive('italic')" @mousedown.prevent @click="run('italic')"><icon-italic :size="17" /></el-button>
        <el-button class="toolButton" :class="{ active: editor?.isActive('bulletList') }" text :disabled="locked || sourceMode || !ready" title="列表" aria-label="列表" :aria-pressed="!!editor?.isActive('bulletList')" @mousedown.prevent @click="run('list')"><icon-list :size="17" /></el-button>
      </div>
      <div class="toolbarGroup">
        <el-button class="toolButton" text :disabled="locked || sourceMode || !editor?.can().undo()" title="撤销" aria-label="撤销" @mousedown.prevent @click="run('undo')"><icon-arrow-back-up :size="17" /></el-button>
        <el-button class="toolButton" text :disabled="locked || sourceMode || !editor?.can().redo()" title="重做" aria-label="重做" @mousedown.prevent @click="run('redo')"><icon-arrow-forward-up :size="17" /></el-button>
      </div>
      <span class="toolbarSpacer" />
      <div class="toolbarGroup">
        <el-button class="toolButton" text title="复制正文" aria-label="复制正文" @click="copyText"><icon-copy :size="17" /></el-button>
        <el-button class="toolButton" :class="{ active: sourceMode }" text :title="sourceMode ? '富文本' : '原文'" :aria-label="sourceMode ? '切换到富文本' : '切换到原文'" :aria-pressed="sourceMode" @click="sourceMode = !sourceMode"><component :is="sourceMode ? IconFileText : IconFileCode" :size="17" /></el-button>
      </div>
    </div>
    <p v-if="error" class="editorError" role="alert">{{ error }}</p>
    <textarea v-if="sourceMode" class="sourceEditor" :value="modelValue" :readonly="readonly || !editable" :disabled="disabled" :aria-label="ariaLabel || '编辑 Markdown 原文'" spellcheck="false" @input="updateSource" />
    <editor-content v-if="editor && !sourceMode" :editor="editor" class="richHost" :class="{ readOnlyContent: !editable }" />
    <p v-if="!compact" class="editorHint">富文本会规范化 Markdown；保留原始 HTML 写法请使用原文。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { Editor, EditorContent } from "@tiptap/vue-3";
import { ElButton, ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus";
import { IconHeading, IconBold, IconItalic, IconList, IconArrowBackUp, IconArrowForwardUp, IconCopy, IconFileCode, IconFileText, IconLetterT, IconChevronDown, IconMinus, IconArrowsMaximize, IconDownload } from "@tabler/icons-vue";
import type { MarkdownProps } from "./markdownContent";
import markdownExtensions, { parseMarkdownContent, serializeMarkdown } from "./markdownExtensions";

const props = withDefaults(defineProps<MarkdownProps & { compact?: boolean; toolbarTarget?: HTMLElement; toolbarVisible?: boolean; backgroundColor?: string; expandable?: boolean; downloadUrl?: string; downloadName?: string; contentEditable?: boolean }>(), { active: true, toolbarVisible: true, contentEditable: true });
const emit = defineEmits<{ "update:modelValue": [value: string]; "update:backgroundColor": [value: string]; expand: [] }>();
const sourceMode = ref(false);
const colorOpen = ref(false);
const colorPicker = ref<HTMLElement>();
const editor = shallowRef<Editor>();
const ready = computed(() => !!editor.value);
const error = ref("");
const locked = computed(() => !!(props.disabled || props.readonly));
const editable = computed(() => !locked.value && props.contentEditable !== false);
const editorRevision = ref(0);
const formatState = computed(() => {
  void editorRevision.value;
  return { heading: [1, 2, 3].find(level => editor.value?.isActive("heading", { level })), bold: !!editor.value?.isActive("bold"), italic: !!editor.value?.isActive("italic") };
});
const backgroundColors = [
  { label: "清除颜色", value: "", swatch: "transparent" },
  { label: "红色", value: "#382124", swatch: "#f04438" },
  { label: "橙色", value: "#46301c", swatch: "#f28c28" },
  { label: "黄色", value: "#453b1b", swatch: "#f5bd3f" },
  { label: "绿色", value: "#1d3a2a", swatch: "#2dcc75" },
  { label: "青色", value: "#1b3b43", swatch: "#08b8d4" },
  { label: "蓝色", value: "#24385d", swatch: "#4389f5" },
  { label: "紫色", value: "#38264f", swatch: "#9258ed" },
  { label: "粉色", value: "#48233b", swatch: "#ed3d91" },
  { label: "灰色", value: "#3d3d3d", swatch: "#858585" },
];
const selectedBackgroundSwatch = computed(() => backgroundColors.find(color => color.value === props.backgroundColor)?.swatch || "linear-gradient(135deg, #777 0 48%, #bbb 48% 52%, #777 52%)");
let lastMarkdown = "";

function selectBackgroundColor(value: string) {
  if (locked.value || !props.active) return;
  emit("update:backgroundColor", value);
  colorOpen.value = false;
}

function closeColorPicker(event: PointerEvent) {
  if (!(event.target instanceof Node) || !colorPicker.value?.contains(event.target)) colorOpen.value = false;
}

function destroyEditor() {
  editor.value?.destroy();
  editor.value = undefined;
}

watch(colorOpen, value => {
  if (value) document.addEventListener("pointerdown", closeColorPicker, true);
  else document.removeEventListener("pointerdown", closeColorPicker, true);
});
watch(() => props.active, value => { if (!value) colorOpen.value = false; });
watch(() => props.toolbarVisible, value => { if (!value) colorOpen.value = false; });
onBeforeUnmount(() => document.removeEventListener("pointerdown", closeColorPicker, true));
function rebuild() {
  destroyEditor();
  if (!props.active || sourceMode.value) return;
  error.value = "";
  try {
    lastMarkdown = props.modelValue;
    editor.value = new Editor({
      extensions: markdownExtensions({ files: props.files, resource: { path: props.path || "" } }),
      content: parseMarkdownContent(props.modelValue),
      editable: editable.value,
      onTransaction() { editorRevision.value++; },
      editorProps: {
        attributes: { class: "textNodeMarkdown", "aria-label": props.ariaLabel || "编辑文本内容", role: "textbox", "aria-multiline": "true" },
        transformPastedHTML: parseMarkdownContent,
        handlePaste(_view, event) {
          const current = editor.value;
          const clipboard = event.clipboardData;
          if (!current || !editable.value || !props.active || current.isActive("codeBlock") || clipboard?.getData("text/html")) return false;
          const text = clipboard?.getData("text/markdown") || clipboard?.getData("text/plain");
          return !!text && current.commands.insertContent(parseMarkdownContent(text));
        },
      },
      onUpdate({ editor: current }) {
        if (!props.active || sourceMode.value) return;
        lastMarkdown = serializeMarkdown(current);
        // 同步更新节点输出，关闭弹窗或保存画布时不等待防抖回调。
        emit("update:modelValue", lastMarkdown);
      },
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "编辑器加载失败，可切换原文继续编辑";
  }
}

watch([() => props.active, sourceMode, () => props.files, () => props.path], rebuild, { immediate: true, flush: "post" });
watch(() => props.modelValue, value => {
  if (!editor.value || !props.active || value === lastMarkdown) return;
  try {
    editor.value.commands.setContent(parseMarkdownContent(value), { emitUpdate: false });
    lastMarkdown = value;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "正文更新失败"; }
});
watch(editable, value => editor.value?.setEditable(value, false));
onBeforeUnmount(destroyEditor);

function setTextStyle(level: number) {
  if (!editor.value || !editable.value || !props.active) return;
  if (level === 0) editor.value.chain().focus().setParagraph().run();
  else if (level === 1 || level === 2 || level === 3) editor.value.chain().focus().setHeading({ level }).run();
}
defineExpose({ focus: () => editor.value?.commands.focus(), blur: () => editor.value?.commands.blur() });
function run(action: "heading" | "bold" | "italic" | "list" | "undo" | "redo" | "divider") {
  if (!editor.value || !editable.value || !props.active) return;
  const chain = editor.value.chain().focus();
  if (action === "heading") chain.toggleHeading({ level: 2 }).run();
  else if (action === "bold") chain.toggleBold().run();
  else if (action === "italic") chain.toggleItalic().run();
  else if (action === "list") chain.toggleBulletList().run();
  else if (action === "divider") chain.setHorizontalRule().run();
  else if (action === "undo") chain.undo().run();
  else chain.redo().run();
}
function updateSource(event: Event) {
  if (!locked.value && editable.value && props.active) emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
}
async function copyText() {
  try {
    if (props.writeClipboardText) await props.writeClipboardText(props.modelValue);
    else await navigator.clipboard.writeText(props.modelValue);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "复制失败，请在原文中选择并复制"; }
}
</script>

<style scoped lang="scss">
.nodeMarkdownEditor {
  display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden;
  .editorToolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px 0 8px; flex-shrink: 0;
    .toolbarGroup { display: flex; align-items: center; gap: 2px;
      + .toolbarGroup { margin-left: 4px; padding-left: 8px; border-left: 1px solid var(--el-border-color-lighter); }
      .toolButton { width: 30px; height: 30px; margin-left: 0; padding: 0; border-radius: 6px;
        &.active { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
      }
    }
    .toolbarSpacer { flex: 1; }
  }
  .editorError { flex-shrink: 0; margin: 0 0 6px; color: var(--el-color-danger); }
  .sourceEditor { flex: 1; min-height: 0; width: 100%; box-sizing: border-box; resize: none; padding: 12px; border: 1px solid var(--el-border-color); color: var(--el-text-color-primary); background: var(--el-bg-color); font: 14px/1.8 Consolas, monospace; cursor: text; }
  .richHost { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--el-border-color); overscroll-behavior: contain; cursor: text;
    :deep(.ProseMirror) { min-height: 180px; padding: 12px 16px; outline: none; white-space: pre-wrap; word-break: break-word; cursor: text; }
    :deep(.ProseMirror-selectednode) { outline: 2px solid var(--el-color-primary); }
    &.readOnlyContent, &.readOnlyContent :deep(.ProseMirror) { cursor: grab; }
  }
  .editorHint { flex-shrink: 0; margin: 6px 0 0; color: var(--el-text-color-secondary); font-size: 11px; }
  &.compact {
    .richHost { border: 0; :deep(.ProseMirror) { box-sizing: border-box; min-height: 100%; padding: 12px; user-select: text; } }
  }
}
.compactToolbar {
  position: relative; display: flex; align-items: center; flex-shrink: 0; gap: 3px; padding: 5px; border: 1px solid var(--el-border-color); border-radius: 12px; background: var(--el-bg-color-overlay); box-shadow: 0 4px 16px #0002; cursor: default;
  button { display: inline-flex; justify-content: center; align-items: center; gap: 5px; height: 32px; min-width: 30px; padding: 0 6px; border: 0; border-radius: 7px; color: var(--el-text-color-primary); background: transparent; font: inherit; font-size: 13px; cursor: pointer;
    &:hover, &.active { background: var(--el-fill-color); }
    &.active { color: var(--el-color-primary); }
    &:disabled { opacity: .45; cursor: default; }
    &:focus-visible { outline: 2px solid var(--el-color-primary); }
  }
  .downloadButton { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 32px; border-radius: 7px; color: var(--el-text-color-primary); text-decoration: none; &:hover { background: var(--el-fill-color); } &[aria-disabled="true"] { opacity: .4; pointer-events: none; } }
  .colorPicker { position: relative; }
  .colorButton span { width: 18px; height: 18px; border: 1px solid #ffffff40; border-radius: 50%; }
  .toolDivider { height: 18px; width: 1px; margin: 0 3px; background: var(--el-border-color); }
}
.colorPanel { position: absolute; z-index: 10; top: calc(100% + 8px); left: 0; padding: 8px; border: 1px solid var(--el-border-color-light); border-radius: 12px; background: var(--el-bg-color-overlay); box-shadow: 0 8px 24px #0006; }
.nodeColors { display: grid; grid-template-columns: repeat(5, 28px); gap: 8px; padding: 2px; button { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; &:focus-visible { outline: 2px solid var(--el-color-primary); } &[aria-pressed="true"] { outline: 2px solid var(--el-color-primary); outline-offset: 2px; } span { display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid #ffffff30; border-radius: 50%; background: var(--colorSwatch); color: #fff; font-size: 13px; } .noColor { position: relative; background: var(--el-fill-color); &::after { position: absolute; width: 26px; height: 1px; background: var(--el-color-danger); content: ""; transform: rotate(-45deg); } } } }
</style>
