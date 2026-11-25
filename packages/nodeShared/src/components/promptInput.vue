<template>
  <div class="promptInputWrap nodrag nopan nowheel">
    <el-button v-if="expandable && panelExpanded === undefined" class="expandButton" :icon="IconMaximize" text circle title="展开编辑提示词" aria-label="展开编辑提示词" @mousedown.prevent @click.stop="expanded = true" />
    <teleport :to="expandedTarget || 'body'" :disabled="!expanded || !expandedTarget">
      <div ref="senderElement" class="promptInput chat-area-wrap nodrag nopan nowheel" :class="{ expandedInput: editorExpanded }" @keydown.capture="handleMentionKey" @mousedown.capture="preservePresetCursor" @click.capture="handleTagClick" />
    </teleport>
  </div>
  <el-dialog v-if="expandable && panelExpanded === undefined" v-model="expanded" class="promptEditorDialog" title="生成提示词" width="80%" alignCenter appendToBody :closeOnClickModal="false" @opened="sender?.focus('mark')" @close="expanded = false" @closed="sender?.focus('mark')">
    <div ref="expandedTarget" class="promptExpandedTarget nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop />
  </el-dialog>
  <el-image-viewer v-if="previewUrl" :urlList="[previewUrl]" teleported @close="previewReferenceId = undefined" />
  <teleport :to="mentionTarget || 'body'">
    <promptReferenceMenu
      v-if="mentionVisible"
      ref="mentionMenu"
      :references="references"
      :materials="materials ?? []"
      :query="mentionQuery"
      :anchor="mentionAnchor"
      :zIndex="mentionZIndex"
      :busy="selectingReference"
      :hasAssetLibrary="!!selectAsset"
      @select="id => chooseReference(() => references.find(item => item.id === id))"
      @selectMaterial="id => chooseReference(() => selectMaterial?.(id))"
      @selectAsset="chooseReference(() => selectAsset?.())"
      @close="dismissMentionMenu" />
  </teleport>
</template>

<script setup lang="ts">
import { computed, h, inject, nextTick, ref, render, watch, type Component, type Ref } from "vue";
import { ElButton, ElDialog, ElImageViewer, ElMessage, useZIndex } from "element-plus";
import { IconMaximize } from "@tabler/icons-vue";
import xSender, { type AnyTagProps, type MentionItem } from "x-sender";
import "x-sender/lib/XSender.css";
import type { MaterialMention, ReferenceMention } from "../useNodeReferences";
import { getPromptText } from "../promptText";
import { useCanvasTextHistory } from "../canvasTextHistory";
import promptReferenceMenu from "./promptReferenceMenu.vue";

type Reference = ReferenceMention;
const props = defineProps<{
  references: Reference[];
  presets?: readonly { id: string; label: string; value: string; icon?: Component; iconColor?: string }[];
  materials?: MaterialMention[];
  selectMaterial?: (id: string) => Promise<Reference | undefined>;
  selectAsset?: () => Promise<Reference | undefined>;
  expandable?: boolean;
  compact?: boolean;
  highlightImageMentions?: boolean;
  highlightVideoMentions?: boolean;
  placeholder?: string;
}>();
const model = defineModel<AnyTagProps[][]>({ required: true });
const text = defineModel<string>("text", { default: "" });
const senderElement = ref<HTMLElement>();
const registerTextHistory = useCanvasTextHistory();
const expanded = ref(false);
const panelExpanded = inject<Ref<boolean> | undefined>("expandedGenerationPrompt", undefined);
const editorExpanded = computed(() => expanded.value || panelExpanded?.value === true);
const inlineHeight = computed(() => props.compact ? { minHeight: "24px", maxHeight: "72px" } : { minHeight: "70px", maxHeight: "180px" });
const expandedTarget = ref<HTMLElement>();
const { nextZIndex } = useZIndex();
const mentionMenu = ref<InstanceType<typeof promptReferenceMenu>>();
const mentionTarget = ref<HTMLElement>();
const mentionVisible = ref(false);
const mentionQuery = ref("");
const mentionAnchor = ref({ left: 0, top: 0, bottom: 0 });
const mentionZIndex = ref(0);
const selectingReference = ref(false);
type MentionCursor = { gridIndex: number; childIndex: number; offset: number; text: string; start: number };
let mentionCursor: MentionCursor | undefined;
const previewReferenceId = ref<string>();
const previewUrl = computed(() => {
  const reference = props.references.find(item => item.id === previewReferenceId.value);
  return reference?.previewable === false ? "" : String(reference?.avatar ?? "");
});
let sender: xSender | undefined;
let resetTask: Promise<void> | undefined;

