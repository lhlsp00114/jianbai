<template>
  <main class="workspacePage" :inert="workspaceStore.projectLoadingVisible" :style="{ '--agentWidth': `${agentVisible ? agentWidth : 0}px` }">
    <canvasPanel
      :key="workspaceStore.project?.directory"
      v-model:selectedTool="selectedTool"
      v-model:agentVisible="agentVisible"
      ref="canvasPanelRef"
      class="canvasPanel"
      :class="{ backgroundPanel: activePanel !== 'canvas' }"
      :inert="activePanel !== 'canvas'"
      :aria-hidden="activePanel !== 'canvas'"
      :active="activePanel === 'canvas'"
      :createDefaultCanvas="createDefaultCanvas"
      :menuTarget="projectMenuTarget"
      :settingsVisible="settingsVisible" />
    <keep-alive :key="workspaceStore.project?.directory" :max="1">
      <documentPanel
        v-if="activePanel === 'document'"
        :key="workspaceStore.project?.directory"
        :ref="setDocumentPanel"
        :readNode="readDocumentNode"
        :readNodes="readDocumentNodes"
        :focusNode="focusDocumentNode"
        :mountNode="mountDocumentNode"
        :resolveNodeFile="resolveDocumentNodeFile"
        :observeNode="observeDocumentNode"
        :flushNodes="flushDocumentNodes"
        :fileAction="performFileAction"
        :saveNode="saveDocumentNode" />
    </keep-alive>
    <workspaceMenu class="workspaceMenu" @openSettings="settingsVisible = true" />
    <div ref="projectMenuTarget" class="projectMenuTarget" />
    <div class="workspaceTools">
      <workspacePanelSwitcher class="panelSwitcher" :activePanel="activePanel" :showComic="isComicProject" @change="switchPanel" />
      <div class="bottomTools">
        <el-card v-if="activePanel === 'canvas'" class="toolMenu" shadow="never" :bodyStyle="{ padding: '2px 4px' }">
          <div class="toolMenuContent" role="toolbar" aria-label="画布工具">
            <el-tooltip :content="selectedTool === 'move' ? '移动工具，点击切换为抓手' : '抓手工具，点击切换为移动'" placement="top" :showArrow="false" :hideAfter="0" :enterable="false" :triggerKeys="[]">
              <el-button
                class="toolButton"
                text
                :type="selectedTool === 'hand' ? 'primary' : 'default'"
                :aria-pressed="selectedTool === 'hand'"
                aria-label="切换抓手/移动工具"
                @click="selectedTool = selectedTool === 'move' ? 'hand' : 'move'">
                <component :is="selectedTool === 'move' ? IconPointer : IconHandStop" :size="18" aria-hidden="true" />
              </el-button>
            </el-tooltip>
            <el-tooltip content="搜索节点" placement="top" :showArrow="false" :hideAfter="0" :enterable="false" :triggerKeys="[]">
              <el-button class="toolButton" text :disabled="!canvasPanelRef?.canvasReady || settingsVisible" aria-label="搜索节点" @click="canvasPanelRef?.openNodeSearch()">
                <icon-search :size="18" aria-hidden="true" />
              </el-button>
            </el-tooltip>
            <el-tooltip :content="appearanceLabel" placement="top" :showArrow="false" :hideAfter="0" :enterable="false" :triggerKeys="[]">
              <el-button class="toolButton" text :aria-label="appearanceLabel" @click="updateUiSettings({ theme: appearanceDark ? 'light' : 'dark' })">
                <component :is="appearanceDark ? IconMoon : IconSun" :size="18" aria-hidden="true" />
              </el-button>
            </el-tooltip>
            <el-tooltip :content="['撤销', shortcutLabel(generalSettings.canvasShortcuts.undo)].filter(Boolean).join(' · ')" placement="top" :showArrow="false" :hideAfter="0" :enterable="false" :triggerKeys="[]">
              <el-button class="toolButton" text data-canvas-history :disabled="!canvasPanelRef?.canvasReady || (!textHistory && !canvasPanelRef?.canUndo) || historyBusy || settingsVisible" aria-label="撤销" @mousedown.prevent @click="changeHistory('undo')">
                <icon-arrow-back-up :size="18" aria-hidden="true" />
              </el-button>
            </el-tooltip>
            <el-tooltip :content="['重做', shortcutLabel(generalSettings.canvasShortcuts.redo)].filter(Boolean).join(' · ')" placement="top" :showArrow="false" :hideAfter="0" :enterable="false" :triggerKeys="[]">
              <el-button class="toolButton" text data-canvas-history :disabled="!canvasPanelRef?.canvasReady || (!textHistory && !canvasPanelRef?.canRedo) || historyBusy || settingsVisible" aria-label="重做" @mousedown.prevent @click="changeHistory('redo')">
                <icon-arrow-forward-up :size="18" aria-hidden="true" />
              </el-button>
            </el-tooltip>
            <el-tooltip :showArrow="false" content="帮助" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]" :disabled="helpVisible">
              <span class="toolTrigger">
                <el-popover v-model:visible="helpVisible" trigger="click" placement="top-end" :width="196">
                  <template #reference>
                    <el-button class="toolButton" text aria-label="帮助">
                      <icon-help :size="18" />
                    </el-button>
                  </template>
                  <div class="helpMenu">
                    <el-button class="helpAction" text :icon="IconKeyboard" @click="showShortcuts">快捷键</el-button>
                    <el-button
                      class="helpAction"
                      tag="a"
                      text
                      :icon="IconBook"
                      href="https://qcn7xdsqgc4z.feishu.cn/docx/RXFqdgR2Xo0dXZxGfd0cZCGgnwf"
                      target="_blank"
                      rel="noopener noreferrer"
                      @click="helpVisible = false">
                      使用教程
                    </el-button>
                    <el-button
                      class="helpAction"
                      tag="a"
                      text
                      :icon="IconBug"
                      href="https://docs.qq.com/smartsheet/form/EmvmQBrmlPmr%2Fss_vsqk2v%2FvhiGzE?tab=ss_vsqk2v"
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Toonflow 需求/BUG反馈表"
                      @click="helpVisible = false">
                      汇报 BUG
                    </el-button>
                    <el-button class="helpAction" text :icon="IconBrandWechat" @click="showContact('community')">加入交流群</el-button>
                    <el-button class="helpAction" text :icon="IconBriefcase" @click="showContact('business')">商务合作</el-button>
                  </div>
                </el-popover>
              </span>
            </el-tooltip>
          </div>
        </el-card>
      </div>
      <el-tooltip v-if="!agentVisible" content="见白 Agent" placement="top" :showArrow="false" :hideAfter="0">
        <agentOrbButton class="agentButton" :aria-expanded="agentVisible" aria-controls="agentPanel" @click="agentVisible = true" />
      </el-tooltip>
    </div>
    <floatingAgent ref="floatingAgentRef" v-model="agentVisible" :inert="workspaceStore.projectLoadingVisible" @resize="agentWidth = $event" />
    <settings ref="settingsDialog" v-model="settingsVisible" />
    <el-dialog v-model="contactVisible" :title="contactInfo.title" width="min(360px, calc(100vw - 32px))" alignCenter appendToBody>
      <div class="contactContent">
        <q-r-code
          :value="contactInfo.url"
          :size="192"
          type="svg"
          color="#000000"
          bgColor="#ffffff"
          borderless
          role="img"
          :aria-label="`${contactInfo.title}二维码`" />
        <p class="contactTip">{{ contactInfo.tip }}</p>
      </div>
    </el-dialog>
  </main>
