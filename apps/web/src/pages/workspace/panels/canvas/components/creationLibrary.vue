<template>
  <el-dialog v-model="visible" class="creationLibraryDialog" title="创作广场" width="min(1200px, calc(100vw - 32px))" alignCenter appendToBody :closeOnClickModal="false" :beforeClose="close" @closed="resetDraft">
    <template #header="{ titleId, titleClass }">
      <div class="libraryHeader">
        <h2 :id="titleId" :class="titleClass">创作广场</h2>
        <nav class="libraryViewTabs" aria-label="当前分类视图">
          <template v-if="builtinCategory">
            <button v-for="item in instructionTabs" :key="item.value" type="button" :aria-pressed="instructionType === item.value" @click="switchInstruction(item.value)">{{ item.label }}</button>
          </template>
          <template v-else>
            <button type="button" :aria-pressed="libraryView === 'mine'" @click="selectView('mine')">{{ category === 'skill' ? '我的 Skill' : '我的提示词' }}</button>
            <button type="button" :aria-pressed="libraryView === 'official'" @click="selectView('official')">{{ category === 'skill' ? '官方 Skill' : '官方提示词' }}</button>
            <button type="button" :aria-pressed="libraryView === 'recent'" @click="selectView('recent')">最近使用</button>
          </template>
        </nav>
      </div>
    </template>
    <div class="creationLibrary" @keydown.stop @pointerdown.stop @wheel.stop>
      <div class="libraryNavigation">
        <nav class="libraryCategories" aria-label="创作广场分类">
          <button type="button" :aria-pressed="builtinCategory" @click="selectCategory('builtin')"><icon-adjustments :size="16" aria-hidden="true" />内置提示词</button>
          <hr class="categoryDivider" />
          <button type="button" :aria-pressed="category === 'prompt'" @click="selectCategory('prompt')"><icon-message :size="16" aria-hidden="true" />提示词</button>
          <button type="button" :aria-pressed="category === 'skill'" @click="selectCategory('skill')"><icon-book :size="16" aria-hidden="true" />Skill</button>
        </nav>
      </div>
      <builtinNodeInstructions v-if="visible && builtinCategory" :key="instructionType" ref="builtinEditor" :section="instructionType" :search="search">
        <template #default="{ cards, selectInstruction }">
          <div class="libraryToolbar">
            <el-input v-model="search" clearable :prefixIcon="IconSearch" placeholder="搜索内置提示词" aria-label="搜索内置提示词" />
          </div>
          <div class="libraryBody">
            <div class="entryList" :style="{ '--cardWidth': `${208 - gridDensity * 28}px` }" role="region" aria-label="内置提示词列表">
              <button v-for="card in cards" :key="card.id" class="entryItem builtinEntry" type="button" :title="card.label" :aria-label="card.label" @click="selectInstruction(card.id)">
                <span class="entryPreview"><span class="entryExcerpt">{{ card.preview }}</span></span>
                <span class="entryTitle">{{ card.label }}</span>
              </button>
              <div v-if="search.trim() && !cards.length" class="searchEmpty">
                <span role="status">当前分类没有匹配项</span>
                <el-button text @click="search = ''">清除搜索</el-button>
              </div>
            </div>
          </div>
        </template>
      </builtinNodeInstructions>
      <el-alert v-if="!builtinCategory && (library.error || operationError)" :title="library.error || operationError" type="error" :closable="false" showIcon />
      <div v-if="!builtinCategory && !draft && !officialPreview" class="libraryToolbar">
        <el-input v-model="search" clearable :prefixIcon="IconSearch" :placeholder="category === 'skill' ? '搜索 Skill' : '搜索提示词'" aria-label="搜索名称或内容" />
        <div class="libraryActions">
          <el-button v-if="libraryView === 'mine'" text :icon="IconPlus" :disabled="busy || !!library.error" @click="createEntry">新建</el-button>
          <el-button v-if="libraryView === 'mine'" text :icon="IconUpload" title="导入文件" aria-label="导入文件" :disabled="busy || !!library.error" @click="fileInput?.click()" />
          <el-popover placement="bottom-end" trigger="click" :width="200" title="视图密度">
            <template #reference><el-button text :icon="IconAdjustments" title="视图密度" aria-label="视图密度" /></template>
            <input v-model.number="gridDensity" class="densitySlider" type="range" min="0" max="4" step="1" aria-label="视图密度" />
          </el-popover>
        </div>
        <input ref="fileInput" type="file" accept=".md,.markdown,.txt" hidden aria-label="导入 Skill 或提示词文本" @change="importEntry" />
      </div>
      <div v-if="category === 'skill' && libraryView === 'official'" class="officialEmpty" role="status">暂无官方 Skill</div>
      <div v-else-if="!builtinCategory" class="libraryBody">
        <div v-if="!draft && !officialPreview" class="entryList" :style="{ '--cardWidth': `${208 - gridDensity * 28}px` }" role="region" aria-label="创作条目">
          <div v-for="{ entry, title, excerpt } in filteredEntries" :key="entry.id" class="entryCard">
            <button class="entryItem" :class="{ dragging: draggedId === entry.id, dropBefore: dropTarget?.id === entry.id && !dropTarget.after, dropAfter: dropTarget?.id === entry.id && dropTarget.after }" type="button" :disabled="busy" :draggable="!busy && libraryView === 'mine'" :title="entry.title" @click="selectEntry(entry)" @dragstart.stop="startSort($event, entry)" @dragover.stop="overSort($event, entry)" @drop.stop="dropSort($event, entry)" @dragend.stop="endSort" @keydown.alt.left.prevent.stop="moveEntry(entry, -1)" @keydown.alt.right.prevent.stop="moveEntry(entry, 1)">
              <span class="entryPreview">
                <img v-if="entry.cover && !excerpt.hit" class="entryCover" :src="entry.cover" alt="" draggable="false" />
                <span v-else class="entryExcerpt">{{ excerpt.before }}<mark v-if="excerpt.hit">{{ excerpt.hit }}</mark>{{ excerpt.after }}</span>
              </span>
              <span class="entryTitle">{{ title.before }}<mark v-if="title.hit">{{ title.hit }}</mark>{{ title.after }}</span>
            </button>
            <button class="starEntry" type="button" :aria-pressed="starred.has(entry.id)" :title="starred.has(entry.id) ? '取消置顶' : '加星置顶'" :aria-label="`加星置顶：${entry.title}`" @click="toggleStar(entry.id)"><icon-star :size="14" /></button>
            <div class="entryActions">
              <button v-if="sendToCanvas" type="button" title="发送到画布" :aria-label="`${translate('发送到画布')}：${entry.title}`" :disabled="busy || !entry.content" @click="sendEntry(entry)"><icon-send :size="15" /></button>
              <button type="button" title="复制正文" :aria-label="`${translate('复制正文')}：${entry.title}`" :disabled="busy || !entry.content" @click="copyContent(entry.content, entry.id)"><icon-copy :size="15" /></button>
            </div>
          </div>
          <div v-if="search.trim() && !filteredEntries.length && !library.error" class="searchEmpty">
            <span role="status">当前分类没有匹配项</span>
            <el-button text @click="search = ''">清除搜索</el-button>
          </div>
          <div v-else-if="libraryView === 'recent' && !filteredEntries.length && !library.error" class="searchEmpty" role="status">当前分类暂无最近使用记录</div>
        </div>
        <div v-else class="entryEditor">
          <header class="libraryToolbar editorToolbar">
            <el-button text :icon="IconArrowLeft" :disabled="busy" @click="backToGrid">返回列表</el-button>
            <el-input v-if="draft" v-model="draft.title" :maxlength="120" aria-label="收藏名称" placeholder="名称（留空时使用正文首行）" :disabled="busy" />
            <h3 v-else-if="officialPreview">{{ officialPreview.title }}</h3>
            <div v-if="draft" class="libraryActions">
              <el-popover placement="bottom-end" trigger="click" :width="216">
                <template #reference><el-button text :icon="IconPhoto" title="封面图" aria-label="封面图" :disabled="busy" /></template>
                <div class="coverEditor">
                  <img v-if="draft.cover" :src="draft.cover" alt="收藏封面" />
                  <el-button text :icon="IconUpload" :loading="coverLoading" :disabled="busy" @click="coverInput?.click()">{{ draft.cover ? "替换封面" : "上传封面" }}</el-button>
                  <el-button v-if="draft.cover" text :disabled="busy" @click="delete draft.cover">移除封面</el-button>
                </div>
              </el-popover>
              <el-button text :icon="IconDownload" title="导出文本" aria-label="导出文本" :loading="exporting" :disabled="busy || !draft.content.trim()" @click="exportEntry" />
              <el-button text :icon="IconCopy" title="复制内容" aria-label="复制内容" :disabled="busy || !draft.content" @click="copyContent(draft.content)" />
              <el-button v-if="original" text :icon="IconStarOff" title="取消收藏" aria-label="取消收藏" :disabled="busy" @click="removeEntry" />
              <el-button text type="primary" :icon="IconCheck" :loading="saving" :disabled="busy || !dirty || !draft.content.trim()" @click="saveEntry">保存</el-button>
            </div>
            <div v-else-if="officialPreview" class="libraryActions">
              <el-button text :icon="IconCopy" title="复制内容" aria-label="复制内容" @click="copyContent(officialPreview.content, officialPreview.id)" />
            </div>
          </header>
          <input v-if="draft" ref="coverInput" type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="选择收藏封面" @change="importCover" />
          <el-input v-if="draft" v-model="draft.content" class="contentInput" type="textarea" :maxlength="64000" resize="none" :spellcheck="false" :aria-label="draft.kind === 'skill' ? 'Skill 内容' : '提示词内容'" :disabled="busy" />
          <el-input v-else-if="officialPreview" :modelValue="officialPreview.content" class="contentInput" type="textarea" resize="none" aria-label="官方提示词内容" readonly />
          <span v-if="draft && (dirty || saving)" class="saveHint" role="status">{{ saving ? "正在保存…" : "返回、切换分类或关闭时自动保存" }}</span>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { IconAdjustments, IconArrowLeft, IconBook, IconCheck, IconCopy, IconDownload, IconMessage, IconPhoto, IconPlus, IconSearch, IconSend, IconStar, IconStarOff, IconUpload } from "@tabler/icons-vue";
