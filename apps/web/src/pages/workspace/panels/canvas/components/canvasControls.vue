<template>
  <mini-map
    v-if="showMap"
    class="canvasMiniMap"
    position="bottom-left"
    :pannable="true"
    :zoomable="true"
    nodeColor="var(--el-fill-color-dark)"
    maskColor="var(--el-mask-color-extra-light)"
    @click="({ position }) => setCenter(position.x, position.y, { zoom: viewport.zoom, duration: 250 })" />
  <panel class="canvasControlsPanel" position="bottom-left">
    <el-card class="canvasControlsCard" shadow="never" :bodyStyle="{ padding: '2px 4px' }">
      <div class="canvasControls">
        <el-tooltip :showArrow="false" :content="selectedTool === 'move' ? '移动工具，点击切换为抓手' : '抓手工具，点击切换为移动'" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]">
          <el-button class="toolButton" :class="{ active: selectedTool === 'hand' }" text :aria-pressed="selectedTool === 'hand'" aria-label="切换移动和抓手工具" @click="selectedTool = selectedTool === 'move' ? 'hand' : 'move'">
            <component :is="selectedTool === 'move' ? IconPointer : IconHandStop" :size="18" aria-hidden="true" />
          </el-button>
        </el-tooltip>
        <el-tooltip :showArrow="false" :content="['撤销', workspaceActions?.shortcutLabel('undo')].filter(Boolean).join(' · ')" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]">
          <el-button class="toolButton" text data-canvas-history :disabled="workspaceActions?.undoDisabled() ?? true" aria-label="撤销" @mousedown.prevent @click="workspaceActions?.undo()">
            <icon-arrow-back-up :size="18" aria-hidden="true" />
          </el-button>
        </el-tooltip>
        <el-tooltip :showArrow="false" :content="['重做', workspaceActions?.shortcutLabel('redo')].filter(Boolean).join(' · ')" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]">
          <el-button class="toolButton" text data-canvas-history :disabled="workspaceActions?.redoDisabled() ?? true" aria-label="重做" @mousedown.prevent @click="workspaceActions?.redo()">
            <icon-arrow-forward-up :size="18" aria-hidden="true" />
          </el-button>
        </el-tooltip>
        <!-- trigger 用 contextmenu 是为了让整理按钮只由 arrangeNodes 控制显隐，同时仍保留点击外部自动关闭 -->
        <el-tooltip :showArrow="false" content="整理画布" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]" :disabled="undoPopoverVisible">
          <span class="toolTrigger">
            <el-popover trigger="contextmenu" placement="top-start" :width="180" v-model:visible="undoPopoverVisible">
              <template #reference>
                <el-button class="toolButton" text :disabled="!canArrange" aria-label="整理画布" @click="arrangeNodes">
                  <icon-sitemap :size="18" />
                </el-button>
              </template>
              <div class="zoomMenu">
                <el-button class="zoomAction" style="width: 100%" text @click="undoArrange">撤销整理</el-button>
              </div>
            </el-popover>
          </span>
        </el-tooltip>
        <el-tooltip :showArrow="false" :content="showEdges ? '隐藏连线' : '显示连线'" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]">
          <el-button
            class="toolButton"
            text
            :type="showEdges ? 'primary' : 'default'"
            :aria-pressed="showEdges"
            aria-label="显示或隐藏连线"
            @click="showEdges = !showEdges">
            <icon-arrow-guide :size="18" />
          </el-button>
        </el-tooltip>
        <el-tooltip :showArrow="false"
          content="缩放菜单（滚轮调整缩放）"
          placement="top"
          :hideAfter="0"
          :enterable="false"
          :triggerKeys="[]"
          :disabled="zoomMenuVisible">
          <span class="toolTrigger">
            <el-popover v-model:visible="zoomMenuVisible" trigger="click" placement="top-start" :width="216">
              <template #reference>
                <el-button
                  class="toolButton"
                  text
                  aria-label="缩放菜单"
                  @wheel.stop.prevent="$event.deltaY && applyZoom(Math.min(800, Math.max(20, zoomPercent - Math.sign($event.deltaY))))">
                  {{ zoomPercent }}%
                </el-button>
              </template>
              <div class="zoomMenu">
                <el-input-number
                  class="zoomInput"
                  :model-value="zoomPercent"
                  :min="20"
                  :max="800"
                  :controls="false"
                  aria-label="缩放百分比"
                  @change="applyZoom">
                  <template #suffix>%</template>
                </el-input-number>
                <el-button class="zoomAction" text @click="zoomIn()">放大</el-button>
                <el-button class="zoomAction" text @click="zoomOut()">缩小</el-button>
                <el-button class="zoomAction" text @click="fitView({ duration: 250 })">适应视图</el-button>
                <div class="zoomDivider" role="separator" />
                <el-button class="zoomAction toggleAction" text :aria-pressed="showMap" @click="showMap = !showMap"><span>显示小地图</span><icon-check v-if="showMap" class="toggleCheck" :size="15" aria-hidden="true" /></el-button>
                <el-button class="zoomAction toggleAction" text :aria-pressed="snapEnabled" @click="snapEnabled = !snapEnabled"><span>网格吸附</span><icon-check v-if="snapEnabled" class="toggleCheck" :size="15" aria-hidden="true" /></el-button>
              </div>
            </el-popover>
          </span>
        </el-tooltip>
        <span class="toolbarDivider" role="separator" />
        <el-tooltip :showArrow="false" content="帮助" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]" :disabled="workspaceActions?.helpVisible.value ?? false">
          <span class="toolTrigger">
            <el-popover v-model:visible="helpVisible" trigger="click" placement="top-start" :width="196">
              <template #reference>
                <el-button class="toolButton" text aria-label="帮助"><icon-help :size="18" /></el-button>
              </template>
              <div class="helpMenu">
                <el-button class="helpAction" text :icon="IconKeyboard" @click="workspaceActions?.showShortcuts">快捷键</el-button>
                <el-button class="helpAction" text :icon="appearanceDark ? IconMoon : IconSun" @click="toggleAppearance">{{ appearanceDark ? '切换为浅色模式' : '切换为深色模式' }}</el-button>
                <el-button class="helpAction" tag="a" text :icon="IconBook" href="https://qcn7xdsqgc4z.feishu.cn/docx/RXFqdgR2Xo0dXZxGfd0cZCGgnwf" target="_blank" rel="noopener noreferrer" @click="helpVisible = false">使用教程</el-button>
                <el-button class="helpAction" tag="a" text :icon="IconBug" href="https://docs.qq.com/smartsheet/form/EmvmQBrmlPmr%2Fss_vsqk2v%2FvhiGzE?tab=ss_vsqk2v" target="_blank" rel="noopener noreferrer" title="Toonflow 需求/BUG反馈表" @click="helpVisible = false">汇报 BUG</el-button>
                <el-button class="helpAction" text :icon="IconBrandWechat" @click="workspaceActions?.showContact('community')">加入交流群</el-button>
                <el-button class="helpAction" text :icon="IconBriefcase" @click="workspaceActions?.showContact('business')">商务合作</el-button>
              </div>
            </el-popover>
          </span>
        </el-tooltip>
      </div>
    </el-card>
  </panel>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { Panel, useVueFlow, type XYPosition } from "@vue-flow/core";
