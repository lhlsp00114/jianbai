<template>
  <nodeSkeleton v-bind="nodeProps" style="width: 320px" contentPadding="2px" :resizeAspectRatio="1">
    <div class="directorPreviewArea">
    <div class="directorContent" @dblclick.stop>
      <img v-if="data.trialPreview" class="scenePreview" :src="data.trialPreview" alt="导演台场景预览" draggable="false" />
      <div v-else class="emptyPreview">
        <directorIcon :size="38" stroke="1.2" />
      </div>
      <button type="button" class="openDirector nodrag nopan" :disabled="trialOpening" @click.stop="openTrial">打开导演台</button>
    </div>
    </div>
  </nodeSkeleton>
  <el-dialog v-if="trialVisible" class="directorBetaDialog" :modelValue="true" title="3D导演台" fullscreen appendToBody :closeOnClickModal="false" :closeOnPressEscape="false" :beforeClose="closeTrial">
    <iframe ref="trialFrame" class="trialFrame" src="/directorTrial/index.html" title="分镜工作台" :data-project="trialInitial" :inert="trialSaving" @projectchange="trialDraft = $event.detail" />
    <form v-if="layoutOpen" class="layoutBar" aria-label="AI 搭景" @submit.prevent="generateLayout" @keydown.esc.stop="layoutOpen = false">
      <el-select v-model="model" filterable aria-label="搭景文本模型" placeholder="选择文本模型" :disabled="layoutBusy" @visibleChange="$event && loadModels()">
        <el-option-group v-for="group in groupNodeModels(models)" :key="group.id" :label="group.label"><el-option v-for="item in group.models" :key="getNodeModelKey(item)" :label="item.label" :value="getNodeModelKey(item)" /></el-option-group>
      </el-select>
      <el-input v-model="layoutInstruction" aria-label="搭景描述" placeholder="描述要添加的人物、道具和机位" :maxlength="4000" :disabled="layoutBusy" />
      <el-button nativeType="submit" type="primary" :loading="layoutBusy" :disabled="!layoutReady || !selectedModel || !layoutInstruction.trim() || trialSaving">AI 搭景</el-button>
    </form>
    <el-button v-if="!layoutReady" class="loadingClose" @click="closeTrial">关闭</el-button>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import directorIcon from "@toonflow/node-shared/directorIcon";
import { ElButton, ElDialog, ElInput, ElMessage, ElOption, ElOptionGroup, ElSelect } from "element-plus";
import { getNodeModelIdentity, getNodeModelKey, nodeSkeleton, useNode, useNodeFiles, useNodeModelSelection, z, type NodeHandle, type NodeAiModel } from "@toonflow/nodes-scaffold/runtime";
import { useNodeReferences } from "@toonflow/node-shared/useNodeReferences";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import { layoutPrompt, parseLayout } from "./trialLayout";

defineOptions({
  inheritAttrs: false,
  icon: directorIcon,
  handles: [{ id: "in", type: "target", dataType: ["STRING", "IMAGE", "VIDEO"], label: "文本、图片、视频输入" }] satisfies NodeHandle[],
});
const { node, nodeProps, ai, files, nodeEvent } = useNode({ label: "3D导演台", onModelsChanged: () => void loadModels() });
const { addNodes, findNode, getNodes, nodeTypes } = useVueFlow();
const mediaFiles = useNodeFiles();
const exportingImage = ref(false);
const exportController = new AbortController();
nodeEvent.on("delete", () => { if (exportingImage.value) throw new Error("正在导出，请完成后再删除导演节点"); });
const data = computed(() => node.data as typeof node.data & {
  trialSaved?: boolean;
  trialPreview?: string;
  trialMode?: boolean;
  trialSnapshot?: string;
  model?: string;
});
const { refList } = useNodeReferences();
if (data.value.trialMode && ["新版导演台 · 试用", "3D导演台Beta"].includes(data.value.label ?? "")) data.value.label = "3D导演台";
const model = computed({ get: () => data.value.model ?? "", set: (value: string) => { data.value.model = value; } });
const modelsLoading = ref(false);
const models = ref<NodeAiModel[]>([]);
const selectedModel = useNodeModelSelection(models, model);
let disposed = false;
onBeforeUnmount(() => { disposed = true; exportController.abort(new Error("导演节点已关闭，导出已停止")); });

