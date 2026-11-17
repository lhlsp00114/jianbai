<template>
  <el-dialog v-model="visible" class="creationLibraryDialog" :title="draft ? (draft.kind === 'skill' ? '编辑 Skill' : '编辑提示词') : '创作收藏'" width="min(1120px, calc(100vw - 32px))" alignCenter appendToBody :closeOnClickModal="false" :beforeClose="close" @closed="resetDraft">
    <div class="creationLibrary" @keydown.stop @pointerdown.stop @wheel.stop>
      <el-tabs v-if="!draft" v-model="category" :beforeLeave="changeCategory">
        <el-tab-pane label="Skill 收藏" name="skill" />
        <el-tab-pane label="提示词收藏" name="prompt" />
        <el-tab-pane label="内置节点提示词" name="nodes" />
      </el-tabs>
      <builtinNodeInstructions v-if="visible && builtinCategory" ref="builtinEditor" />
      <el-alert v-if="!builtinCategory && (library.error || operationError)" :title="library.error || operationError" type="error" :closable="false" showIcon />
      <div v-if="draft" class="editorNavigation">
        <el-button text :icon="IconArrowLeft" :disabled="busy" @click="backToGrid">返回收藏</el-button>
        <span class="saveHint" role="status">{{ saving ? "正在保存…" : "返回或关闭时自动保存" }}</span>
      </div>
      <div v-else-if="!builtinCategory" class="libraryToolbar">
        <el-input v-model="search" clearable :prefixIcon="IconSearch" placeholder="搜索收藏名称或内容" aria-label="搜索收藏" />
        <el-button :icon="IconPlus" :disabled="busy || !!library.error" @click="createEntry">新增收藏</el-button>
        <el-button :icon="IconUpload" :disabled="busy || !!library.error" @click="fileInput?.click()">导入文件</el-button>
        <input ref="fileInput" type="file" accept=".md,.markdown,.txt" hidden aria-label="导入 Skill 或提示词文本" @change="importEntry" />
      </div>
      <div v-if="!builtinCategory" class="libraryBody">
        <nav v-if="!draft" class="entryList" aria-label="收藏列表">
          <button class="entryItem createEntryCard" type="button" :disabled="busy || !!library.error" @click="createEntry">
            <icon-plus :size="28" aria-hidden="true" />
            <span>{{ category === "skill" ? "创建 Skill" : "创建提示词" }}</span>
          </button>
          <button v-for="entry in filteredEntries" :key="entry.id" class="entryItem" :class="{ hasCover: !!entry.cover, dragging: draggedId === entry.id, dropBefore: dropTarget?.id === entry.id && !dropTarget.after, dropAfter: dropTarget?.id === entry.id && dropTarget.after }" type="button" :disabled="busy" :draggable="!busy" title="点击编辑，按住拖动排序；也可使用 Alt + 左右方向键排序" @click="selectEntry(entry)" @dragstart.stop="startSort($event, entry)" @dragover.stop="overSort($event, entry)" @drop.stop="dropSort($event, entry)" @dragend.stop="endSort" @keydown.alt.left.prevent.stop="moveEntry(entry, -1)" @keydown.alt.right.prevent.stop="moveEntry(entry, 1)">
            <img v-if="entry.cover" class="entryCover" :src="entry.cover" alt="" draggable="false" />
            <span class="entryTitle">{{ entry.title }}</span>
            <span class="entryExcerpt">{{ entry.content }}</span>
          </button>
        </nav>
        <div v-else class="entryEditor">
          <template v-if="draft">
            <div class="editorLayout">
              <aside class="entryDetails" aria-label="收藏信息">
                <div class="nameField">
                  <label :for="titleInputId" class="fieldLabel">名称</label>
                  <el-input :id="titleInputId" v-model="draft.title" :maxlength="120" aria-label="收藏名称" placeholder="留空时使用正文首行" :disabled="busy" />
                </div>
                <div class="coverEditor">
                  <span class="fieldLabel">封面图 <small>可选</small></span>
                  <img v-if="draft.cover" :src="draft.cover" alt="收藏封面" />
                  <div class="coverActions">
                    <el-button :icon="IconUpload" :loading="coverLoading" :disabled="busy" @click="coverInput?.click()">{{ draft.cover ? "替换封面" : "上传封面" }}</el-button>
                    <el-button v-if="draft.cover" text :disabled="busy" @click="delete draft.cover">移除封面</el-button>
                  </div>
                  <input ref="coverInput" type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="选择收藏封面" @change="importCover" />
                </div>
              </aside>
              <section class="entryContent" aria-label="正文编辑区">
                <label :for="contentInputId" class="fieldLabel">{{ draft.kind === "skill" ? "Skill 内容" : "提示词内容" }}</label>
                <el-input :id="contentInputId" v-model="draft.content" class="contentInput" type="textarea" :maxlength="64000" resize="none" :spellcheck="false" aria-label="收藏内容" :disabled="busy" />
              </section>
            </div>
            <div class="editorActions">
              <el-button v-if="original" text type="danger" :icon="IconStarOff" :disabled="busy" @click="removeEntry">取消收藏</el-button>
              <span class="actionSpacer" />
              <el-button text :icon="IconDownload" :loading="exporting" :disabled="busy || !draft.content.trim()" @click="exportEntry">导出文本</el-button>
              <el-button text :icon="IconCopy" :disabled="busy || !draft.content" @click="copyContent">复制内容</el-button>
              <el-button type="primary" :loading="saving" :disabled="busy || !dirty || !draft.content.trim()" @click="saveEntry">保存</el-button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { IconArrowLeft, IconCopy, IconDownload, IconPlus, IconSearch, IconStarOff, IconUpload } from "@tabler/icons-vue";
