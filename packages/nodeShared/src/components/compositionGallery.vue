<template>
  <el-dialog v-model="visible" :title="category" width="min(1040px, calc(100vw - 40px))" alignCenter appendToBody class="compositionGallery galleryPicker">
    <template #header>
      <div class="compositionTabs" :class="{ styleTabList: kind === 'style' }" role="tablist" :aria-label="`${category}分类`">
        <button v-for="tab in tabs" :key="tab.id" type="button" role="tab" :aria-selected="activeTab === tab.id" @click="activeTab = tab.id">{{ tab.label }}</button>
      </div>
    </template>
    <div v-if="kind === 'style'" class="compositionTabs styleTabs styleTabList" :class="{ hiddenStyleTabs: activeTab !== 'official' }" :inert="activeTab !== 'official'" role="tablist" aria-label="官方风格分类">
      <button v-for="tab in styleTabs" :key="tab.id" type="button" role="tab" :aria-selected="styleTab === tab.id" @click="styleTab = tab.id">{{ tab.label }}</button>
    </div>
    <div class="galleryToolbar">
      <el-input v-model="search" class="compositionSearch" :placeholder="`搜索${category}`" :aria-label="`搜索${category}`" :prefixIcon="IconSearch" clearable />
      <el-button v-if="kind === 'color' || kind === 'style' && activeTab === 'mine'" class="createPaletteButton" @click="editorVisible = true">
        <icon-plus :size="16" aria-hidden="true" />创建{{ category }}
      </el-button>
    </div>
    <div ref="grid" class="compositionGrid">
      <p v-if="!displayedCompositions.length" class="galleryEmpty">{{ emptyMessage }}</p>
      <figure v-for="item in displayedCompositions" :key="item.name" class="compositionCard" :class="{ chosen: draft === item.name, colorCard: !!item.colors }">
        <div class="compositionPreview">
          <button class="compositionSelect" type="button" :aria-label="`选择${item.label}`" :aria-pressed="draft === item.name" @click="draft = item.name">
          <img v-if="item.image" :src="item.image" :alt="item.label" :class="{ thirdsPreview: item.name === 'thirds' }" loading="lazy" />
          <span v-else>{{ item.label }}</span>
          <svg v-if="item.paths?.length" viewBox="0 0 1600 900" aria-hidden="true">
            <path v-for="(path, index) in item.paths" :key="index" :d="path" />
          </svg>
          </button>
          <button class="favoriteButton" :class="{ favorited: favorites.includes(item.name), styleFavorite: kind === 'style' }" type="button" :aria-label="`${favorites.includes(item.name) ? '取消收藏' : '收藏'}${item.label}`" :aria-pressed="favorites.includes(item.name)" @click="toggleFavorite(item.name)">
            <icon-star :size="16" :fill="favorites.includes(item.name) ? 'currentColor' : 'none'" aria-hidden="true" />
          </button>
        </div>
        <div v-if="item.colors" class="colorSwatches" aria-label="代表色卡"><span v-for="(color, index) in item.colors" :key="index" :style="{ background: color }" :title="color" /></div>
        <figcaption v-if="item.image">{{ item.label }}</figcaption>
      </figure>
    </div>
    <template #footer>
      <div class="compositionFooter">
        <div class="selectedComposition"><img v-if="draftItem?.image" :src="draftItem.image" :alt="draftItem.label" /><span v-if="draftItem">{{ draftItem.label }}</span></div>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :disabled="!draftItem" @click="confirmSelection">确定</el-button>
      </div>
    </template>
  </el-dialog>
  <colorPaletteEditor v-if="kind === 'color'" v-model="editorVisible" @created="onCreated" />
  <stylePresetEditor v-if="kind === 'style' && editorVisible" v-model="editorVisible" @created="onCreated" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElButton, ElDialog, ElInput, ElMessage } from "element-plus";