defineExpose({ insertPreset, insertReferenceAtCursor });

async function insertReferenceAtCursor(id: string) {
  const instance = sender;
  if (!instance || selectingReference.value || instance.chatEditor.isComposition) return;
  selectingReference.value = true;
  try {
    await instance.nextTick();
    if (resetTask) await resetTask;
    const reference = props.references.find(item => item.id === id);
    if (sender !== instance || !reference || reference.disabled || instance.chatEditor.isComposition) return;
    closeMentionMenu();
    instance.bus.emit(xSender.EventSet.EVENT_COMMON_DIALOG_CLOSE);
    instance.focus("mark");
    await instance.setHtml(referenceHtml(reference));
  } finally {
    selectingReference.value = false;
  }
}

async function insertPreset(id: string) {
  const instance = sender;
  const preset = props.presets?.find(item => item.id === id);
  if (!instance || !preset || instance.chatEditor.isComposition) return false;
  await instance.nextTick();
  if (resetTask) await resetTask;
  if (sender !== instance) return false;
  instance.focus("mark");
  if (getPromptText(instance.getModel()).includes(preset.value)) return true;
  await instance.setHtml(presetHtml(preset));
  if (sender !== instance) return false;
  await instance.setText(" ");
  return sender === instance;
}

function closeMentionMenu() {
  mentionVisible.value = false;
}

async function dismissMentionMenu() {
  closeMentionMenu();
  await nextTick();
  sender?.focus("mark");
}

function updateMentionMenu() {
  const instance = sender;
  if (!instance || props.materials === undefined || selectingReference.value || instance.chatEditor.isComposition) return;
  if (document.activeElement && mentionMenu.value?.contains(document.activeElement)) return;
  const selection = instance.getSelection();
  const editor = instance.chatElement.richText;
  if (!selection.isCollapsed || !selection.rangeCount || !editor.contains(selection.focusNode)) return closeMentionMenu();
  const cursor = instance.getCurrentNode();
  if (cursor.instance?.type !== "Write") return closeMentionMenu();
  const before = cursor.instance.text.slice(0, cursor.offset);
  const start = before.lastIndexOf("@");
  if (start < 0 || /\s/.test(before.slice(start + 1))) return closeMentionMenu();
  const gridIndex = instance.chatEditor.NODES.indexOf(cursor.instance.context);
  const childIndex = cursor.instance.context.children.indexOf(cursor.instance);
  if (gridIndex < 0 || childIndex < 0) return closeMentionMenu();
  mentionCursor = { gridIndex, childIndex, offset: cursor.offset, text: cursor.instance.text, start };
  const range = selection.getRangeAt(0);
  const rect = range.getClientRects()[0] ?? editor.getBoundingClientRect();
  mentionAnchor.value = { left: rect.left, top: rect.top, bottom: rect.bottom };
  mentionQuery.value = before.slice(start + 1);
  mentionTarget.value = expanded.value && expandedTarget.value ? expandedTarget.value : editor.closest<HTMLElement>(".el-dialog") ?? document.body;
  if (!mentionVisible.value) mentionZIndex.value = nextZIndex();
  mentionVisible.value = true;
}

