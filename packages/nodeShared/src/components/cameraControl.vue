<template>
  <el-dialog v-model="visible" title="摄影机控制" width="min(920px, calc(100vw - 32px))" appendToBody alignCenter :closeOnClickModal="false" class="cameraControl" @opened="syncWheel">
    <template #header>
      <div class="cameraHeader"><strong>摄影机控制</strong><el-select :modelValue="presetId" aria-label="摄影参数预设" @change="applyPreset"><el-option v-for="preset in cameraPresets" :key="preset.id" :value="preset.id" :label="preset.label" /><el-option v-if="presetId === 'custom'" value="custom" label="自定义组合" disabled /></el-select></div>
    </template>
    <div class="cameraPanel nodrag nopan nowheel" @wheel.stop @pointerdown.stop @keydown.stop>
      <div class="cameraReference">
        <div class="cameraPreview">
          <img :src="referenceImage" alt="摄影参数示意场景" :style="backgroundStyle" />
          <img class="previewSubject" :src="referenceImage" alt="" :style="subjectStyle" />
          <div class="previewLabels"><span>{{ preview.focalLength }} mm</span><span>f/{{ preview.aperture }}</span></div>
          <span class="previewNote">仅作取景与景深示意</span>
        </div>
        <div class="parameterDetail" aria-live="polite"><strong>{{ options[selectedIndex]?.label }}</strong><p>{{ options[selectedIndex]?.detail }}</p></div>
        <details class="cameraPrompt"><summary>将发送的摄影参数</summary><p>{{ draft.enabled ? getCameraPrompt(draft) : '已关闭，不发送摄影参数。已选参数会保留。' }}</p></details>
      </div>
      <div class="cameraSelection">
        <div class="cameraTabs" role="tablist" aria-label="摄影参数分类" @keydown="onTabKey">
          <button v-for="tab in tabs" :id="`${controlId}-${tab.id}`" :key="tab.id" type="button" role="tab" :aria-selected="activeTab === tab.id" :aria-controls="`${controlId}-parameters`" :tabindex="activeTab === tab.id ? 0 : -1" @click="changeTab(tab.id)">
            <icon-camera v-if="tab.id === 'camera'" :size="18" aria-hidden="true" />
            <icon-aperture v-else-if="tab.id === 'aperture'" :size="18" aria-hidden="true" />
            <svg v-else-if="tab.id === 'lens'" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="17" cy="12" rx="4" ry="8"/><path d="M17 4H8C2 4 2 20 8 20h9M8 5v14m4-14v14"/></svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4v16m18-16v16M7 12h10m-7-3-3 3 3 3m4-6 3 3-3 3"/></svg>
            {{ tab.label }}
          </button>
        </div>
        <div :id="`${controlId}-parameters`" role="tabpanel" :aria-labelledby="`${controlId}-${activeTab}`">
          <div class="wheelHeader"><span>{{ activeTabLabel }}</span><span>{{ options.length }} 项</span></div>
          <div class="wheelContainer">
            <div class="wheelHighlight" aria-hidden="true" />
            <div ref="wheel" class="optionWheel" role="listbox" tabindex="0" :aria-label="`选择${activeTabLabel}，可循环滚轮或方向键切换`" :aria-activedescendant="`${controlId}Option${selectedIndex}`" @wheel="onWheel" @scroll.passive="onWheelScroll" @keydown="onWheelKey">
              <button v-for="row in wheelRows" :id="row.copy === 1 ? `${controlId}Option${row.index}` : undefined" :key="row.key" type="button" :role="row.copy === 1 ? 'option' : undefined" :aria-hidden="row.copy !== 1" tabindex="-1" :aria-selected="row.copy === 1 ? selectedIndex === row.index : undefined" class="wheelOption" :class="{ active: selectedIndex === row.index }" @pointerdown.prevent @click="chooseRow(row.position)">
                <span class="optionIndex">{{ String(row.index + 1).padStart(2, '0') }}</span><strong>{{ row.option.label }}</strong><span v-if="selectedIndex === row.index" class="optionCheck" aria-hidden="true">✓</span>
              </button>
            </div>
          </div>
          <div class="wheelHint">滚轮或 ↑ ↓ 逐项切换，也可直接点击</div>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="cameraFooter">
        <div class="parameterChips"><button v-for="tab in tabs" :key="tab.id" type="button" :class="{ active: activeTab === tab.id }" :title="chipLabel(tab.id)" @click="changeTab(tab.id, true)"><span>{{ tab.label }}</span><strong>{{ chipLabel(tab.id) }}</strong></button></div>
        <div class="cameraActions"><el-switch v-model="draft.enabled" aria-label="启用摄影参数" activeText="开启" inactiveText="关闭" @change="manuallyDisabled = !draft.enabled" /><span class="actionSpacer" /><el-button @click="visible = false">取消</el-button><el-button class="applyButton" @click="applySettings">应用</el-button></div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { ElButton, ElDialog, ElOption, ElSelect, ElSwitch } from "element-plus";
