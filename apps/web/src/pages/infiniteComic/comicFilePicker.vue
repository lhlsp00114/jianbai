<template>
  <el-popover v-model:visible="visible" trigger="click" placement="bottom-start" :width="320" :showArrow="false" @show="reload">
    <template #reference>
      <el-button class="comicTrigger" text aria-label="切换漫画文件" :aria-expanded="visible" :title="comicPath">
        {{ comicLabel(comicPath) }} <component :is="visible ? IconChevronUp : IconChevronDown" :size="14" aria-hidden="true" />
      </el-button>
    </template>
    <div class="comicPicker" @keydown.esc="visible = false">
      <div class="pickerToolbar">
        <el-input v-model="search" :prefixIcon="IconSearch" placeholder="搜索漫画" aria-label="搜索漫画" clearable @keydown.esc.stop="search = ''" />
        <el-button text :icon="IconFolderPlus" :disabled="actionsDisabled" title="新建文件夹" aria-label="新建漫画文件夹" @click="createFolder" />
        <el-button text :icon="IconPlus" :disabled="actionsDisabled" title="新建漫画" aria-label="新建漫画" @click="createComic" />
      </div>
      <el-button v-if="folder" class="backButton" text :icon="IconChevronLeft" :title="folderLabel(folder)" @click="goToFolder(parentFolder(folder))">{{ folderLabel(folder) }}</el-button>
      <div v-loading="loading" class="entryList">
        <button v-for="entry in shownEntries" :key="entry.path" type="button" class="entry" :class="{ current: entry.path === comicPath }" :aria-current="entry.path === comicPath ? 'true' : undefined" :title="entry.path" :disabled="entry.type === 'file' && (disabled || writing)" @click="selectEntry(entry)">
          <component :is="entry.type === 'directory' ? IconFolder : IconBook2" :size="18" aria-hidden="true" />
          <span class="entryName">{{ entry.type === 'directory' ? entry.name : comicLabel(entry.path) }}</span>
          <small v-if="query && parentFolder(entry.path)">{{ folderLabel(parentFolder(entry.path)) }}</small>
          <icon-check v-if="entry.path === comicPath" :size="16" aria-hidden="true" />
          <icon-chevron-right v-else-if="entry.type === 'directory'" :size="16" aria-hidden="true" />
        </button>
      </div>
      <el-text v-if="errorMessage" type="danger" role="alert">{{ errorMessage }}</el-text>
      <el-text v-else-if="query && !loading && !shownEntries.length" type="info" role="status">未找到匹配的漫画</el-text>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, onBeforeUnmount, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { IconBook2, IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp, IconFolder, IconFolderPlus, IconPlus, IconSearch } from "@tabler/icons-vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { comicFolderRoot, isComicFile } from "./comicPersistence";
import { comicFileName, createComicProject } from "./comicProject";

const props = defineProps<{ directory: string; comicPath: string; disabled: boolean }>();
const emit = defineEmits<{ select: [path: string] }>();
const files = useWorkspaceFiles(props.directory);
type Entry = Awaited<ReturnType<typeof files.list>>["entries"][number];

const visible = ref(false);
const search = ref("");
const folder = ref(parentFolder(props.comicPath));
const entries = ref<Entry[]>([]);
const loading = ref(false);
const writing = ref(false);
const errorMessage = ref("");
let listRequest: AbortController | undefined;

const query = computed(() => search.value.trim().toLowerCase());
const actionsDisabled = computed(() => !props.directory || props.disabled || loading.value || writing.value);
const shownEntries = computed(() => entries.value.filter(entry => {
  if (!query.value) return parentFolder(entry.path) === folder.value;
  const label = entry.type === "file" ? comicLabel(entry.path) : entry.name;
  return label.toLowerCase().includes(query.value) || folderLabel(entry.path).toLowerCase().includes(query.value);
}));

function parentFolder(path: string) {
  const parent = path.slice(0, Math.max(0, path.lastIndexOf("/")));
  return parent === comicFolderRoot ? "" : parent;
}

function folderLabel(path: string) {
  return path.startsWith(`${comicFolderRoot}/`) ? path.slice(comicFolderRoot.length + 1) : path;
}

function comicLabel(path: string) {
  const name = path.split("/").at(-1) ?? comicFileName;
  return `漫画 ${name.slice("comicProject".length, -5) || "1"}`;
}

function goToFolder(path: string) {
  search.value = "";
  folder.value = path;
}

function selectEntry(entry: Entry) {
  if (entry.type === "directory") goToFolder(entry.path);
  else if (entry.path === props.comicPath) visible.value = false;
  else emit("select", entry.path);
}

function isNameConflict(error: unknown) {
  return axios.isAxiosError<{ data?: { code?: string } }>(error) && error.response?.status === 409 && error.response.data.data?.code === "EEXIST";
}