import { translate } from "@toonflow/i18n/vue";
import { saveSettings, settings, settingsStorage } from "@/stores/settings";
import { writeClipboardText } from "@/lib/clipboard";
import saveFile from "@/lib/saveFile";
import { currentUser } from "@/stores/multiTenant";
import builtinNodeInstructions from "./builtinNodeInstructions.vue";
import { officialPrompts } from "./officialPrompts";

type Entry = { id: string; kind: "skill" | "prompt"; title: string; content: string; cover?: string };
const visible = defineModel<boolean>({ default: false });
const props = defineProps<{ sendToCanvas?: (entry: Entry) => Promise<void>; officialPromptsOnOpen?: boolean }>();
const category = ref<"skill" | "prompt" | "builtin">("prompt");
const instructionTabs = [{ value: "text", label: translate("文本节点") }, { value: "comic", label: translate("漫画提示词") }, { value: "image", label: translate("图片生成节点") }] as const;
const instructionType = ref<(typeof instructionTabs)[number]["value"]>("text");
const libraryView = ref<"mine" | "official" | "recent">("mine");
const builtinCategory = computed(() => category.value === "builtin");
const recentIds = ref<string[]>([]);
const preferences = computed(() => settings.value.stores as Record<string, unknown> | undefined);
const starred = computed(() => {
  const ids = preferences.value?.creationLibraryStars;
  return new Set<string>(Array.isArray(ids) ? ids.filter(id => typeof id === "string") : []);
});
const gridDensity = computed({
  get() {
    const value = preferences.value?.creationLibraryDensity;
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4 ? value : 2;
  },
  set(value: number) { settingsStorage.setItem("creationLibraryDensity", JSON.stringify(value)); },
});

