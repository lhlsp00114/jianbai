<template>
  <canvasToolbar
    v-if="visible"
    class="selectionToolbar"
    :style="toolbarStyle"
    @keydown.esc.prevent="colorMenuVisible = false">
      <template v-if="selectedStack">
        <el-button text :icon="IconDeselect" :disabled="busy || disabled" @click="operate('unstack')">取消堆叠</el-button>
        <el-button text :icon="IconSend" :disabled="busy || disabled || !sendNodeToAgent" @click="sendStack">发送到 Agent</el-button>
        <el-button text :icon="IconFolderPlus" :disabled="busy || disabled || !saveNodeToAssets" @click="saveStack">保存到素材库</el-button>
        <el-button text :icon="IconDownload" :disabled="busy || disabled" title="全部下载为 ZIP" @click="downloadStack">全部下载</el-button>
      </template>
      <template v-else>
      <el-button v-if="canGroup" text :icon="IconStack2" :disabled="busy || disabled || !canStack" @click="operate('stack')">堆叠</el-button>
      <el-popover v-if="hasGroup" v-model:visible="colorMenuVisible" trigger="click" placement="bottom-start" :width="274" :showArrow="false" :disabled="busy || disabled">
        <template #reference>
          <el-button text class="colorButton" :disabled="busy || disabled" title="分组背景颜色" aria-label="分组背景颜色">
            <span class="colorPreview" :style="{ background: selectedColors[0]?.value }" />
          </el-button>
        </template>
        <div
          class="groupColors nodrag nopan nowheel"
          role="group"
          aria-label="分组背景颜色"
          @pointerdown.stop
          @mousedown.stop
          @click.stop
          @dblclick.stop
          @keydown.stop
          @keydown.esc.prevent="colorMenuVisible = false">
          <button
            v-for="color in colors"
            :key="color.value"
            type="button"
            class="colorSwatch"
            :style="{ background: color.value }"
            :title="color.label"
            :aria-label="color.label"
            :aria-pressed="selectedColors.every(item => item.value === color.value && item.opacity === 25)"
            :disabled="busy || disabled"
            @click="changeGroupColor(color.value)" />
          <el-color-picker
            class="customColor"
            :modelValue="customColor"
            showAlpha
            colorFormat="hex"
            :clearable="false"
            :teleported="false"
            :disabled="busy || disabled"
            title="自定义颜色和透明度"
            aria-label="自定义分组颜色和透明度"
            @change="changeGroupColor" />
        </div>
      </el-popover>
      <template v-if="canGroup || storyboardGroup">
        <el-button
          v-for="action in layoutActions"
          :key="action.mode"
          text
          :icon="action.icon"
          :disabled="!canArrangeSelection"
          @click="operate(action.mode)">{{ action.label }}</el-button>
      </template>
      <span v-if="canGroup || hasGroup" class="toolbarDivider" aria-hidden="true" />
      <el-button text :icon="IconCopyPlus" :disabled="busy || disabled" @click="operate('duplicate')">创建副本</el-button>
      <el-button v-if="canGroup" text :icon="IconBoxMultiple" :disabled="busy || disabled" @click="operate('group')">打组</el-button>
      <el-button v-if="storyboardGroup" text :icon="IconLayoutGrid" :disabled="busy || disabled || !storyboardMembers" :title="storyboardMembers ? undefined : '仅支持由未连线且已有图片的普通图片节点组成的分组'" @click="operate('storyboard')">转分镜组</el-button>
      <el-button v-if="hasGroup" text :icon="IconDeselect" :disabled="busy || disabled" @click="operate('ungroup')">解组</el-button>
      </template>
  </canvasToolbar>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from "vue";
