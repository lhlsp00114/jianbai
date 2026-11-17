<template>
  <nodeSkeleton
    v-bind="nodeProps"
    :bottomVisible="node.selected && (!manualWriting || musicPromptMode)"
    :topVisible="manualWriting && node.selected"
    topWidth="max-content"
    :downloadUrl="downloadUrl"
    :downloadName="`${nodeProps.label || '文本'}.md`"
    :bottomWidth="660"
    :style="{ width: '350px', '--textNodeBackground': textBackground || undefined }"
    @fullscreen="editing = true">
    <template v-if="manualWriting" #top><div ref="manualToolbar" /></template>
    <div ref="textContentElement" class="textContent" :class="{ empty: !manualWriting && !outputs.text.value.trim(), resized, manualWriting }" :style="{ backgroundColor: textBackground || undefined }">
      <el-alert v-if="documentState.error" :title="documentState.error" type="error" :closable="false" showIcon>
        <el-button text size="small" :disabled="generating || textReloading" @click="editing = true">查看并复制当前正文</el-button>
        <el-button text size="small" :disabled="generating" :loading="textReloading" @click="reloadText">重新读取磁盘</el-button>
      </el-alert>
      <div v-if="manualWriting && textReady" class="inlineEditor nowheel" :class="{ nodrag: inlineEditing, nopan: inlineEditing }" @pointerdown="handleInlinePointerdown" @mousedown="handleInlineMousedown" @dblclick.stop="enterInlineEditing" @keydown="handleInlineKeydown">
        <markdownEditor ref="inlineEditor" v-model="outputs.text.value" v-model:backgroundColor="textBackground" compact expandable :contentEditable="inlineEditing" :toolbarTarget="manualToolbar" :toolbarVisible="!!manualToolbar && !editing" :downloadUrl="downloadUrl" :downloadName="`${nodeProps.label || '文本'}.md`" :files="textFiles" :path="textPath" :active="!editing" :disabled="generating || textReloading" :readonly="!!documentState.error" ariaLabel="编写文本内容" @expand="editing = true" />
      </div>
      <div v-else-if="!outputs.text.value.trim() && textReady" class="emptyState">
        <div class="emptyIcon">
          <icon-menu-2 :size="34" />
        </div>
        <div class="emptyLabel">尝试：</div>
        <div class="quickActions">
          <button class="quickAction nodrag nopan" :disabled="quickActionBusy || generating || textReloading || !!documentState.error" @pointerdown.stop @mousedown.stop @dblclick.stop @click.stop="useQuickAction('write')">
            <icon-pencil :size="18" />
            <span>自己编写内容</span>
          </button>
          <button class="quickAction nodrag nopan" :disabled="quickActionBusy || generating || textReloading || !!documentState.error" @pointerdown.stop @mousedown.stop @dblclick.stop @click.stop="useQuickAction('text2video')">
            <icon-video :size="18" />
            <span>文生视频</span>
          </button>
          <button class="quickAction nodrag nopan" :disabled="quickActionBusy || generating || textReloading || !!documentState.error" @pointerdown.stop @mousedown.stop @dblclick.stop @click.stop="useQuickAction('image2prompt')">
            <icon-photo :size="18" />
            <span>图片反推提示词</span>
          </button>
          <button class="quickAction nodrag nopan" :disabled="quickActionBusy || generating || textReloading || !!documentState.error" @pointerdown.stop @mousedown.stop @dblclick.stop @click.stop="useQuickAction('text2music')">
            <icon-music :size="18" />
            <span>文字生音乐</span>
          </button>
        </div>
      </div>
      <div v-if="!manualWriting && outputs.text.value.trim() && previewReady" class="textPreview nopan nowheel" aria-label="文本内容">
        <markdownPreview :modelValue="outputs.text.value" :files="textReady ? textFiles : undefined" :path="textPath" :active="previewReady" />
      </div>
      <div v-if="!manualWriting && outputs.text.value.trim()" class="textActions nodrag nopan" @pointerdown.stop @mousedown.stop @dblclick.stop>
        <el-button :icon="IconCopy" :disabled="generating || !textReady || textReloading" text title="复制正文" aria-label="复制正文" @click.stop="copyText">复制</el-button>
        <el-button :icon="IconEdit" :disabled="generating || !textReady" text @click.stop="editing = true">编辑</el-button>
      </div>
    </div>
    <template v-if="!manualWriting || musicPromptMode" #bottom>
      <el-card class="promptCard" shadow="never" :bodyStyle="{ padding: '14px 16px 12px' }">
        <div class="promptHeader" v-if="refList.length">
          <referenceItem
            v-model="refList"
            @preview="setReferencePreview"
            @remove="removeReference" />
        </div>
        <promptInput v-model="promptModel" v-model:text="prompt" :references="referenceMentions" />
        <div class="promptFooter">
          <el-select :modelValue="selectedModel ? model : ''" class="modelSelect" filterable :loading="modelsLoading" :disabled="generating" placeholder="选择模型" aria-label="生成模型" noDataText="请先在设置中添加模型" placement="top-start" @update:modelValue="model = $event" @visible-change="visible => visible && loadModels()">
            <template v-if="!selectedModel" #prefix><icon-sparkles :size="17" /></template>
            <template #label="{ label }"><modelLabel :label="label" :providerId="selectedModel?.providerId" :modelId="selectedModel?.modelId" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option v-for="item in provider.models" :key="item.modelId" :label="item.label" :value="getNodeModelKey(item)">
                <modelLabel :label="item.label" :providerId="item.providerId" :modelId="item.modelId" />
              </el-option>
            </el-option-group>
          </el-select>
          <div class="promptActions">
            <el-button class="sendButton" :icon="IconArrowUp" :loading="generating" :disabled="!prompt.trim() || !selectedModel || generating || !textReady || textReloading || !!documentState.error" title="生成" aria-label="生成" @click="generateText" />
          </div>
        </div>
      </el-card>
    </template>
  </nodeSkeleton>
  <el-dialog v-model="editing" class="textEditDialog" title="编辑文本" width="min(760px, calc(100vw - 48px))" alignCenter appendToBody>
    <div class="textEditor">
      <markdownEditor v-model="outputs.text.value" v-model:backgroundColor="textBackground" :compact="manualWriting" :files="textReady ? textFiles : undefined" :path="textPath" :active="editing" :disabled="generating || textReloading || !textReady" :readonly="!!documentState.error" ariaLabel="编辑文本内容" />
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from "vue";
import { ElAlert, ElButton, ElCard, ElSelect, ElDialog, ElOption, ElOptionGroup, ElMessage, ElMessageBox } from "element-plus";
import { IconEdit, IconFileText, IconSparkles, IconArrowUp, IconMenu2, IconPencil, IconVideo, IconPhoto, IconMusic, IconCopy } from "@tabler/icons-vue";
import { getNodeModelIdentity, getNodeModelKey, nodeSkeleton, nodeTools, useNode, useNodeModelSelection, validateConnection, z, type NodeAiModel, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import { useVueFlow } from "@vue-flow/core";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import modelLabel from "@toonflow/node-shared/modelLabel";
import { useNodeReferences } from "@toonflow/node-shared/useNodeReferences";
import markdownEditor from "./markdownEditor.vue";
import markdownPreview from "./markdownPreview.vue";
import referenceItem from "@toonflow/node-shared/referenceItem";
import promptInput from "@toonflow/node-shared/promptInput";
import { useNodeDocumentState, type NodeDocumentContext } from "@toonflow/nodes-scaffold/nodeDocument";
import { defaultImagePromptInstruction, imagePromptRequest, legacyImagePrompt } from "./imagePromptInstruction";

type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;

defineOptions({
  inheritAttrs: false,
  icon: IconFileText,
  handles: [
    { id: "in", type: "target", dataType: ["VIDEO", "IMAGE", "STRING", "FILE"], label: "视频、图片、文本、文件输入" },
    { id: "text", type: "source", dataType: "STRING", label: "文本输出" },
  ] satisfies NodeHandle[],
});
const { node, nodeProps, outputs, ai, files, nodeEvent, previewReady } = useNode({
  label: "文本",
  onModelsChanged: () => void loadModels(),
  outputs: { text: { dataType: "STRING", value: "" } },
});
const { refList, referenceMentions, setReferencePreview, removeReference } = useNodeReferences();
const editing = ref(false);
async function copyText() {
  try {
    await navigator.clipboard.writeText(outputs.value.text.value);
    ElMessage.success("已复制");
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : "复制失败，请在编辑窗口中选择并复制"); }
}