function toggleStar(id: string) {
  const ids = new Set(starred.value);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  settingsStorage.setItem("creationLibraryStars", JSON.stringify([...ids]));
}
const builtinEditor = ref<InstanceType<typeof builtinNodeInstructions>>();
const search = ref("");
const draft = ref<Entry>();
const officialPreview = ref<Entry>();
const original = ref("");
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
  const query = search.value.trim();
  const pattern = query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu") : undefined;
  function preview(text: string, context: number) {
    const match = pattern?.exec(text);
    if (!match) return { before: text, hit: "", after: "" };
    const start = Math.max(0, match.index - context);
    const end = match.index + match[0].length;
    return { before: (start ? "…" : "") + text.slice(start, match.index).replace(/\s+/g, " "), hit: match[0], after: text.slice(end, end + 180) };
  }
  const source: Entry[] = libraryView.value === "official" ? officialPrompts
    : libraryView.value === "recent" ? [...library.value.entries, ...officialPrompts] : library.value.entries;
  const entries = source.filter(entry => entry.kind === category.value
    && (libraryView.value !== "recent" || recentIds.value.includes(entry.id)));
  return entries.sort((left, right) => Number(starred.value.has(right.id)) - Number(starred.value.has(left.id)) || (libraryView.value === "recent"
    ? recentIds.value.indexOf(left.id) - recentIds.value.indexOf(right.id) : 0)).map(entry => ({
    entry, title: preview(entry.title, 4), excerpt: preview(entry.content, 12),
  })).filter(item => !query || item.title.hit || item.excerpt.hit);
});

