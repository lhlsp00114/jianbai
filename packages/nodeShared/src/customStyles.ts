import { shallowRef } from "vue";

type CustomStyle = { name: string; label: string; prompt: string; image?: string };
const storageKey = "toonflow.customStyles";
export const customStyles = shallowRef<CustomStyle[]>([]);

export function isCustomStyle(item: unknown): item is CustomStyle {
  if (!item || typeof item !== "object") return false;
  const value = item as Partial<CustomStyle>;
  return typeof value.name === "string" && /^customStyle[\da-f-]{36}$/i.test(value.name)
    && typeof value.label === "string" && !!value.label.trim() && value.label.length <= 40
    && typeof value.prompt === "string" && !!value.prompt.trim() && value.prompt.length <= 500
    && (value.image === undefined || typeof value.image === "string" && value.image.length <= 300000
      && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.image));
}

function readCustomStyles(): CustomStyle[] {
  const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
  if (!Array.isArray(stored) || !stored.every(isCustomStyle) || new Set(stored.map(item => item.name)).size !== stored.length) {
    throw new Error("本机风格数据读取失败");
  }
  return stored;
}

export function loadCustomStyles() {
  try { customStyles.value = readCustomStyles(); return true; }
  catch { return false; }
}

export function saveCustomStyle(label: string, prompt: string, image?: string) {
  const item = { name: `customStyle${crypto.randomUUID()}`, label: label.trim(), prompt: prompt.trim(), image };
  if (!isCustomStyle(item)) throw new Error("请填写有效的风格名称和描述词");
  const next = [...readCustomStyles(), item];
  localStorage.setItem(storageKey, JSON.stringify(next));
  customStyles.value = next;
  return item.name;
}