import { translate } from "@toonflow/i18n/vue";
import { saveSettings, settings } from "@/stores/settings";
import { writeClipboardText } from "@/lib/clipboard";
import saveFile from "@/lib/saveFile";
import { currentUser } from "@/stores/multiTenant";
import builtinNodeInstructions from "./builtinNodeInstructions.vue";

type Entry = { id: string; kind: "skill" | "prompt"; title: string; content: string; cover?: string };
const visible = defineModel<boolean>({ default: false });
const category = ref<"skill" | "prompt" | "nodes">("skill");
const builtinCategory = computed(() => category.value === "nodes");
const builtinEditor = ref<InstanceType<typeof builtinNodeInstructions>>();
const search = ref("");
const draft = ref<Entry>();
const original = ref("");
const titleInputId = useId();
const contentInputId = useId();
const saving = ref(false);
const importing = ref(false);
const confirming = ref(false);
const coverLoading = ref(false);
const exporting = ref(false);
const coverInput = ref<HTMLInputElement>();
const draggedId = ref("");
const dropTarget = ref<{ id: string; after: boolean }>();
let sortIds: string[] = [];
let sortSnapshot = "";
let suppressClickUntil = 0;
const fileInput = ref<HTMLInputElement>();
const operationError = ref("");
const busy = computed(() => saving.value || importing.value || confirming.value || coverLoading.value || exporting.value);
const dirty = computed(() => draft.value ? original.value
  ? JSON.stringify(draft.value) !== original.value
  : !!(draft.value.title || draft.value.content || draft.value.cover) : false);

function readEntries(current: Record<string, unknown>): Entry[] {
  const stores = current.stores;
  if (stores === undefined) return [];
  if (!stores || typeof stores !== "object" || Array.isArray(stores)) throw new Error(translate("收藏数据格式错误，未覆盖原数据"));
  const value = (stores as Record<string, unknown>).creationLibrary;
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(entry => entry && typeof entry === "object"
    && typeof entry.id === "string" && entry.id.length > 0
    && (entry.kind === "skill" || entry.kind === "prompt")
    && typeof entry.title === "string" && typeof entry.content === "string"
    && (entry.cover === undefined || typeof entry.cover === "string" && entry.cover.length <= 32768 && /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(entry.cover)))
    || new Set(value.map(entry => entry.id)).size !== value.length) {
    throw new Error(translate("收藏数据格式错误，未覆盖原数据"));
  }
  return value;
}