</template>

<script setup lang="ts">
import { translate } from "@toonflow/i18n/vue";
import { computed, defineAsyncComponent, nextTick, onMounted, onScopeDispose, provide, ref, shallowRef, watch, type ComponentPublicInstance } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import axios from "axios";
import { IconPointer, IconHandStop, IconSearch, IconHelp, IconBook, IconBug, IconBrandWechat, IconBriefcase, IconSun, IconMoon, IconArrowBackUp, IconArrowForwardUp, IconKeyboard } from "@tabler/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { QRCode } from "tdesign-vue-next";
import type { AgentMention } from "@toonflow/server/agent/types";
import settings from "@/components/settings/index.vue";
import modelLoginGuide from "@/components/modelLoginGuide.vue";
import { multiTenantEnabled, toonflowAccountToken } from "@/stores/settings";
import { useWorkspaceStore } from "@/stores/workspace";
import { generalSettings, updateUiSettings } from "@/stores/settings";
import { shortcutLabel, canvasShortcutFields } from "@/lib/canvasShortcuts";
import { appearanceDark } from "@/lib/appearance";
import type { CanvasTextHistory } from "@toonflow/node-shared/canvasTextHistory";
import { registerWorkspaceControl, waitForControlValue } from "@/lib/mcpControl";
import anonymousData from "@/lib/anonymousData";
import { useProviderBalances } from "@/lib/providerBilling";
import canvasPanel from "./panels/canvas/canvasHost.vue";
import type { DocumentNodeOptions } from "./panels/canvas/canvasFiles";
import workspaceMenu from "./components/workspaceMenu.vue";
import workspacePanelSwitcher from "./components/workspacePanelSwitcher.vue";
import floatingAgent from "./components/floatingAgent.vue";
import agentOrbButton from "./components/agentOrbButton.vue";

