<template>
  <el-popover v-if="inline && replaceable" ref="replacePopover" v-model:visible="replaceVisible" trigger="click" placement="bottom-end" :appendTo="historyTarget" :width="180" :disabled="disabled" :showArrow="false" :persistent="false" :popperStyle="{ padding: '6px' }">
    <template #reference>
      <el-button class="historyTrigger replaceTrigger nodrag nopan nowheel" :icon="IconTransfer" :disabled="disabled" :aria-expanded="replaceVisible" title="替换素材" aria-label="替换素材" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @keydown.stop />
    </template>
    <div class="replaceMenu nodrag nopan nowheel" role="group" aria-label="替换素材来源" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @keydown.stop @wheel.stop>
      <el-button :icon="IconUpload" :disabled="disabled" text @click="replaceVisible = false; emit('upload')">本地上传</el-button>
      <el-button :icon="IconPhoto" :disabled="disabled" text @click="replaceVisible = false; canvasVisible = true">画布图片</el-button>
    </div>
  </el-popover>
  <el-popover v-if="inline" ref="historyPopover" v-model:visible="visible" trigger="click" placement="right-start" :appendTo="historyTarget" :width="280" :disabled="disabled" :showArrow="false" :persistent="false" :popperStyle="{ padding: '12px', maxWidth: 'calc(100vw - 24px)' }">
    <template #reference>
      <el-button ref="historyTrigger" class="historyTrigger nodrag nopan nowheel" :icon="IconHistory" :disabled="disabled" :aria-expanded="visible" title="历史记录" aria-label="历史记录" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @keydown.stop />
    </template>
    <section v-loading="loading" class="imageHistoryPanel nodrag nopan nowheel" aria-label="节点历史" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @keydown.stop @wheel.stop>
      <div class="historyHeader"><span>节点历史</span><span class="historyCount">{{ items.length }} {{ mediaType === 'video' ? '段' : '张' }}</span></div>
      <el-alert v-if="loadError || previewError" :title="loadError || previewError" type="error" :closable="false" />
      <div v-if="!loading && !items.length && !loadError" class="historyEmpty">暂无历史记录</div>
      <div class="imageHistoryList">
        <div v-for="(item, index) in pageItems" :key="item.url" class="imageHistoryRow" :class="{ current: item.url === currentUrl }">
          <button class="selectHistory" type="button" :disabled="disabled || loading" :aria-pressed="item.url === currentUrl" :aria-label="`切换到历史${mediaLabel} ${(page - 1) * pageSize + index + 1}`" @click="chooseMedia(item)">
            <promptReferenceThumbnail class="historyThumbnail" :dataType="mediaType === 'video' ? 'VIDEO' : 'IMAGE'" :media="item" />
            <span class="historyName">{{ mediaLabel }} {{ (page - 1) * pageSize + index + 1 }}</span>
            <span v-if="item.url === currentUrl" class="currentBadge">当前</span>
            <span v-else-if="item.url === selected?.url && !previewOnly" class="currentBadge">切换中</span>
          </button>
          <el-button class="expandHistory" :icon="IconMaximize" text :disabled="disabled || loading" title="放大预览" :aria-label="`放大历史${mediaLabel} ${(page - 1) * pageSize + index + 1}`" @click="chooseMedia(item, true)" />
        </div>
      </div>
      <el-pagination v-model:currentPage="page" :pageSize="pageSize" :total="items.length" layout="prev, pager, next" hideOnSinglePage small />
      <template v-if="mediaSrc && selected">
        <img v-if="mediaType === 'image'" class="pendingPreview" :src="mediaSrc" alt="" aria-hidden="true" @load="readPreview" @error="previewFailed" />
        <video v-else class="pendingPreview" :src="mediaSrc" muted playsinline preload="auto" aria-hidden="true" @loadeddata="readPreview" @error="previewFailed" />
      </template>
    </section>
  </el-popover>
  <el-button v-else :icon="IconHistory" :disabled="disabled" text title="历史记录" aria-label="历史记录" @click.stop="visible = true">历史记录</el-button>
  <el-dialog v-if="inline && replaceable" v-model="canvasVisible" title="选择画布图片" width="min(620px, calc(100vw - 32px))" appendToBody destroyOnClose>
    <div class="canvasImagePicker nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @keydown.stop>
      <el-alert v-if="previewError" :title="previewError" type="error" :closable="false" />
      <el-empty v-if="!canvasImages.length" description="画布中暂无其它可用图片" />
      <div v-else class="canvasImageGrid">
        <button v-for="item in canvasPageItems" :key="item.key" type="button" class="canvasImageItem" :disabled="disabled || (!!selected && !previewError)" :title="item.name" :aria-label="`使用画布图片：${item.name}`" @click="item.file.url === currentUrl ? canvasVisible = false : chooseMedia(item.file)">
          <promptReferenceThumbnail class="canvasThumbnail" dataType="IMAGE" :media="item.file" />
          <span class="canvasImageName">{{ item.name }}</span>
          <span v-if="item.file.url === currentUrl" class="canvasCurrent">当前图片</span>
        </button>
      </div>
      <el-pagination v-model:currentPage="canvasPage" :pageSize="pageSize" :total="canvasImages.length" layout="prev, pager, next" hideOnSinglePage />
      <img v-if="mediaSrc && selected" class="pendingPreview" :src="mediaSrc" alt="" aria-hidden="true" @load="readPreview" @error="previewFailed" />
    </div>
  </el-dialog>
  <el-image-viewer v-if="mediaType === 'image' && viewerVisible && mediaSrc" :urlList="[mediaSrc]" teleported @close="viewerVisible = false; selected = undefined" />
  <el-dialog v-if="mediaType === 'video'" v-model="viewerVisible" title="视频预览" width="min(960px, calc(100vw - 32px))" appendToBody destroyOnClose @closed="selected = undefined">
    <video v-if="viewerVisible && mediaSrc" class="historyVideoPreview nodrag nopan nowheel" :src="mediaSrc" controls playsinline preload="auto" aria-label="历史视频放大预览" @dblclick.stop @keydown.stop @error="previewFailed" />
    <el-alert v-if="previewError" :title="previewError" type="error" :closable="false" />
  </el-dialog>
  <el-dialog v-if="!inline" v-model="visible" :title="`${mediaType === 'image' ? '图片' : '视频'}历史记录`" width="min(760px, calc(100vw - 32px))" appendToBody destroyOnClose>
    <div v-loading="loading" class="mediaHistory nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop>
      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
      <el-empty v-else-if="!loading && !items.length" description="暂无历史记录" />
      <template v-else-if="items.length">
        <div class="historyContent">
          <div class="historyList" aria-label="历史文件">
            <button
              v-for="item in pageItems"
              :key="item.url"
              type="button"
              class="historyItem"
              :class="{ selected: selected?.url === item.url }"
              :aria-pressed="selected?.url === item.url"
              :title="item.url"
              @click="selected = item">
              <span class="fileName">{{ item.url.split('/').at(-1) }}</span>
              <span v-if="item.url === current?.url.replaceAll('\\', '/')" class="currentLabel">当前结果</span>
            </button>
          </div>
          <div class="historyPreview" v-loading="!!selected && !previewReady && !previewError" :aria-busy="preparingPreview">
            <el-alert v-if="previewError" :title="previewError" type="error" :closable="false" />
            <img v-else-if="mediaSrc && mediaType === 'image'" :src="mediaSrc" alt="历史图片预览" @load="readPreview" @error="previewFailed" />
            <video v-else-if="mediaSrc" :src="mediaSrc" controls playsinline preload="auto" aria-label="历史视频预览" @loadeddata="readPreview" @error="previewFailed" />
          </div>
        </div>
        <el-pagination v-model:currentPage="page" :pageSize="pageSize" :total="items.length" layout="prev, pager, next" hideOnSinglePage />
      </template>
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" :disabled="disabled || loading || !selected || !previewUrl || !previewReady || !!previewError" @click="selectOutput">设为当前结果</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElAlert, ElButton, ElDialog, ElEmpty, ElLoading, ElPagination, ElPopover, ElImageViewer } from "element-plus";
import { IconHistory, IconMaximize, IconTransfer, IconUpload, IconPhoto } from "@tabler/icons-vue";
import { useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import { isNodeOutput, type NodeMediaValue } from "@toonflow/nodes-scaffold/values";
import { useMediaPreview } from "../mediaPreview";
import { getMediaMimeType } from "../mediaTypes";
import promptReferenceThumbnail from "./promptReferenceThumbnail.vue";

const props = defineProps<{ mediaType: "image" | "video"; current?: NodeMediaValue; disabled?: boolean; inline?: boolean; replaceable?: boolean }>();
const emit = defineEmits<{ select: [value: NodeMediaValue]; upload: [] }>();
const vLoading = ElLoading.directive;
const { id, node } = useNode();
const { viewport, getNodes } = useVueFlow();
const files = useNodeFiles();
const visible = ref(false);
const replaceVisible = ref(false);
const canvasVisible = ref(false);
const canvasPage = ref(1);
const replacePopover = ref<InstanceType<typeof ElPopover>>();
const historyPopover = ref<InstanceType<typeof ElPopover>>();
const historyTrigger = ref<InstanceType<typeof ElButton>>();
const historyTarget = computed(() => {
  const element = historyTrigger.value?.$el as HTMLElement | undefined;
  return element?.closest<HTMLElement>(".vue-flow__node") ?? element?.closest<HTMLElement>(".nodeSkeleton") ?? undefined;
});
watch(() => (visible.value || replaceVisible.value) && props.inline ? [viewport.value.x, viewport.value.y, viewport.value.zoom,
  node.computedPosition.x, node.computedPosition.y, node.dimensions.width, node.dimensions.height] : [], () => {
  void historyPopover.value?.popperRef?.popperInstanceRef?.update();
  void replacePopover.value?.popperRef?.popperInstanceRef?.update();
}, { flush: "post" });
const viewerVisible = ref(false);
const previewOnly = ref(false);
const loading = ref(false);
const loadError = ref("");
const previewReadError = ref("");
const previewReady = ref(false);
const items = ref<NodeMediaValue[]>([]);
const mediaLabel = computed(() => props.mediaType === "video" ? "视频" : "图片");
const currentUrl = computed(() => props.current?.url.replaceAll("\\", "/"));
const selected = ref<NodeMediaValue>();
const page = ref(1);
const pageSize = 20;
const canvasImages = computed(() => !canvasVisible.value ? [] : getNodes.value.flatMap(source => source.id === id ? [] :
  Object.entries(source.data.outputs ?? {}).flatMap(([handle, output]) => isNodeOutput(output) && output.dataType === "IMAGE"
    ? [{ key: `${source.id}:${handle}`, name: String(source.data.label || "图片"), file: { ...output.value, url: output.value.url.replaceAll("\\", "/") } }] : [])));
const canvasPageItems = computed(() => canvasImages.value.slice((canvasPage.value - 1) * pageSize, canvasPage.value * pageSize));
const pageItems = computed(() => items.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const previewFile = computed(() => visible.value || viewerVisible.value || canvasVisible.value ? selected.value : undefined);
watch(previewFile, () => { previewReadError.value = ""; }, { flush: "sync" });
// ACT: 仅展开时读取历史，每页最多加载 20 张缩略图；海量目录需服务端分页时再扩展 list。
const previewUrl = files.useFileUrl(previewFile, () => { previewReadError.value = "历史文件读取失败，文件可能已被移动或删除"; });
const { src: mediaSrc, preparing: preparingPreview, error: mediaError, handleError, handleLoaded } = useMediaPreview(previewUrl, () => props.mediaType);
const previewError = computed(() => previewReadError.value || mediaError.value);
watch([previewFile, mediaSrc], () => { previewReady.value = false; }, { flush: "sync" });

watch(() => props.disabled, disabled => { if (disabled) visible.value = replaceVisible.value = canvasVisible.value = false; });
watch(replaceVisible, open => { if (open) visible.value = false; });
watch(canvasVisible, () => { canvasPage.value = 1; selected.value = undefined; });
watch([visible, () => props.inline ? props.current?.url : undefined], async ([open], _previous, onCleanup) => {
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  if (!viewerVisible.value) selected.value = undefined;
  loadError.value = "";
  page.value = 1;
  loading.value = false;
  if (!open) return;
  items.value = [];
  loading.value = true;
  try {
    const { entries } = await files.getWorkspaceFiles().list(`assets/${id}`).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
      if (error.response?.data?.data?.code !== "ENOENT") throw error;
      return { entries: [] };
    });
    if (cancelled) return;
    const results = new Map<string, NodeMediaValue>();
    for (const entry of entries) {
      const mimeType = getMediaMimeType({ name: entry.name, type: "" });
      if (entry.type === "file" && mimeType?.startsWith(`${props.mediaType}/`)) {
        const url = entry.path.replaceAll("\\", "/");
        results.set(url, { url, mimeType });
      }
    }
    // ACT: 副本使用新 ID，但当前结果仍可能引用原节点文件；只补当前结果，不继承原目录的全部历史。
    const current = props.current && { ...props.current, url: props.current.url.replaceAll("\\", "/") };
    if (current) results.set(current.url, current);
    items.value = [...results.values()].sort((left, right) => left.url.localeCompare(right.url, "zh-CN", { numeric: true }));
    selected.value = props.inline ? undefined : current ?? items.value[0];
    page.value = Math.floor(Math.max(0, items.value.findIndex(item => item.url === current?.url)) / pageSize) + 1;
  } catch (error) {
    if (!cancelled) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      loadError.value = message || (error instanceof Error ? error.message : "历史记录读取失败");
    }
  } finally {
    if (!cancelled) loading.value = false;
  }
});