function libraryPatch(current: Record<string, unknown>, entries: Entry[]) {
  if (entries.length > 200 || new Blob([JSON.stringify(entries)]).size > 1024 * 1024) {
    throw new Error(translate("收藏最多 200 条，总内容不能超过 1 MB"));
  }
  const patch = { stores: { ...(current.stores as Record<string, unknown> | undefined), creationLibrary: entries } };
  if (currentUser.value?.role === "user") {
    const scopedSettings = Object.fromEntries(["ui", "general", "privacy", "stores", "helloCompleted"]
      .filter(key => Object.hasOwn(current, key)).map(key => [key, current[key]]));
    if (new Blob([JSON.stringify({ ...scopedSettings, ...patch })]).size > 1024 * 1024) {
      throw new Error(translate("账号设置空间不足，请缩小封面或导出部分收藏后再保存；当前修改已保留"));
    }
  }
  return patch;
}

const library = computed(() => {
  try { return { entries: readEntries(settings.value), error: "" }; }
  catch (error) { return { entries: [] as Entry[], error: error instanceof Error ? error.message : translate("读取收藏失败") }; }
});
const filteredEntries = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return library.value.entries.filter(entry => entry.kind === category.value
    && (!query || entry.title.toLocaleLowerCase().includes(query) || entry.content.toLocaleLowerCase().includes(query)));
});

function resetDraft() {
  draft.value = undefined;
  original.value = "";
  operationError.value = "";
}

async function saveBeforeLeaving() {
  if (builtinCategory.value) return await builtinEditor.value?.saveBeforeLeaving() ?? true;
  if (busy.value || draggedId.value) return false;
  if (!dirty.value || !draft.value) return true;
  if (!original.value && !draft.value.title.trim() && !draft.value.content.trim() && !draft.value.cover) return true;
  return persistEntry(false, false);
}

async function close(done: () => void) {
  if (await saveBeforeLeaving()) done();
}

async function backToGrid() {
  if (await saveBeforeLeaving()) resetDraft();
}

async function changeCategory() {
  if (!await saveBeforeLeaving()) return false;
  resetDraft();
  search.value = "";
  return true;
}

async function createEntry() {
  if (category.value !== "skill" && category.value !== "prompt") return;
  if (!await saveBeforeLeaving()) return;
  resetDraft();
  draft.value = { id: crypto.randomUUID(), kind: category.value, title: "", content: "" };
}

async function selectEntry(entry: Entry) {
  if (Date.now() < suppressClickUntil || entry.id === draft.value?.id || !await saveBeforeLeaving()) return;
  resetDraft();
  draft.value = { ...entry };
  original.value = JSON.stringify(entry);
}

function showError(error: unknown) {
  operationError.value = axios.isAxiosError(error)
    ? error.response?.status === 409
      ? translate("设置已被其他页面修改，请先复制保留草稿，再刷新后重试")
      : typeof error.response?.data?.message === "string" ? error.response.data.message : translate("保存失败，请重试")
    : error instanceof Error ? error.message : translate("操作失败，请重试");
}

function openTextDraft(content: string, title: string) {
  if (category.value !== "skill" && category.value !== "prompt") return;
  if (!content.trim() || content.length > 64000 || content.includes("\0")) {
    throw new Error(translate("内容必须是非空文本，且不能超过 64000 个字符"));
  }
  resetDraft();
  draft.value = { id: crypto.randomUUID(), kind: category.value, title: title.slice(0, 120), content };
}

async function exportEntry() {
  if (!draft.value || busy.value || !draft.value.content.trim()) return;
  const entry = { ...draft.value };
  exporting.value = true;
  operationError.value = "";
  try {
    const name = entry.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").slice(0, 100) || "collection";
    const extension = entry.kind === "skill" ? ".md" : ".txt";
    const mimeType = entry.kind === "skill" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8";
    await saveFile(new Blob([entry.content], { type: mimeType }), "collection-" + name + extension);
  } catch (error) { showError(error); }
  finally { exporting.value = false; }
}

