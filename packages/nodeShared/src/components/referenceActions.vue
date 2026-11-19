<template>
  <div class="referenceActions nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @keydown.stop>
    <el-dropdown trigger="click" :teleported="false" :disabled="disabled || busy" @command="chooseUpload">
      <el-button :icon="IconPlus" :loading="busy" :disabled="disabled || busy" text aria-label="上传参考素材">上传</el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="local" :icon="IconUpload">本地上传</el-dropdown-item>
          <el-dropdown-item command="library" :icon="IconFolder">素材库上传</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
    <el-button :icon="IconPhoto" :disabled="disabled || busy" text @click="startPicking">画布参考</el-button>
    <el-button v-if="presetPrompts && openOfficialPrompts" :icon="IconMessage" :disabled="disabled || busy" text @click="openOfficialPrompts(id)">预设提示词</el-button>
    <input ref="fileInput" type="file" accept="image/*" hidden aria-label="上传本地参考图片" :disabled="disabled || busy" @change="uploadReference" />
  </div>
  <teleport to="body">
    <div v-if="picking" class="referencePickBanner" :style="{ zIndex: bannerZIndex }" role="status" @pointerdown.stop @mousedown.stop>
      <icon-photo :size="18" />
      <span>点击画布中的图片作为参考</span>
      <el-button size="small" text @click="finishPicking()">返回节点 · Esc</el-button>
      <el-button :icon="IconX" size="small" text aria-label="取消选择画布参考" @click="finishPicking()" />
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { inject, nextTick, onScopeDispose, ref, watch, type Ref } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElDropdown, ElDropdownMenu, ElDropdownItem, ElMessage, useZIndex } from "element-plus";
import { IconPlus, IconUpload, IconFolder, IconPhoto, IconMessage, IconX } from "@tabler/icons-vue";
import { uploadNodeFile, useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import type { NodeHandle } from "@toonflow/nodes-scaffold/connection";
import type { MaterialMention, ReferenceMention } from "../useNodeReferences";
import { getMediaMimeType } from "../mediaTypes";
import { getMediaPreviewSize } from "../mediaPreviewSize";
import { showNodeError } from "../showNodeError";

const props = defineProps<{
  materials: MaterialMention[];
  selectMaterial: (id: string) => Promise<ReferenceMention | undefined>;
  selectAsset: () => Promise<ReferenceMention | undefined>;
  disabled?: boolean;
  presetPrompts?: boolean;
}>();
const { id, node } = useNode();
const openOfficialPrompts = inject<(targetId: string) => void>("openOfficialPrompts");
const flow = useVueFlow();
const files = useNodeFiles();
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
const getCanvas = inject<(() => { id: string } | undefined) | undefined>("canvas", undefined);
const expanded = inject<Ref<boolean> | undefined>("expandedGenerationPrompt", undefined);
const panelPicking = inject<Ref<boolean> | undefined>("pickingGenerationReference", undefined);
const fileInput = ref<HTMLInputElement>();
const busy = ref(false);
const picking = ref(false);
const bannerZIndex = ref(0);
const { nextZIndex } = useZIndex();
let disposed = false;
let spacePressed = false;
let pickingElement: HTMLElement | undefined;
let returnViewport = { ...flow.viewport.value };
let returnExpanded = false;

function chooseUpload(command: string) {
  if (props.disabled || busy.value) return;
  if (command === "local") fileInput.value?.click();
  else if (command === "library") void selectLibrary();
}

async function selectLibrary() {
  busy.value = true;
  try { await props.selectAsset(); }
  catch (error) { showNodeError(error, "添加素材库参考失败"); }
  finally { busy.value = false; }
}

async function uploadReference(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || props.disabled || busy.value) return;
  const mimeType = getMediaMimeType(file);
  if (!mimeType.startsWith("image/") || !file.size || file.size > 100 * 1024 * 1024) {
    return void showNodeError("请选择不超过 100 MB 的非空图片文件", "添加参考失败");
  }
  const type = "remote-imageNode";
  const handles = (flow.nodeTypes?.value?.[type] as { handles?: NodeHandle[] } | undefined)?.handles;
  if (!handles?.some(handle => handle.id === "image" && handle.type === "source")) return void showNodeError("请先启用图片节点插件", "添加参考失败");
  const canvasId = getCanvas?.()?.id;
  const sourceId = crypto.randomUUID();
  const preview = URL.createObjectURL(file);
  busy.value = true;
  try {
    const workspace = files.getWorkspaceFiles();
    const image = new Image();
    image.src = preview;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("无法读取该图片");
    if (disposed || getCanvas?.()?.id !== canvasId || flow.findNode(id) !== node) return;
    const previewSize = getMediaPreviewSize(image.naturalWidth, image.naturalHeight);
    const width = previewSize.width + 18;
    const height = previewSize.height + 60;
    const x = node.computedPosition.x - width - 80;
    let y = node.computedPosition.y;
    for (const other of [...flow.getNodes.value].sort((left, right) => left.computedPosition.y - right.computedPosition.y)) {
      const position = other.computedPosition;
      if (position.x < x + width && position.x + (other.dimensions.width || 320) > x
        && position.y < y + height && position.y + (other.dimensions.height || 300) > y) y = position.y + (other.dimensions.height || 300) + 40;
    }
    const url = await uploadNodeFile(workspace, sourceId, file);
    if (disposed || getCanvas?.()?.id !== canvasId || flow.findNode(id) !== node) return;
    await batchHistory(async () => {
      flow.addNodes({ id: sourceId, type, position: { x, y }, data: {
        label: file.name, handles: handles.map(handle => ({ ...handle })),
        outputs: { image: { dataType: "IMAGE", value: { url, mimeType } } },
      } });
      await nextTick();
      const material = props.materials.find(item => item.source === sourceId && item.dataType === "IMAGE" && !item.disabled);
      if (!material) throw new Error("图片已上传，但当前节点无法引用它，请检查连接限制");
      await props.selectMaterial(material.id);
    });
  } catch (error) {
    if (!disposed) showNodeError(error, "添加本地参考失败");
  } finally {
    URL.revokeObjectURL(preview);
    busy.value = false;
  }
}