async function chooseReference(select: () => Reference | undefined | Promise<Reference | undefined>) {
  const instance = sender;
  const cursor = mentionCursor;
  if (!instance || !cursor || selectingReference.value) return;
  selectingReference.value = true;
  closeMentionMenu();
  try {
    const reference = await select();
    await nextTick();
    await instance.nextTick();
    if (resetTask) await resetTask;
    if (sender !== instance) return;
    const current = instance.chatEditor.NODES[cursor.gridIndex]?.children[cursor.childIndex];
    if (current?.type !== "Write" || current.text !== cursor.text) return;
    current.focus(cursor.offset);
    if (!reference) return;
    const resolved = props.references.find(item => item.id === reference.id);
    if (!resolved || resolved.disabled) return;
    await instance.backspace(cursor.start - cursor.offset);
    if (sender === instance) await instance.setHtml(referenceHtml(resolved));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "引用素材失败");
  } finally {
    selectingReference.value = false;
  }
}

function preservePresetCursor(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest(".promptPreset")) event.preventDefault();
}

function handleTagClick(event: MouseEvent) {
  const preset = event.target instanceof Element ? event.target.closest<HTMLElement>(".promptPreset") : null;
  if (preset && sender) {
    event.preventDefault();
    event.stopPropagation();
    if (sender.chatEditor.isComposition) return;
    const gridIndex = sender.chatEditor.NODES.findIndex(grid => grid.$el.contains(preset));
    const grid = sender.chatEditor.NODES[gridIndex];
    const childIndex = grid?.children.findIndex(child => child.$el.contains(preset)) ?? -1;
    if (childIndex < 0) return;
    if (event.target instanceof Element && event.target.closest(".promptPresetRemove")) {
      const value = sender.getModel();
      value[gridIndex].splice(childIndex, 1);
      syncModel(value);
    } else {
      const next = grid.children[childIndex + 1];
      if (next?.type === "Write") next.focus(0);
    }
    return;
  }
  const tag = event.target instanceof Element ? event.target.closest<HTMLElement>(".imageReference[data-reference-id]") : null;
  const reference = props.references.find(item => item.id === tag?.dataset.referenceId);
  if (!reference?.avatar || reference.previewable === false) return;
  event.preventDefault();
  event.stopPropagation();
  sender?.bus.emit(xSender.EventSet.EVENT_COMMON_DIALOG_CLOSE);
  closeMentionMenu();
  previewReferenceId.value = reference.id;
}

function presetHtml(preset: NonNullable<typeof props.presets>[number]) {
  const tag = document.createElement("span");
  tag.className = "promptPreset";
  tag.dataset.presetId = preset.id;
  tag.dataset.value = preset.value;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "promptPresetRemove";
  if (preset.iconColor) remove.style.backgroundColor = preset.iconColor;
  remove.title = `删除${preset.label}预设提示词`;
  remove.setAttribute("aria-label", remove.title);
  const icon = document.createElement("span");
  icon.className = "promptPresetIcon";
  icon.setAttribute("aria-hidden", "true");
  if (preset.icon) render(h(preset.icon, { size: 14, stroke: 1.8 }), icon);
  else icon.textContent = "✦";
  const close = document.createElement("span");
  close.className = "promptPresetClose";
  close.setAttribute("aria-hidden", "true");
  close.textContent = "×";
  remove.append(icon, close);
  tag.append(remove, document.createTextNode(preset.label));
  const html = tag.outerHTML;
  if (preset.icon) render(null, icon);
  return html;
}