import { getRectOfNodes, useVueFlow, type GraphNode, type Node, type XYPosition } from "@vue-flow/core";
import { ElButton, ElColorPicker, ElMessage, ElPopover } from "element-plus";
import {
  IconCopyPlus, IconBoxMultiple, IconDeselect,
  IconLayoutGrid, IconLayoutColumns, IconLayoutRows, IconStack2, IconSend, IconFolderPlus, IconDownload,
} from "@tabler/icons-vue";
import { useNodeEvent } from "@toonflow/nodes-scaffold/nodeEvent";
import { createGroupNode, finishGroupDrag, getSelectionRoots, getSelectionTree } from "../selectionNodes";
import { arrangeSelection, getArrangeTargets, type ArrangeSelectionMode } from "../arrangeSelection";
import { remapNodeReferences } from "../canvasFiles";
import { getStackFileNames, getStackImage, getStackMembers, type StackMember } from "../nodeStacks";
import { readStoryboard, storyboardMaxSide, storyboardOption } from "../storyboard";
import type { NodeOutput } from "@toonflow/nodes-scaffold/values";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { useWorkspaceStore } from "@/stores/workspace";
import saveFile from "@/lib/saveFile";
import canvasToolbar from "./canvasToolbar.vue";

const props = defineProps<{
  batchHistory: (action: () => Promise<void>) => Promise<void>;
  getSignal: () => AbortSignal;
  disabled?: boolean;
}>();
const flow = useVueFlow();
const busy = ref(false);
const colorMenuVisible = ref(false);
const colors = [
  { label: "灰色", value: "#808080" },
  { label: "红色", value: "#ef4444" },
  { label: "橙色", value: "#f98b28" },
  { label: "黄色", value: "#f8bd3e" },
  { label: "绿色", value: "#2acb70" },
  { label: "青色", value: "#0db5d0" },
  { label: "蓝色", value: "#3b82f6" },
  { label: "紫色", value: "#8b5cf6" },
  { label: "粉色", value: "#ec399d" },
  { label: "棕色", value: "#b7794e" },
  { label: "白色", value: "#e6e6e6" },
];
const layoutActions = [
  { mode: "horizontal", label: "水平排列", icon: IconLayoutColumns },
  { mode: "vertical", label: "垂直排列", icon: IconLayoutRows },
  { mode: "grid", label: "宫格排列", icon: IconLayoutGrid },
] as const;
const selectionRoots = computed(() => getSelectionRoots(flow.getSelectedNodes.value, flow.getNodes.value));
const canGroup = computed(() => selectionRoots.value.length > 1);
const selectedStack = computed(() => selectionRoots.value.length === 1 && selectionRoots.value[0]?.type === "canvasStack" ? selectionRoots.value[0] : undefined);
const canStack = computed(() => canGroup.value && selectionRoots.value.every(node =>
  node.type !== "canvasGroup" && node.type !== "canvasStack" && node.draggable !== false && !node.hidden
  && node.parentNode === selectionRoots.value[0]?.parentNode && node.dimensions.width > 0 && node.dimensions.height > 0 && getStackImage(node)));
const sendNodeToAgent = inject<((nodeId: string, outputIds: string[]) => Promise<void>) | undefined>("sendNodeToAgent", undefined);
const saveNodeToAssets = inject<((label: string, outputs: { label: string; output: NodeOutput }[], all?: boolean) => void) | undefined>("saveNodeToAssets", undefined);
const workspaceStore = useWorkspaceStore();
const canArrangeSelection = computed(() => {
  if (busy.value || props.disabled) return false;
  const targets = getArrangeTargets(flow.getSelectedNodes.value, flow.getNodes.value);
  return targets.length > 1 && targets.every(node => node.draggable !== false
    && Number.isFinite(node.dimensions.width) && node.dimensions.width > 0
    && Number.isFinite(node.dimensions.height) && node.dimensions.height > 0);
});
const selectedGroups = computed(() => flow.getSelectedNodes.value.filter(node => node.type === "canvasGroup"));
const hasGroup = computed(() => selectedGroups.value.length > 0);
const storyboardGroup = computed(() => {
  const [root] = selectionRoots.value;
  return selectionRoots.value.length === 1 && root?.type === "canvasGroup" ? root : undefined;
});
const storyboardMembers = computed(() => {
  const group = storyboardGroup.value;
  if (!group) return;
  const members = flow.getNodes.value.filter(node => node.parentNode === group.id);
  if (!members.length || members.length > storyboardMaxSide ** 2) return;
  const ids = new Set([group.id, ...members.map(node => node.id)]);
  if (flow.getEdges.value.some(edge => ids.has(edge.source) || ids.has(edge.target))) return;
  if (members.some(node => node.type !== "remote-imageNode" || node.hidden || node.data?.rotationDraft || !getStackImage(node))) return;
  return members;
});
const selectedColors = computed(() => selectedGroups.value.map(node => {
  const style = typeof node.style === "function" ? node.style(node) : node.style;
  return {
    value: style?.["--groupColor"] ?? colors[0]!.value,
    opacity: Number.parseFloat(String(style?.["--groupOpacity"] ?? "25%")),
  };
}));
const customColor = computed(() => {
  const color = selectedColors.value[0];
  return color ? `${color.value}${Math.round(color.opacity / 100 * 255).toString(16).padStart(2, "0")}` : undefined;
});
const visible = computed(() => !props.disabled && !flow.userSelectionActive.value && flow.getSelectedNodes.value.length > 0
  && (flow.nodesSelectionActive.value || hasGroup.value || !!selectedStack.value));