const inlineEditing = ref(false);
const textContentElement = ref<HTMLElement>();
const manualToolbar = ref<HTMLElement>();
const inlineEditor = ref<InstanceType<typeof markdownEditor>>();
const downloadUrl = ref("");
const documentContext = inject<NodeDocumentContext | undefined>("nodeDocument", undefined);
const flow = useVueFlow();
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
const resized = computed(() => !documentContext?.targets.has(node.id) && typeof node.style === "object" && !!node.style.height);
watch([() => outputs.value.text.value, () => node.selected || !!documentContext?.targets.has(node.id)], ([text, visible], _previous, onCleanup) => {
  downloadUrl.value = "";
  if (!visible || !text.trim()) return;
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  downloadUrl.value = url;
  onCleanup(() => URL.revokeObjectURL(url));
}, { immediate: true });
const data = computed(() => node.data as typeof node.data & { prompt?: string; promptModel?: PromptModel; model?: string; textPath?: string; textSnapshot?: string; manualWriting?: boolean; promptAction?: string; textBackground?: string });
const manualWriting = computed(() => data.value.manualWriting === true);
const musicPromptMode = computed(() => data.value.promptAction === "text2music");
const readImageInstruction = inject<() => string>("textImagePromptInstruction", () => defaultImagePromptInstruction);
const imagePromptMode = computed(() => data.value.promptAction === "image2prompt"
  || !data.value.promptAction && data.value.prompt === legacyImagePrompt);