async function importCover(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !draft.value || busy.value) return;
  const currentDraft = draft.value;
  coverLoading.value = true;
  operationError.value = "";
  let bitmap: ImageBitmap | undefined;
  try {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) {
      throw new Error(translate("请选择不超过 20 MB 的 PNG、JPEG 或 WebP 图片"));
    }
    bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    const ratio = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(translate("无法处理封面图片"));
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // ACT: 封面限 32 KB，收藏总量沿用 1 MB 限制；更大图库应迁移到独立的用户素材存储。
    let cover = canvas.toDataURL("image/webp", 0.75);
    if (cover.length > 32768) cover = canvas.toDataURL("image/webp", 0.4);
    if (cover.length > 32768) throw new Error(translate("封面图片压缩后仍过大，请选择更简单或更小的图片"));
    if (draft.value === currentDraft) draft.value.cover = cover;
  } catch (error) { showError(error); }
  finally { bitmap?.close(); coverLoading.value = false; }
}

function startSort(event: DragEvent, entry: Entry) {
  if (busy.value || draft.value || !event.dataTransfer) { event.preventDefault(); return; }
  draggedId.value = entry.id;
  sortIds = filteredEntries.value.map(item => item.id);
  sortSnapshot = JSON.stringify(library.value.entries.map(item => item.id));
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", entry.id);
}

function overSort(event: DragEvent, entry: Entry) {
  if (!draggedId.value || busy.value) return;
  if (entry.id === draggedId.value) { dropTarget.value = undefined; return; }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  dropTarget.value = { id: entry.id, after: event.clientX > bounds.left + bounds.width / 2 };
}

function endSort() {
  draggedId.value = "";
  dropTarget.value = undefined;
  suppressClickUntil = Date.now() + 300;
}

async function dropSort(event: DragEvent, entry: Entry) {
  if (!draggedId.value || busy.value || !dropTarget.value || dropTarget.value.id !== entry.id) return;
  event.preventDefault();
  const sourceId = draggedId.value;
  const orderedIds = sortIds.filter(id => id !== sourceId);
  const targetIndex = orderedIds.indexOf(entry.id);
  if (targetIndex < 0) { endSort(); return; }
  orderedIds.splice(targetIndex + Number(dropTarget.value.after), 0, sourceId);
  const expectedOrder = sortSnapshot;
  const unchanged = orderedIds.every((id, index) => id === sortIds[index]);
  endSort();
  if (unchanged) return;
  await persistOrder(orderedIds, expectedOrder);
}

async function moveEntry(entry: Entry, direction: number) {
  if (busy.value || draggedId.value) return;
  const orderedIds = filteredEntries.value.map(item => item.id);
  const index = orderedIds.indexOf(entry.id);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= orderedIds.length) return;
  orderedIds.splice(index, 1);
  orderedIds.splice(targetIndex, 0, entry.id);
  await persistOrder(orderedIds, JSON.stringify(library.value.entries.map(item => item.id)));
}

async function persistOrder(orderedIds: string[], expectedOrder: string) {
  saving.value = true;
  operationError.value = "";
  try {
    await saveSettings(current => {
      const entries = readEntries(current);
      if (JSON.stringify(entries.map(item => item.id)) !== expectedOrder) throw new Error(translate("收藏顺序已发生变化，请重新拖动排序"));
      const entriesById = new Map(entries.map(item => [item.id, item]));
      const movedIds = new Set(orderedIds);
      const reordered = orderedIds.map(id => entriesById.get(id)!);
      let index = 0;
      // 搜索时仅重排可见收藏所在的位置，保留其他分类和未匹配项。
      const updated = entries.map(item => movedIds.has(item.id) ? reordered[index++]! : item);
      return libraryPatch(current, updated);
    });
  } catch (error) { showError(error); }
  finally { saving.value = false; }
}