watch(() => visible.value && hasGroup.value, value => {
  if (!value) colorMenuVisible.value = false;
});
const toolbarStyle = computed(() => {
  const bounds = getRectOfNodes(flow.getSelectedNodes.value);
  const { x, y, zoom } = flow.viewport.value;
  const left = x + (bounds.x + bounds.width / 2) * zoom;
  const top = y + (bounds.y - 12 - (hasGroup.value ? 30 : 0)) * zoom;
  // 与节点工具条一样锚定内容，不再因视口边缘或工具条宽度变化偏移。
  return { left: `${left}px`, top: `${top}px`, "--selectionToolbarZoom": zoom };
});

function changeGroupColor(color: string | null) {
  if (busy.value || props.disabled || !color) return;
  const opacity = color.length === 9 ? Math.round(Number.parseInt(color.slice(7), 16) / 255 * 100) : 25;
  for (const node of selectedGroups.value) {
    const style = typeof node.style === "function" ? node.style(node) : node.style;
    flow.updateNode(node.id, { style: { ...style, "--groupColor": color.slice(0, 7), "--groupOpacity": `${opacity}%` } });
  }
  colorMenuVisible.value = false;
}

async function duplicateNodes(selection: GraphNode[], signal: AbortSignal, withEdges = true, positions?: Map<string, XYPosition>) {
  const nodes = getSelectionTree(selection, flow.getNodes.value);
  const roots = getSelectionRoots(nodes, flow.getNodes.value);
  const rootsIds = new Set(roots.map(node => node.id));
  const bounds = getRectOfNodes(nodes);
  const ids = new Map(nodes.map(node => [node.id, crypto.randomUUID()]));
  const snapshot = flow.toObject();
  const savedNodes = new Map(snapshot.nodes.map(node => [node.id, node]));
  const incomingEdges = withEdges ? snapshot.edges.filter(edge => ids.has(edge.target)) : [];
  const copies = await Promise.all(nodes.map(async node => {
    const patch = await useNodeEvent(node.id, flow).emit("copy");
    signal.throwIfAborted();
    const saved = savedNodes.get(node.id)!;
    const copy = JSON.parse(JSON.stringify({ ...saved, data: { ...saved.data, ...patch } })) as Node;
    remapNodeReferences(copy, ids);
    Reflect.deleteProperty(copy, "initialized");
    copy.id = ids.get(node.id)!;
    copy.parentNode = ids.get(saved.parentNode ?? "") ?? saved.parentNode;
    copy.position = positions ? { ...positions.get(node.id)! }
      : { x: saved.position.x + (rootsIds.has(node.id) ? bounds.width + 64 : 0), y: saved.position.y };
    copy.data = { ...copy.data, label: `${copy.data?.label || "未命名节点"} - 副本` };
    return copy;
  }));
  signal.throwIfAborted();
  if (nodes.some(node => flow.findNode(node.id) !== node)) throw new Error("节点已变化，请重新创建副本");
  const edges = incomingEdges.filter(edge => ids.has(edge.source) || flow.findNode(edge.source)).map(edge => ({
    ...JSON.parse(JSON.stringify(edge)),
    id: crypto.randomUUID(),
    source: ids.get(edge.source) ?? edge.source,
    target: ids.get(edge.target)!,
    selected: false,
  }));
  flow.addNodes(copies);
  flow.addEdges(edges);
  return { ids, rootIds: roots.map(node => ids.get(node.id)!) };
}