import { IconPlus, IconSearch, IconStar } from "@tabler/icons-vue";
import { compositions as compositionOptions } from "./compositionOptions";
import { colorOptions } from "./colorOptions";
import { liveActionStylePresets, musicVideoStylePresets, stylePresets } from "../stylePresets";
import { twoDStylePresets } from "../twoDStylePresets";
import { threeDStylePresets } from "../threeDStylePresets";
import { getColorOptions, getCustomColorOption, isCustomColor, loadCustomColors } from "../customColors";
import { customStyles, isCustomStyle, loadCustomStyles } from "../customStyles";
import colorPaletteEditor from "./colorPaletteEditor.vue";
import stylePresetEditor from "./stylePresetEditor.vue";

const props = defineProps<{ kind?: "composition" | "color" | "style"; selectedSnapshot?: unknown }>();
const category = computed(() => props.kind === "style" ? "风格" : props.kind === "color" ? "配色" : "构图");
type GalleryItem = { name: string; label: string; image?: string; paths?: string[]; colors?: string[] };
const compositions = computed<readonly GalleryItem[]>(() => {
  if (props.kind === "style") {
    const snapshot = props.selectedSnapshot;
    const ownStyles = customStyles.value;
    const missingSnapshot = isCustomStyle(snapshot) && snapshot.name === selected.value && !ownStyles.some(item => item.name === snapshot.name);
    return [...stylePresets, ...ownStyles, ...(missingSnapshot ? [snapshot] : [])];
  }
  if (props.kind !== "color") return compositionOptions;
  const options = getColorOptions();
  const snapshot = props.selectedSnapshot;
  return isCustomColor(snapshot) && snapshot.name === selected.value && !options.some(item => item.name === snapshot.name) ? [...options, getCustomColorOption(snapshot)] : options;
});
const visible = defineModel<boolean>({ default: false });
const selected = defineModel<string>("selected", { default: "" });
const tabs = computed(() => {
  const official = { id: "official", label: `官方${category.value}` };
  const mine = { id: "mine", label: `我的${category.value}` };
  return [
    official,
    mine,
    { id: "favorites", label: "我的收藏" },
    { id: "recent", label: "最近使用" },
  ];
});
const styleTabs = [
  { id: "all", label: "全部" },
  { id: "liveAction", label: "真人风格" },
  { id: "musicVideo", label: "MV风格" },
  { id: "twoD", label: "2D风格" },
  { id: "threeD", label: "3D风格" },
];
const styleTab = ref("all");
const activeTab = ref("official");
const search = ref("");
const grid = ref<HTMLElement>();
watch([activeTab, styleTab, search], () => {
  if (grid.value) grid.value.scrollTop = 0;
}, { flush: "post" });
const editorVisible = ref(false);
const draft = ref("");
const favorites = ref<string[]>([]);
const recent = ref<string[]>([]);
const recentKey = computed(() => props.kind === "style" ? "toonflow.recentStyles" : props.kind === "color" ? "toonflow.recentColors" : "toonflow.recentCompositions");
const favoritesKey = computed(() => props.kind === "style" ? "toonflow.styleFavorites" : props.kind === "color" ? "toonflow.colorFavorites" : "toonflow.compositionFavorites");
const emptyMessage = computed(() => {
  if (search.value.trim()) return `没有匹配的${category.value}`;
  if (activeTab.value === "recent") return `应用${category.value}后会显示在这里`;
  if (activeTab.value === "favorites") return `还没有收藏的${category.value}`;
  return props.kind === "style" && activeTab.value === "mine" ? "还没有自定义风格" : `暂无${category.value}`;
});
const draftItem = computed(() => compositions.value.find(item => item.name === draft.value));
const tabCompositions = computed<readonly GalleryItem[]>(() => {
  if (activeTab.value === "favorites") return compositions.value.filter(item => favorites.value.includes(item.name));
  if (activeTab.value === "recent") return recent.value.flatMap(name => {
    const item = compositions.value.find(item => item.name === name);
    return item ? [item] : [];
  });
  if (props.kind !== "style") {
    if (activeTab.value === "mine") return compositions.value.filter(item => favorites.value.includes(item.name) || isCustomColor(item));
    return props.kind === "color" ? colorOptions : compositions.value;
  }
  if (activeTab.value === "mine") return compositions.value.filter(isCustomStyle);
  if (styleTab.value === "liveAction") return liveActionStylePresets;
  if (styleTab.value === "musicVideo") return musicVideoStylePresets;
  if (styleTab.value === "twoD") return twoDStylePresets;
  if (styleTab.value === "threeD") return threeDStylePresets;
  return stylePresets;
});
const displayedCompositions = computed(() => {
  const query = search.value.trim().toLowerCase();
  const matching = tabCompositions.value.filter(item => item.label.toLowerCase().includes(query));
  if (props.kind === "style" || activeTab.value === "favorites" || activeTab.value === "recent") return matching;
  return matching.sort((a, b) => Number(favorites.value.includes(b.name)) - Number(favorites.value.includes(a.name)));
});
function readGalleryIds(key: string) {
  const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
  if (!Array.isArray(stored) || !stored.every(item => typeof item === "string")) throw new Error("记录格式无效");
  return [...new Set<string>(stored)];
}
watch(visible, open => {
  if (!open) { editorVisible.value = false; return; }
  if (props.kind === "color" && !loadCustomColors()) ElMessage.error("本机配色读取失败，请先备份并恢复存储数据");
  draft.value = selected.value;
  search.value = "";
  if (props.kind === "style") {
    if (!loadCustomStyles()) ElMessage.error("本机风格数据读取失败");
    activeTab.value = isCustomStyle(draftItem.value) ? "mine" : "official";
    if (threeDStylePresets.some(item => item.name === draft.value)) styleTab.value = "threeD";
    else if (twoDStylePresets.some(item => item.name === draft.value)) styleTab.value = "twoD";
    else if (musicVideoStylePresets.some(item => item.name === draft.value)) styleTab.value = "musicVideo";
    else if (!draft.value || liveActionStylePresets.some(item => item.name === draft.value)) styleTab.value = "liveAction";
    else styleTab.value = "all";
  }
  if (props.kind === "color" && selected.value.startsWith("customColor")) activeTab.value = "mine";
  try { favorites.value = readGalleryIds(favoritesKey.value); }
  catch { favorites.value = []; }
  try { recent.value = readGalleryIds(recentKey.value); }
  catch { recent.value = []; }
});
function toggleFavorite(name: string) {
  try {
    const current = readGalleryIds(favoritesKey.value);
    const next = current.includes(name) ? current.filter(item => item !== name) : [...current, name];
    localStorage.setItem(favoritesKey.value, JSON.stringify(next));
    favorites.value = next;
  } catch { ElMessage.error("收藏保存失败，请检查浏览器存储空间"); }
}
function onCreated(name: string) {
  activeTab.value = "mine";
  search.value = "";
  draft.value = name;
}
function confirmSelection() {
  if (!draftItem.value) return;
  selected.value = draft.value;
  try {
    const next = [draft.value, ...readGalleryIds(recentKey.value).filter(name => name !== draft.value)].slice(0, 50);
    localStorage.setItem(recentKey.value, JSON.stringify(next));
    recent.value = next;
  } catch { ElMessage.error("最近使用记录保存失败"); }
  visible.value = false;
}

