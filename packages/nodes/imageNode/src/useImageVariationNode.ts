import { inject, nextTick } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { emptyMediaCardWidth, getMediaPreviewSize } from "@toonflow/node-shared/mediaPreviewSize";
import type { ImageInpaint } from "./imageInpaint";

export function useImageVariationNode() {
  const { id, node } = useNode();
  const { addNodes, addEdges, removeNodes, findNode, getNodes, nodeTypes } = useVueFlow();
  const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());

  return async function createVariation(input: { label: string; prompt: string; model: string; size: string; ratio: string; nodeId?: string; inpaint?: ImageInpaint; compactPrompt?: "multiAngle" | "lighting" }, signal?: AbortSignal) {
    const type = "remote-imageGenerationNode";
    signal?.throwIfAborted();
    if (!nodeTypes?.value?.[type]) throw new Error("请先启用图片生成节点插件");
    if (findNode(id) !== node) throw new Error("原节点已变化，请重新操作");
    const nodeId = input.nodeId ?? crypto.randomUUID();
    const edgeId = crypto.randomUUID();
    const { label, model, size, ratio, compactPrompt } = input;
    const prompt = compactPrompt ? `{{preset ${compactPrompt}}}` : input.prompt;
    const [ratioWidth = 0, ratioHeight = 0] = ratio.split(":").map(Number);
    const previewSize = ratioWidth > 0 && ratioHeight > 0 && Number.isFinite(ratioWidth) && Number.isFinite(ratioHeight) ? getMediaPreviewSize(ratioWidth, ratioHeight) : undefined;
    const outputWidth = Math.max(emptyMediaCardWidth, (previewSize?.width ?? 0) + 18);
    const outputHeight = Math.max(300, previewSize?.height ?? 0) + 60;
    const x = node.computedPosition.x + (node.dimensions.width || 320) + 80;
    let y = node.computedPosition.y;
    for (const other of [...getNodes.value].sort((left, right) => left.computedPosition.y - right.computedPosition.y)) {
      const position = other.computedPosition;
      if (position.x < x + outputWidth && position.x + (other.dimensions.width || 320) > x && position.y < y + outputHeight && position.y + (other.dimensions.height || 300) > y) {
        y = position.y + (other.dimensions.height || 300) + 40;
      }
    }
    await batchHistory(async () => {
      signal?.throwIfAborted();
      try {
        const promptModel = prompt.split("\n").map(text => [{ type: "Write", text }]);
        addNodes({ id: nodeId, type, position: { x, y }, data: {
          label: `${node.data.label || "图片"} · ${label}`, model, size, ratio, prompt, promptModel,
          ...(compactPrompt ? { [`${compactPrompt}Prompt`]: input.prompt } : {}),
          ...(input.inpaint ? { inpaint: input.inpaint } : {}),
        } });
        addEdges({ id: edgeId, source: id, sourceHandle: "image", target: nodeId, targetHandle: "in" });
      } catch (error) {
        removeNodes(nodeId, true, false);
        throw error;
      }
      await nextTick();
    });
    return { nodeId, edgeId };
  };
}