async function importEntry(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !await saveBeforeLeaving()) return;
  importing.value = true;
  operationError.value = "";
  try {
    if (!/\.(md|markdown|txt)$/i.test(file.name) || file.size > 256 * 1024) throw new Error(translate("请选择不超过 256 KB 的 Markdown 或文本文件"));
    const content = (await file.text()).replace(/^\uFEFF/, "");
    openTextDraft(content, file.name.replace(/\.(md|markdown|txt)$/i, ""));
  } catch (error) { showError(error); }
  finally { importing.value = false; }
}

async function persistEntry(remove = false, notify = true): Promise<boolean> {
  if (!draft.value || busy.value) return false;
  const firstLine = draft.value.content.split(/\r?\n/).find(line => line.trim())?.trim() ?? "";
  const entry = { ...draft.value, title: draft.value.title.trim() || firstLine.slice(0, 120) };
  if (!remove && (!entry.title || entry.title.length > 120 || !entry.content.trim() || entry.content.length > 64000)) {
    operationError.value = translate("请输入正文内容，名称最多 120 字，内容最多 64000 字；当前修改已保留");
    return false;
  }
  const expected = original.value;
  saving.value = true;
  operationError.value = "";
  try {
    await saveSettings(current => {
      const entries = readEntries(current);
      const index = entries.findIndex(item => item.id === entry.id);
      if (expected ? index < 0 || JSON.stringify(entries[index]) !== expected : index >= 0) {
        throw new Error(translate("这条收藏已发生变化，请先复制保留草稿，再重新打开"));
      }
      const updated = remove ? entries.filter(item => item.id !== entry.id)
        : index < 0 ? [entry, ...entries] : entries.map(item => item.id === entry.id ? entry : item);
      return libraryPatch(current, updated);
    });
    if (remove) resetDraft();
    else { draft.value = entry; original.value = JSON.stringify(entry); }
    if (notify) ElMessage.success(remove ? translate("已取消收藏") : translate("已保存"));
    return true;
  } catch (error) { showError(error); return false; }
  finally { saving.value = false; }
}

async function saveEntry() { await persistEntry(); }

async function removeEntry() {
  if (!draft.value || busy.value || !original.value) return;
  confirming.value = true;
  let confirmed = false;
  try {
    await ElMessageBox.confirm(translate("取消这条收藏？收藏内容和未保存修改将被移除，原始文件不受影响。"), translate("取消收藏"), {
      confirmButtonText: translate("取消收藏"), cancelButtonText: translate("保留"), type: "warning",
    });
    confirmed = true;
  } catch { /* 用户保留收藏。 */ }
  finally { confirming.value = false; }
  if (confirmed) await persistEntry(true);
}

async function copyContent() {
  if (!draft.value) return;
  try { await writeClipboardText(draft.value.content); ElMessage.success(translate("已复制")); }
  catch (error) { showError(error); }
}

function beforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}
watch([dirty, saving, coverLoading, importing], ([unsaved, pending, processing, reading]) => {
  window.removeEventListener("beforeunload", beforeUnload);
  if (unsaved || pending || processing || reading) window.addEventListener("beforeunload", beforeUnload);
});
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
</script>

<style scoped lang="scss">
:global(.creationLibraryDialog) {
  display: flex;
  flex-direction: column;
  height: min(800px, 85dvh);
  max-height: calc(100dvh - 32px);
  overflow: hidden;
}