const documentPanel = defineAsyncComponent(() => import("./panels/document/index.vue"));
const route = useRoute();
const router = useRouter();
const workspaceStore = useWorkspaceStore();
const isComicProject = computed(() => workspaceStore.project?.projectKind === "infiniteComic");
const activePanel = ref<"canvas" | "document">(isComicProject.value && route.query.panel === "document" ? "document" : "canvas");
const createDefaultCanvas = ref(activePanel.value === "canvas");
const selectedTool = ref<"move" | "hand">("move");
const appearanceLabel = computed(() => appearanceDark.value ? "深色模式，点击切换为浅色模式" : "浅色模式，点击切换为深色模式");
const textHistory = shallowRef<CanvasTextHistory>();
const historyBusy = ref(false);
provide("canvasTextHistory", textHistory);

function clearTextHistory(event: Event) {
  if (!(event.target instanceof Element) || event.target.closest("[data-canvas-history]")) return;
  if (!textHistory.value?.element.contains(event.target)) textHistory.value = undefined;
}

async function changeHistory(direction: "undo" | "redo") {
  if (historyBusy.value || settingsVisible.value || activePanel.value !== "canvas") return;
  const editing = textHistory.value;
  // 编辑器内部没有更多历史时也不回退到画布撤销，避免误移动或移除节点。
  if (editing && (!editing.element.isConnected || !editing.element.getClientRects().length)) {
    textHistory.value = undefined;
    return;
  }
  historyBusy.value = true;
  try {
    if (editing) await editing.change(direction);
    else await canvasPanelRef.value?.changeHistory(direction);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "恢复编辑内容失败");
  } finally { historyBusy.value = false; }
}
const sideButtonEvents = ["mousedown", "mouseup", "auxclick"] as const;
// 鼠标侧键会直接触发原生历史导航，需在 DOM 事件阶段拦截，避免生成中的工作区被误关闭。
function preventSideButtonNavigation(event: MouseEvent) {
  if (event.button === 3 || event.button === 4) event.preventDefault();
}
onMounted(() => {
  anonymousData.track(activePanel.value === "canvas" ? "workspace.canvas" : "workspace.document");
  void openInitialWorkspaceTool();
  document.addEventListener("pointerdown", clearTextHistory, true);
  document.addEventListener("focusin", clearTextHistory, true);
  for (const eventName of sideButtonEvents) window.addEventListener(eventName, preventSideButtonNavigation, true);
});
onScopeDispose(() => {
  document.removeEventListener("pointerdown", clearTextHistory, true);
  document.removeEventListener("focusin", clearTextHistory, true);
  for (const eventName of sideButtonEvents) window.removeEventListener(eventName, preventSideButtonNavigation, true);
});
useProviderBalances();
const agentVisible = ref(false);
const agentWidth = ref(0);
const settingsVisible = ref(false);
const settingsDialog = ref<InstanceType<typeof settings>>();
provide("openSettingsPanel", (id: string) => settingsDialog.value?.openPanel(id));
provide("modelLoginGuide", computed(() => !multiTenantEnabled.value && !toonflowAccountToken.value ? modelLoginGuide : undefined));
const helpVisible = ref(false);
const shortcutsVisible = ref(false);
const contactVisible = ref(false);
const contactType = ref<"community" | "business">("community");
const contacts = {
  community: {
    title: "加入交流群",
    url: "https://work.weixin.qq.com/u/vc66e4c7f8432af0d8?v=5.0.13.84802&bb=c03c3ad130",
    tip: "Toonflow 是为爱发电的开源项目。欢迎文明交流、友善反馈；回复可能需要一些时间，请避免责问或命令式沟通，感谢你的理解与尊重。",
  },
  business: {
    title: "商务合作",
    url: "https://work.weixin.qq.com/u/vc66e4c7f8432af0d8?v=5.0.13.84802&bb=c03c3ad130",
    tip: "此联系方式仅用于商务合作接洽，不提供问题答疑。使用问题欢迎在交流群交流，需求与 BUG 可通过反馈表提交。感谢理解。",
  },
};
const contactInfo = computed(() => contacts[contactType.value]);

