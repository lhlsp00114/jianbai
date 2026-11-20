<template>
  <el-dialog v-model="visible" title="创建配色" class="colorPaletteDialog" width="min(460px, calc(100vw - 32px))" appendToBody alignCenter>
    <div class="paletteEditor">
      <el-input v-model="label" aria-label="配色名称" maxlength="40" />
      <div class="creationTabs" role="tablist" aria-label="配色创建方式">
        <button type="button" role="tab" :aria-selected="source === 'image'" @click="source = 'image'">从图片创建</button>
        <button type="button" role="tab" :aria-selected="source === 'custom'" @click="source = 'custom'">自定义色板</button>
      </div>
      <div v-if="source === 'image'" class="imageSource">
        <label class="imageUpload">{{ extracting ? '正在提取颜色…' : imagePreview ? '更换图片' : '选择图片' }}<input type="file" accept="image/*" :disabled="extracting" aria-label="选择配色图片" @change="readImage" /></label>
        <img v-if="imagePreview" :src="imagePreview" alt="配色来源图片" />
      </div>
      <div v-else class="customSource">
      <div class="harmonyModes" role="group" aria-label="取色模式">
        <button v-for="mode in modes" :key="mode.id" type="button" :title="mode.label" :aria-label="mode.label" :aria-pressed="harmony === mode.id" @click="setHarmony(mode.id)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path :d="mode.path" /></svg>
        </button>
      </div>
      <div ref="wheel" class="colorWheel" role="group" aria-label="色轮取色" @pointerdown="startPick" @pointermove="movePick" @pointerup="stopPick" @pointercancel="stopPick" @lostpointercapture="dragging = false">
        <button v-for="(color, index) in colors" :key="index" type="button" class="wheelPoint" :class="{ active: active === index }" :style="pointStyle(color)" :aria-label="`调整颜色 ${index + 1}`" @pointerdown.stop="active = index; startPick($event, false)" />
      </div>
      </div>
      <div class="colorCount">{{ colors.length }} 个颜色</div>
      <div class="paletteColors">
        <button v-for="(color, index) in colors" :key="index" type="button" class="paletteColor" :class="{ mainColor: index === 0, active: active === index }" :style="{ background: color }" :aria-label="`选择颜色 ${index + 1} ${color}`" @click="active = index"><span v-if="index === 0">主色</span></button>
        <button v-if="colors.length < 8" class="addColor" type="button" aria-label="添加颜色" @click="addColor">+</button>
      </div>
      <div class="colorControls">
        <el-color-picker :modelValue="colors[active]" :clearable="false" @update:modelValue="setHex" aria-label="精确取色" />
        <el-input v-model="hexValue" aria-label="颜色 HEX 值" maxlength="7" @blur="setHex(hexValue)" @keydown.enter.prevent="setHex(hexValue)" />
        <el-button :disabled="colors.length <= 2" @click="removeColor">移除颜色</el-button>
      </div>
    </div>
    <template #footer><el-button @click="visible = false">取消</el-button><el-button type="primary" :disabled="!label.trim() || extracting || (source === 'image' && !imagePreview)" @click="createPalette">创建</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { ElButton, ElColorPicker, ElDialog, ElInput, ElMessage } from "element-plus";
import { customColors, saveCustomColor } from "../customColors";