const legacyBackgroundColors: Record<string, string> = {
  "#35211f": "#382124", "#35281b": "#46301c", "#332f1a": "#453b1b",
  "#1f3026": "#1d3a2a", "#1d3034": "#1b3b43", "#1e2938": "#24385d",
  "#2b2238": "#38264f", "#351f2b": "#48233b", "#343434": "#3d3d3d",
  "#4a2425": "#382124", "#49301c": "#46301c", "#453c1a": "#453b1b",
  "#1c3d2c": "#1d3a2a", "#183e46": "#1b3b43", "#203c64": "#24385d",
  "#362052": "#38264f", "#4d1e3c": "#48233b", "#424242": "#3d3d3d",
};
const textBackground = computed({ get: () => legacyBackgroundColors[data.value.textBackground ?? ""] ?? data.value.textBackground ?? "", set: (value: string) => { data.value.textBackground = value; } });
const prompt = computed({ get: () => data.value.prompt ?? "", set: (value: string) => { data.value.prompt = value; } });
const model = computed({ get: () => data.value.model ?? "", set: (value: string) => { data.value.model = value; } });
const models = ref<NodeAiModel[]>([]);
const modelsLoading = ref(false);
const generating = ref(false);
const quickActionBusy = ref(false);
const selectedModel = useNodeModelSelection(models, model);
const modelGroups = computed(() => groupNodeModels(models.value));
const textReady = ref(false);
const textReloading = ref(false);
const textPath = `assets/${node.id}/content.md`;
let textFiles: ReturnType<typeof files.getWorkspaceFiles>;
let textLoading: Promise<void> | undefined;
let textSaving = Promise.resolve();
let textSnapshot: Awaited<ReturnType<typeof textFiles.readTextSnapshot>> | undefined;
let textRevision = 0;
const documentState = useNodeDocumentState();
watch(() => node.selected, selected => { if (!selected) inlineEditing.value = false; });
watch(editing, value => { if (value) inlineEditing.value = false; });
function saveText(value: string) {
  const revision = ++textRevision;
  documentState.dirty = true;
  textSaving = textSaving.catch(() => {}).then(async () => {
    if (!textSnapshot) throw new Error("文本尚未加载，无法保存");
    textSnapshot.revision = await textFiles.writeTextSnapshot(textPath, value, textSnapshot);
    textSnapshot.text = value;
    if (revision === textRevision && outputs.value.text.value === value) {
      documentState.dirty = false;
      documentState.error = "";
    }
  }).catch(error => {
    documentState.error = (error as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (error instanceof Error ? error.message : "文本保存失败");
    throw error;
  });
  return textSaving;
}
nodeEvent.on("save", async (reason) => {
  await textLoading;
  if (!textReady.value) throw new Error("文本尚未加载，无法保存");
  if (reason === "reload" && generating.value) throw new Error("文本正在生成，请完成后再刷新节点");
  // 普通编辑已由 watcher 入队；生成中补存当前片段，不因画布保存重复写未改动的文本。
  if (generating.value) saveText(outputs.value.text.value);
  let pending: Promise<void>;
  do {
    pending = textSaving;
    try { await pending; }
    catch { await saveText(outputs.value.text.value); }
  } while (pending !== textSaving);
  if (reason === "reload" && generating.value) throw new Error("文本正在生成，请完成后再刷新节点");
});
onMounted(() => { textLoading = loadText(); });
async function loadText(fromDisk = false) {
  textReloading.value = true;
  textReady.value = false;
  try {
    if (!node.id || /[\\/]/.test(node.id) || node.id === "." || node.id === "..") throw new Error("节点 ID 不能作为文件夹名称");
    if (data.value.textPath !== undefined && data.value.textPath !== textPath) throw new Error("文本文件路径无效");
    textFiles = files.getWorkspaceFiles();
    if (data.value.textPath || fromDisk) textSnapshot = await textFiles.readTextSnapshot(textPath);
    const value = fromDisk ? textSnapshot!.text : data.value.textSnapshot !== undefined ? data.value.textSnapshot : textSnapshot?.text ?? outputs.value.text.value;
    if (typeof value !== "string") throw new Error("文本内容无效");
    if (!data.value.textPath && !fromDisk) {
      for (const directory of ["assets", `assets/${node.id}`]) {
        await textFiles.mkdir(directory).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
          if (error.response?.data?.data?.code !== "EEXIST") throw error;
        });
      }
      await textFiles.write(textPath, value, true).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
        if (error.response?.data?.data?.code !== "EEXIST") throw error;
      });
      textSnapshot = await textFiles.readTextSnapshot(textPath);
      if (textSnapshot.text !== value) throw new Error("文本文件已被其他编辑器修改，请重新加载节点");
    } else if (textSnapshot && textSnapshot.text !== value) {
      textSnapshot.revision = await textFiles.writeTextSnapshot(textPath, value, textSnapshot);
      textSnapshot.text = value;
    }
    outputs.value.text.value = value;
    data.value.textPath = textPath;
    delete data.value.textSnapshot;
    // ACT: 成功落盘后才排除内联正文；迁移失败时画布仍保留原内容。
    if (!Object.hasOwn(outputs.value, "toJSON")) Object.defineProperty(outputs.value, "toJSON", { value: () => ({}) });
    textSaving = Promise.resolve();
    textReady.value = true;
    documentState.dirty = false;
    documentState.error = "";
  } catch (error) {
    documentState.error = (error as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (error instanceof Error ? error.message : "文本加载失败");
    ElMessage.error(documentState.error);
  } finally { textReloading.value = false; }
}