function showShortcuts() {
  helpVisible.value = false;
  shortcutsVisible.value = true;
}

function showContact(type: "community" | "business") {
  contactType.value = type;
  helpVisible.value = false;
  contactVisible.value = true;
}
const canvasPanelRef = ref<InstanceType<typeof canvasPanel>>();
const projectMenuTarget = ref<HTMLElement>();
const floatingAgentRef = ref<InstanceType<typeof floatingAgent>>();
watch([activePanel, () => workspaceStore.project?.directory, () => canvasPanelRef.value?.canvasId], () => {
  textHistory.value = undefined;
}, { flush: "sync" });
watch(() => canvasPanelRef.value?.canvasListReady, ready => {
  workspaceStore.projectLoading = !ready;
}, { immediate: true });
onScopeDispose(() => { workspaceStore.projectLoading = false; });
const documentPanelCache = shallowRef<{ directory: string; instance: InstanceType<typeof documentPanel> }>();
const documentPanelRef = computed(() => documentPanelCache.value?.directory === workspaceStore.project?.directory ? documentPanelCache.value?.instance : undefined);
watch(() => workspaceStore.project?.directory, () => {
  documentPanelCache.value?.instance.cancelSave();
  documentPanelCache.value = undefined;
}, { flush: "sync" });
function setDocumentPanel(value: Element | ComponentPublicInstance | null) {
  const directory = workspaceStore.project?.directory;
  // KeepAlive 失活会清空模板 ref，保留同一工作区实例以协调后台文档保存和文件操作。
  if (value && directory) documentPanelCache.value = { directory, instance: value as InstanceType<typeof documentPanel> };
}
provide("canvas", () => canvasPanelRef.value?.getCanvasContext());
provide("mentionCanvas", () => canvasPanelRef.value?.mentionSource);
provide("sendNodeToAgent", async (nodeId: string, outputIds: string[], prompt?: string) => {
  const source = canvasPanelRef.value?.mentionSource;
  const canvasId = source?.currentCanvasId();
  if (!source || !canvasId) throw new Error("请先打开画布");
  const mentions = (await Promise.all(outputIds.map(outputId => source.selectCanvas(canvasId, nodeId, outputId))))
    .filter((mention): mention is AgentMention => !!mention);
  if (!mentions.length) throw new Error("此节点没有可发送的输出");
  agentVisible.value = true;
  if (!floatingAgentRef.value) throw new Error("Agent 面板尚未准备好，请重试");
  await floatingAgentRef.value.insertMentions(mentions, prompt);
});
provide("activateCanvasPanel", () => switchPanel("canvas"));
provide("performWorkspaceFileAction", (directory: string, action: "copy" | "rename" | "move" | "delete", path: string, target?: string, entryType: "canvas" | "directory" = "canvas") =>
  documentPanelRef.value ? documentPanelRef.value.performFileAction(directory, action, path, target, entryType) : performFileAction(directory, action, path, target));