import { IconAperture, IconCamera } from "@tabler/icons-vue";
import { apertureDescription, apertures, cameraOptions, cameraPresets, defaultCameraSettings, focalLengthDescription, focalLengths, isCameraSettings, lensOptions, type CameraSettings } from "../cameraOptions";
import { getCameraPrompt } from "../cameraPrompts";
import referenceImage from "../assets/colors/sageCream.jpg";

type CameraTab = "camera" | "lens" | "focalLength" | "aperture";
const visible = defineModel<boolean>({ default: false });
const settings = defineModel<unknown>("settings");
const controlId = useId();
const tabs: { id: CameraTab; label: string }[] = [{ id: "camera", label: "相机" }, { id: "lens", label: "镜头" }, { id: "focalLength", label: "焦距" }, { id: "aperture", label: "光圈" }];
const activeTab = ref<CameraTab>("camera");
const draft = ref<CameraSettings>({ ...defaultCameraSettings });
const preview = ref<CameraSettings>({ ...defaultCameraSettings });
const manuallyDisabled = ref(false);
const wheel = ref<HTMLElement>();
const rowHeight = 56;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
let scrollFrame = 0;
let syncing = false;
let syncVersion = 0;
let wheelDelta = 0;
let lastWheelTime = 0;
const lens = computed(() => lensOptions.find(item => item.id === draft.value.lens)!);
const activeTabLabel = computed(() => tabs.find(item => item.id === activeTab.value)!.label);
const presetId = computed(() => cameraPresets.find(item => item.camera === draft.value.camera && item.lens === draft.value.lens && item.focalLength === draft.value.focalLength && item.aperture === draft.value.aperture)?.id ?? "custom");
const options = computed<{ value: string | number; label: string; detail: string }[]>(() => {
  if (activeTab.value === "camera") return cameraOptions.map(item => ({ value: item.id, label: item.label, detail: item.detail }));
  if (activeTab.value === "lens") return lensOptions.map(item => ({ value: item.id, label: item.label, detail: item.detail }));
  if (activeTab.value === "focalLength") return focalLengths.map(value => ({ value, label: `${value} mm`, detail: focalLengthDescription(value) }));
  return apertures.map(value => ({ value, label: `f/${value}`, detail: apertureDescription(value) }));
});
const selectedIndex = computed(() => Math.max(0, options.value.findIndex(item => item.value === draft.value[activeTab.value])));

const wheelRows = computed(() => options.value.length === 1
  ? [{ option: options.value[0]!, copy: 1, index: 0, position: 0, key: `1:${options.value[0]!.value}` }]
  : Array.from({ length: 3 }, (_, copy) => options.value.map((option, index) => ({ option, copy, index, position: copy * options.value.length + index, key: `${copy}:${option.value}` }))).flat());