const visible = defineModel<boolean>({ default: false });
const emit = defineEmits<{ created: [name: string] }>();
const label = ref("");
const colors = ref<string[]>([]);
const active = ref(0);
const hexValue = ref("");
watch(() => colors.value[active.value], color => { hexValue.value = color ?? ""; });
const wheel = ref<HTMLElement>();
const dragging = ref(false);
const source = ref("custom");
const harmony = ref("free");
const imagePreview = ref("");
const extracting = ref(false);
let imageRequest = 0;
const modes = [
  { id: "free", label: "自由取色", path: "M8 8h1m6 1h1m-6 7h1m5-2h1" },
  { id: "analogous", label: "临近色取色", path: "M6 5l6 7 6-7M12 3v9" },
  { id: "complementary", label: "互补色", path: "M12 3v18" },
  { id: "triadic", label: "三等分取色", path: "M12 3v9l-8 5m8-5 8 5" },
];
function clearPreview() {
  imageRequest++;
  extracting.value = false;
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value);
  imagePreview.value = "";
}
onBeforeUnmount(clearPreview);
watch(source, () => {
  imageRequest++;
  extracting.value = false;
  dragging.value = false;
});
watch(visible, open => {
  if (!open) { clearPreview(); return; }
  source.value = "custom";
  harmony.value = "free";
  label.value = `未命名配色 ${customColors.value.length + 1}`;
  colors.value = ["#4B90E2", "#9C96EB", "#43CFDE", "#9744DF", "#40DDA4"];
  active.value = 0;
});
function toHsv(hex: string) {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const hue = !delta ? 0 : ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
  const saturation = max ? delta / max : 0;
  return { hue, saturation, value: max };
}
function pointStyle(hex: string) {
  const { hue, saturation } = toHsv(hex);
  const angle = hue * Math.PI / 180;
  return { left: `${50 + Math.sin(angle) * saturation * 48}%`, top: `${50 - Math.cos(angle) * saturation * 48}%`, background: hex };
}
function pick(event: PointerEvent) {
  const bounds = wheel.value?.getBoundingClientRect();
  if (!bounds) return;
  const x = (event.clientX - bounds.left - bounds.width / 2) / (bounds.width / 2);
  const y = (event.clientY - bounds.top - bounds.height / 2) / (bounds.height / 2);
  const hue = (Math.atan2(x, -y) / Math.PI * 180 + 360) % 360;
  const saturation = Math.min(1, Math.hypot(x, y));
  updateColors(fromHsv(hue, saturation, toHsv(colors.value[active.value]!).value || 1));
}
function fromHsv(hue: number, saturation: number, value: number) {
  const channel = (n: number) => {
    const k = (n + (hue + 360) % 360 / 60) % 6;
    return Math.round(255 * value * (1 - saturation * Math.max(0, Math.min(k, 4 - k, 1)))).toString(16).padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`.toUpperCase();
}
function hueOffset(index: number) {
  return harmony.value === "analogous" ? index * 15 : harmony.value === "complementary" ? index % 2 * 180 : index % 3 * 120;
}
function updateColors(hex: string) {
  const previous = toHsv(colors.value[active.value]!);
  colors.value[active.value] = hex;
  if (source.value !== "custom" || harmony.value === "free") return;
  const base = toHsv(hex);
  const origin = base.hue - hueOffset(active.value);
  colors.value = colors.value.map((color, index) => {
    const current = toHsv(color);
    const saturation = index === active.value ? base.saturation : Math.min(1, previous.saturation ? current.saturation * base.saturation / previous.saturation : base.saturation);
    return fromHsv((origin + hueOffset(index) + 360) % 360, saturation, index === active.value ? base.value : current.value);
  });
}
function setHarmony(mode: string) {
  harmony.value = mode;
  updateColors(colors.value[active.value]!);
}
function addColor() {
  colors.value.push(colors.value[active.value]!);
  updateColors(colors.value[active.value]!);
  active.value = colors.value.length - 1;
}
function removeColor() {
  colors.value.splice(active.value, 1);
  active.value = Math.min(active.value, colors.value.length - 1);
  updateColors(colors.value[active.value]!);
}
async function readImage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) { ElMessage.error("请选择 20MB 以内的图片"); return; }
  const request = ++imageRequest;
  extracting.value = true;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (request !== imageRequest) return;
    // ACT: 最多采样 96×96 像素、4096 个色桶，优先保持本机取色流畅；需要更细的色彩分离时再升级聚类。
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = Math.max(1, Math.round(96 * image.height / image.width));
    canvas.height = Math.min(96, canvas.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法读取图片");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const buckets = new Map<number, { count: number; rgb: number[] }>();
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3]! < 128) continue;
      const rgb = [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!];
      const key = (rgb[0]! >> 4) * 256 + (rgb[1]! >> 4) * 16 + (rgb[2]! >> 4);
      const bucket = buckets.get(key) ?? { count: 0, rgb: [0, 0, 0] };
      bucket.count++;
      rgb.forEach((value, index) => { bucket.rgb[index]! += value; });
      buckets.set(key, bucket);
    }
    const candidates = [...buckets.values()].sort((a, b) => b.count - a.count).map(bucket => ({ count: bucket.count, rgb: bucket.rgb.map(value => Math.round(value / bucket.count)) }));
    if (!candidates.length) throw new Error("图片没有可提取的颜色");
    const picked = [candidates.shift()!];
    while (picked.length < 5 && candidates.length) {
      let best = 0, bestScore = -1;
      candidates.forEach((candidate, index) => {
        const distance = Math.min(...picked.map(item => item.rgb.reduce((sum, value, channel) => sum + (value - candidate.rgb[channel]!) ** 2, 0)));
        const score = distance * Math.sqrt(candidate.count);
        if (score > bestScore) { bestScore = score; best = index; }
      });
      picked.push(candidates.splice(best, 1)[0]!);
    }
    const extracted = picked.map(item => `#${item.rgb.map(value => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase());
    colors.value = extracted.length === 1 ? [extracted[0]!, extracted[0]!] : extracted;
    active.value = 0;
    if (imagePreview.value) URL.revokeObjectURL(imagePreview.value);
    imagePreview.value = url;
  } catch { if (request === imageRequest) ElMessage.error("图片读取失败，请选择有效的图片"); }
  finally {
    if (imagePreview.value !== url) URL.revokeObjectURL(url);
    if (request === imageRequest) extracting.value = false;
  }
}