function trialPath() {
  if (!node.id || /[\\/]/.test(node.id) || node.id === "." || node.id === "..") throw new Error("节点 ID 不能作为文件夹名称");
  return `assets/${node.id}/directorTrial.json`;
}
const trialVisible = ref(false);
const trialOpening = ref(false);
const trialSaving = ref(false);
const trialFrame = ref<HTMLIFrameElement>();
const trialInitial = shallowRef<string>();
const trialDraft = shallowRef<unknown>();
const layoutInstruction = ref("");
const layoutBusy = ref(false);
const layoutReady = ref(false);
const layoutOpen = ref(false);
let layoutRequest: AbortController | undefined;

async function generateLayout() {
  const instruction = layoutInstruction.value.trim();
  const choice = selectedModel.value;
  const frame = trialFrame.value;
  if (!frame || !layoutReady.value || !instruction || !choice || layoutBusy.value || trialSaving.value) return;
  layoutBusy.value = true;
  const request = new AbortController();
  layoutRequest = request;
  try {
    if (refList.value.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
    const references = refList.value
      .filter(item => item.value !== undefined && (item.dataType === "STRING" || item.dataType === "IMAGE" || item.dataType === "VIDEO"))
      .map(item => item.dataType === "STRING" ? { dataType: item.dataType, value: item.value } : { dataType: item.dataType, value: { ...item.value } });
    const directory = references.some(item => item.dataType !== "STRING") ? (await files.getWorkspaceFiles().list()).directory : undefined;
    request.signal.throwIfAborted();
    const result = await ai.generate({ ...getNodeModelIdentity(choice), prompt: instruction, systemPrompt: layoutPrompt, references, directory, signal: request.signal });
    if (request.signal.aborted || disposed || trialFrame.value !== frame) return;
    const detail = parseLayout(result.text);
    if (frame.dispatchEvent(new CustomEvent("appenddirectorlayout", { detail, cancelable: true }))) throw new Error("工作台未接收搭景结果，请重新打开后再试");
    layoutInstruction.value = "";
    ElMessage.success("搭景完成，可以选择人物、道具和机位继续编辑");
  } catch (error) {
    if (!request.signal.aborted && !disposed) ElMessage.error(error instanceof SyntaxError || error instanceof z.ZodError ? "模型返回的场景格式无效，请调整描述后重试" : error instanceof Error ? error.message : "搭景失败");
  } finally { layoutBusy.value = false; }
}
let trialFiles: ReturnType<typeof files.getWorkspaceFiles>;
let trialRevision: Awaited<ReturnType<typeof trialFiles.readTextSnapshot>> | undefined;
let firstSavedText: string | undefined;
let trialWrite: Promise<void> | undefined;
let trialTimer: ReturnType<typeof setTimeout> | undefined;

watch(trialDraft, project => {
  if (!project) return;
  clearTimeout(trialTimer);
  trialTimer = setTimeout(() => { void flushTrial().catch(error => ElMessage.error(`导演台自动保存失败：${error.message}`)); }, 600);
}, { flush: "sync" });

function warnUnsavedTrial(event: BeforeUnloadEvent) {
  if (trialDraft.value || layoutBusy.value) event.preventDefault();
}

async function flushTrial() {
  clearTimeout(trialTimer);
  while (trialDraft.value || trialWrite) {
    if (!trialWrite) trialWrite = writeTrialDraft().finally(() => { trialWrite = undefined; });
    await trialWrite;
  }
}

async function writeTrialDraft() {
  const project = trialDraft.value;
  const text = JSON.stringify(project);
  const path = trialPath();
  if (firstSavedText !== undefined) {
    const snapshot = await trialFiles.readTextSnapshot(path);
    if (snapshot.text !== firstSavedText) throw new Error("场景文件已被其他编辑器修改，当前编辑内容已保留");
    trialRevision = snapshot;
    firstSavedText = undefined;
  }
  if (trialRevision) {
    trialRevision.revision = await trialFiles.writeTextSnapshot(path, text, trialRevision);
  } else {
    for (const directory of ["assets", `assets/${node.id}`]) {
      await trialFiles.mkdir(directory).catch(error => { if (error?.response?.data?.data?.code !== "EEXIST") throw error; });
    }
    await trialFiles.write(path, text, true);
    firstSavedText = text;
  }
  data.value.trialSaved = true;
  delete data.value.trialSnapshot;
  if (trialDraft.value === project) {
    trialDraft.value = undefined;
    updateTrialPreview();
  }
}

function updateTrialPreview() {
  if (!layoutReady.value) return;
  const viewport = trialFrame.value?.contentDocument?.querySelector(".director-canvas");
  const source = viewport?.querySelector("canvas");
  if (!viewport || !source?.width || !source.height) return;
  const bounds = source.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const scale = Math.min(1, 640 / bounds.width, 480 / bounds.height);
  const thumbnail = document.createElement("canvas");
  thumbnail.width = Math.max(1, Math.round(bounds.width * scale));
  thumbnail.height = Math.max(1, Math.round(bounds.height * scale));
  const context = thumbnail.getContext("2d");
  if (!context) return;
  try {
    context.drawImage(source, 0, 0, thumbnail.width, thumbnail.height);
    context.textAlign = "center";
    context.font = "11px sans-serif";
    context.lineWidth = 3;
    context.strokeStyle = "#202020";
    context.fillStyle = "#fff";
    for (const label of viewport.querySelectorAll(".role-label")) {
      const rect = label.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const x = (rect.left + rect.width / 2 - bounds.left) * scale;
      const y = (rect.bottom - bounds.top) * scale;
      context.strokeText(label.textContent ?? "", x, y);
      context.fillText(label.textContent ?? "", x, y);
    }
    data.value.trialPreview = thumbnail.toDataURL("image/webp", 0.8);
  } catch (error) {
    console.warn("导演台场景预览更新失败", error);
  }
}

async function openTrial() {
  if (trialOpening.value || trialVisible.value) return;
  trialOpening.value = true;
  try {
    trialFiles = files.getWorkspaceFiles();
    trialRevision = data.value.trialSaved ? await trialFiles.readTextSnapshot(trialPath()) : undefined;
    trialInitial.value = trialRevision?.text ?? data.value.trialSnapshot;
    if (trialInitial.value !== undefined) {
      const project = JSON.parse(trialInitial.value);
      if (project?.version !== 1 || !Array.isArray(project.objects) || !Array.isArray(project.cameras) || !Array.isArray(project.assets) || typeof project.scene?.backgroundColor !== "string") throw new Error("导演台场景格式无效");
    }
    trialDraft.value = undefined;
    layoutReady.value = false;
    layoutOpen.value = false;
    void loadModels();
    if (!disposed) trialVisible.value = true;
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : "导演台场景读取失败"); }
  finally { trialOpening.value = false; }
}