function startPicking() {
  if (props.disabled || busy.value || picking.value || !flow.vueFlowRef.value) return;
  returnViewport = { ...flow.viewport.value };
  returnExpanded = expanded?.value === true;
  if (expanded) expanded.value = false;
  if (panelPicking) panelPicking.value = true;
  picking.value = true;
  spacePressed = false;
  bannerZIndex.value = nextZIndex();
  pickingElement = flow.vueFlowRef.value;
  pickingElement.classList.add("pickingReference");
  for (const name of ["pointerdown", "mousedown", "click", "dblclick"]) pickingElement.addEventListener(name, pickImage, true);
  window.addEventListener("keydown", pickingKey, true);
  window.addEventListener("keyup", pickingKey, true);
  (document.activeElement as HTMLElement | null)?.blur();
}

function finishPicking(returnToNode = true) {
  if (!picking.value) return;
  picking.value = false;
  if (panelPicking) panelPicking.value = false;
  pickingElement?.classList.remove("pickingReference");
  for (const name of ["pointerdown", "mousedown", "click", "dblclick"]) pickingElement?.removeEventListener(name, pickImage, true);
  window.removeEventListener("keydown", pickingKey, true);
  window.removeEventListener("keyup", pickingKey, true);
  pickingElement = undefined;
  spacePressed = false;
  if (!returnToNode || disposed || flow.findNode(id) !== node) return;
  flow.removeSelectedElements();
  flow.addSelectedNodes([node]);
  flow.nodesSelectionActive.value = false;
  void flow.setViewport(returnViewport, { duration: 200 });
  if (expanded) expanded.value = returnExpanded;
}

function pickingKey(event: KeyboardEvent) {
  if (event.code === "Space") spacePressed = event.type === "keydown";
  if (event.type !== "keydown" || event.key !== "Escape" || event.isComposing) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  finishPicking();
}

function pickImage(event: Event) {
  const mouse = event as MouseEvent;
  if (!picking.value || mouse.button !== 0 || !(event.target instanceof Element)) return;
  if (spacePressed && event.type !== "click") return;
  const sourceId = event.target.closest<HTMLElement>(".vue-flow__node")?.dataset.id;
  if (!sourceId && !event.target.closest(".vue-flow__pane")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!sourceId || event.type !== "click" || busy.value) return;
  const material = props.materials.find(item => item.source === sourceId && item.dataType === "IMAGE" && !item.disabled);
  if (!material) return void ElMessage.info("请选择尚未连接的可用图片节点");
  busy.value = true;
  void props.selectMaterial(material.id).then(() => { if (!disposed) finishPicking(); })
    .catch(error => showNodeError(error, "添加画布参考失败"))
    .finally(() => { busy.value = false; });
}

watch(() => props.disabled, disabled => { if (disabled) finishPicking(); });
watch(() => getCanvas?.()?.id, () => finishPicking(false));
onScopeDispose(() => { disposed = true; finishPicking(false); });
</script>

<style scoped lang="scss">
.referenceActions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding-right: 34px;

  .el-button { height: 30px; margin: 0; padding: 0 9px; border-radius: 6px; background: var(--el-fill-color-light); }
}
.referencePickBanner {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100vw - 32px);
  padding: 8px 10px 8px 14px;
  border: 1px solid var(--el-color-primary);
  border-radius: 10px;
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow);
  color: var(--el-text-color-primary);
  font-size: 13px;

  > svg { flex-shrink: 0; color: var(--el-color-primary); }
  .el-button { flex-shrink: 0; margin: 0; }
}
:global(.pickingReference .vue-flow__node),
:global(.pickingReference .vue-flow__node *) { cursor: crosshair !important; }
</style>