const previewCamera = computed(() => cameraOptions.find(item => item.id === preview.value.camera)!);
const subjectStyle = computed(() => ({ transform: `scale(${1 + Math.log2(preview.value.focalLength / focalLengths[0]!) * .085})`, filter: `saturate(${previewCamera.value.saturation}) sepia(${previewCamera.value.warmth})` }));
const backgroundStyle = computed(() => ({ ...subjectStyle.value, filter: `${subjectStyle.value.filter} blur(${Math.max(0, 5 - Math.log2(preview.value.aperture) * 1.5)}px)` }));
watch(visible, open => {
  stopScroll();
  resetWheelDelta();
  if (!open) return;
  draft.value = isCameraSettings(settings.value) ? { ...settings.value } : { ...defaultCameraSettings };
  preview.value = { ...draft.value };
  manuallyDisabled.value = !draft.value.enabled && isCameraSettings(settings.value);
  activeTab.value = "camera";
  void syncWheel();
});
onBeforeUnmount(stopScroll);
function stopScroll() {
  syncVersion++;
  if (scrollTimer !== undefined) clearTimeout(scrollTimer);
  scrollTimer = undefined;
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  scrollFrame = 0;
}
function resetWheelDelta() {
  wheelDelta = 0;
  lastWheelTime = 0;
}
function wrapIndex(index: number) { return (index % options.value.length + options.value.length) % options.value.length; }
async function syncWheel() {
  stopScroll();
  const version = syncVersion;
  syncing = true;
  await nextTick();
  if (version !== syncVersion || !visible.value) return;
  if (wheel.value) wheel.value.scrollTop = options.value.length === 1 ? 0 : (options.value.length + selectedIndex.value) * rowHeight;
  scrollFrame = requestAnimationFrame(() => { syncing = false; scrollFrame = 0; });
}
async function changeTab(tab: CameraTab, focusList = false) {
  if (activeTab.value !== tab) {
    flushWheel();
    resetWheelDelta();
    activeTab.value = tab;
    await syncWheel();
  }
  if (focusList) wheel.value?.focus();
}
function onTabKey(event: KeyboardEvent) {
  const index = tabs.findIndex(tab => tab.id === activeTab.value);
  const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
    : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
    : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault();
  const tab = tabs[next]!.id;
  changeTab(tab);
  document.getElementById(`${controlId}-${tab}`)?.focus({ preventScroll: true });
}
function selectOption(index: number) {
  const option = options.value[index];
  if (!option) return;
  if (activeTab.value === "camera") draft.value.camera = String(option.value);
  else if (activeTab.value === "lens") draft.value.lens = String(option.value);
  else if (activeTab.value === "focalLength") draft.value.focalLength = Number(option.value);
  else draft.value.aperture = Number(option.value);
  if (!manuallyDisabled.value) draft.value.enabled = true;
}