function resetDraft() {
  draft.value = undefined;
  officialPreview.value = undefined;
  original.value = "";
  operationError.value = "";
}

watch(visible, open => {
  if (!open || !props.officialPromptsOnOpen) return;
  resetDraft();
  search.value = "";
  category.value = "prompt";
  libraryView.value = "official";
});

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

async function selectCategory(next: typeof category.value) {
  if (next === category.value || !await saveBeforeLeaving()) return;
  resetDraft();
  search.value = "";
  category.value = next;
  libraryView.value = "mine";
}

async function switchInstruction(next: typeof instructionType.value) {
  if (next === instructionType.value || !await saveBeforeLeaving()) return;
  search.value = "";
  instructionType.value = next;
}

async function selectView(next: typeof libraryView.value) {
  if (next === libraryView.value || !await saveBeforeLeaving()) return;
  resetDraft();
  search.value = "";
  libraryView.value = next;
}

async function createEntry() {
  if (category.value !== "skill" && category.value !== "prompt") return;
  if (!await saveBeforeLeaving()) return;
  resetDraft();
  draft.value = { id: crypto.randomUUID(), kind: category.value, title: "", content: "" };
}

async function selectEntry(entry: Entry) {
  if (Date.now() < suppressClickUntil || entry.id === draft.value?.id || !await saveBeforeLeaving()) return;
  recordRecent(entry.id);
  resetDraft();
  if (officialPrompts.some(prompt => prompt === entry)) {
    officialPreview.value = entry;
    return;
  }
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
  sortIds = filteredEntries.value.map(item => item.entry.id).filter(id => starred.value.has(id) === starred.value.has(entry.id));
  sortSnapshot = JSON.stringify(library.value.entries.map(item => item.id));
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", entry.id);
}