import { MiniMap } from "@vue-flow/minimap";
import { IconArrowBackUp, IconArrowForwardUp, IconBook, IconBug, IconBrandWechat, IconBriefcase, IconHandStop, IconHelp, IconKeyboard, IconMoon, IconPointer, IconSun } from "@tabler/icons-vue";
import { ElMessage } from "element-plus";
import { appearanceDark } from "@/lib/appearance";
import { updateUiSettings } from "@/stores/settings";
import { arrangeCanvas } from "../arrangeCanvas";

const props = defineProps<{
  canvasId: string;
  directory: string | undefined;
  batchHistory: (action: () => Promise<void>) => Promise<void>;
}>();
const snapEnabled = defineModel<boolean>("snapEnabled", { required: true });
const showEdges = defineModel<boolean>("showEdges", { required: true });
const selectedTool = defineModel<"move" | "hand">("selectedTool", { required: true });
const workspaceActions = inject<{
  undoDisabled: () => boolean;
  redoDisabled: () => boolean;
  undo: () => void;
  redo: () => void;
  helpVisible: Ref<boolean>;
  showShortcuts: () => void;
  showContact: (type: "community" | "business") => void;
  shortcutLabel: (id: "undo" | "redo") => string;
}>("workspaceBottomActions");
const helpVisible = workspaceActions?.helpVisible ?? ref(false);
function toggleAppearance() {
  updateUiSettings({ theme: appearanceDark.value ? "light" : "dark" });
}
const showMap = ref(false);
const zoomMenuVisible = ref(false);
const flow = useVueFlow();
const { viewport, zoomTo, zoomIn, zoomOut, fitView, setCenter, getNodes, updateNode } = flow;
const zoomPercent = computed(() => Math.round(viewport.value.zoom * 100));
const layoutSnapshot = ref<{ id: string; position: XYPosition }[]>();
const undoPopoverVisible = ref(false);
const arranging = ref(false);
let arrangeController: AbortController | undefined;
const canArrange = computed(() => {
  const nodes = getNodes.value.filter((node) => !node.parentNode);
  return (
    !!props.canvasId &&
    !!props.directory &&
    !arranging.value &&
    nodes.length > 0 &&
    nodes.every((node) => node.dimensions.width > 0 && node.dimensions.height > 0)
  );
});
defineExpose({ arrangeNodes });