async function closeTrial() {
  if (trialSaving.value || exportingImage.value) return;
  layoutRequest?.abort();
  trialSaving.value = true;
  try {
    if (!trialDraft.value && data.value.trialSnapshot) trialDraft.value = JSON.parse(data.value.trialSnapshot);
    await flushTrial();
    updateTrialPreview();
    trialVisible.value = false;
    trialDraft.value = undefined;
    trialInitial.value = undefined;
    trialRevision = undefined;
    firstSavedText = undefined;
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : "导演台场景保存失败，已保留编辑内容"); }
  finally { trialSaving.value = false; }
}

async function handleTrialMessage(event: MessageEvent) {
  if (!trialVisible.value || !trialFrame.value || event.origin !== location.origin || event.source !== trialFrame.value.contentWindow) return;
  if (event.data?.type === "storyai:director-desk-ready") { layoutReady.value = true; return; }
  if (event.data?.type === "storyai:director-desk-toggle-layout") {
    layoutOpen.value = !layoutOpen.value;
    return;
  }
  if (event.data?.type === "storyai:director-desk-close") return closeTrial();
  if (event.data?.type !== "storyai:director-desk-captures-sent" || trialSaving.value || exportingImage.value) return;
  const captures = event.data.payload?.captures;
  if (!Array.isArray(captures) || !captures.length || captures.length > 64) return void ElMessage.error("分镜数量无效，每次最多发送 64 张");
  for (const capture of captures) {
    if (disposed || !trialVisible.value) return;
    if (typeof capture?.dataUrl !== "string" || capture.dataUrl.length > 24 * 1024 * 1024 || !capture.dataUrl.startsWith("data:image/png;base64,iVBORw0KGgo")) return void ElMessage.error("分镜图片无效或过大");
    await exportCapture(capture.dataUrl);
  }
}

watch(trialVisible, open => {
  if (open) window.addEventListener("beforeunload", warnUnsavedTrial);
  else window.removeEventListener("beforeunload", warnUnsavedTrial);
  if (open) window.addEventListener("message", handleTrialMessage);
  else window.removeEventListener("message", handleTrialMessage);
});
onBeforeUnmount(() => {
  clearTimeout(trialTimer);
  layoutRequest?.abort();
  window.removeEventListener("beforeunload", warnUnsavedTrial);
  window.removeEventListener("message", handleTrialMessage);
});

nodeEvent.on("copy", async () => {
  await nodeEvent.emit("save");
  const trialSnapshot = trialDraft.value ? JSON.stringify(trialDraft.value) : data.value.trialSaved ? await files.getWorkspaceFiles().readText(trialPath()) : data.value.trialSnapshot;
  return { modelPath: undefined, modelSnapshot: undefined, trialSaved: undefined, trialSnapshot };
});