const controlLifetime = new AbortController();
onScopeDispose(() => {
  controlLifetime.abort(new Error("工作区已关闭"));
  // 离开守卫已完成保存，先释放文档观察者，避免画布卸载被当成节点删除。
  documentPanelRef.value?.cancelSave();
});
registerWorkspaceControl({
  getState: () => ({
    directory: workspaceStore.project?.directory ?? null,
    canvasId: canvasPanelRef.value?.canvasId || null,
    panel: activePanel.value,
    tools: canvasPanelRef.value?.canvasReady ? canvasPanelRef.value.getCanvasContext()?.tools ?? [] : [],
    document: documentPanelRef.value?.getDocument(false),
  }),
  flushSave,
  async call(request, signal) {
    const directory = workspaceStore.project?.directory;
    if (!directory) throw new Error("请先打开工作区");
    const callSignal = AbortSignal.any([signal, controlLifetime.signal]);
    const checkDirectory = () => {
      callSignal.throwIfAborted();
      if (directory !== workspaceStore.project?.directory) throw new Error("工作区已切换，本次调用已停止");
    };
    checkDirectory();
    if (request.name === "switchPanel") {
      if (request.args.panel !== "canvas" && request.args.panel !== "document") throw new Error("未知面板");
      if (!(await switchPanel(request.args.panel))) throw new Error("面板切换失败，请检查文档是否保存成功");
      if (request.args.panel === "document") await waitForControlValue(() => documentPanelRef.value?.ready ? documentPanelRef.value : undefined, callSignal);
      checkDirectory();
      return { panel: activePanel.value };
    }
    if (["getDocument", "openDocument", "writeDocument"].includes(request.name)) {
      if (!(await switchPanel("document"))) throw new Error("文档面板无法打开");
      const panel = await waitForControlValue(() => documentPanelRef.value?.ready ? documentPanelRef.value : undefined, callSignal);
      checkDirectory();
      if (request.name === "openDocument") await panel.openDocument(request.args, callSignal);
      if (request.name === "writeDocument") await panel.writeDocument(request.args, callSignal);
      checkDirectory();
      return panel.getDocument();
    }
    if (!(await switchPanel("canvas"))) throw new Error("画布面板无法打开");
    const context = await waitForControlValue(
      () => (canvasPanelRef.value?.canvasReady || (!canvasPanelRef.value?.canvasId && canvasPanelRef.value?.canvasListReady) ? canvasPanelRef.value.getCanvasContext() : undefined),
      callSignal
    );
    checkDirectory();
    return context.call({ name: request.name, args: request.args }, callSignal);
  },
});

async function flushSave() {
  await documentPanelRef.value?.flushSave();
  await canvasPanelRef.value?.flushSave();
}

onBeforeRouteLeave(async () => {
  if (canvasPanelRef.value?.saveBusy) {
    ElMessage.warning("画布操作尚未完成，请稍后退出");
    return false;
  }
  try {
    await flushSave();
    return true;
  } catch (error) {
    const message = axios.isAxiosError<{ message?: string }>(error)
      ? error.response?.data?.message || error.message
      : error instanceof Error
      ? error.message
      : translate("项目保存失败");
    const leave = await ElMessageBox.confirm(`无法保存项目：${message}。文件或目录可能已被移动或删除。仍然退出将丢弃尚未保存的修改。`, "项目未保存", {
      type: "warning",
      confirmButtonText: "仍然退出",
      cancelButtonText: "留在项目",
      closeOnClickModal: false,
    }).then(
      () => true,
      () => false
    );
    if (leave) {
      documentPanelRef.value?.cancelSave();
      canvasPanelRef.value?.cancelSave();
    }
    return leave;
  }
});

async function switchPanel(value: string | number | boolean) {
  if (value === "comic" && isComicProject.value) return !await router.push({ path: "/comic", query: { comicFile: route.query.comicFile } });
  if (value !== "canvas" && value !== "document") return false;
  try {
    if (activePanel.value === "document") await documentPanelRef.value?.flushSave();
    const changed = activePanel.value !== value;
    if (value === "canvas" && !canvasPanelRef.value?.canvasId) createDefaultCanvas.value = true;
    activePanel.value = value;
    await nextTick();
    if (changed) anonymousData.track(value === "canvas" ? "workspace.canvas" : "workspace.document");
    return true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "文本保存失败");
    return false;
  }
}

async function openInitialWorkspaceTool() {
  const tool = route.query.tool;
  if (!isComicProject.value || activePanel.value !== "canvas" || (tool !== "nodes" && tool !== "history" && tool !== "upload")) return;
  const upload = workspaceStore.pendingCanvasUpload;
  workspaceStore.pendingCanvasUpload = null;
  if (tool === "upload" && (!upload || upload.directory !== workspaceStore.project?.directory)) return;
  try {
    const signal = AbortSignal.any([controlLifetime.signal, AbortSignal.timeout(30000)]);
    const panel = await waitForControlValue(() => canvasPanelRef.value?.canvasReady ? canvasPanelRef.value : undefined, signal);
    if (activePanel.value !== "canvas") return;
    if (tool === "upload" && upload) await panel.uploadFiles(upload.files);
    else if (tool === "nodes" || tool === "history") panel.toggleWorkspaceTool(tool);
  } catch (error) {
    if (!controlLifetime.signal.aborted) ElMessage.error(error instanceof Error ? error.message : "画布工具尚未就绪");
  }
}

