<template>
  <el-dialog v-model="visible" :title="category" width="min(1040px, calc(100vw - 40px))" alignCenter appendToBody class="compositionGallery">
    <template #header>
      <div class="compositionTabs" role="tablist" :aria-label="`${category}分类`">
        <button v-for="tab in tabs" :key="tab.id" type="button" role="tab" :aria-selected="activeTab === tab.id" @click="activeTab = tab.id">{{ tab.label }}</button>
      </div>
    </template>
    <div class="galleryToolbar"><el-input v-model="search" class="compositionSearch" :placeholder="`搜索${category}`" :aria-label="`搜索${category}`" :prefixIcon="IconSearch" clearable /><el-button v-if="kind === 'color'" class="createPaletteButton" @click="editorVisible = true"><icon-plus :size="16" aria-hidden="true" />创建配色</el-button></div>
    <div class="compositionGrid">
      <figure v-for="item in displayedCompositions" :key="item.name" class="compositionCard" :class="{ chosen: draft === item.name, colorCard: !!item.colors }">
        <div class="compositionPreview">
          <button class="compositionSelect" type="button" :aria-label="`选择${item.label}`" :aria-pressed="draft === item.name" @click="draft = item.name">
          <img :src="item.image" :alt="item.label" :class="{ thirdsPreview: item.name === 'thirds' }" loading="lazy" />
          <svg viewBox="0 0 1600 900" aria-hidden="true">
            <path v-for="(path, index) in item.paths" :key="index" :d="path" />
          </svg>
          </button>
          <button class="favoriteButton" :class="{ favorited: favorites.includes(item.name) }" type="button" :aria-label="`${favorites.includes(item.name) ? '取消收藏' : '收藏'}${item.label}`" :aria-pressed="favorites.includes(item.name)" @click="toggleFavorite(item.name)">
            <icon-star :size="16" :fill="favorites.includes(item.name) ? 'currentColor' : 'none'" aria-hidden="true" />
          </button>
        </div>
        <div v-if="item.colors" class="colorSwatches" aria-label="代表色卡"><span v-for="(color, index) in item.colors" :key="index" :style="{ background: color }" :title="color" /></div>
        <figcaption>{{ item.label }}</figcaption>
      </figure>
    </div>
    <template #footer>
      <div class="compositionFooter">
        <div class="selectedComposition"><img v-if="draftItem" :src="draftItem.image" :alt="draftItem.label" /><span v-if="draftItem">{{ draftItem.label }}</span></div>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :disabled="!draftItem" @click="confirmSelection">确定</el-button>
      </div>
    </template>
  </el-dialog>
  <colorPaletteEditor v-if="kind === 'color'" v-model="editorVisible" @created="onCreated" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElButton, ElDialog, ElInput, ElMessage } from "element-plus";
import { IconPlus, IconSearch, IconStar } from "@tabler/icons-vue";
import { compositions as compositionOptions } from "./compositionOptions";
import { colorOptions } from "./colorOptions";
import { getColorOptions, getCustomColorOption, isCustomColor, loadCustomColors } from "../customColors";
import colorPaletteEditor from "./colorPaletteEditor.vue";

const props = defineProps<{ kind?: "composition" | "color"; selectedSnapshot?: unknown }>();
const category = computed(() => props.kind === "color" ? "配色" : "构图");
const compositions = computed<{ name: string; label: string; image: string; paths: string[]; colors?: string[] }[]>(() => {
  if (props.kind !== "color") return compositionOptions;
  const options = getColorOptions();
  const snapshot = props.selectedSnapshot;
  return isCustomColor(snapshot) && snapshot.name === selected.value && !options.some(item => item.name === snapshot.name) ? [...options, getCustomColorOption(snapshot)] : options;
});
const visible = defineModel<boolean>({ default: false });
const selected = defineModel<string>("selected", { default: "" });
const tabs = computed(() => [{ id: "mine", label: `我的${category.value}` }, { id: "official", label: `官方${category.value}` }]);
const activeTab = ref("official");
const search = ref("");
const editorVisible = ref(false);
const draft = ref("");
const favorites = ref<string[]>([]);
const favoritesKey = computed(() => props.kind === "color" ? "toonflow.colorFavorites" : "toonflow.compositionFavorites");
const draftItem = computed(() => compositions.value.find(item => item.name === draft.value));
const displayedCompositions = computed(() => compositions.value
  .filter(item => (activeTab.value === "mine" ? favorites.value.includes(item.name) || item.name.startsWith("customColor") : props.kind !== "color" || colorOptions.some(color => color.name === item.name)) && item.label.toLowerCase().includes(search.value.trim().toLowerCase()))
  .map((item, index) => ({ ...item, index }))
  .sort((a, b) => Number(favorites.value.includes(b.name)) - Number(favorites.value.includes(a.name)) || a.index - b.index));