async function reloadText() {
  if (generating.value || textReloading.value) return;
  const confirmed = await ElMessageBox.confirm("重新读取将用磁盘内容替换当前正文。未保存的修改会被放弃，请先复制需要保留的内容。", "重新读取文本", {
    confirmButtonText: "重新读取", cancelButtonText: "取消", type: "warning", closeOnClickModal: false,
  }).then(() => true, () => false);
  if (!confirmed || generating.value || textReloading.value) return;
  const fromDisk = textReady.value || !!textSnapshot || !!data.value.textPath;
  textReloading.value = true;
  textReady.value = false;
  await textSaving.catch(() => {});
  textLoading = loadText(fromDisk);
  await textLoading;
}

watch(() => outputs.value.text.value, async (value) => {
  if (!textReady.value) return;
  documentState.dirty = true;
  if (generating.value) return;
  try { await saveText(value); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : "文本保存失败"); }
}, { flush: "sync" });
nodeEvent.on("copy", () => {
  if (!textReady.value) throw new Error("文本尚未加载");
  return { textPath: undefined, textSnapshot: outputs.value.text.value };
});

onMounted(loadModels);

async function loadModels() {
  if (modelsLoading.value) return;
  modelsLoading.value = true;
  try {
    models.value = await ai.getModels();
    if (!model.value) {
      const first = modelGroups.value[0]?.models[0];
      model.value = first ? getNodeModelKey(first) : "";
    }
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError") ElMessage.error(error.message);
  } finally {
    modelsLoading.value = false;
  }
}

const quickActionPrompts: Record<string, { placeholder: string; autoOpen?: boolean }> = {
  write: { placeholder: "写下你想讲的故事、场景或角色设定。例如：一个来自未来的机器人，在城市屋顶看星星。", autoOpen: true },
  text2video: { placeholder: "描述你想生成的视频内容。例如：夕阳下的海边，海浪轻轻拍打岸边，一个女孩坐在礁石上看日落。" },
  image2prompt: { placeholder: imagePromptRequest },
  text2music: { placeholder: "描述你想生成的音乐风格和情绪。例如：轻快欢乐的流行音乐，适合夏日海边场景，BPM 约 120。" },
};