function groupNodes(selection: GraphNode[]) {
  const roots = getSelectionRoots(selection, flow.getNodes.value);
  if (!roots.length) return [];
  const rootIds = new Set(roots.map(node => node.id));
  const bounds = getRectOfNodes(roots);
  const parentNode = roots.every(node => node.parentNode === roots[0]!.parentNode) ? roots[0]!.parentNode : undefined;
  const parentPosition = flow.findNode(parentNode)?.computedPosition ?? { x: 0, y: 0 };
  const group = createGroupNode({ ...bounds, x: bounds.x - parentPosition.x, y: bounds.y - parentPosition.y }, parentNode);
  const nodes: Node[] = flow.getNodes.value.map(node => rootIds.has(node.id) ? {
    ...node,
    parentNode: group.id,
    position: { x: node.computedPosition.x - parentPosition.x - group.position.x, y: node.computedPosition.y - parentPosition.y - group.position.y },
    extent: undefined,
    expandParent: false,
  } : node);
  nodes.splice(nodes.findIndex(node => rootIds.has(node.id)), 0, group);
  flow.setNodes(nodes);
  return [group.id];
}

function stackNodes(selection: GraphNode[]) {
  if (!canStack.value) throw new Error("请选中同一分组内至少两个有图片输出的节点");
  const roots = getSelectionRoots(selection, flow.getNodes.value);
  const bounds = getRectOfNodes(roots);
  const first = roots[0]!;
  const parentPosition = flow.findNode(first.parentNode)?.computedPosition ?? { x: 0, y: 0 };
  const members: StackMember[] = roots.map(node => ({
    id: node.id,
    position: { x: node.computedPosition.x - bounds.x, y: node.computedPosition.y - bounds.y },
    style: (typeof node.style === "function" ? node.style(node) : node.style) || undefined,
    draggable: node.draggable,
    selectable: node.selectable,
  }));
  const id = crypto.randomUUID();
  const stack: Node = {
    id, type: "canvasStack", parentNode: first.parentNode,
    position: { x: bounds.x - parentPosition.x, y: bounds.y - parentPosition.y },
    style: { width: `${first.dimensions.width}px`, height: `${first.dimensions.height}px` },
    connectable: false, expandParent: false,
    data: { label: "图片堆叠", stackMembers: members, stackIndex: 0 },
  };
  const ids = new Set(members.map(member => member.id));
  const nodes: Node[] = flow.getNodes.value.map(node => ids.has(node.id) ? {
    ...node, parentNode: id, position: { x: 0, y: 0 }, selected: false, draggable: false, selectable: false,
    style: { ...(typeof node.style === "function" ? node.style(node) : node.style), visibility: "hidden", pointerEvents: "none" },
  } : node);
  nodes.splice(nodes.findIndex(node => ids.has(node.id)), 0, stack);
  flow.setNodes(nodes);
  return [id];
}

function unstackNodes(stack: GraphNode) {
  const ids: string[] = [];
  for (const member of getStackMembers(stack)) {
    const node = flow.findNode(member.id);
    if (!node || node.parentNode !== stack.id) continue;
    flow.updateNode(node.id, {
      parentNode: stack.parentNode,
      position: { x: stack.position.x + member.position.x, y: stack.position.y + member.position.y },
      style: member.style, draggable: member.draggable, selectable: member.selectable,
    });
    ids.push(node.id);
  }
  flow.removeNodes([stack.id], true, false);
  return ids;
}

async function sendStack() {
  const stack = selectedStack.value;
  if (!stack || busy.value || props.disabled || !sendNodeToAgent) return;
  busy.value = true;
  const signal = props.getSignal();
  try {
    for (const member of getStackMembers(stack)) {
      signal.throwIfAborted();
      const node = flow.findNode(member.id);
      const image = node?.parentNode === stack.id ? getStackImage(node) : undefined;
      if (image) await sendNodeToAgent(member.id, [image.id]);
    }
  } catch (error) {
    if (!signal.aborted) ElMessage.error(error instanceof Error ? error.message : "发送到 Agent 失败");
  } finally { busy.value = false; }
}