watch(visible, open => {
  if (!open) { editorVisible.value = false; return; }
  if (props.kind === "color" && !loadCustomColors()) ElMessage.error("本机配色读取失败，请先备份并恢复存储数据");
  draft.value = selected.value;
  search.value = "";
  if (props.kind === "color" && selected.value.startsWith("customColor")) activeTab.value = "mine";
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(favoritesKey.value) ?? "[]");
    favorites.value = Array.isArray(stored) ? stored.filter((name): name is string => typeof name === "string" && compositions.value.some(item => item.name === name)) : [];
  } catch { favorites.value = []; }
});
function toggleFavorite(name: string) {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(favoritesKey.value) ?? "[]");
    if (!Array.isArray(stored) || !stored.every(item => typeof item === "string")) throw new Error("收藏数据损坏");
    const current = [...new Set<string>(stored)];
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
  visible.value = false;
}

</script>

<style scoped lang="scss">
.compositionTabs {
  display: flex;
  gap: 20px;
  padding-right: 24px;
  button { padding: 4px 0; border: 0; background: transparent; color: var(--el-text-color-secondary); font: inherit; font-size: 14px; cursor: pointer; }
  button[aria-selected="true"] { color: var(--el-text-color-primary); font-weight: 600; }
}
.galleryToolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 4px 0 20px; .compositionSearch { width: min(240px, 100%); :deep(.el-input__wrapper) { background: #242424; box-shadow: none; border-radius: 10px; } :deep(.el-input__wrapper.is-focus) { box-shadow: 0 0 0 1px #888 inset; } }
  .createPaletteButton { flex-shrink: 0; background: #fff; border-color: #fff; color: #161616; border-radius: 9px; :deep(> span) { gap: 6px; } &:hover { background: #e9e9e9; border-color: #e9e9e9; } } }
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
  }
}
.compositionGrid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px 16px;
  height: 55vh;
  align-content: start;
  overflow-y: auto;
  padding: 4px;

  .compositionCard {
    min-width: 0;
    margin: 0;
    &.chosen .compositionPreview { outline: 1px solid #fff; outline-offset: 2px; }

    .compositionPreview {
      position: relative;
      overflow: hidden;
      aspect-ratio: 16 / 9;
      border-radius: 12px;
      background: var(--el-fill-color);
      .compositionSelect { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; }
      .compositionSelect:focus-visible { outline: 1px solid #fff; outline-offset: -2px; }
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
  --el-bg-color: #171717;
  --el-text-color-primary: #f0f0f0;
  --el-text-color-regular: #d0d0d0;
  --el-text-color-secondary: #999;
  padding: 20px 18px 16px;
  border: 1px solid #2c2c2c;
  border-radius: 24px;
  background: #171717;
  .el-dialog__header { padding-bottom: 16px; }
  .el-dialog__footer { padding-top: 24px; }
  .compositionFooter .el-button { min-width: 80px; height: 36px; margin-left: 0; border: 0; border-radius: 10px; background: #242424; color: #f0f0f0;
    &:hover { background: #333; }
    &.el-button--primary { background: #fff; color: #161616; }
    &.is-disabled { background: #242424; color: #777; }
  }
}
</style>
