<template>
  <main ref="editorRoot" class="photoCraft" :class="{ expandedEditor: expanded }" aria-label="PhotoCraft 图片编辑器">
    <iframe
      ref="editorFrame"
      class="editorFrame"
      :src="editorUrl"
      title="PhotoCraft 图片编辑器"
      allow="fullscreen; clipboard-read; clipboard-write"
      allowfullscreen
      @load="bindEditorShortcuts" />
    <span class="versionBadge" :title="`PhotoCraft ${release.version}`">v{{ release.version }}</span>
    <el-button class="exportPsd" :icon="IconDownload" title="导出 PSD" @mousedown.prevent @click="exportPsd">导出 PSD</el-button>
    <el-button class="modeToggle" :icon="expanded ? IconMinimize : IconMaximize" :aria-label="modeLabel" :title="modeLabel" :aria-pressed="expanded" :disabled="changingMode" @mousedown.prevent @click="expanded ? showPage() : enterFullscreen()">{{ expanded ? "退出全屏" : "全屏" }}</el-button>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { ElButton, ElMessage } from "element-plus";
import { IconDownload, IconMaximize, IconMinimize } from "@tabler/icons-vue";
import { readNodeModels, subscribeNodeModels, type NodeMediaModel } from "@toonflow/nodes-scaffold/nodeAi";
import release from "../../../photoCraftRelease.json";

const editorRoot = ref<HTMLElement>();
const editorFrame = ref<HTMLIFrameElement>();
const expanded = ref(false);
const modeLabel = computed(() => expanded.value ? "切换为页面模式" : "切换为全屏模式");
const changingMode = ref(false);
const imageModels = shallowRef<NodeMediaModel[]>([]);
const imageModelsLoading = ref(false);
let removeEditorShortcuts: (() => void) | undefined;
let removeModelSubscription: (() => void) | undefined;
let imageModelsRequest: Promise<void> | undefined;
const keyboard = (navigator as Navigator & {
  keyboard?: { lock: (keyCodes: string[]) => Promise<void>; unlock: () => void };
}).keyboard;
let ownsKeyboard = false;

async function enterFullscreen() {
  const root = editorRoot.value;
  if (!root || changingMode.value) return;
  expanded.value = true;
  changingMode.value = true;
  await nextTick();
  try {
    if (document.fullscreenElement !== root) await root.requestFullscreen();
  } catch {
    ElMessage.warning({ message: "浏览器未进入全屏，已保留铺满显示。", appendTo: root });
    return;
  } finally {
    changingMode.value = false;
  }
  if (document.fullscreenElement !== root) return;
  if (!keyboard?.lock) {
    ElMessage.warning({ message: "当前浏览器不支持键盘锁定，Ctrl+T 等快捷键仍可能由浏览器处理。请使用支持此功能的 Chrome 或 Edge。", appendTo: root });
    editorFrame.value?.contentWindow?.focus();
    return;
  }
  try {
    // 不锁定 Escape，保留浏览器原生退出全屏；其余常用编辑键交给 iframe。
    await keyboard.lock([
      ...Array.from({ length: 26 }, (_, index) => `Key${String.fromCharCode(65 + index)}`),
      ...Array.from({ length: 10 }, (_, index) => `Digit${index}`),
      ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
      "Tab", "Space", "Backspace", "Home", "End", "PageUp", "PageDown", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
      "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Comma", "Period", "Slash", "Backquote",
    ]);
    if (document.fullscreenElement !== root) keyboard.unlock();
    else ownsKeyboard = true;
  } catch (error) {
    console.warn("PhotoCraft 键盘锁定失败", error);
    ElMessage.warning({ message: "键盘锁定未生效，Ctrl+T 等仍可能触发浏览器。请在支持此功能的 Chrome 或 Edge 中打开，并允许出现的键盘锁定请求。", appendTo: root });
  } finally {
    if (document.fullscreenElement === root) editorFrame.value?.contentWindow?.focus();
  }
}

function releaseKeyboard() {
  if (!ownsKeyboard) return;
  keyboard?.unlock();
  ownsKeyboard = false;
}

function handleFullscreenChange() {
  // 系统选图窗口可能使浏览器退出原生全屏；保留铺满视图，不卸载或重载编辑器。
  if (document.fullscreenElement !== editorRoot.value) releaseKeyboard();
}
async function showPage() {
  if (changingMode.value) return;
  changingMode.value = true;
  try {
    if (document.fullscreenElement === editorRoot.value) await document.exitFullscreen();
    expanded.value = false;
    releaseKeyboard();
  } catch {
    ElMessage.warning({ message: "无法退出浏览器全屏，请使用浏览器的退出全屏操作后重试。", appendTo: editorRoot.value });
  } finally {
    changingMode.value = false;
  }
}
onMounted(() => {
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  removeModelSubscription = subscribeNodeModels(type => {
    if (type === "media") void loadImageModels(true).catch(() => ElMessage.error("图片模型读取失败"));
  });
  void loadImageModels().catch(() => ElMessage.error("图片模型读取失败"));
});

function loadImageModels(fresh = false) {
  if (imageModelsRequest) return imageModelsRequest;
  imageModelsLoading.value = true;
  imageModelsRequest = readNodeModels<NodeMediaModel>("media", undefined, fresh).then(models => {
    imageModels.value = models.filter(model => model.type === "image");
  }).finally(() => {
    imageModelsLoading.value = false;
    imageModelsRequest = undefined;
  });
  return imageModelsRequest;
}