watch(
  () => [props.canvasId, props.directory],
  () => {
    arrangeController?.abort();
    layoutSnapshot.value = undefined;
    undoPopoverVisible.value = false;
  },
  { flush: "sync" }
);
onBeforeUnmount(() => arrangeController?.abort());

function applyZoom(value: number | undefined) {
  if (value !== undefined && Number.isFinite(value)) void zoomTo(value / 100);
}

async function arrangeNodes() {
  if (!canArrange.value) return;
  const controller = new AbortController();
  arrangeController = controller;
  arranging.value = true;
  try {
    await props.batchHistory(async () => {
      const { snapshot, arrangedNodeIds } = await arrangeCanvas(flow, controller.signal);
      controller.signal.throwIfAborted();
      if (!arrangedNodeIds.length) return;
      layoutSnapshot.value = snapshot;
      undoPopoverVisible.value = true;
    });
  } catch (error) {
    if (!controller.signal.aborted) ElMessage.error(error instanceof Error ? error.message : "整理画布失败");
  } finally {
    arrangeController = undefined;
    arranging.value = false;
  }
}

async function undoArrange() {
  const snapshot = layoutSnapshot.value;
  if (!snapshot) return;
  try {
    await props.batchHistory(async () => {
      const nodeIds = new Set(getNodes.value.map((node) => node.id));
      snapshot.forEach(({ id, position }) => {
        if (nodeIds.has(id)) updateNode(id, { position });
      });
      layoutSnapshot.value = undefined;
      undoPopoverVisible.value = false;
    });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "撤销整理失败");
  }
}
</script>

<style lang="scss" scoped>
.canvasMiniMap.vue-flow__minimap { bottom: 46px; }

@container canvasWorkspace (max-width: 1040px) {
  .canvasControlsPanel.vue-flow__panel { bottom: 46px; }
  .canvasMiniMap.vue-flow__minimap { bottom: 92px; }
}

.canvasControlsCard {
  height: 34px;
  box-sizing: border-box;
  border: 0;
  background: var(--el-bg-color-overlay);
  box-shadow: 0 6px 20px #0004;
}

.canvasControls {
  display: flex;
  align-items: center;
  gap: 2px;

  .toolTrigger {
    display: inline-flex;
  }

  .toolButton {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    margin-left: 0;
    padding: 0;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .toolbarDivider {
    width: 1px;
    height: 16px;
    margin: 0 3px;
    background: var(--el-border-color-lighter);
  }
}

.zoomMenu {
  display: flex;
  flex-direction: column;

  .zoomInput {
    width: 100%;
  }

  .zoomAction {
    justify-content: flex-start;
    margin-left: 0;

    &.toggleAction { justify-content: space-between; gap: 12px; }
  }

  .zoomDivider { height: 1px; margin: 6px 0; background: var(--el-border-color-lighter); }
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
</style>