function onWheel(event: WheelEvent) {
  if (!event.deltaY || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  event.preventDefault();
  const direction = Math.sign(event.deltaY);
  if (event.deltaMode === 0 && Math.abs(event.deltaY) < 40) {
    // ACT: 合并触控板的小幅像素输入，单次事件最多切换一档。
    if (event.timeStamp - lastWheelTime > 150 || Math.sign(wheelDelta) !== direction) wheelDelta = 0;
    lastWheelTime = event.timeStamp;
    wheelDelta += event.deltaY;
    if (Math.abs(wheelDelta) < 40) return;
  }
  resetWheelDelta();
  chooseRow(options.value.length + selectedIndex.value + direction, false);
}
function readWheel() {
  const element = wheel.value;
  if (!element || syncing || !visible.value || options.value.length === 1) return;
  const span = options.value.length * rowHeight;
  let top = element.scrollTop;
  // ACT: 三份等长列表循环复用，最多 129 行；越界只平移整周期，不重新创建节点。
  if (top < span / 2 || top >= span * 2.5) {
    top = (top % span + span) % span + span;
    element.scrollTop = top;
  }
  const index = wrapIndex(Math.round(top / rowHeight));
  if (index !== selectedIndex.value) selectOption(index);
}
function onWheelScroll() {
  if (syncing || !visible.value) return;
  if (!scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; readWheel(); });
  if (scrollTimer !== undefined) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    scrollTimer = undefined;
    readWheel();
    if (wheel.value) wheel.value.scrollTop = Math.round(wheel.value.scrollTop / rowHeight) * rowHeight;
    preview.value = { ...draft.value };
  }, 110);
}
function flushWheel() {
  readWheel();
  stopScroll();
  syncing = false;
  preview.value = { ...draft.value };
}
function chooseRow(position: number, focusList = true) {
  stopScroll();
  resetWheelDelta();
  syncing = false;
  selectOption(wrapIndex(position));
  const count = options.value.length;
  const target = count === 1 ? 0 : position < count / 2 || position >= count * 2.5 ? wrapIndex(position) + count : position;
  if (wheel.value) wheel.value.scrollTop = target * rowHeight;
  preview.value = { ...draft.value };
  if (focusList) wheel.value?.focus({ preventScroll: true });
}
function onWheelKey(event: KeyboardEvent) {
  const offset = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : event.key === "PageDown" ? 3 : event.key === "PageUp" ? -3 : 0;
  if (!offset && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const position = Math.round((wheel.value?.scrollTop ?? options.value.length * rowHeight) / rowHeight);
  chooseRow(event.key === "Home" ? options.value.length : event.key === "End" ? options.value.length * 2 - 1 : position + offset);
}
function applyPreset(id: string) {
  const preset = cameraPresets.find(item => item.id === id);
  if (!preset) return;
  stopScroll();
  resetWheelDelta();
  draft.value = { enabled: !manuallyDisabled.value, camera: preset.camera, lens: preset.lens, focalLength: preset.focalLength, aperture: preset.aperture };
  preview.value = { ...draft.value };
  void syncWheel();
}
function chipLabel(tab: CameraTab) {
  return tab === "camera" ? cameraOptions.find(item => item.id === draft.value.camera)!.label : tab === "lens" ? lens.value.label : tab === "focalLength" ? `${draft.value.focalLength} mm` : `f/${draft.value.aperture}`;
}
function applySettings() {
  flushWheel();
  if (!isCameraSettings(draft.value)) return;
  settings.value = { ...draft.value };
  visible.value = false;
}
</script>

<style lang="scss">
.cameraControl.el-dialog {
  --cameraAccent: var(--el-color-primary);
  display: flex;
  flex-direction: column;
  height: min(650px, calc(100dvh - 48px));
  padding: 22px;
  border-radius: 16px;
  box-sizing: border-box;
  .el-dialog__header { flex-shrink: 0; padding: 0 0 18px; }
  .el-dialog__body { flex: 1; min-height: 0; overflow: hidden; padding: 0; }
  .el-dialog__footer { flex-shrink: 0; padding-top: 18px; }
  .cameraHeader { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-right: 28px; strong { font-size: 15px; } .el-select { width: 160px; } }
  .cameraPanel {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; height: 100%; overflow-y: auto; scrollbar-gutter: stable;
    .cameraReference {
      min-width: 0;
      .cameraPreview {
        position: relative; overflow: hidden; border-radius: 12px; aspect-ratio: 16 / 10; background: var(--el-fill-color);
        img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center top; transform-origin: 55% 30%; }
        .previewSubject { clip-path: ellipse(25% 58% at 55% 54%); }
        .previewLabels { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; span { padding: 3px 7px; border-radius: 5px; background: #0009; color: #fff; font-size: 11px; } }
        .previewNote { position: absolute; left: 10px; bottom: 10px; font-size: 10px; padding: 3px 6px; border-radius: 4px; background: #0008; color: #fff; }
      }
      .parameterDetail { height: 108px; box-sizing: border-box; padding-top: 16px; font-size: 12px; line-height: 1.7; overflow-y: auto; strong { color: var(--el-text-color-primary); font-size: 14px; } p { margin: 5px 0 0; color: var(--el-text-color-secondary); } }
      .cameraPrompt { font-size: 11px; color: var(--el-text-color-secondary); summary { cursor: pointer; padding: 6px 0; } p { height: 96px; overflow-y: auto; line-height: 1.7; margin: 0; } }
    }
    .cameraSelection {
      min-width: 0;
      .cameraTabs { display: flex; height: 42px; border-bottom: 1px solid var(--el-border-color-lighter); button { display: flex; align-items: center; justify-content: center; gap: 7px; flex: 1; padding: 0; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--el-text-color-secondary); font-size: 13px; cursor: pointer; &[aria-selected="true"] { border-bottom-color: var(--cameraAccent); color: var(--el-text-color-primary); } svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; } } }
      .wheelHeader { display: flex; justify-content: space-between; padding: 20px 0 12px; font-size: 12px; color: var(--el-text-color-primary); span:last-child { color: var(--el-text-color-secondary); font-size: 11px; } }
      .wheelContainer {
        position: relative; overflow: hidden; border-radius: 10px; border: 1px solid var(--el-border-color-lighter);
        .wheelHighlight { position: absolute; top: 112px; left: 6px; right: 6px; height: 56px; background: var(--el-fill-color); box-shadow: inset 0 0 0 1px var(--cameraAccent); border-radius: 8px; pointer-events: none; }
        .optionWheel { position: relative; height: 280px; box-sizing: border-box; padding: 112px 6px; overflow-y: auto; overflow-anchor: none; overscroll-behavior: contain; scrollbar-width: none; outline-offset: -3px; &::-webkit-scrollbar { display: none; }
          .wheelOption { display: flex; align-items: center; gap: 12px; width: 100%; height: 56px; padding: 0 12px; box-sizing: border-box; border: 0; background: transparent; color: var(--el-text-color-secondary); cursor: pointer; text-align: left;
            &.active { color: var(--el-text-color-primary); strong { font-weight: 600; } .optionCheck { color: var(--cameraAccent); } }
            .optionIndex { flex: 0 0 22px; font-size: 11px; opacity: .6; font-variant-numeric: tabular-nums; }
            strong { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .optionCheck { width: 16px; }
          }
        }
      }
      .wheelHint { padding-top: 12px; text-align: center; color: var(--el-text-color-secondary); font-size: 11px; }
    }
  }
  .cameraFooter {
    display: grid; gap: 16px; border-top: 1px solid var(--el-border-color-lighter); padding-top: 16px;
    .parameterChips { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; button { min-width: 0; text-align: left; border: 1px solid transparent; border-radius: 8px; padding: 8px 10px; background: var(--el-fill-color-light); cursor: pointer; &.active { border-color: var(--cameraAccent); background: color-mix(in srgb, var(--cameraAccent) 8%, transparent); } span { display: block; font-size: 10px; color: var(--el-text-color-secondary); margin-bottom: 4px; } strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--el-text-color-primary); font-size: 12px; font-weight: 500; } } }
    .cameraActions {
      display: flex;
      align-items: center;
      gap: 8px;
      .actionSpacer { flex: 1; }
      .el-button {
        min-width: 80px;
        height: 36px;
        border: 0;
        border-radius: 10px;
        background: var(--el-fill-color);
        color: var(--el-text-color-primary);
        &:hover { background: var(--el-fill-color-dark); }
        & + .el-button { margin-left: 0; }
        &.applyButton {
          background: var(--el-color-primary);
          color: var(--ui-primary-foreground, #fff);
          &:hover { background: var(--el-color-primary-dark-2); }
        }
      }
    }
  }
  @media (max-width: 760px) { padding: 16px; .cameraPanel { grid-template-columns: minmax(0, 1fr); gap: 16px; .cameraReference .cameraPreview { aspect-ratio: 16 / 8; } .cameraReference .parameterDetail { height: 92px; } } .cameraFooter .parameterChips { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; } }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
}
</style>