function readDocumentNode(directory: string, canvasPath: string, nodeId: string) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.readDocumentNode(directory, canvasPath, nodeId);
}

function readDocumentNodes(directory: string, options?: DocumentNodeOptions) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.readDocumentNodes(directory, options);
}

async function focusDocumentNode(directory: string, canvasPath: string, nodeId: string) {
  if (!directory || workspaceStore.project?.directory !== directory) throw new Error("工作目录已切换，请重新选择节点");
  if (!await switchPanel("canvas")) throw new Error("画布面板无法打开");
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  await canvasPanelRef.value.focusDocumentNode(directory, canvasPath, nodeId);
}

function mountDocumentNode(directory: string, canvasPath: string, nodeId: string, target: HTMLElement) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.mountDocumentNode(directory, canvasPath, nodeId, target);
}

function resolveDocumentNodeFile(directory: string, path: string) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.resolveDocumentNodeFile(directory, path);
}

function observeDocumentNode(directory: string, canvasPath: string, nodeId: string, onState: (state: { dirty: boolean; error: string; deleted: boolean }) => void) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.observeDocumentNode(directory, canvasPath, nodeId, onState);
}

async function flushDocumentNodes() {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  await canvasPanelRef.value.flushSave();
}

function performFileAction(directory: string, action: "copy" | "rename" | "move" | "delete", path: string, target?: string, nodeId?: string) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.performFileAction(directory, action, path, target, nodeId);
}

function saveDocumentNode(directory: string, canvasPath: string, nodeId: string, handleId: string, text: string, expectedText?: string) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.saveDocumentNode(directory, canvasPath, nodeId, handleId, text, expectedText);
}
</script>

<style scoped lang="scss">
.workspacePage {
  position: relative;
  width: 100%;
  height: 100dvh;
  // 画布的选区端口和工具条可以移出视口，不能把工作区变成浏览器滚动区域。
  overflow: clip;
  background-color: var(--el-bg-color);

  .canvasPanel {
    position: absolute;
    inset: 0;
    width: calc(100% - var(--agentWidth, 0px));
    container: canvasWorkspace / inline-size;

    &.backgroundPanel {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }
  }

  .workspaceMenu {
    position: absolute;
    top: 15px;
    left: 15px;
    z-index: 5;
  }
  .projectMenuTarget { position: absolute; top: 15px; left: 90px; z-index: 6; }

  .workspaceTools {
    position: absolute;
    inset: 0;
    width: 100%;
    pointer-events: none;

    .panelSwitcher {
      position: absolute;
      top: 15px;
      left: 50%;
      z-index: 5;
      transform: translateX(-50%);
      pointer-events: auto;
    }

    .bottomTools {
      position: absolute;
      bottom: 15px;
      left: 50%;
      z-index: 5;
      transform: translateX(-50%);
      pointer-events: auto;

      .toolMenu {
        flex-shrink: 0;
        transition: none;

        .toolMenuContent {
          display: flex;
          align-items: center;
          gap: 2px;

          .toolButton {
            width: 28px;
            height: 28px;
            margin: 0;
            padding: 0;

          }

          .toolTrigger { display: inline-flex; }

          .el-divider { margin: 0; }
        }
      }

    }

    .agentButton {
      position: absolute;
      right: 15px;
      bottom: 13px;
      z-index: 5;
      pointer-events: auto;
    }
  }
}

.helpMenu {
  display: flex;
  flex-direction: column;
  gap: 4px;

  .helpAction {
    justify-content: flex-start;
    margin-left: 0;
  }
}

.shortcutsMenu {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 2px 20px;
  max-height: min(72vh, 480px);
  overflow: auto;
  padding: 2px 0;

  .shortcutItem {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 2px;
    border-bottom: 1px solid var(--el-border-color-lighter);

    &:last-child { border-bottom: 0; }

    .shortcutLabel {
      flex-shrink: 0;
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }

    .shortcutKeys {
      color: var(--el-text-color-primary);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      text-align: right;
    }
  }
}

.contactContent {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;

  .contactTip {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.7;
  }
}
</style>