function chooseMedia(item: NodeMediaValue, preview = false) {
  if (props.disabled || loading.value || (!preview && item.url === currentUrl.value)) return;
  previewOnly.value = preview;
  if (selected.value?.url === item.url && previewReady.value && !previewError.value) completeMediaAction();
  else selected.value = item;
}

function completeMediaAction() {
  if (props.disabled || loading.value || !selected.value || !previewReady.value || previewError.value) return;
  if (previewOnly.value) {
    viewerVisible.value = true;
    visible.value = false;
  } else selectOutput();
}

function readPreview(event: Event) {
  previewReady.value = handleLoaded(event);
  if (props.inline && previewReady.value) completeMediaAction();
}

function previewFailed(event: Event) {
  previewReady.value = false;
  handleError(event);
}

function selectOutput() {
  if (props.disabled || loading.value || !selected.value || !previewUrl.value || !previewReady.value || previewError.value) return;
  emit("select", { ...selected.value });
  canvasVisible.value = false;
  if (props.inline) selected.value = undefined;
  else visible.value = false;
}
</script>

<style scoped lang="scss">
.historyVideoPreview { display: block; width: 100%; max-height: 75vh; background: #000; }

.historyTrigger {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 6px;
  border-radius: 6px;
  --el-button-bg-color: rgb(20 22 27 / 78%);
  --el-button-border-color: rgb(255 255 255 / 20%);
  --el-button-text-color: #fff;
  --el-button-hover-bg-color: rgb(20 22 27 / 94%);
  --el-button-hover-border-color: rgb(255 255 255 / 45%);
  --el-button-hover-text-color: #fff;

  &::before { content: ""; position: absolute; inset: -2px; border-radius: 8px; }
  &.replaceTrigger { right: 40px; }
}

.replaceMenu {
  display: flex;
  flex-direction: column;
  gap: 2px;

  .el-button {
    justify-content: flex-start;
    height: 38px;
    margin: 0;
    padding: 0 10px;
    border-radius: 6px;
  }
}

.canvasImagePicker {
  .canvasImageGrid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    max-height: 400px;
    overflow-y: auto;

    .canvasImageItem {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      min-width: 0;
      padding: 8px;
      border: 1px solid var(--el-border-color-light);
      border-radius: 8px;
      background: var(--el-fill-color-light);
      color: var(--el-text-color-primary);
      font: inherit;
      cursor: pointer;

      &:hover:not(:disabled) { border-color: var(--el-color-primary); }
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
      &:disabled { opacity: 0.5; cursor: default; }
      .canvasThumbnail { width: 100%; height: 96px; }
      .canvasImageName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
      .canvasCurrent { color: var(--el-color-primary); font-size: 11px; }
    }
  }

  .el-pagination { justify-content: center; margin-top: 12px; }
  .pendingPreview { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
}

.imageHistoryPanel {
  .historyHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 4px 10px;
    font-weight: 600;

    .historyCount { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 400; }
  }

  .historyEmpty { padding: 16px 4px; color: var(--el-text-color-secondary); text-align: center; }
  .imageHistoryList {
    max-height: 320px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;

    .imageHistoryRow {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      border: 1px solid transparent;
      border-radius: 8px;

      & + .imageHistoryRow { margin-top: 4px; }
      &:hover { background: var(--el-fill-color); }
      &.current { background: var(--el-fill-color-light); border-color: var(--el-border-color-light); }

      .selectHistory {
        display: flex;
        flex: 1;
        align-items: center;
        gap: 10px;
        min-width: 0;
        padding: 3px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--el-text-color-primary);
        font: inherit;
        text-align: left;
        cursor: pointer;

        &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
        &:disabled { cursor: default; opacity: 0.5; }
        .historyThumbnail { width: 42px; height: 42px; border-radius: 6px; }
        .historyName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .currentBadge { flex-shrink: 0; padding: 1px 5px; border-radius: 4px; background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-size: 11px; }
      }

      .expandHistory { flex-shrink: 0; width: 32px; height: 32px; padding: 0; margin: 0; }
    }
  }

  .el-pagination { justify-content: center; margin-top: 8px; }
  .pendingPreview { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
}

.mediaHistory {
  min-height: 300px;

  .historyContent {
    display: grid;
    grid-template-columns: minmax(140px, 1fr) minmax(0, 2fr);
    gap: 16px;

    .historyList {
      height: 360px;
      overflow: auto;

      .historyItem {
        display: block;
        width: 100%;
        padding: 10px;
        border: 1px solid transparent;
        border-radius: var(--el-border-radius-base);
        background: transparent;
        color: var(--el-text-color-primary);
        font: inherit;
        text-align: left;
        cursor: pointer;

        &:hover { background: var(--el-fill-color-light); }
        &.selected { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
        &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
        .fileName { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .currentLabel { color: var(--el-color-primary); font-size: 12px; }
      }
    }

    .historyPreview {
      display: grid;
      place-items: center;
      height: 360px;
      min-width: 0;
      background: var(--el-fill-color-light);
      border-radius: var(--el-border-radius-base);

      img, video { width: 100%; max-height: 360px; object-fit: contain; }
    }
  }

  .el-pagination { justify-content: center; margin-top: 16px; }
}
</style>