</script>

<style scoped lang="scss">
.compositionTabs {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  padding-right: 24px;
  button { padding: 4px 0; border: 0; background: transparent; color: var(--el-text-color-secondary); font: inherit; font-size: 14px; cursor: pointer; }
  button[aria-selected="true"] { color: var(--el-color-primary); font-weight: 600; }
  &.styleTabList button { font-weight: 600; }
}
.styleTabs { margin-bottom: 10px; }
.hiddenStyleTabs { visibility: hidden; }
.galleryEmpty { grid-column: 1 / -1; margin: 40px 0; text-align: center; color: var(--el-text-color-secondary); }
.galleryToolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 4px 0 20px;
  .compositionSearch {
    width: min(240px, 100%);
    :deep(.el-input__wrapper) { background: var(--el-fill-color); box-shadow: none; border-radius: 10px; }
    :deep(.el-input__wrapper.is-focus) { box-shadow: 0 0 0 1px var(--el-color-primary) inset; }
  }
  .createPaletteButton {
    flex-shrink: 0;
    background: var(--el-color-primary);
    border-color: var(--el-color-primary);
    color: var(--ui-primary-foreground, #fff);
    border-radius: 9px;
    :deep(> span) { gap: 6px; }
    &:hover { background: var(--el-color-primary-dark-2); border-color: var(--el-color-primary-dark-2); }
  }
}
.compositionFooter {
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 0;
  padding-top: 14px;
  .selectedComposition {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    min-height: 40px;
    text-align: left;
    font-size: 12px;
    img { width: 72px; height: 40px; border-radius: 7px; object-fit: cover; }
    span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  }
}
.compositionGrid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px 16px;
  flex: 1;
  min-height: 0;
  align-content: start;
  overflow-y: auto;
  padding: 4px;
  scrollbar-gutter: stable;

  .compositionCard {
    min-width: 0;
    margin: 0;
    &.chosen .compositionPreview { outline: 1px solid var(--el-color-primary); outline-offset: 2px; }

    .compositionPreview {
      position: relative;
      overflow: hidden;
      aspect-ratio: 16 / 9;
      border-radius: 12px;
      background: var(--el-fill-color);
      .compositionSelect { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; }
      .compositionSelect > span { display: inline-block; max-width: calc(100% - 16px); overflow-wrap: anywhere; color: var(--el-text-color-primary); font-size: 13px; }
      .compositionSelect:focus-visible { outline: 1px solid var(--el-color-primary); outline-offset: -2px; }
      .favoriteButton {
        position: absolute;
        z-index: 1;
        top: 7px;
        left: 7px;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid #ffffff30;
        border-radius: 8px;
        background: #161b20bd;
        color: #fff;
        opacity: 0;
        cursor: pointer;
        transition: opacity 140ms ease;
        &.favorited { opacity: 1; color: #e4c58c; }
        &.styleFavorite.favorited { color: #fff; }
        &:focus-visible { opacity: 1; outline: 2px solid var(--el-color-primary); }
      }
      &:hover .favoriteButton, &:focus-within .favoriteButton { opacity: 1; }
      @media (hover: none) { .favoriteButton { opacity: 1; } }

      img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; }
      .thirdsPreview { position: absolute; width: 133.333333%; height: 133.333333%; left: 0; top: -16.931217%; max-width: none; }
      .compositionSelect > svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        filter: drop-shadow(0 1px 2px #000b);

        path { fill: none; stroke: #fff; stroke-width: 1.2; stroke-dasharray: 5 4; stroke-linecap: round; vector-effect: non-scaling-stroke; }
      }
    }
    .colorSwatches {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 7px;
      span { width: 18px; height: 18px; flex: 0 1 18px; border-radius: 999px; box-shadow: inset 0 0 0 1px #80808020;
        &:first-child { width: 36px; flex-basis: 36px; }
      }
    }
    figcaption { text-align: left; margin: 9px 2px 0; color: var(--el-text-color-primary); font-size: 13px; line-height: 1.5; }

  }
  @media (max-width: 720px) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>

<style lang="scss">
.compositionGallery.el-dialog {
  padding: 20px 18px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 24px;
  background: var(--el-bg-color-overlay);
  .el-dialog__header { padding-bottom: 16px; }
  .el-dialog__footer { padding-top: 24px; }
  &.galleryPicker {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    height: min(644px, calc(100dvh - 40px));
    .el-dialog__body {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-height: 0;
      > :not(.compositionGrid) { flex-shrink: 0; }
    }
  }
  .compositionFooter .el-button {
    min-width: 80px;
    height: 36px;
    margin-left: 0;
    border: 0;
    border-radius: 10px;
    background: var(--el-fill-color);
    color: var(--el-text-color-primary);
    &:hover { background: var(--el-fill-color-dark); }
    &.el-button--primary {
      background: var(--el-color-primary);
      color: var(--ui-primary-foreground, #fff);
      &:hover { background: var(--el-color-primary-dark-2); }
    }
    &.is-disabled { background: var(--el-fill-color); color: var(--el-text-color-disabled); }
  }
}
</style>