function overSort(event: DragEvent, entry: Entry) {
  if (!draggedId.value || busy.value) return;
  if (entry.id === draggedId.value || !sortIds.includes(entry.id)) { dropTarget.value = undefined; return; }
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
  if (busy.value || draggedId.value || libraryView.value !== "mine") return;
  const orderedIds = filteredEntries.value.map(item => item.entry.id).filter(id => starred.value.has(id) === starred.value.has(entry.id));
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

async function sendEntry(entry: Entry) {
  if (!props.sendToCanvas || busy.value) return;
  saving.value = true;
  try {
    await props.sendToCanvas(entry);
    recordRecent(entry.id);
    visible.value = false;
  } catch (error) { showError(error); }
  finally { saving.value = false; }
}

function recordRecent(id: string) {
  recentIds.value = [id, ...recentIds.value.filter(previous => previous !== id)].slice(0, 30);
}

async function copyContent(content: string, entryId?: string) {
  try {
    await writeClipboardText(content);
    if (entryId) recordRecent(entryId);
    ElMessage.success(translate("已复制"));
  }
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
.densitySlider { display: block; width: 100%; margin: 6px 0; accent-color: var(--el-color-primary); }
.coverEditor {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  img { width: 100%; max-height: 180px; object-fit: contain; border-radius: 8px; background: var(--el-fill-color-light); }
  :deep(.el-button) { margin: 0; padding: 0 8px; border-radius: 8px; }
}
:global(.el-dialog.creationLibraryDialog) {
  --librarySelectedText: var(--el-text-color-primary);
  --libraryMutedText: var(--el-text-color-secondary);
  --libraryContentOffset: 176px;
  --el-dialog-border-radius: 24px;
  border: 1px solid var(--el-border-color-lighter);
  display: flex;
  flex-direction: column;
  height: min(780px, 92dvh);
  max-height: calc(100dvh - 32px);
  overflow: hidden;
}

:global(.creationLibraryDialog > .el-dialog__body) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.libraryHeader {
  display: grid;
  grid-template-columns: var(--libraryContentOffset) minmax(0, 1fr);
  align-items: center;
  padding-right: 26px;
  .el-dialog__title { margin: 0; color: var(--libraryMutedText); font-size: 14px; font-weight: 600; }
  .libraryViewTabs {
    display: flex; flex-wrap: wrap; align-items: center; gap: 2px 16px;
    button {
      min-height: 32px; padding: 4px 0; border: 0; background: transparent; color: var(--libraryMutedText); font: inherit; font-size: 13px; font-weight: 400; cursor: pointer;
      &:hover { color: var(--el-text-color-regular); }
      &[aria-pressed="true"] { color: var(--librarySelectedText); font-weight: 600; }
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
    }
  }
  @media (max-width: 640px) { grid-template-columns: 1fr; gap: 6px; }
}
.creationLibrary {
  .officialEmpty { padding: 48px 12px; text-align: center; color: var(--el-text-color-secondary); }
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 14px;
  > :deep(.el-alert) { flex-shrink: 0; }
  .libraryNavigation {
    position: absolute;
    inset: 0 auto 0 0;
    width: calc(var(--libraryContentOffset) - 16px);
    box-sizing: border-box;
    padding-right: 8px;
    border-right: 1px solid var(--el-border-color-lighter);
    .libraryCategories {
      display: flex;
      flex-direction: column;
      gap: 4px;
      .categoryDivider {
        width: 100%;
        margin: 2px 0;
        border: 0;
        border-top: 1px solid var(--el-border-color-lighter);
      }
      button {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 36px;
        padding: 4px 6px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--libraryMutedText);
        font: inherit;
        font-size: 13px;
        svg { box-sizing: content-box; padding: 5px; }
        cursor: pointer;
        &:hover { color: var(--librarySelectedText); }
        &[aria-pressed="true"] {
          background: var(--el-fill-color-light);
          color: var(--librarySelectedText);
          font-weight: 600;
        }
        &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
      }
    }
  }
  padding-left: var(--libraryContentOffset);
  box-sizing: border-box;
  .libraryToolbar {
    display: flex;
    flex-wrap: wrap;
    flex-shrink: 0;
    gap: 8px;
    :deep(.el-input) { flex: 1; min-width: 120px; max-width: 240px; margin-right: auto; }
    :deep(.el-input__wrapper) { background: var(--el-fill-color-light); border-radius: 10px; box-shadow: none; }
    :deep(.el-input__wrapper.is-focus) { box-shadow: inset 0 0 0 1px var(--el-color-primary); }
    .libraryActions {
      display: flex;
      align-items: center;
      gap: 4px;
      :deep(.el-button) { margin: 0; padding: 0 8px; border-radius: 8px; }
    }
  }
  .libraryBody {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    .entryList {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--cardWidth)), 1fr));
      align-content: start;
      gap: 20px 14px;
      height: 100%;
      overflow-y: auto;
      .entryCard {
        position: relative;
        min-width: 0;
        mark { background: var(--el-color-warning-light-8); color: var(--el-text-color-primary); }
        align-self: start;
        .entryActions {
          position: absolute;
          inset: 0 0 auto;
          aspect-ratio: 3 / 4;
          display: flex;
          align-items: end;
          justify-content: end;
          gap: 4px;
          padding: 6px;
          box-sizing: border-box;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
        }

        &:hover .entryActions, &:focus-within .entryActions {
          opacity: 1;
          visibility: visible;
        }

        @media (hover: none) {
          .entryActions { opacity: 1; visibility: visible; }
        }
        .starEntry, .entryActions button {
          display: grid; place-items: center; pointer-events: auto;
          width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px;
          background: var(--el-bg-color-overlay); color: var(--el-text-color-secondary); cursor: pointer;
          &:hover { color: var(--el-text-color-primary); }
        }
        .starEntry {
          position: absolute; inset: 6px auto auto 6px;
          &[aria-pressed="true"] { color: var(--el-color-warning); svg { fill: currentColor; } }
        }
      }
      .searchEmpty { grid-column: 1 / -1; text-align: center; color: var(--el-text-color-secondary); }
      .entryItem {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 100%;
        min-width: 0;
        padding: 0;
        overflow: hidden;
        border: 0;
        background: transparent;
        color: var(--el-text-color-primary);
        text-align: left;
        font: inherit;
        cursor: pointer;
        user-select: none;
        &[draggable="true"]:active { cursor: grabbing; }
        &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; border-radius: 12px; }
        &.dragging { opacity: 0.4; }
        &.dropBefore .entryPreview { border-left: 3px solid var(--el-color-primary); }
        &.dropAfter .entryPreview { border-right: 3px solid var(--el-color-primary); }
        .entryPreview {
          position: relative;
          width: 100%; aspect-ratio: 3 / 4; box-sizing: border-box;
          overflow: hidden; border: 1px solid var(--el-border-color-lighter);
          border-radius: 12px; background: var(--el-fill-color-light);
        }
        .entryCover { display: block; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
        &:hover .entryPreview { background: var(--el-fill-color); }
        .entryPreview .entryExcerpt { position: absolute; inset: 0 0 21px; }
        .entryTitle { width: 100%; line-height: 20px; flex-shrink: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; font-weight: 500; }
        .entryExcerpt { display: block; margin: 10px; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.65; }
        .entryExcerpt::before { content: ""; float: left; width: 25px; height: 20px; }
        &.builtinEntry .entryExcerpt { inset-block-end: 0; &::before { content: none; } }
      }
    }
    .entryEditor {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      height: 100%;
      gap: 14px;
      .editorToolbar {
        align-items: center;
        > :deep(.el-button) { margin: 0; padding: 0 8px; border-radius: 8px; }
        h3 { min-width: 0; margin: 0; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
        .libraryActions { flex-wrap: wrap; margin-inline-start: auto; }
      }
      .contentInput {
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
      .saveHint { flex-shrink: 0; font-size: 12px; color: var(--el-text-color-secondary); }
    }
  }
  @media (max-width: 640px) {
    padding-left: 0;
    .libraryNavigation {
      position: static; width: 100%; padding: 0; border: 0;
      .libraryCategories { flex-direction: row; flex-wrap: wrap; margin: 4px 0 0; padding: 0; border: 0; }
    }
  }
}
</style>