nodeEvent.on("save", async (reason) => {
  if (reason === "reload" && (layoutBusy.value || exportingImage.value)) throw new Error("导演台正在搭景或导出，请完成后再刷新节点");
  await flushTrial();
});

async function exportCapture(dataUrl: string) {
  const type = "remote-imageNode";
  if (!nodeTypes?.value?.[type]) return void ElMessage.error("请先启用图片节点插件");
  exportingImage.value = true;
  try {
    const id = crypto.randomUUID();
    const signal = exportController.signal;
    const blob = await (await fetch(dataUrl, { signal })).blob();
    signal.throwIfAborted();
    const path = await mediaFiles.uploadFile(id, new File([blob], "导演台分镜.png", { type: "image/png" }));
    signal.throwIfAborted();
    if (findNode(node.id) !== node || !nodeTypes.value[type]) throw new Error("画布节点已变化，请重新导出");
    const width = 240 * 16 / 9 + 18;
    const x = node.computedPosition.x + (node.dimensions.width || 320) + 80;
    let y = node.computedPosition.y;
    for (const other of [...getNodes.value].sort((a, b) => a.computedPosition.y - b.computedPosition.y)) {
      const position = other.computedPosition;
      if (position.x < x + width && position.x + (other.dimensions.width || 320) > x && position.y < y + 320 && position.y + (other.dimensions.height || 300) > y) {
        y = position.y + (other.dimensions.height || 300) + 24;
      }
    }
    addNodes({ id, type, position: { x, y }, data: { label: "导演台分镜", outputs: { image: { dataType: "IMAGE", value: { url: path, mimeType: "image/png" } } } } });
    ElMessage.success("分镜已导出到画布");
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "导出失败，请重试");
  } finally {
    exportingImage.value = false;
  }
}

async function loadModels() {
  if (modelsLoading.value) return;
  modelsLoading.value = true;
  try {
    const available = await ai.getModels();
    if (disposed) return;
    models.value = available;
    const first = groupNodeModels(models.value)[0]?.models[0];
    // ACT: 只给空配置选默认模型，保留暂时不可用的旧选择。
    if (!model.value) model.value = first ? getNodeModelKey(first) : "";
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "模型加载失败");
  } finally {
    modelsLoading.value = false;
  }
}
</script>

<style scoped lang="scss">
:global(.el-dialog.directorBetaDialog) { display: flex; flex-direction: column; height: 100dvh; box-sizing: border-box; padding: 0; overflow: hidden; }
:global(.directorBetaDialog > .el-dialog__header) { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); }
:global(.directorBetaDialog .el-dialog__headerbtn) { display: none; }
:global(.directorBetaDialog > .el-dialog__body) { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; background: #191a1d; }
.layoutBar {
  position: absolute;
  left: 50%;
  bottom: 72px;
  z-index: 4;
  display: flex;
  align-items: center;
  align-self: center;
  gap: 6px;
  width: min(390px, calc(100% - 24px));
  box-sizing: border-box;
  margin: 0;
  transform: translateX(-50%);
  padding: 6px;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 24px;
  background: rgb(29 30 34 / 88%);
  box-shadow: 0 10px 32px rgb(0 0 0 / 28%);
  backdrop-filter: blur(18px);
  .el-select { width: 104px; flex-shrink: 0; }
  :deep(.el-input__wrapper), :deep(.el-select__wrapper) { box-shadow: none; border-radius: 16px; background: #27282c; color: white; }
  .el-button { border-radius: 16px; }
  .el-input { min-width: 0; }
}
.loadingClose { position: absolute; top: 8px; left: 8px; z-index: 5; }
.trialFrame { display: block; flex: 1; min-height: 0; width: 100%; border: 0; }
.directorPreviewArea {
  position: relative;
  .nodeSkeleton.resized & { height: 100%; }
}
.directorContent {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
  border-radius: var(--el-border-radius-base);
  .openDirector {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 6px 11px;
    border: 1px solid rgb(255 255 255 / 18%);
    border-radius: 7px;
    background: rgb(22 23 25 / 92%);
    color: #fff;
    font: inherit;
    font-size: 12px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    cursor: pointer;
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
  }
  &:hover .openDirector, &:focus-within .openDirector { opacity: 1; pointer-events: auto; }
  @media (hover: none) { .openDirector { opacity: 1; pointer-events: auto; } }

  .nodeSkeleton.resized & {
    height: 100%;
    aspect-ratio: auto;
  }

  .scenePreview {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .emptyPreview {
    display: flex;
    height: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--el-text-color-placeholder);
  }

}
</style>
