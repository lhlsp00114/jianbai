import { inject, nextTick, ref } from "vue";
import { getTransformForBounds, useNode, useVueFlow } from "@vue-flow/core";
import type { NodeMediaValue } from "@toonflow/nodes-scaffold/values";
import { showNodeError } from "@toonflow/node-shared/showNodeError";

export type ImageRotation = { angle: number; flipX: boolean; flipY: boolean };

export function useImageRotation() {
  const { node } = useNode();
  const { addNodes, addEdges, removeNodes, findNode, getNodes, nodeTypes, removeSelectedElements, addSelectedNodes, nodesSelectionActive, dimensions, minZoom, maxZoom, setViewport } = useVueFlow();
  const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());
  const getCanvas = inject<(() => { id: string } | undefined) | undefined>("canvas", undefined);
  const creatingRotation = ref(false);

  async function createRotation(source?: NodeMediaValue) {
    if (!source || creatingRotation.value) return;
    const canvasId = getCanvas?.()?.id;
    const type = "remote-imageNode";
    const id = crypto.randomUUID();
    creatingRotation.value = true;
    try {
      if (!nodeTypes?.value?.[type]) throw new Error("请先启用图片节点插件");
      if (findNode(node.id) !== node) throw new Error("原图片节点已变化，请重新操作");
      const width = node.dimensions.width || 320;
      const height = node.dimensions.height || 300;
      const x = node.computedPosition.x + width + 80;
      let y = node.computedPosition.y;
      for (const other of [...getNodes.value].sort((left, right) => left.computedPosition.y - right.computedPosition.y)) {
        const position = other.computedPosition;
        if (position.x < x + width && position.x + (other.dimensions.width || 320) > x
          && position.y < y + height && position.y + (other.dimensions.height || 300) > y) {
          y = position.y + (other.dimensions.height || 300) + 40;
        }
      }
      await batchHistory(async () => {
        try {
          addNodes({ id, type, position: { x, y }, data: {
            label: `${node.data.label || "图片"} · 旋转与镜像`,
            outputs: { image: { dataType: "IMAGE", value: { ...source } } },
            rotationDraft: { angle: 0, flipX: false, flipY: false } satisfies ImageRotation,
          } });
          await nextTick();
          if (getCanvas?.()?.id !== canvasId || findNode(node.id) !== node || !findNode(id)) throw new Error("画布已变化，请重新操作");
          addEdges({ id: crypto.randomUUID(), source: node.id, sourceHandle: "image", target: id, targetHandle: "in" });
        } catch (error) {
          // 只撤回尚未完成的画布创建，不触发节点素材清理。
          removeNodes(id, true, false);
          throw error;
        }
      });
      const created = findNode(id);
      if (!created || getCanvas?.()?.id !== canvasId) return;
      removeSelectedElements();
      addSelectedNodes([created]);
      nodesSelectionActive.value = false;
      await nextTick();
      if (findNode(id) === created && getCanvas?.()?.id === canvasId) {
        // 新插件尚未挂载时没有测量尺寸，按原图尺寸及编辑栏范围定位，避免只聚焦原节点。
        const left = Math.min(node.computedPosition.x, x + width / 2 - 280);
        const top = Math.min(node.computedPosition.y, y - 90);
        const right = Math.max(x + width, x + width / 2 + 280);
        const bottom = Math.max(node.computedPosition.y + height, y + height);
        await setViewport(getTransformForBounds({ x: left, y: top, width: right - left, height: bottom - top },
          dimensions.value.width, dimensions.value.height, minZoom.value, Math.min(maxZoom.value, 1), 0.2), { duration: 200 });
      }
    } catch (error) {
      showNodeError(error, "创建旋转节点失败");
    } finally {
      creatingRotation.value = false;
    }
  }

  return { createRotation, creatingRotation };
}