function stackOutputs(stack: GraphNode) {
  return getStackMembers(stack).flatMap(member => {
    const node = flow.findNode(member.id);
    const image = node?.parentNode === stack.id ? getStackImage(node) : undefined;
    return image ? [{ label: node?.data.label || "图片", output: image.output }] : [];
  });
}

function saveStack() {
  const stack = selectedStack.value;
  if (!stack || busy.value || props.disabled || !saveNodeToAssets) return;
  const outputs = stackOutputs(stack);
  if (outputs.length) saveNodeToAssets(stack.data.label, outputs, true);
}

async function downloadStack() {
  const stack = selectedStack.value;
  const directory = workspaceStore.project?.directory;
  if (!stack || !directory || busy.value || props.disabled) return;
  const outputs = stackOutputs(stack);
  if (!outputs.length) return;
  const names = getStackFileNames(outputs);
  const files = useWorkspaceFiles(directory);
  const signal = props.getSignal();
  busy.value = true;
  try {
    await saveFile(async () => {
      const { Zip, ZipPassThrough } = await import("fflate");
      const chunks: BlobPart[] = [];
      let zipError: Error | undefined;
      let finished = false;
      const archive = new Zip((error, chunk, final) => {
        if (error) zipError = error;
        else chunks.push(new Uint8Array(chunk));
        if (final) finished = true;
      });
      try {
        // 图片已压缩，逐张读取并直接打包，避免再次压缩阻塞界面。
        for (const [index, item] of outputs.entries()) {
          signal.throwIfAborted();
          const content = await files.read(item.output.value.url);
          signal.throwIfAborted();
          const file = new ZipPassThrough(names[index]!);
          archive.add(file);
          file.push(new Uint8Array(content), true);
          if (zipError) throw zipError;
        }
        archive.end();
        if (zipError) throw zipError;
        if (!finished) throw new Error("图片打包未完成，请重试");
        return new Blob(chunks, { type: "application/zip" });
      } finally { archive.terminate(); }
    }, "堆叠图片.zip");
  } catch (error) {
    if (!signal.aborted) ElMessage.error(error instanceof Error ? error.message : "全部下载失败");
  } finally { busy.value = false; }
}

function ungroupNodes(selection: GraphNode[]) {
  const groups = new Map(selection.filter(node => node.type === "canvasGroup").map(node => [node.id, node]));
  const promoted: string[] = [];
  for (const node of flow.getNodes.value) {
    if (!node.parentNode || !groups.has(node.parentNode) || groups.has(node.id)) continue;
    const visited = new Set<string>();
    let parentNode: string | undefined = node.parentNode;
    while (parentNode && groups.has(parentNode) && !visited.has(parentNode)) {
      visited.add(parentNode);
      parentNode = groups.get(parentNode)!.parentNode;
    }
    if (parentNode && visited.has(parentNode)) parentNode = undefined;
    const parentPosition = flow.findNode(parentNode)?.computedPosition ?? { x: 0, y: 0 };
    flow.updateNode(node.id, {
      parentNode,
      position: { x: node.computedPosition.x - parentPosition.x, y: node.computedPosition.y - parentPosition.y },
      extent: undefined,
      expandParent: false,
    });
    promoted.push(node.id);
  }
  flow.removeNodes([...groups.keys()], true, false);
  return [...selection.filter(node => !groups.has(node.id)).map(node => node.id), ...promoted];
}