function fileError(error: unknown, fallback: string) {
  if (isNameConflict(error)) return "此名称已被占用";
  if (axios.isAxiosError<{ message?: string }>(error)) return error.response?.data.message || fallback;
  return error instanceof Error ? error.message : fallback;
}

async function reload() {
  listRequest?.abort();
  const request = new AbortController();
  listRequest = request;
  errorMessage.value = "";
  loading.value = true;
  try {
    const root = await files.list("", request.signal);
    const collected = root.entries.filter(entry => entry.type === "file" && isComicFile(entry.path));
    const folders = root.entries.some(entry => entry.type === "directory" && entry.path === comicFolderRoot) ? [comicFolderRoot] : [];
    while (folders.length) {
      const { entries } = await files.list(folders.pop()!, request.signal);
      for (const entry of entries) {
        if (entry.type === "directory") folders.push(entry.path);
        if (entry.type === "directory" || isComicFile(entry.path)) collected.push(entry);
      }
    }
    if (!collected.some(entry => entry.path === props.comicPath)) collected.push({ path: props.comicPath, name: comicLabel(props.comicPath), type: "file" });
    entries.value = collected.sort((left, right) => left.type === right.type
      ? left.path.localeCompare(right.path, "zh-CN", { numeric: true })
      : left.type === "directory" ? -1 : 1);
  } catch (error) {
    if (!request.signal.aborted) errorMessage.value = fileError(error, "读取漫画列表失败");
  } finally {
    if (listRequest === request) loading.value = false;
  }
}

async function createFolder() {
  if (actionsDisabled.value) return;
  const parent = folder.value || comicFolderRoot;
  writing.value = true;
  errorMessage.value = "";
  try {
    const { value } = await ElMessageBox.prompt("文件夹名称", "新建漫画文件夹", {
      confirmButtonText: "创建", cancelButtonText: "取消", inputValidator: value => {
        const name = value.trim();
        return !!name && name.length <= 120 && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !name.endsWith(".") && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || "请输入有效的文件夹名称";
      },
    });
    if (parent === comicFolderRoot) {
      const { entries } = await files.list();
      if (!entries.some(entry => entry.type === "directory" && entry.path === comicFolderRoot)) {
        try { await files.mkdir(comicFolderRoot); }
        catch (error) { if (!isNameConflict(error)) throw error; }
      }
    }
    await files.mkdir(`${parent}/${value.trim()}`);
    search.value = "";
    await reload();
  } catch (error) {
    if (error !== "cancel" && error !== "close") errorMessage.value = fileError(error, "新建漫画文件夹失败");
  } finally {
    writing.value = false;
  }
}

async function createComic() {
  if (actionsDisabled.value) return;
  const target = folder.value;
  writing.value = true;
  errorMessage.value = "";
  try {
    const { entries } = await files.list(target);
    const occupiedNames = new Set(entries.map(entry => entry.name.toLowerCase()));
    for (let number = 1; ; number++) {
      const stem = `comicProject${number === 1 ? "" : number}`;
      if (occupiedNames.has(`${stem}.json`.toLowerCase()) || occupiedNames.has(`${stem}Backup.json`.toLowerCase())) continue;
      const path = `${target ? `${target}/` : ""}${stem}.json`;
      try { await files.writeJson(path, createComicProject(comicLabel(path)), true); }
      catch (error) {
        if (!isNameConflict(error)) throw error;
        continue;
      }
      await reload();
      emit("select", path);
      return;
    }
  } catch (error) {
    errorMessage.value = fileError(error, "新建漫画失败");
  } finally {
    writing.value = false;
  }
}

onBeforeUnmount(() => listRequest?.abort());
</script>

<style scoped lang="scss">
.comicTrigger {
  flex-shrink: 0;
  height: 32px;
  padding: 0 6px;
  :deep(span) { gap: 4px; }
}

.comicPicker {
  display: grid;
  gap: 8px;

  .pickerToolbar {
    display: flex;
    align-items: center;
    gap: 4px;

    .el-input { min-width: 0; }
    .el-button { width: 30px; flex-shrink: 0; margin: 0; padding: 0; }
  }

  .backButton { justify-self: start; max-width: 100%; }

  .entryList {
    max-height: min(360px, calc(100dvh - 160px));
    overflow: auto;

    .entry {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-height: 36px;
      padding: 0 12px;
      border: 0;
      border-radius: var(--ui-radius);
      color: var(--el-text-color-primary);
      background: transparent;
      text-align: left;
      cursor: pointer;

      &:hover { background: var(--el-fill-color-light); }
      &.current { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
      &:disabled { cursor: not-allowed; opacity: 0.6; }
      svg { flex-shrink: 0; }
      .entryName { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      small { max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--el-text-color-secondary); }
    }
  }
}
</style>