function bindEditorShortcuts() {
  removeEditorShortcuts?.();
  const frameWindow = editorFrame.value?.contentWindow;
  if (!frameWindow) return;
  const preventBrowserShortcut = (event: KeyboardEvent) => {
    if (event.isComposing || event.getModifierState("AltGraph")) return;
    // 保留原生文字选择、剪贴板、撤销和光标操作，编辑器自身仍接收全部原始事件。
    const nativeEditing = !event.altKey && (
      !event.shiftKey && /^Key[ACVXYZ]$/.test(event.code)
      || /^Key[VZ]$/.test(event.code)
      || /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|Backspace|Delete|Insert)$/.test(event.code)
    );
    const command = (event.ctrlKey || event.metaKey) && !nativeEditing
      && !/^(Control|Meta|Shift|Alt)(Left|Right)$/.test(event.code);
    const browserNavigation = event.altKey && ["ArrowLeft", "ArrowRight", "Home"].includes(event.code);
    if (command || browserNavigation || /^F([1-9]|1[0-2])$/.test(event.key) || event.key === "Alt") event.preventDefault();
  };
  const preventBrowserZoom = (event: WheelEvent) => {
    if (frameWindow.document.hasFocus() && (event.ctrlKey || event.metaKey)) event.preventDefault();
  };
  // 事件仅绑定 iframe，焦点离开编辑器后不接管宿主快捷键；不阻止 PhotoCraft 处理事件。
  // 全屏期间由顶层页面锁定浏览器保留键，再在此取消默认行为，原始事件仍交给编辑器。
  frameWindow.addEventListener("keydown", preventBrowserShortcut, true);
  frameWindow.addEventListener("wheel", preventBrowserZoom, { capture: true, passive: false });
  removeEditorShortcuts = () => {
    frameWindow.removeEventListener("keydown", preventBrowserShortcut, true);
    frameWindow.removeEventListener("wheel", preventBrowserZoom, true);
  };
}
function exportPsd() {
  const frameWindow = editorFrame.value?.contentWindow;
  if (!frameWindow) return;
  const target = frameWindow.document.activeElement ?? frameWindow.document.body;
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  target.dispatchEvent(new KeyboardEvent("keydown", {
    key: "s", code: "KeyS", shiftKey: true, ctrlKey: !isMac, metaKey: isMac, bubbles: true, cancelable: true,
  }));
}
onBeforeUnmount(() => {
  removeEditorShortcuts?.();
  removeModelSubscription?.();
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
  releaseKeyboard();
});

// PhotoCraft Web 的公开偏好格式；只初始化默认语言，用户自行选择的语言优先。
// 升级时核对 photocraft.preferences / interface.language，保持上游发行文件不变。
try {
  const stored = localStorage.getItem("photocraft.preferences");
  const preferences = stored ? JSON.parse(stored) : { version: 2 };
  if (preferences && typeof preferences === "object" && !Array.isArray(preferences)) {
    const appearance = preferences.interface;
    if (appearance === undefined || appearance && typeof appearance === "object" && !Array.isArray(appearance)) {
      if (appearance?.language === undefined) {
        localStorage.setItem("photocraft.preferences", JSON.stringify({
          ...preferences, interface: { ...appearance, language: "zh-hans" },
        }));
      }
    }
  }
} catch (error) {
  console.warn("PhotoCraft 默认语言初始化失败，可在编辑器的首选项中选择简体中文。", error);
}

const editorUrl = `${import.meta.env.BASE_URL}photoCraft/v${release.version.replaceAll(".", "p")}/index.html`;
</script>

<style scoped lang="scss">
.photoCraft {
  position: relative;
  grid-column: 2;
  grid-row: 2;
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  &:fullscreen { width: 100%; height: 100%; background: var(--el-bg-color); }
  &.expandedEditor { position: fixed; inset: 0; z-index: 3000; width: 100%; height: 100%; background: #262626; }

  // 保留 iframe 尺寸，避免隐藏时 WebGPU/面板布局收到 0×0 视口。
  &.backgroundEditor { visibility: hidden; pointer-events: none; }

  .versionBadge {
    position: absolute;
    top: 7px;
    right: 422px;
    z-index: 1;
    color: #c8c8c8;
    font-size: 11px;
    line-height: 18px;
    pointer-events: none;
  }

  .exportPsd {
    position: absolute;
    top: 3px;
    right: 316px;
    z-index: 1;
    width: 100px;
    height: 24px;
    margin: 0;
    padding: 0 8px;
    border-radius: 4px;
    font-size: 12px;
  }

  .modeToggle {
    position: absolute;
    top: 3px;
    right: 212px;
    z-index: 1;
    width: 96px;
    height: 24px;
    margin: 0;
    padding: 0 10px;
    border: 1px solid #53b5ff;
    border-radius: 4px;
    color: #fff;
    background: #146dc0;
    font-size: 12px;
    font-weight: 600;
    box-shadow: 0 1px 4px rgb(0 0 0 / 25%);

    &:hover:not(:disabled) { color: #fff; border-color: #8bd0ff; background: #2387da; }
    &:focus-visible { outline: 2px solid #b8e2ff; outline-offset: 2px; }
  }
  .editorFrame { display: block; width: 100%; height: 100%; border: 0; }
}
</style>