function mergeGroups(selection: GraphNode[]) {
  const groups = getSelectionRoots(selection.filter(node => node.type === "canvasGroup"), flow.getNodes.value);
  if (groups.length < 2) throw new Error("请至少选择两个分组");
  const first = groups[0]!;
  const groupIds = new Set(groups.map(node => node.id));
  const bounds = getRectOfNodes(groups);
  const parentNode = groups.every(node => node.parentNode === first.parentNode) ? first.parentNode : undefined;
  const parentPosition = flow.findNode(parentNode)?.computedPosition ?? { x: 0, y: 0 };
  const style = typeof first.style === "function" ? first.style(first) : first.style;
  const merged: GraphNode = {
    ...first,
    parentNode,
    position: { x: bounds.x - parentPosition.x, y: bounds.y - parentPosition.y },
    dimensions: { width: bounds.width, height: bounds.height },
    style: { ...style, width: `${bounds.width}px`, height: `${bounds.height}px` },
  };
  const nodes: Node[] = flow.getNodes.value.flatMap(node => {
    if (groupIds.has(node.id)) return [];
    return node.parentNode && groupIds.has(node.parentNode) ? [{
      ...node,
      parentNode: first.id,
      position: { x: node.computedPosition.x - bounds.x, y: node.computedPosition.y - bounds.y },
      extent: undefined,
      expandParent: false,
    }] : [node];
  });
  const firstChild = nodes.findIndex(node => node.parentNode === first.id);
  nodes.splice(firstChild < 0 ? nodes.length : firstChild, 0, merged);
  flow.setNodes(nodes);
  return [first.id];
}

async function convertGroupToStoryboard(signal: AbortSignal) {
  const group = storyboardGroup.value;
  const members = storyboardMembers.value;
  if (!group || !members) throw new Error("当前分组无法转换为分镜组");
  await Promise.all(members.map(node => useNodeEvent(node.id, flow).emit("save", "reload")));
  signal.throwIfAborted();
  if (storyboardGroup.value !== group || storyboardMembers.value !== members) throw new Error("分组已变化，请重新转换");

  const layout = group.data?.storyboardLayout;
  let storyboard = readStoryboard(layout);
  const slots = members.map(node => node.data.storyboardSlot);
  const canRestoreSlots = layout && new Set(slots).size === members.length
    && slots.every(slot => Number.isInteger(slot) && slot >= 0 && slot < storyboard.shots.length);
  const ordered = canRestoreSlots ? members : [...members].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  if (!canRestoreSlots && members.length > storyboard.shots.length) {
    const side = Math.ceil(Math.sqrt(members.length));
    storyboard = readStoryboard({ ...storyboard, rows: side, columns: side });
  }
  for (const [index, node] of ordered.entries()) {
    const image = getStackImage(node)!;
    storyboard.shots[canRestoreSlots ? slots[index] : index] = {
      id: crypto.randomUUID(),
      label: String(node.data.label || "图片"),
      media: { ...image.output.value },
    };
  }

  const id = crypto.randomUUID();
  const label = group.data?.label;
  flow.addNodes([{
    id,
    type: storyboardOption.type,
    parentNode: group.parentNode,
    position: { ...group.position },
    data: { label: label && label !== "分组" ? label : layout?.label || storyboardOption.label, storyboard },
  }]);
  flow.removeNodes([...members, group], false);
  return [id];
}

async function selectNodes(ids: string[], signal: AbortSignal) {
  await nextTick();
  signal.throwIfAborted();
  flow.removeSelectedElements();
  const nodes = ids.flatMap(id => flow.findNode(id) ?? []);
  flow.addSelectedNodes(getSelectionRoots(nodes, flow.getNodes.value));
  flow.nodesSelectionActive.value = !nodes.every(node => node.type === "canvasStack" || node.type === storyboardOption.type);
  flow.updateNodeInternals(ids);
}