:global(.creationLibraryDialog > .el-dialog__body) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.creationLibrary {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 12px;
  > :deep(.el-tabs), > :deep(.el-alert) { flex-shrink: 0; }
  .editorNavigation {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    :deep(.el-button) { margin: 0; padding-left: 0; color: var(--el-text-color-regular); }
    .saveHint { font-size: 12px; color: var(--el-text-color-secondary); }
  }
  .libraryToolbar {
    display: flex;
    flex-wrap: wrap;
    flex-shrink: 0;
    gap: 8px;
    :deep(.el-input) { flex: 1; min-width: 120px; }
    :deep(.el-button) { margin: 0; }
  }
  .libraryBody {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    .entryList {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      align-content: start;
      gap: 12px;
      height: 100%;
      overflow-y: auto;
      .entryItem {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 100%;
        min-width: 0;
        aspect-ratio: 1;
        padding: 12px;
        overflow: hidden;
        border: 1px solid var(--el-border-color-lighter);
        border-radius: 6px;
        background: var(--el-fill-color-light);
        color: var(--el-text-color-primary);
        text-align: left;
        font: inherit;
        cursor: grab;
        user-select: none;
        &:active { cursor: grabbing; }
        &.dragging { opacity: 0.4; }
        &.dropBefore { box-shadow: inset 4px 0 var(--el-color-primary); }
        &.dropAfter { box-shadow: inset -4px 0 var(--el-color-primary); }
        .entryCover { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
        &.hasCover {
          padding: 0;
          .entryTitle { position: absolute; bottom: 0; padding: 24px 12px 12px; background: linear-gradient(transparent, rgb(0 0 0 / 85%)); color: #fff; pointer-events: none; }
          .entryExcerpt { display: none; }
          &.dropBefore::after, &.dropAfter::after { content: ""; position: absolute; top: 0; bottom: 0; width: 4px; background: var(--el-color-primary); pointer-events: none; }
          &.dropBefore::after { left: 0; }
          &.dropAfter::after { right: 0; }
        }
        &:hover { border-color: var(--el-color-primary); }
        &.createEntryCard {
          align-items: center;
          justify-content: center;
          gap: 12px;
          border-style: dashed;
          border-color: var(--el-border-color);
          background: transparent;
          color: var(--el-text-color-secondary);
          cursor: pointer;
          &:hover:not(:disabled) { color: var(--el-color-primary); border-color: var(--el-color-primary); background: var(--el-fill-color-light); }
          &:disabled { cursor: not-allowed; opacity: 0.5; }
        }
        .entryTitle { width: 100%; flex-shrink: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
        .entryExcerpt { display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
      }
    }
    .entryEditor {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      height: 100%;
      gap: 12px;
      .editorLayout {
        display: grid;
        grid-template-columns: 260px minmax(0, 1fr);
        flex: 1;
        min-height: 0;
        gap: 24px;
        .fieldLabel { display: block; margin-bottom: 10px; color: var(--el-text-color-primary); font-size: 14px; font-weight: 600; }
        .entryDetails {
          display: flex;
          flex-direction: column;
          gap: 24px;
          padding: 18px;
          overflow-y: auto;
          border: 1px solid var(--el-border-color-lighter);
          border-radius: var(--ui-radius-small);
          background: var(--el-fill-color-light);
          .coverEditor {
            small { margin-left: 4px; color: var(--el-text-color-secondary); font-weight: 400; font-size: 12px; }
            img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: contain; margin-bottom: 12px; border-radius: 6px; background: var(--el-bg-color); }
            .coverActions { display: flex; flex-wrap: wrap; gap: 4px; :deep(.el-button) { margin: 0; } }
          }
        }
        .entryContent {
          display: flex;
          flex-direction: column;
          min-width: 0;
          min-height: 0;
          .contentInput { flex: 1; min-height: 0; :deep(.el-textarea__inner) { height: 100%; padding: 14px 16px; line-height: 1.8; } }
        }
      }
      .editorActions {
        display: flex;
        flex-shrink: 0;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding-top: 12px;
        border-top: 1px solid var(--el-border-color-lighter);
        .actionSpacer { flex: 1; }
        :deep(.el-button) { margin: 0; }
      }
    }
  }
  @media (max-width: 640px) {
    .libraryToolbar { flex-wrap: wrap; }
    .libraryBody {
      .entryList { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .entryEditor .editorLayout {
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        gap: 16px;
        .entryDetails { flex-shrink: 0; padding: 12px; gap: 16px; .coverEditor img { width: 128px; } }
        .entryContent { flex: 1 0 220px; }
      }
    }
  }
}
</style>