async function useQuickAction(type: string) {
  const action = quickActionPrompts[type];
  if (!action || quickActionBusy.value || !textReady.value || textReloading.value || generating.value || documentState.error) return;
  quickActionBusy.value = true;
  try {
    if (type === "text2video") {
      if (await createVideoGenerationNode()) activateManualWriting("text2video");
      return;
    }
    if (type === "image2prompt" && !await createImageReferenceNode()) return;
    if (type === "image2prompt") data.value.promptAction = type;
    if (action.autoOpen) {
      activateManualWriting("write");
      return;
    }
    if (!prompt.value.trim() || type === "image2prompt" && prompt.value === legacyImagePrompt) {
      data.value.prompt = action.placeholder;
      data.value.promptModel = [[{ type: "Write", text: action.placeholder }]];
    }
    if (type === "text2music") activateManualWriting("text2music");
    node.selected = true;
  } finally { quickActionBusy.value = false; }
}

async function enterInlineEditing() {
  if (!manualWriting.value || !textReady.value || generating.value || textReloading.value || documentState.error) return;
  inlineEditing.value = true;
  node.selected = true;
  await nextTick();
  inlineEditor.value?.focus();
}

function handleInlinePointerdown(event: PointerEvent) {
  if (inlineEditing.value) event.stopPropagation();
}

function handleInlineMousedown(event: MouseEvent) {
  if (inlineEditing.value) event.stopPropagation();
}

function handleInlineKeydown(event: KeyboardEvent) {
  if (!inlineEditing.value) return;
  event.stopPropagation();
  if (event.key === "Escape" && !event.isComposing) {
    event.preventDefault();
    inlineEditing.value = false;
    inlineEditor.value?.blur();
  }
}

function activateManualWriting(action: string) {
  if (!textReady.value || generating.value || documentState.error) return;
  const skeleton = textContentElement.value?.closest<HTMLElement>(".nodeSkeleton");
  if (skeleton && !documentContext?.targets.has(node.id)) {
    const style = typeof node.style === "function" ? node.style(node) : node.style;
    node.style = { ...style, width: `${skeleton.offsetWidth}px`, height: `${skeleton.offsetHeight}px` };
  }
  data.value.manualWriting = true;
  data.value.promptAction = action;
  node.selected = true;
}

async function createVideoGenerationNode() {
  const type = "remote-videoGenerationNode";
  if (!flow.nodeTypes?.value?.[type]) { ElMessage.error("请先启用视频生成节点插件"); return false; }
  if (flow.findNode(node.id) !== node) { ElMessage.error("文本节点已变化，请重新操作"); return false; }
  const nodeId = crypto.randomUUID();
  const width = 360;
  const x = node.computedPosition.x + (node.dimensions.width || 350) + 100;
  let y = node.computedPosition.y;
  for (const other of [...flow.getNodes.value].sort((left, right) => left.computedPosition.y - right.computedPosition.y)) {
    const position = other.computedPosition;
    if (other.id !== node.id && position.x < x + width && position.x + (other.dimensions.width || 320) > x
      && position.y < y + 420 && position.y + (other.dimensions.height || 300) > y) y = position.y + (other.dimensions.height || 300) + 40;
  }
  return batchHistory(async () => {
    if (flow.findNode(node.id) !== node || !flow.nodeTypes?.value?.[type]) throw new Error("画布或视频生成节点已变化，请重新操作");
    try {
      flow.addNodes({ id: nodeId, type, position: { x, y }, data: { label: "视频生成", ...(outputs.value.text.value.trim() ? { prompt: outputs.value.text.value.trim(), promptModel: [[{ type: "Write", text: outputs.value.text.value.trim() }]] } : {}) } });
      await nextTick();
      const sourceNode = flow.findNode(node.id);
      const targetNode = flow.findNode(nodeId);
      const edge = { id: crypto.randomUUID(), source: node.id, sourceHandle: "text", target: nodeId, targetHandle: "in" };
      if (!sourceNode || !targetNode || !validateConnection(edge, { sourceNode, targetNode, nodes: flow.getNodes.value, edges: flow.getEdges.value })) throw new Error("文本无法连接到视频生成节点");
      flow.addEdges(edge);
      if (!flow.findEdge(edge.id)) throw new Error("视频生成节点连接失败");
      // 保留文本节点选中状态，让创建完成后仍显示文本工具栏；这里只更新选中标记，不删除任何节点。
      flow.setNodes(flow.getNodes.value.map(item => ({ ...item, selected: item.id === node.id })));
      flow.nodesSelectionActive.value = false;
    } catch (error) {
      flow.removeNodes(nodeId, true, false);
      throw error;
    }
  }).then(() => true, error => {
    ElMessage.error(error instanceof Error ? error.message : "创建视频生成节点失败");
    return false;
  });
}

