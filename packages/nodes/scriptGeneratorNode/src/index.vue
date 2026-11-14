<template>
  <nodeSkeleton v-bind="nodeProps" :topVisible="node.selected" :bottomVisible="node.selected && !editorOpen && !loadError" topWidth="max-content" :bottomWidth="660" :downloadUrl="downloadUrl" :downloadName="(document.title.trim() || '分镜脚本') + '.md'" toolbarAction="focus" :style="{ width: '350px' }">
    <template #topActions><el-button :icon="IconMovie" text :disabled="!!loadError" @click.stop="openEditor()">打开脚本编辑器</el-button></template>
    <div class="summaryContent" @dblclick.stop="openEditor()">
      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
      <template v-else>
        <div class="scriptMark"><icon-menu-2 :size="34" /></div>
        <div class="creationModes nodrag nopan" aria-label="选择分镜创作方式" @pointerdown.stop @mousedown.stop>
          <span>尝试：</span>
          <button v-for="option in creationModes" :key="option.value" type="button" :class="{ current: modeChosen && document.mode === option.value }" :aria-pressed="modeChosen && document.mode === option.value" :disabled="busy || scriptExampleCreating" @click.stop="selectCreationMode(option.value)">
            <component :is="option.icon" :size="18" />{{ option.label }}
          </button>
        </div>
        <p v-if="document.shots.length" class="documentSummary">{{ document.shots.length }} 个镜头 · {{ totalDuration }} 秒 · {{ document.assets.length }} 项资产</p>
        <span v-if="busy" class="progressLabel">{{ progress }}</span>
      </template>
    </div>
    <template #bottom>
      <el-card class="promptCard" shadow="never" :bodyStyle="{ padding: '14px 16px 12px' }">
        <div class="promptTopline nodrag nopan">
          <el-button text :icon="IconPlus" :disabled="busy" @click.stop="addReference">参考图</el-button>
          <span v-if="refList.length" class="referenceCount">{{ refList.length }} 项参考</span>
        </div>
        <div v-if="refList.length" class="referenceList"><referenceItem v-model="refList" @preview="setReferencePreview" @remove="removeReference" /></div>
        <div v-if="document.mode !== 'manual'" :inert="busy" class="promptArea">
          <promptInput v-model="promptModel" v-model:text="document.input" :references="referenceMentions" :materials="materialMentions" :selectMaterial="selectMaterialReference" :selectAsset="selectAssetReference" expandable placeholder="描述剧情片段、故事，或为你生成分镜脚本" />
        </div>
        <div v-else class="manualPromptHint">手工编写模式将在脚本编辑器中添加分镜</div>
        <div class="promptFooter">
          <textModelSelect v-if="document.mode !== 'manual'" v-model="document.model" :models="textModels" :loading="modelsLoading" :disabled="busy" @open="loadModels" />
          <span v-else class="manualModeLabel">手工编写</span>
          <div class="promptActions">
            <span v-if="document.mode !== 'manual'" class="billingHint">按所选模型计费</span>
            <el-button v-if="busy" :icon="IconPlayerStop" @click="cancel">停止</el-button>
            <el-button v-else class="sendButton" :icon="document.mode === 'manual' ? IconEdit : IconArrowUp" type="primary" circle :title="document.mode === 'manual' ? '打开分镜编辑器' : '生成分镜脚本'" :aria-label="document.mode === 'manual' ? '打开分镜编辑器' : '生成分镜脚本'" @click="document.mode === 'manual' ? openEditor(0) : generateScript()" />
          </div>
        </div>
        <p v-if="error" class="errorMessage">{{ error }}</p>
      </el-card>
    </template>
  </nodeSkeleton>
  <el-dialog v-if="!loadError" v-model="editorOpen" title="脚本生成器" fullscreen appendToBody destroyOnClose :showClose="false" :closeOnClickModal="false" class="scriptGeneratorDialog">
    <scriptEditor v-model="document" :busy="busy" :generating="generating" :error="error" :progress="progress" :imageModels="imageModels" :videoModels="videoModels" :reports="reports" :selectAssetImage="selectAssetImage" @close="editorOpen = false" @generate="generateScript" @compose="compose" @media="createMedia" @cancel="cancel" @focus="focusMedia" @saveAsset="saveAsset" @loadModels="loadModels">
      <template #model><textModelSelect v-if="document.mode !== 'manual'" v-model="document.model" :models="textModels" :loading="modelsLoading" :disabled="busy" @open="loadModels" /></template>
    </scriptEditor>
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElAlert, ElButton, ElCard, ElDialog, ElMessage, ElMessageBox } from "element-plus";
import { IconMovie, IconMenu2, IconList, IconUser, IconFileText, IconPlus, IconArrowUp, IconEdit, IconPlayerStop } from "@tabler/icons-vue";
import { nodeSkeleton, useNode, findNodeModel, getNodeModelIdentity, getNodeModelKey, validateConnection, type NodeAiModel, type NodeMediaModel, type NodeHandle, type NodeOutput } from "@toonflow/nodes-scaffold/runtime";
import { useNodeReferences } from "@toonflow/node-shared/useNodeReferences";
import { readLastNodeModel } from "@toonflow/node-shared/modelPreference";
import { getPromptText } from "@toonflow/node-shared/promptText";
import promptInput from "@toonflow/node-shared/promptInput";
import referenceItem from "@toonflow/node-shared/referenceItem";
import scriptEditor from "./scriptEditor.vue";
import textModelSelect from "./textModelSelect.vue";
import { createScript, scriptSchema, composeShot, formatScript, shotSource, promptEdited, scriptIssueText, inputLimit, type ScriptDocument, type AssetReference, type MediaKind } from "./scriptData";
import { buildScriptPrompt, readGeneratedScript, scriptSystemPrompt } from "./scriptAi";
import { useScriptMedia, type MediaReport } from "./scriptMedia";
import scriptExample from "./scriptExample.md?raw";