function referenceHtml(reference: Reference) {
  const tag = document.createElement("span");
  tag.className = "imageReference";
  tag.dataset.referenceId = reference.id;
  tag.dataset.value = reference.value;
  tag.title = reference.label || reference.name;
  if (reference.avatar) {
    if (reference.previewable !== false) tag.classList.add("previewable");
    const image = document.createElement("img");
    image.src = String(reference.avatar);
    image.alt = "";
    image.draggable = false;
    tag.append(image);
  }
  const imageNumber = reference.dataType === "IMAGE" ? /^\{\{ref (\d+)\}\}$/.exec(reference.value)?.[1] : undefined;
  const highlighted = (imageNumber && props.highlightImageMentions) || (reference.dataType === "VIDEO" && props.highlightVideoMentions);
  if (highlighted) tag.classList.add("highlightedMediaMention");
  const displayName = reference.displayName ?? (imageNumber ? `图片${imageNumber}` : reference.label || reference.name);
  tag.append(document.createTextNode(`${highlighted ? "@" : ""}${displayName}`));
  return tag.outerHTML;
}

function normalizeModel(value: AnyTagProps[][]): AnyTagProps[][] {
  if (!value.length) return [[{ type: "Write", text: "" }]];
  return value.map(line => {
    const tags = line.flatMap((tag): AnyTagProps[] => {
      if (tag.type === "Write") return tag.text.split(/(\{\{ref \d+\}\}|\{\{preset [a-zA-Z0-9]+\}\})/g).map(text => {
        const preset = props.presets?.find(item => item.value === text);
        if (preset) return { type: "Custom", html: `<span style="display: inline-block;">${presetHtml(preset)}</span>` };
        const reference = props.references.find(item => item.value === text);
        return reference
          ? { type: "Custom", html: `<span style="display: inline-block;">${referenceHtml(reference)}</span>` }
          : { type: "Write", text };
      });
      if (tag.type !== "Custom") return [tag];
      const template = document.createElement("template");
      template.innerHTML = tag.html;
      const presetId = template.content.querySelector<HTMLElement>(".promptPreset[data-preset-id]")?.dataset.presetId;
      if (presetId) {
        const preset = props.presets?.find(item => item.id === presetId);
        return preset ? [{ type: "Custom", html: `<span style="display: inline-block;">${presetHtml(preset)}</span>` }] : [tag];
      }
      const id = template.content.querySelector<HTMLElement>(".imageReference[data-reference-id]")?.dataset.referenceId;
      if (!id) return [tag];
      const reference = props.references.find(item => item.id === id);
      if (!reference) return [];
      return [{ type: "Custom", html: `<span style="display: inline-block;">${referenceHtml(reference)}</span>` }];
    });
    const next: AnyTagProps[] = [{ type: "Write", text: "" }];
    for (const tag of tags) {
      const previous = next[next.length - 1];
      if (tag.type === "Write" && previous.type === "Write") previous.text += tag.text;
      else {
        if (tag.type !== "Write" && previous.type !== "Write") next.push({ type: "Write", text: "" });
        next.push(tag);
      }
    }
    if (next[next.length - 1].type !== "Write") next.push({ type: "Write", text: "" });
    return next;
  });
}

function releaseNodeFocus(instance: xSender) {
  // ACT: 1.4.6 的排队输入回调仍会聚焦旧 Write；仅让即将移除的节点失效，库支持取消回调后可移除。
  for (const grid of instance.chatEditor.NODES) {
    for (const node of grid.children) {
      if (node.type === "Write" || node.type === "Input") node.focus = () => {};
    }
  }
}