async function createImageReferenceNode() {
  const type = "remote-imageNode";
  if (!flow.nodeTypes?.value?.[type]) { ElMessage.error("请先启用图片节点插件"); return false; }
  if (flow.findNode(node.id) !== node) { ElMessage.error("文本节点已变化，请重新操作"); return false; }
  const nodeId = crypto.randomUUID();
  const width = 300;
  const x = node.computedPosition.x - width - 100;
  let y = node.computedPosition.y;
  for (const other of [...flow.getNodes.value].sort((left, right) => left.computedPosition.y - right.computedPosition.y)) {
    const position = other.computedPosition;
    if (other.id !== node.id && position.x < node.computedPosition.x && position.x + (other.dimensions.width || 320) > x
      && position.y < y + 300 && position.y + (other.dimensions.height || 300) > y) y = position.y + (other.dimensions.height || 300) + 40;
  }
  return batchHistory(async () => {
    if (flow.findNode(node.id) !== node || !flow.nodeTypes?.value?.[type]) throw new Error("画布或图片节点已变化，请重新操作");
    try {
      flow.addNodes({ id: nodeId, type, position: { x, y }, data: { label: "图片" } });
      await nextTick();
      const sourceNode = flow.findNode(nodeId);
      const targetNode = flow.findNode(node.id);
      const edge = { id: crypto.randomUUID(), source: nodeId, sourceHandle: "image", target: node.id, targetHandle: "in" };
      if (!sourceNode || !targetNode || !validateConnection(edge, { sourceNode, targetNode, nodes: flow.getNodes.value, edges: flow.getEdges.value })) throw new Error("图片节点无法连接到文本节点");
      flow.addEdges(edge);
      if (!flow.findEdge(edge.id)) throw new Error("图片节点连接失败");
    } catch (error) {
      flow.removeNodes(nodeId, true, false);
      throw error;
    }
  }).then(() => true, error => {
    ElMessage.error(error instanceof Error ? error.message : "创建图片节点失败");
    return false;
  });
}