defineOptions({ inheritAttrs: false, icon: IconMovie, handles: [
  { id: "in", type: "target", dataType: ["STRING", "IMAGE"], label: "剧本、角色与场景参考输入" },
  { id: "script", type: "source", dataType: "STRING", label: "分镜脚本输出" },
] satisfies NodeHandle[] });
const { node, nodeProps, outputs, ai, files, nodeEvent } = useNode({ label: "脚本生成器", outputs: { script: { dataType: "STRING", value: "" } }, onModelsChanged: () => void loadModels() });
const savedData = node.data as typeof node.data & { scriptDocument?: ScriptDocument; scriptExampleNodeId?: string };
const fallbackDocument = createScript();
const recovered = scriptSchema.safeParse(savedData.scriptDocument ?? fallbackDocument);
const loadError = recovered.success ? "" : "脚本数据格式无效，原数据已保留，请先恢复有效的画布版本";
// 仅在新节点上写入初始数据；已有的有效数据保持原对象，避免每次打开画布都触发一次保存。
if (recovered.success && !savedData.scriptDocument) savedData.scriptDocument = recovered.data;
const document = computed({ get: () => loadError ? fallbackDocument : savedData.scriptDocument!, set: value => { savedData.scriptDocument = value; } });
const { refList, referenceMentions, materialMentions, selectMaterialReference, selectAssetReference, setReferencePreview, removeReference } = useNodeReferences();
const media = useScriptMedia();
const flow = useVueFlow();
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
const creationModes = [
  { value: "script" as const, label: "剧本生成分镜脚本", icon: IconList },
  { value: "character" as const, label: "角色生成分镜脚本", icon: IconUser },
  { value: "manual" as const, label: "自己编写分镜脚本", icon: IconFileText },
];
// 高亮跟随已保存的创作方式；全新节点在用户选择前不高亮默认值。
const modeChosen = ref(!loadError && (document.value.mode !== "script" || !!document.value.input.trim() || !!document.value.shots.length || !!savedData.scriptExampleNodeId));
watch(() => loadError ? "" : document.value.mode, () => { modeChosen.value = true; });
const scriptExampleCreating = ref(false);
async function selectCreationMode(mode: ScriptDocument["mode"]) {
  modeChosen.value = true;
  document.value.mode = mode;
  if (mode === "manual") return openEditor(0);
  // 案例剧本只用于空节点的上手演示；已有创作要求、分镜或文本参考时不再接入，避免案例混进用户自己的剧本。
  if (mode !== "script" || scriptExampleCreating.value || document.value.input.trim() || document.value.shots.length || refList.value.some(item => item.dataType === "STRING")) return;
  scriptExampleCreating.value = true;
  try { await ensureScriptExampleNode(); }
  catch (cause) { ElMessage.warning(cause instanceof Error ? cause.message : "创建剧本案例节点失败"); }
  finally { scriptExampleCreating.value = false; }
}
async function ensureScriptExampleNode() {
  if (!flow.nodeTypes?.value?.["remote-textNode"]) throw new Error("请先启用文本节点插件");
  if (flow.findNode(node.id) !== node) throw new Error("脚本节点已切换");
  let sourceNode = savedData.scriptExampleNodeId ? flow.findNode(savedData.scriptExampleNodeId) : undefined;
  const createdId = sourceNode ? undefined : crypto.randomUUID();
  const sourceId = sourceNode?.id ?? createdId!;
  const targetNode = flow.findNode(node.id);
  if (!targetNode) throw new Error("脚本节点已不存在");
  const edge = { id: crypto.randomUUID(), source: sourceId, sourceHandle: "text", target: node.id, targetHandle: "in" };
  const x = node.computedPosition.x - 440;
  let y = node.computedPosition.y;
  for (const other of [...flow.getNodes.value].sort((left, right) => left.computedPosition.y - right.computedPosition.y)) {
    if (other.id !== sourceId && other.computedPosition.x < x + 360 && other.computedPosition.x + (other.dimensions.width || 320) > x
      && other.computedPosition.y < y + 320 && other.computedPosition.y + (other.dimensions.height || 300) > y) y = other.computedPosition.y + (other.dimensions.height || 300) + 40;
  }
  const textNode = sourceNode ?? { id: sourceId, type: "remote-textNode", position: { x, y }, data: { label: "《社畜登基记》剧本案例", outputs: { text: { dataType: "STRING", value: scriptExample } } } };
  await batchHistory(async () => {
    if (flow.findNode(node.id) !== node || !flow.nodeTypes?.value?.["remote-textNode"]) throw new Error("画布节点已变化，请重新选择创作方式");
    if (createdId) flow.addNodes(textNode);
    await nextTick();
    sourceNode = flow.findNode(sourceId);
    if (!sourceNode || !validateConnection(edge, { sourceNode, targetNode, nodes: flow.getNodes.value, edges: flow.getEdges.value })) {
      if (createdId) flow.removeNodes([sourceId], true, false);
      throw new Error("剧本案例文本节点无法连接，请检查画布状态");
    }
    if (!flow.getEdges.value.some(item => item.source === sourceId && item.sourceHandle === "text" && item.target === node.id && item.targetHandle === "in")) {
      flow.addEdges(edge);
      await nextTick();
      if (!flow.findEdge(edge.id)) {
        flow.removeEdges([edge.id]);
        if (createdId) flow.removeNodes([sourceId], true, false);
        throw new Error("剧本案例文本节点连接失败");
      }
    }
    savedData.scriptExampleNodeId = sourceId;
  });
}
const editorOpen = ref(false);
const busy = ref(false);
const generating = ref(false);
const error = ref("");
const progress = ref("");
const reports = ref<MediaReport[]>([]);
const textModels = shallowRef<NodeAiModel[]>([]);
const mediaModels = shallowRef<NodeMediaModel[]>([]);
const modelsLoading = ref(false);
const imageModels = computed(() => mediaModels.value.filter(model => model.type === "image"));
const videoModels = computed(() => mediaModels.value.filter(model => model.type === "video"));
const totalDuration = computed(() => loadError ? 0 : Math.round(document.value.shots.reduce((sum, shot) => sum + (shot.duration || 0), 0) * 10) / 10);
type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;
const promptModel = ref<PromptModel>([]);
watch(() => loadError ? "" : document.value.input, value => {
  // 提示词输入框本身没有长度限制；超限内容一旦自动保存，下次打开会因校验失败而整个节点不可用，所以在这里截断。
  if (value.length > inputLimit) {
    document.value.input = value.slice(0, inputLimit);
    return void ElMessage.warning("剧本或创作要求最多 " + inputLimit + " 字，超出部分已截断；长篇内容建议放入文本节点后连接到本节点");
  }
  if (getPromptText(promptModel.value) !== value) promptModel.value = value.split("\n").map(text => [{ type: "Write", text }]);
}, { immediate: true });
const downloadUrl = ref("");
watch(() => loadError ? "" : formatScript(document.value), (value, _previous, onCleanup) => {
  if (loadError) return;
  outputs.value.script.value = value;
  downloadUrl.value = value ? URL.createObjectURL(new Blob([value], { type: "text/markdown;charset=utf-8" })) : "";
  const url = downloadUrl.value;
  onCleanup(() => { if (url) URL.revokeObjectURL(url); });
}, { immediate: true });
let controller: AbortController | undefined;
let modelsRequest: Promise<void> | undefined;
let disposed = false;
onMounted(() => { void loadModels(); });
onScopeDispose(() => { disposed = true; controller?.abort(); });
nodeEvent.on("save", reason => {
  if (loadError) return;
  if (reason === "reload" && busy.value) throw new Error("脚本正在处理，请先停止或等待完成后刷新");
  const checked = scriptSchema.safeParse(document.value);
  if (!checked.success) throw new Error("脚本含有无效字段，请修正后保存：" + scriptIssueText(checked.error));
});
nodeEvent.on("delete", () => { if (busy.value) throw new Error("脚本正在处理，请先停止后再移除节点"); });