function syncModel(value = sender?.getModel() ?? model.value, clearHistory = false) {
  // 输入法组字时只同步文本，等 compositionend 后再替换参考标签，保留正在编辑的 DOM。
  const next = sender?.chatEditor.isComposition ? value : normalizeModel(value);
  if (sender && JSON.stringify(sender.getModel()) !== JSON.stringify(next)) {
    const instance = sender;
    const editor = instance.chatElement.richText;
    const selection = instance.getSelection();
    const focused = document.activeElement === editor;
    const endpoints = focused ? [selection.anchorNode, selection.focusNode].map((node, index) => {
      const gridIndex = instance.chatEditor.NODES.findIndex(grid => grid.$el.contains(node));
      const grid = instance.chatEditor.NODES[gridIndex];
      const childIndex = grid?.children.findIndex(child => child.$el.contains(node)) ?? -1;
      const child = grid?.children[childIndex];
      return {
        gridIndex, childIndex,
        text: child?.type === "Write" || child?.type === "Input" ? child.text : undefined,
        offset: index ? selection.focusOffset : selection.anchorOffset,
      };
    }) : [];
    releaseNodeFocus(instance);
    const task = instance.reset({ chatNode: next, clearHistory });
    resetTask = task;
    void task.finally(() => { if (resetTask === task) resetTask = undefined; });
    // ACT: reset 同步重建 DOM，但下一帧会强制移到末尾；在此恢复选区，并在 reset 完成前抑制该次聚焦。
    const last = instance.chatEditor.NODES.at(-1)?.children.at(-1);
    if (last?.type === "Write") {
      Object.assign(instance.getCurrentNode(), { instance: last, node: last.$el.children[0].firstChild, offset: last.text.length || 1 });
    }
    const restored = endpoints.map(endpoint => {
      const target = instance.chatEditor.NODES[endpoint.gridIndex]?.children[endpoint.childIndex];
      if ((target?.type !== "Write" && target?.type !== "Input") || target.text !== endpoint.text) return;
      const node = target.type === "Write" ? target.$el.children[0].firstChild : target.$el.children[0].children[0].firstChild;
      if (node?.nodeType !== Node.TEXT_NODE || endpoint.offset > (node.textContent?.length ?? 0)) return;
      return { target, node, offset: endpoint.offset };
    });
    const [anchor, focus] = restored;
    if (anchor && focus) {
      focus.target.focus(focus.offset);
      selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    } else if (focused && last?.type === "Write") last.focus(-1);
  }
  updateModel(next);
}

function getStoredModel(value: AnyTagProps[][]): AnyTagProps[][] {
  return value.map(line => line.map(tag => {
    if (tag.type !== "Custom") return tag;
    const template = document.createElement("template");
    template.innerHTML = tag.html;
    // 参考缩略图及其临时地址只用于显示，不进入持久化模型。
    const images = template.content.querySelectorAll(".imageReference img");
    if (!images.length) return tag;
    for (const image of images) image.remove();
    return { ...tag, html: template.innerHTML };
  }));
}

function updateModel(value: AnyTagProps[][]) {
  const next = getStoredModel(value);
  // ACT: 旧模型中的预览地址随下次实际编辑清理，避免仅打开文档就触发保存。
  if (JSON.stringify(getStoredModel(model.value)) !== JSON.stringify(next)) model.value = next;
  text.value = getPromptText(next);
}

watch(model, (value) => {
  if (sender && JSON.stringify(getStoredModel(value)) !== JSON.stringify(getStoredModel(sender.getModel()))) syncModel(value);
}, { deep: true });

watch(() => props.references, async (options) => {
  const instance = sender;
  if (!instance) return;
  instance.bus.emit(xSender.EventSet.EVENT_COMMON_DIALOG_CLOSE);
  if (props.materials === undefined) instance.updateConfig({ mentionConfig: { dialogTitle: "选择参考", callEvery: false, options } });
  // 等库将本帧的输入 DOM 写回模型后再更新参考，避免用旧文本重建输入框。
  await instance.nextTick();
  if (sender === instance) syncModel();
}, { deep: true });