function startPick(event: PointerEvent, update = true) {
  if (event.button !== 0) return;
  event.preventDefault();
  dragging.value = true;
  wheel.value?.setPointerCapture(event.pointerId);
  if (update) pick(event);
}
function movePick(event: PointerEvent) { if (dragging.value) pick(event); }
function stopPick(event: PointerEvent) {
  dragging.value = false;
  if (wheel.value?.hasPointerCapture(event.pointerId)) wheel.value.releasePointerCapture(event.pointerId);
}
function setHex(value: string | null) {
  if (value && /^#[\da-f]{6}$/i.test(value.trim())) {
    updateColors(value.trim().toUpperCase());
    hexValue.value = colors.value[active.value]!;
  }
  else {
    hexValue.value = colors.value[active.value] ?? "";
    ElMessage.error("请输入 # 开头的六位颜色值");
  }
}
function createPalette() {
  if (extracting.value || source.value === "image" && !imagePreview.value) return;
  if (!/^#[\da-f]{6}$/i.test(hexValue.value.trim())) {
    setHex(hexValue.value);
    return;
  }
  updateColors(hexValue.value.trim().toUpperCase());
  try {
    const name = saveCustomColor(label.value, colors.value);
    emit("created", name);
    visible.value = false;
  } catch { ElMessage.error("配色保存失败，请检查颜色值或浏览器存储空间"); }
}
</script>

<style scoped lang="scss">
.paletteEditor {
  display: grid;
  gap: 18px;
  .creationTabs { display: flex; padding: 3px; border-radius: 10px; background: var(--el-fill-color); button { flex: 1; padding: 8px; border: 0; border-radius: 8px; background: transparent; color: var(--el-text-color-secondary); cursor: pointer; &[aria-selected="true"] { background: var(--el-bg-color); color: var(--el-text-color-primary); } } }
  .imageSource { display: grid; gap: 12px; min-height: 230px; align-content: center; .imageUpload { position: relative; padding: 12px; text-align: center; border: 1px dashed var(--el-border-color); border-radius: 8px; cursor: pointer; input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; } } img { width: 100%; max-height: 230px; object-fit: contain; border-radius: 8px; } }
  .customSource { .harmonyModes { display: flex; justify-content: flex-end; gap: 4px; margin-bottom: 8px; button { width: 30px; height: 30px; padding: 4px; border: 0; border-radius: 6px; color: var(--el-text-color-secondary); background: transparent; cursor: pointer; &[aria-pressed="true"] { background: var(--el-fill-color); color: var(--el-text-color-primary); } svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.5; } } } }
  .colorWheel {
    position: relative;
    width: 230px;
    height: 230px;
    margin: 2px auto;
    border-radius: 50%;
    background: radial-gradient(closest-side, #fff, transparent), conic-gradient(red, #ff0, #0f0, #0ff, #00f, #f0f, red);
    touch-action: none;
    cursor: crosshair;
    .wheelPoint { position: absolute; width: 18px; height: 18px; transform: translate(-50%, -50%); border: 2px solid white; border-radius: 50%; cursor: grab; box-shadow: 0 1px 4px #0004; &.active { width: 24px; height: 24px; z-index: 1; } }
  }
  .colorCount { font-size: 12px; color: var(--el-text-color-secondary); }
  .paletteColors {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    .paletteColor, .addColor { width: 48px; height: 54px; border: 2px solid transparent; border-radius: 8px; cursor: pointer; &.active { outline: 2px solid var(--el-color-primary); outline-offset: 2px; } }
    .mainColor { width: 96px; span { padding: 3px 6px; border-radius: 4px; background: #0009; color: #fff; font-size: 12px; } }
    .addColor { background: var(--el-fill-color); color: var(--el-text-color-secondary); font-size: 26px; }
  }
  .colorControls { display: flex; align-items: center; gap: 10px; .el-input { flex: 1; } }
}
</style>

<style lang="scss">
.colorPaletteDialog.el-dialog {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 20px;
  padding: 24px;
  background: var(--el-bg-color-overlay);
  .el-input__wrapper { box-shadow: none; background: var(--el-fill-color); border-radius: 9px; &.is-focus { box-shadow: 0 0 0 1px var(--el-color-primary) inset; } }
  .el-dialog__footer .el-button { border: 0; border-radius: 9px; background: var(--el-fill-color); color: var(--el-text-color-primary); &:hover { background: var(--el-fill-color-dark); } }
  .el-dialog__footer .el-button--primary {
    background: var(--el-text-color-primary);
    color: var(--el-bg-color);
    &:hover { background: var(--el-text-color-regular); }
    &.is-disabled { background: var(--el-fill-color); color: var(--el-text-color-disabled); }
  }
}
</style>