function loadModels() {
  if (modelsRequest || disposed || loadError) return modelsRequest;
  modelsLoading.value = true;
  modelsRequest = Promise.all([ai.getModels(), ai.getMediaModels()]).then(([text, media]) => {
    if (disposed) return;
    textModels.value = text; mediaModels.value = media;
    if (!document.value.model && text[0]) document.value.model = getNodeModelKey(text[0]);
    for (const kind of ["image", "video"] as const) {
      const key = kind === "image" ? "imageModel" : "videoModel";
      const choices = media.filter(model => model.type === kind);
      const choice = readLastNodeModel(kind, choices) ?? choices[0];
      if (!document.value[key] && choice) document.value[key] = getNodeModelKey(choice);
    }
  }).catch(cause => { if (!disposed) error.value = cause instanceof Error ? cause.message : "模型列表读取失败"; }).finally(() => { modelsLoading.value = false; modelsRequest = undefined; });
  return modelsRequest;
}
function openEditor(step?: number) { if (loadError) return; if (!busy.value && step !== undefined) document.value.step = step; editorOpen.value = true; }
async function addReference() {
  try { await selectAssetReference(); }
  catch (cause) { ElMessage.warning(cause instanceof Error ? cause.message : "选择参考图失败"); }
}
function cancel() { controller?.abort(); progress.value = "已停止后续处理，已启动的媒体任务请到对应节点查看或取消"; }
function focusMedia(id?: string) { try { media.focus(id); editorOpen.value = false; } catch (cause) { ElMessage.warning(cause instanceof Error ? cause.message : "节点已不存在"); } }
async function selectAssetImage() {
  const mention = await selectAssetReference();
  if (!mention) return;
  const source = refList.value.find(item => encodeURIComponent(JSON.stringify([item.source, item.sourceHandle])) === mention.id);
  return source ? { source: source.source, sourceHandle: source.sourceHandle, label: mention.label ?? "参考图片" } : undefined;
}
function saveAsset(id: string) {
  const asset = document.value.assets.find(item => item.id === id);
  if (!asset) return;
  try { media.saveAsset(asset); } catch (cause) { ElMessage.warning(cause instanceof Error ? cause.message : "保存个人资产失败"); }
}
async function generateScript() {
  if (busy.value || loadError) return;
  if (document.value.mode === "manual") return openEditor(0);
  busy.value = true; error.value = ""; controller = new AbortController();
  const signal = controller.signal;
  try {
    const checked = scriptSchema.safeParse(document.value);
    if (!checked.success) throw new Error("脚本内容有误，请修正后再生成：" + scriptIssueText(checked.error));
    const input = checked.data;
    const model = findNodeModel(textModels.value, input.model);
    if (!model) throw new Error("请先选择有效的语言模型");
    if (!input.input.trim() && !refList.value.length) throw new Error("请输入剧本或创作要求，或连接文本、图片参考");
    if (input.mode === "character" && !refList.value.some(item => item.dataType === "IMAGE" && item.value)) throw new Error("角色创作模式需要至少一张连接的角色参考图");
    const empty = refList.value.flatMap((item, index) => item.value === undefined ? ["参考 " + (index + 1)] : []);
    if (empty.length) throw new Error(empty.slice(0, 3).join("、") + (empty.length > 3 ? " 等 " + empty.length + " 项" : "") + "还没有内容，请先完成这些参考素材，或移除对应连线");
    // 服务端单次请求最多接收 32 项参考；资产图生成后会连回本节点，数量多时提前说明原因。
    if (refList.value.length > 32) throw new Error("当前连接了 " + refList.value.length + " 项参考，单次拆解最多支持 32 项，请先移除不需要的参考连线");
    if (input.shots.length || input.assets.length) {
      const confirmed = await ElMessageBox.confirm("重新拆解成功后将替换当前分镜和资产记录，已创建的素材节点会保留。是否继续？", "重新拆解脚本", { confirmButtonText: "重新拆解", cancelButtonText: "取消" }).then(() => true, () => false);
      if (!confirmed) return;
    }
    signal.throwIfAborted();
    const sources = refList.value.filter(item => item.value !== undefined && (item.dataType === "STRING" || item.dataType === "IMAGE"));
    const references = sources.map(item => ({ dataType: item.dataType, value: typeof item.value === "string" ? item.value : { ...item.value } })) as Extract<NodeOutput, { dataType: "STRING" | "IMAGE" }>[];
    const bindings = sources.map(item => item.dataType === "IMAGE" ? { source: item.source, sourceHandle: item.sourceHandle, label: "" } : undefined);
    const directory = references.some(item => item.dataType === "IMAGE") ? (await files.getWorkspaceFiles().list()).directory : undefined;
    signal.throwIfAborted();
    progress.value = "正在拆解剧本、提取资产与编写分镜";
    editorOpen.value = true; document.value.rawResponse = ""; generating.value = true;
    const result = await ai.generate({ ...getNodeModelIdentity(model), systemPrompt: scriptSystemPrompt, prompt: buildScriptPrompt(input), references, directory, signal,
      onEvent(event) {
        if (disposed || signal.aborted) return;
        if (event.type === "reasoning" && !document.value.rawResponse) progress.value = "模型正在思考，尚未开始输出分镜";
        if (event.type !== "text") return;
        document.value.rawResponse = (document.value.rawResponse + event.delta).slice(0, 200000);
        progress.value = "正在编写分镜，已收到 " + document.value.rawResponse.length + " 字";
      },
    });
    signal.throwIfAborted();
    document.value.rawResponse = result.text.slice(0, 200000);
    const { warnings, ...generated } = readGeneratedScript(result.text, bindings);
    const applied = scriptSchema.safeParse({ ...input, ...generated, title: generated.title || input.title, step: 0, rawResponse: "" });
    if (!applied.success) throw new Error("模型分镜未通过校验，原分镜已保留：" + scriptIssueText(applied.error));
    document.value = applied.data;
    reports.value = []; progress.value = "分镜脚本已生成";
    if (warnings.length) ElMessage.warning({ message: "分镜已生成，以下内容已自动修正：" + warnings.join("；"), duration: 10000, showClose: true });
  } catch (cause) { if (!signal.aborted && !disposed) error.value = cause instanceof Error ? cause.message : "分镜生成失败，原结果已保留"; }
  finally { if (!disposed) { busy.value = false; generating.value = false; } controller = undefined; }
}
async function compose(ids: string[]) {
  if (busy.value || loadError) return;
  const shots = document.value.shots.filter(shot => ids.includes(shot.id));
  if (!shots.length || shots.some(shot => !shot.description.trim())) return void ElMessage.warning("请先补全分镜画面描述");
  busy.value = true;
  try {
    // 只有手动改过的提示词才需要确认覆盖；未改动或尚未合成的镜头直接更新。
    if (shots.some(promptEdited)) {
      const confirmed = await ElMessageBox.confirm("重新合成会覆盖所选镜头中手动编辑的图片和视频提示词，是否继续？", "重新合成提示词", { confirmButtonText: "重新合成", cancelButtonText: "取消" }).then(() => true, () => false);
      if (!confirmed || disposed) return;
    }
    const composed = shots.map(shot => ({ shot, prompts: composeShot(shot, document.value.assets, document.value.style), source: shotSource(shot, document.value.assets, document.value.style) }));
    if (composed.some(item => item.prompts.imagePrompt.length > 14000 || item.prompts.videoPrompt.length > 16000 || item.source.length > 200000)) throw new Error("分镜关联描述过长，请精简该镜头或资产描述后再合成；原提示词已保留");
    composed.forEach(({ shot, prompts, source }) => { Object.assign(shot, prompts); shot.promptSource = source; });
    error.value = "";
  } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : "提示词合成失败"; }
  finally { if (!disposed) busy.value = false; }
}
async function createMedia(kind: MediaKind, ids: string[], assetsOnly: boolean, start: boolean, config?: { model: string; size: string; ratio: string; other: Record<string, unknown>; prompt: string }) {
  if (busy.value || loadError) return;
  busy.value = true; error.value = ""; controller = new AbortController();
  const signal = controller.signal;
  try {
    const checked = scriptSchema.safeParse(document.value);
    if (!checked.success) throw new Error("脚本内容有误，请修正后再创建节点：" + scriptIssueText(checked.error));
    if (!assetsOnly && document.value.shots.some(shot => ids.includes(shot.id) && shot.promptSource !== shotSource(shot, document.value.assets, document.value.style))) throw new Error("所选分镜或资产已有修改，请先重新合成提示词");
    if (start) {
      const confirmed = await ElMessageBox.confirm("将为 " + ids.length + " 项启动" + (kind === "image" ? "图片" : "视频") + "生成，由所选供应商计费。已有结果或任务不会重复提交，是否继续？", "启动生成", { confirmButtonText: "启动生成", cancelButtonText: "取消", type: "warning" }).then(() => true, () => false);
      if (!confirmed) return;
    }
    signal.throwIfAborted();
    const model = findNodeModel(mediaModels.value, kind === "image" ? config?.model ?? document.value.imageModel : document.value.videoModel);
    progress.value = start ? "正在创建并依次启动生成节点" : "正在创建生成节点"; reports.value = [];
    await media.create(document.value, kind, ids, assetsOnly, model, start, signal, report => { if (!disposed) reports.value.push(report); }, config ? { size: config.size, ratio: config.ratio, other: config.other, prompt: config.prompt } : {});
    if (!disposed) progress.value = signal.aborted ? "后续启动已停止，已启动任务仍保留" : "节点操作完成；实际生成进度请在关联节点查看";
  } catch (cause) { if (!signal.aborted && !disposed) error.value = cause instanceof Error ? cause.message : "生成节点创建失败"; }
  finally { if (!disposed) busy.value = false; controller = undefined; }
}
</script>
<style scoped lang="scss">
.summaryContent {
  display: flex; flex-direction: column; align-items: stretch; justify-content: center; min-height: 290px; padding: 24px 20px; text-align: left;
  .nodeSkeleton.resized & { min-height: 0; height: 100%; overflow: auto; }
  .scriptMark { display: grid; place-items: center; width: 100%; height: 80px; margin-bottom: 18px; color: var(--el-text-color-secondary); opacity: .45; }
  .creationModes { display: flex; flex-direction: column; gap: 14px;
    > span { margin-bottom: 2px; color: var(--el-text-color-secondary); font-size: 13px; }
    button { display: flex; align-items: center; gap: 10px; min-height: 26px; padding: 2px 8px; border: 0; border-radius: 4px; color: var(--el-text-color-primary); background: transparent; font-size: 14px; text-align: left; cursor: pointer;
      &:hover, &.current { color: var(--el-color-primary); background: var(--el-fill-color-light); }
      &:disabled { cursor: not-allowed; opacity: .6; }
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
    }
  }
  .documentSummary { margin: 18px 0 0; color: var(--el-text-color-secondary); font-size: 12px; }
  .progressLabel { margin-top: 12px; font-size: 12px; color: var(--el-text-color-secondary); }
}
.promptCard {
  .promptTopline { display: flex; align-items: center; min-height: 26px; gap: 8px; }
  .referenceCount, .billingHint { color: var(--el-text-color-secondary); font-size: 12px; }
  .referenceList { margin: 8px 0; }
  .promptArea { min-height: 100px; margin-top: 8px; }
  .manualPromptHint { display: flex; align-items: center; min-height: 100px; color: var(--el-text-color-placeholder); font-size: 14px; }
  .promptFooter { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; }
  .promptActions { display: flex; align-items: center; gap: 10px; }
  .manualModeLabel { color: var(--el-text-color-secondary); font-size: 13px; }
  .sendButton { width: 40px; height: 40px; }
  .errorMessage { color: var(--el-color-danger); font-size: 12px; line-height: 1.6; }
  :deep(.promptInputWrap) { margin: 0; }
  :deep(.promptInput) { min-height: 100px; }
}
</style>