watch(senderElement, (element, _previous, onCleanup) => {
  if (!element) return;
  const popup = document.createElement("div");
  popup.className = "textNodeMentions nodrag nopan nowheel";
  popup.style.zIndex = String(nextZIndex());
  document.body.appendChild(popup);
  const initialModel: AnyTagProps[][] = model.value.length ? model.value : text.value.split("\n").map(text => [{ type: "Write", text }]);
  const instance = new xSender(element, {
    autoFocus: false,
    placeholder: props.placeholder ?? "描述一下生成风格提示词，输入 @ 引用参考",
    chatStyle: { ...inlineHeight.value, fontSize: "14px", lineHeight: "1.6" },
    getPopupContainer: () => popup,
    // ACT: XSender 1.4.6 不支持分组候选渲染，扩展引用菜单由 Vue 管理，标签仍走编辑器公开 API。
    ...(props.materials === undefined ? { mentionConfig: { dialogTitle: "选择参考", callEvery: false, options: props.references } } : {}),
    keyboardSendFun: () => false,
    keyboardWrapFun: event => event.key === "Enter" && !event.isComposing,
  });
  sender = instance;
  // ACT: 弹窗只移动现有编辑器，保留参考标签、光标与撤销记录。
  const stopExpandedWatch = watch([editorExpanded, expandedTarget, inlineHeight], async ([visible, , height]) => {
    instance.bus.emit(xSender.EventSet.EVENT_COMMON_DIALOG_CLOSE);
    closeMentionMenu();
    instance.updateConfig({ chatStyle: { ...(visible ? { minHeight: "100%", maxHeight: "100%" } : height), fontSize: visible ? "16px" : "14px", lineHeight: visible ? "1.8" : "1.6" } });
    if (!visible) return;
    await nextTick();
    if (sender !== instance || !editorExpanded.value) return;
    popup.style.zIndex = String(nextZIndex());
  }, { immediate: true });
  const editor = instance.chatElement.richText;
  const releaseTextHistory = registerTextHistory({
    element: editor,
    async change(direction) {
      await instance.nextTick();
      if (resetTask) await resetTask;
      if (sender !== instance || !editor.isConnected || instance.chatEditor.isComposition) return;
      await instance[direction]();
    },
  });
  // ACT: 1.4.6 未检查卸载节点和空 Range 矩形；只适配当前实例，升级到库内修复后可移除。
  const chatEditor = instance.chatEditor as typeof instance.chatEditor & {
    focusFirst(): void;
    focusLast(): void;
    focusMark(): void;
    cursorView(): void;
    insertNodes(nodes: AnyTagProps[][]): Promise<void>;
  };
  for (const method of ["focusFirst", "focusLast", "focusMark"] as const) {
    const focus = chatEditor[method].bind(chatEditor);
    chatEditor[method] = () => {
      if (sender !== instance || !editor.isConnected || !editor.getClientRects().length) return;
      if (method === "focusLast" && resetTask) return;
      if (method === "focusMark" && !editor.contains(instance.getCurrentNode().node)) return chatEditor.focusLast();
      focus();
    };
  }
  const cursorView = chatEditor.cursorView.bind(chatEditor);
  chatEditor.cursorView = () => {
    const selection = instance.getSelection();
    if (sender !== instance || !editor.isConnected || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer) || !range.getClientRects().length || !editor.parentElement?.getClientRects().length) return;
    cursorView();
  };
  const insertNodes = chatEditor.insertNodes.bind(chatEditor);
  chatEditor.insertNodes = async nodes => {
    // 选区粘贴会先异步删除，再插入；关闭输入框后不再创建并聚焦新节点。
    if (sender === instance && editor.isConnected) await insertNodes(nodes);
  };
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-label", "生成提示词");
  editor.setAttribute("aria-multiline", "true");
  instance.bus.on("textPrompt", xSender.EventSet.EVENT_COMMON_CHANGE, () => {
    syncModel();
    updateMentionMenu();
  });
  syncModel(initialModel, true);
  // ACT: XSender 1.4.6 默认复制标签名称；复用库截取的选区模型，仅覆盖纯文本，保留富文本粘贴。
  const copyText = (event: ClipboardEvent) => {
    const copied = event.clipboardData?.getData("application/chat-nodes");
    if (copied) event.clipboardData?.setData("text/plain", getPromptText(JSON.parse(copied)));
  };
  editor.addEventListener("copy", copyText);
  editor.addEventListener("cut", copyText);
  const updateMentionCursor = (event: KeyboardEvent | MouseEvent) => {
    if (event instanceof KeyboardEvent && ["Escape", "Enter", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    void instance.nextTick(() => { if (sender === instance) updateMentionMenu(); });
  };
  editor.addEventListener("keyup", updateMentionCursor);
  editor.addEventListener("click", updateMentionCursor);
  const selectReference = (event: MouseEvent) => {
    const item = (event.target as Element).closest<HTMLElement>(".chat-mention-dialog-item");
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    const reference = props.references.find(reference => reference.id === item.dataset.id);
    if (reference) void insertReference(reference);
  };
  const closeOutside = (event: PointerEvent) => {
    if (!element.contains(event.target as Node) && !popup.contains(event.target as Node) && !mentionMenu.value?.contains(event.target as Node)) {
      instance.bus.emit(xSender.EventSet.EVENT_COMMON_DIALOG_CLOSE);
      closeMentionMenu();
    }
  };
  // ACT: XSender 1.4.6 的候选默认插入 Mention；捕获选择事件改用公开 setHtml，库支持自定义渲染后可替换。
  popup.addEventListener("click", selectReference, true);
  document.addEventListener("pointerdown", closeOutside, true);
  onCleanup(() => {
    releaseTextHistory();
    stopExpandedWatch();
    updateModel(instance.getModel());
    releaseNodeFocus(instance);
    sender = undefined;
    closeMentionMenu();
    editor.removeEventListener("copy", copyText);
    editor.removeEventListener("cut", copyText);
    editor.removeEventListener("keyup", updateMentionCursor);
    editor.removeEventListener("click", updateMentionCursor);
    document.removeEventListener("pointerdown", closeOutside, true);
    popup.removeEventListener("click", selectReference, true);
    // ACT: 1.4.6 的 destroy 会删除排队回调仍需用到的字段；先走公开清理事件，库修复后可直接 destroy。
    instance.bus.offKeyEvent("textPrompt");
    instance.bus.emit(xSender.EventSet.EVENT_COMMON_DIALOG_CLOSE);
    if (props.materials === undefined) instance.updateConfig({ mentionConfig: { dialogTitle: "选择参考", callEvery: false, options: [] } });
    instance.bus.emit(xSender.EventSet.EVENT_COMMON_DESTROY);
    popup.remove();
  });
});

async function insertReference(reference: MentionItem) {
  const instance = sender;
  if (!instance) return;
  const cursor = instance.getCurrentNode();
  const before = cursor.node.textContent?.slice(0, cursor.offset) ?? "";
  const start = before.lastIndexOf("@");
  if (start < 0) return;
  instance.bus.emit(xSender.EventSet.EVENT_COMMON_DIALOG_CLOSE);
  await instance.backspace(start - before.length);
  const current = props.references.find(item => item.id === reference.id);
  if (sender === instance && current) await instance.setHtml(referenceHtml(current));
}

function handleMentionKey(event: KeyboardEvent) {
  if (mentionVisible.value && mentionMenu.value?.handleKeydown(event)) return;
  if (!sender || event.isComposing || !["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(event.key)) return;
  const dialog = sender.chatElement.dialogRoot.querySelector<HTMLElement>(".chat-mention-dialog-wrap");
  if (!dialog?.getClientRects().length) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    sender.bus.emit(xSender.EventSet.EVENT_COMMON_DIALOG_CLOSE);
    return;
  }
  // ACT: 1.4.6 的候选键盘监听在 window，会被骨架截断；只适配当前实例，库支持局部键盘 API 后可替换。
  const items = Array.from(dialog.querySelectorAll<HTMLElement>(".chat-mention-dialog-item")).filter(item => item.getClientRects().length);
  if (!items.length) return;
  const active = Math.max(0, items.findIndex(item => item.classList.contains("active")));
  if (event.key === "Enter") {
    items[active]?.click();
    return;
  }
  const next = (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items.forEach((item, index) => item.classList.toggle("active", index === next));
  items[next]?.scrollIntoView({ block: "nearest" });
}
</script>

<style scoped lang="scss">
.promptInputWrap {
  position: relative;
  margin: 12px 0 16px;

  .expandButton {
    position: absolute;
    top: 2px;
    right: 10px;
    z-index: 11;
    width: 24px;
    height: 24px;
    padding: 4px;
    color: var(--el-text-color-secondary);
  }

  &:has(.expandButton) .promptInput {
    :deep(.chat-rich-text > [contenteditable]),
    :deep(.chat-placeholder-wrap) { padding-right: 34px; }
  }
}

:global(.promptEditorDialog) {
  display: flex;
  flex-direction: column;
  height: 80vh;
}

:global(.promptEditorDialog .el-dialog__body) { flex: 1; min-height: 0; }
.promptExpandedTarget { height: 100%; }

.promptInput,
:global(.textNodeMentions) {
  --chat-primary: var(--el-color-primary);
  --chat-text: var(--el-text-color-primary);
  --chat-text-secondary: var(--el-text-color-regular);
  --chat-text-placeholder: var(--el-text-color-placeholder);
  --chat-box: var(--el-bg-color-overlay);
  --chat-card: var(--el-fill-color-light);
  --chat-highlight: var(--el-color-primary-light-3);
  --chat-highlight-card: var(--el-fill-color);
  --chat-box-shadow: var(--el-box-shadow-light);
  --chat-rect-padding: 0px;
}

:global(.textNodeMentions) {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

:global(.textNodeMentions .chat-dialog-wrap .chat-mention-dialog-wrap.chat-view-show) {
  animation: none;
}

.promptInput {
  display: block;
  cursor: text;
  -webkit-user-select: text;
  user-select: text;

  :deep(.chat-rich-text > [contenteditable]) {
    min-height: inherit;
  }

  &.expandedInput {
    height: 100%;
    margin: 0;

    :deep(.chat-area-wrap),
    :deep(.chat-rich-text) { height: 100%; min-height: 0; }
    :deep(.chat-rich-text > [contenteditable]) { min-height: 100%; outline: none; }
  }

  // 最小高度加在滚动容器上，让编辑区撑满它，点击文字以外的空白也能聚焦。
  &:deep(.chat-rich-text) {
    display: flex;
    flex-direction: column;
  }

  &:deep(.chat-rich-text > [contenteditable]) {
    flex: 1 0 auto;
  }

  &:deep(.imageReference) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 0 3px;
    padding: 2px 6px 2px 2px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);
    background: var(--el-fill-color-light);
    color: var(--el-text-color-primary);
    font-size: 12px;
    line-height: 18px;
    white-space: nowrap;
    vertical-align: middle;

    &.highlightedMediaMention {
      color: light-dark(#426c17, #c1f77d);
    }

    &.previewable {
      cursor: zoom-in;
    }

    img {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      object-fit: cover;
      border-radius: 3px;
      pointer-events: none;
    }
  }

  :deep(.promptPreset) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 0 3px;
    padding: 2px 6px 2px 2px;
    border: 1px solid var(--el-border-color);
    border-radius: 6px;
    background: var(--el-fill-color-light);
    color: var(--el-text-color-primary);
    font-size: 12px;
    line-height: 18px;
    white-space: nowrap;
    vertical-align: middle;

    .promptPresetRemove {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 0;
      border-radius: 4px;
      background: #a855f7;
      color: #fff;
      font: inherit;
      cursor: pointer;

      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
      .promptPresetIcon { display: inline-flex; align-items: center; justify-content: center; }
      .promptPresetClose { display: none; font-size: 17px; }
    }

    &:hover, &:focus-within {
      .promptPresetRemove {
        background: var(--el-fill-color-dark);
        .promptPresetIcon { display: none; }
        .promptPresetClose { display: block; }
      }
    }
  }

  &:deep(.chat-placeholder-wrap) {
    font-style: normal;
    -webkit-user-select: none;
    user-select: none;
  }
}
</style>
