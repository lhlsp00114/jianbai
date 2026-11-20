import { computed, ref } from "vue";
import { colorOptions } from "./components/colorOptions";

export type CustomColor = { name: string; label: string; colors: string[] };
const storageKey = "toonflow.customColorPalettes";
export const customColors = ref<CustomColor[]>([]);

export function isCustomColor(item: unknown): item is CustomColor {
  if (!item || typeof item !== "object") return false;
  const value = item as Partial<CustomColor>;
  return typeof value.name === "string" && /^customColor[\da-f-]{36}$/i.test(value.name)
    && typeof value.label === "string" && value.label.trim().length > 0 && value.label.length <= 40
    && Array.isArray(value.colors) && value.colors.length >= 2 && value.colors.length <= 8
    && value.colors.every(color => typeof color === "string" && /^#[\da-f]{6}$/i.test(color));
}
export function readCustomColors(): CustomColor[] {
  const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
  if (!Array.isArray(stored) || !stored.every(isCustomColor) || new Set(stored.map(item => item.name)).size !== stored.length) throw new Error("本机配色数据损坏，请先备份后恢复");
  return stored;
}
export function loadCustomColors() {
  try {
    const stored = readCustomColors();
    if (JSON.stringify(stored) !== JSON.stringify(customColors.value)) customColors.value = stored;
    return true;
  } catch { return false; }
}

export function saveCustomColor(label: string, colors: string[]) {
  if (!label.trim() || label.trim().length > 40 || colors.length < 2 || colors.length > 8 || !colors.every(color => /^#[\da-f]{6}$/i.test(color))) throw new Error("请填写名称并选择 2 至 8 个有效颜色");
  const stored = readCustomColors();
  const item = { name: `customColor${crypto.randomUUID()}`, label: label.trim(), colors: [...colors] };
  const next = [...stored, item];
  localStorage.setItem(storageKey, JSON.stringify(next));
  customColors.value = next;
  return item.name;
}

export function getCustomColorOption(item: CustomColor) {
  const stops = item.colors.map((color, index) => `<stop offset="${index / (item.colors.length - 1)}" stop-color="${color}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><defs><linearGradient id="base" x2="1" y2="1">${stops}</linearGradient><radialGradient id="glow"><stop stop-color="${item.colors[1]}" stop-opacity=".9"/><stop offset="1" stop-color="${item.colors[1]}" stop-opacity="0"/></radialGradient></defs><path fill="url(#base)" d="M0 0h960v540H0z"/><ellipse cx="720" cy="160" rx="400" ry="320" fill="url(#glow)"/></svg>`;
  return { ...item, paths: [] as string[], image: `data:image/svg+xml,${encodeURIComponent(svg)}`, prompt: "以第一个颜色为主色，其余颜色用于辅助和点缀，协调画面的整体色彩关系。" };
}
const availableColors = computed(() => [...colorOptions, ...customColors.value.map(getCustomColorOption)]);
export function getColorOptions() {
  return availableColors.value;
}