async function generateText() {
  const choice = selectedModel.value;
  if (!textReady.value || textReloading.value || documentState.error || generating.value || !choice || !prompt.value.trim()) return;
  generating.value = true;
  let text = "";
  try {
    if (refList.value.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
    const references = refList.value
      .filter(item => item.value !== undefined && (item.dataType === "STRING" || item.dataType === "IMAGE" || item.dataType === "VIDEO" || item.dataType === "FILE"))
      .map(item => item.dataType === "STRING" ? { dataType: item.dataType, value: item.value } : { dataType: item.dataType, value: { ...item.value } });
    if (imagePromptMode.value && !references.some(item => item.dataType === "IMAGE")) {
      throw new Error("请先上传并连接参考图片，再生成反推提示词");
    }
    const input = {
      ...getNodeModelIdentity(choice),
      prompt: imagePromptMode.value && prompt.value === legacyImagePrompt ? imagePromptRequest : prompt.value.trim(),
      ...(imagePromptMode.value ? { systemPrompt: readImageInstruction() } : {}),
      references,
    };
    const directory = references.some(item => item.dataType !== "STRING") ? (await textFiles.list()).directory : undefined;
    const result = await ai.generate({
      ...input,
      directory,
      onEvent(event) {
        if (event.type === "text") outputs.value.text.value = text += event.delta;
      },
    });
    outputs.value.text.value = result.text;
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError") ElMessage.error(error.message);
  } finally {
    // 卸载会取消请求并停止 watcher，生成收尾必须自行保存已收到的正文。
    try { await saveText(outputs.value.text.value); }
    catch (error) { ElMessage.error(error instanceof Error ? error.message : "文本保存失败"); }
    generating.value = false;
  }
}
const promptModel = computed({ get: () => data.value.promptModel ?? [], set: (value: PromptModel) => { data.value.promptModel = value; } });

nodeTools.register({
  name: "setText",
  description: "修改此节点的文本输出",
  parameters: z.strictObject({ text: z.string() }),
  async execute({ text }) {
    if (!textReady.value) throw new Error("文本尚未加载");
    if (textReloading.value) throw new Error("文本正在重新读取，请稍后修改");
    if (documentState.error) throw new Error(documentState.error);
    if (generating.value) throw new Error("文本生成中，请稍后修改");
    if (outputs.value.text.value === text) await saveText(text);
    else { outputs.value.text.value = text; await textSaving; }
    return { text };
  },
});
</script>

<style lang="scss" scoped>
:deep(.contentCard), :deep(.contentCard > .el-card__body) { background-color: var(--textNodeBackground, var(--el-bg-color-overlay)) !important; }
.textEditor {
  height: min(760px, calc(100dvh - 160px));
  min-height: 0;
}

:deep(.textEditDialog.el-dialog) {
  max-width: calc(100vw - 48px);
  max-height: calc(100dvh - 96px);
  overflow: hidden;
}

:deep(.textEditDialog .el-dialog__body) {
  height: min(800px, calc(100dvh - 112px));
  box-sizing: border-box;
  padding: 0 16px 16px;
  overflow: hidden;
}

.textContent {
  min-height: 110px;
  border-radius: 8px;
  background-color: var(--textNodeBackground, transparent) !important;

  &.manualWriting { display: flex; flex-direction: column; height: 100%; min-height: 0; .inlineEditor { flex: 1; min-height: 0; } .el-alert { flex-shrink: 0; } }

  &.resized {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;

    .textPreview {
      flex: 1;
      min-height: 0;
      max-height: none;
    }

    .textActions { flex-shrink: 0; }
  }

  &.empty {
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    &.resized {
      justify-content: flex-start;
      overflow: auto;
      .emptyState { flex: 1; min-height: min-content; }
    }

    .emptyState {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: center;
      min-height: 290px;
      padding: 24px 20px;
      user-select: none;
      width: 100%;
      box-sizing: border-box;
      text-align: left;

      .emptyIcon {
        display: grid;
        place-items: center;
        width: 100%;
        height: 80px;
        flex-shrink: 0;
        margin-bottom: 8px;
        color: var(--el-text-color-secondary);
        opacity: .45;
      }

      .emptyLabel {
        color: var(--el-text-color-secondary);
        font-size: 13px;
        margin-bottom: 16px;
      }

      .quickActions {
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 100%;

        .quickAction {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-height: 26px;
          padding: 2px 8px;
          background: transparent;
          border: 0;
          border-radius: 4px;
          color: var(--el-text-color-primary);
          font: inherit;
          font-size: 14px;
          text-align: left;
          cursor: pointer;
          transition: background-color 0.12s, color 0.12s;

          &:hover {
            background: var(--el-fill-color-light);
            color: var(--el-color-primary);
          }

          &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
          &:disabled { opacity: .45; cursor: default; }
        }
      }
    }

  }

  .textPreview {
    min-height: 110px;
    max-height: 240px;
    overflow: auto;
    overflow-wrap: anywhere;
    user-select: none;
  }

  .textActions {
    display: flex;
    justify-content: flex-end;

    :deep(.el-button) { margin: 0; }
  }
}

.promptCard {
  .promptHeader {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .promptFooter {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;

    .modelSelect {
      width: 190px;
      min-width: 0;

      &:deep(.el-select__wrapper) {
        gap: 6px;
        padding: 0;
        box-shadow: none;
        background: transparent;
      }
    }

    .promptActions {
      display: flex;
      align-items: center;
      gap: 12px;

      .toolButton {
        width: 28px;
        height: 28px;
        padding: 0;
      }

      .generationCount {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--el-text-color-secondary);
        font-size: 12px;
      }

      .sendButton {
        width: 32px;
        height: 32px;
        margin: 0;
        padding: 0;
        border-radius: 12px;
        --el-button-bg-color: var(--el-text-color-primary);
        --el-button-border-color: transparent;
        --el-button-text-color: var(--el-bg-color);
        --el-button-hover-bg-color: var(--el-text-color-regular);
        --el-button-hover-border-color: transparent;
        --el-button-hover-text-color: var(--el-bg-color);
      }
    }
  }
}
</style>