function startDragCopy(selection: GraphNode[], withEdges: boolean) {
  const nodes = getSelectionTree(selection, flow.getNodes.value);
  if (busy.value || props.disabled || !nodes.length) return;
  const roots = getSelectionRoots(nodes, flow.getNodes.value);
  const startPositions = new Map(nodes.map(node => [node.id, { ...node.position }]));
  const positions = new Map(startPositions);
  const signal = props.getSignal();
  const ended = Promise.withResolvers<void>();
  const finish = () => ended.resolve();
  let copies: Map<string, string> | undefined;
  let started = false;

  function moveCopies() {
    for (const node of roots) {
      const copy = flow.findNode(copies?.get(node.id));
      if (copy) {
        copy.position = { ...positions.get(node.id)! };
        copy.dragging = true;
      }
    }
  }

  async function createCopies() {
    busy.value = true;
    signal.addEventListener("abort", finish, { once: true });
    try {
      await props.batchHistory(async () => {
        signal.throwIfAborted();
        const result = await duplicateNodes(selection, signal, withEdges, positions);
        copies = result.ids;
        moveCopies();
        await ended.promise;
        signal.throwIfAborted();
        const created = result.rootIds.flatMap(id => flow.findNode(id) ?? []);
        created.forEach(node => { node.dragging = false; });
        await nextTick();
        signal.throwIfAborted();
        finishGroupDrag(flow.getNodes.value, created);
      });
    } catch (error) {
      if (!signal.aborted) ElMessage.error(error instanceof Error ? error.message : "拖动复制失败");
    } finally {
      signal.removeEventListener("abort", finish);
      busy.value = false;
    }
  }

  return {
    update() {
      if (signal.aborted) return;
      // ACT: Vue Flow 固定拖动原节点 ID；同一帧还原原位置，只让副本跟随，松手后统一提交历史。
      for (const node of roots) {
        if (flow.findNode(node.id) !== node) continue;
        positions.set(node.id, { ...node.position });
        node.position = { ...startPositions.get(node.id)! };
        node.dragging = false;
      }
      moveCopies();
      if (!started) {
        started = true;
        void createCopies();
      }
    },
    finish,
  };
}

async function operate(command: "duplicate" | "group" | "ungroup" | "mergeGroup" | "stack" | "unstack" | "storyboard" | ArrangeSelectionMode) {
  if (busy.value || props.disabled || (command === "group" && !canGroup.value)) return;
  const selection = [...flow.getSelectedNodes.value];
  if (!selection.length) return;
  const signal = props.getSignal();
  busy.value = true;
  try {
    await props.batchHistory(async () => {
      signal.throwIfAborted();
      if (command === "storyboard") {
        await selectNodes(await convertGroupToStoryboard(signal), signal);
      } else if (command === "duplicate" || command === "group" || command === "ungroup" || command === "mergeGroup" || command === "stack" || command === "unstack") {
        const ids = command === "stack" ? stackNodes(selection)
          : command === "unstack" ? (selectedStack.value ? unstackNodes(selectedStack.value) : [])
          : command === "duplicate" ? (await duplicateNodes(selection, signal)).rootIds
          : command === "group" ? groupNodes(selection)
          : command === "mergeGroup" ? mergeGroups(selection) : ungroupNodes(selection);
        await selectNodes(ids, signal);
      } else {
        arrangeSelection(flow, selection, command);
      }
    });
  } catch (error) {
    if (!signal.aborted) ElMessage.error(error instanceof Error ? error.message : "选区操作失败");
  } finally {
    busy.value = false;
  }
}

defineExpose({ operate, startDragCopy, busy });
</script>

<style scoped lang="scss">
.selectionToolbar {
  z-index: 6;
  transform: translate(-50%, -100%) scale(var(--selectionToolbarZoom, 1));
  transform-origin: center bottom;

  .colorButton.el-button {
    width: 28px;
    padding: 0;

    .colorPreview {
      width: 18px;
      height: 18px;
      border: 1px solid rgb(255 255 255 / 20%);
      border-radius: 50%;
    }
  }
}

.groupColors {
  display: grid;
  grid-template-columns: repeat(6, 28px);
  gap: 16px;

  :deep(.customColor) {
    width: 28px;
    height: 28px;

    &.is-disabled {
      opacity: 0.5;
    }

    .el-color-picker__trigger {
      padding: 0;
      border: 1px solid rgb(255 255 255 / 20%);
      border-radius: 50%;
      background: radial-gradient(circle at 30% 25%, rgb(255 255 255 / 70%), transparent 60%),
        conic-gradient(#ef4444, #f8bd3e, #2acb70, #0db5d0, #3b82f6, #8b5cf6, #ec399d, #ef4444);
    }

    .el-color-picker__color {
      display: none;
    }
  }

  .colorSwatch {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid rgb(255 255 255 / 20%);
    border-radius: 50%;
    cursor: pointer;

    &[aria-pressed="true"],
    &:focus-visible {
      outline: 2px solid var(--el-text-color-primary);
      outline-offset: 3px;
    }

    &:disabled {
      cursor: not-allowed;
    }
  }
}
</style>
