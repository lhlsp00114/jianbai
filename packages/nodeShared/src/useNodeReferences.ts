import { computed, h, inject, nextTick, onScopeDispose, ref, render } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { IconMusic } from "@tabler/icons-vue";
import { isTypeCompatible, validateConnection, type NodeData } from "@toonflow/nodes-scaffold/connection";
import { useNodeEvent } from "@toonflow/nodes-scaffold/nodeEvent";
import { isNodeOutput, type NodeInputValue, type NodeMediaValue } from "@toonflow/nodes-scaffold/values";
import type { MentionItem } from "x-sender";
import type { NodeMediaModel } from "@toonflow/nodes-scaffold/nodeAi";
import type { Connection, ValidConnectionFunc } from "@vue-flow/core";
import { showNodeError } from "./showNodeError";
import { videoReferenceLimits } from "./videoModelOptions";

export type ReferenceMention = MentionItem & { value: string; label?: string; dataType?: string; previewable?: boolean };
export type MaterialMention = {
  id: string;
  name: string;
  dataType: "IMAGE" | "VIDEO" | "AUDIO" | "STRING";
  source: string;
  sourceHandle: string;
  disabled: boolean;
  media?: NodeMediaValue;
};

const audioIconElement = document.createElement("div");
render(h(IconMusic, { color: "#409eff" }), audioIconElement);
const audioAvatar = `data:image/svg+xml,${encodeURIComponent(audioIconElement.innerHTML)}`;
render(null, audioIconElement);

export function useNodeReferences(handleId = "in", getModel?: () => NodeMediaModel | undefined, getMode?: () => string | string[] | undefined) {
  const { id, node } = useNode<NodeData & { referenceOrder?: Record<string, string[]> }>();
  const flow = useVueFlow();
  const { findNode, removeEdges } = flow;
  function mediaLimitError(type: "IMAGE" | "VIDEO" | "AUDIO", count: number) {
    const limit = getMode ? videoReferenceLimits(getMode())[type] : type === "IMAGE" ? getModel?.()?.maxReferenceImages : undefined;
    const label = { IMAGE: "图片", VIDEO: "视频", AUDIO: "音频" }[type];
    if (limit === 0) return `当前模型和模式不支持${label}参考，请切换模式后添加。`;
    if (limit !== undefined && count >= limit) return `当前模型和模式最多支持 ${limit} 个${label}素材，请移除已有素材或切换模式。`;
  }
  function referenceLimitError(connection: Connection, context: Parameters<ValidConnectionFunc>[1]) {
    // 视频连线保留全部素材，由节点按当前模式置暗并排除超额项，避免整组连线被数量限制拒绝。
    if (getMode) return;
    if (connection.target !== id || connection.targetHandle !== handleId) return;
    const hasType = (source: string, sourceHandle: string | null | undefined, mediaType: string) => {
      const data = context.nodes.find(item => item.id === source)?.data as NodeData | undefined;
      const output = sourceHandle ? data?.outputs?.[sourceHandle] : undefined;
      if (isNodeOutput(output)) return output.dataType === mediaType;
      const type = data?.handles?.find(item => item.id === sourceHandle && item.type === "source")?.dataType;
      return Array.isArray(type) ? type.includes(mediaType) : type?.split(",").map(item => item.trim()).includes(mediaType);
    };
    const incoming = context.edges.filter(edge => edge.target === id && edge.targetHandle === handleId);
    if (incoming.some(edge => edge.source === connection.source && edge.sourceHandle === connection.sourceHandle)) return;
    for (const type of ["IMAGE", "VIDEO", "AUDIO"] as const) {
      if (!hasType(connection.source, connection.sourceHandle, type)) continue;
      const error = mediaLimitError(type, incoming.filter(edge => hasType(edge.source, edge.sourceHandle, type)).length);
      if (error) return error;
    }
  }
  if (getModel && !getMode) {
    useNodeEvent().on("canConnect", (connection, context) => !referenceLimitError(connection, context));
    flow.onConnectEnd(() => {
      const start = flow.connectionStartHandle.value;
      const end = flow.connectionEndHandle.value;
      if (!start || !end) return;
      const source = start.type === "source" ? start : end;
      const target = start.type === "target" ? start : end;
      if (target.nodeId !== id || target.id !== handleId) return;
      const sourceNode = findNode(source.nodeId);
      if (!sourceNode) return;
      const message = referenceLimitError({ source: source.nodeId, sourceHandle: source.id, target: id, targetHandle: handleId },
        { sourceNode, targetNode: node, nodes: flow.getNodes.value, edges: flow.getEdges.value });
      if (message) showNodeError(message, "参考素材不符合要求");
    });
  }
  const selectNodeAsset = inject<((targetId: string, targetHandleId: string) => Promise<{ source: string; sourceHandle: string } | undefined>) | undefined>("selectNodeAsset", undefined);
  let disposed = false;
  onScopeDispose(() => { disposed = true; });
  const inputValues = ref<NodeInputValue[]>([]);
  const previews = ref(new Map<string, string>());
  const refList = computed({
    get() {
      const order = new Map(node.data.referenceOrder?.[handleId]?.map((key, index) => [key, index]));
      return [...inputValues.value].sort((a, b) => (order.get(referenceKey(a)) ?? order.size) - (order.get(referenceKey(b)) ?? order.size));
    },
    set(values: NodeInputValue[]) {
      node.data.referenceOrder = { ...node.data.referenceOrder, [handleId]: values.map(referenceKey) };
    },
  });
  const referenceMentions = computed<ReferenceMention[]>(() => refList.value.flatMap((item, index) =>
    typeof item.dataType === "string" && ["IMAGE", "VIDEO", "AUDIO", "STRING", "FILE"].includes(item.dataType)
      ? [{
          id: referenceKey(item),
          label: findNode<NodeData>(item.source)?.data.label?.trim() || item.source,
          dataType: item.dataType,
          name: item.dataType === "AUDIO"
            ? `参考 ${index + 1}：${findNode<NodeData>(item.source)?.data.label?.trim() || item.value?.url.split(/[\\/]/).pop() || "音频"}`
            : `参考 ${index + 1}`,
          value: `{{ref ${index + 1}}}`,
          avatar: item.dataType === "AUDIO" ? audioAvatar : previews.value.get(referenceKey(item)) || undefined,
          previewable: item.dataType === "IMAGE" || item.dataType === "VIDEO",
        }]
      : []
  ));
  const materialMentions = computed<MaterialMention[]>(() => {
    const connected = new Set(flow.getEdges.value.filter(edge => edge.target === id && edge.targetHandle === handleId).map(edge => edge.source));
    const targetHandle = node.data.handles?.find(handle => handle.type === "target" && handle.id === handleId);
    return flow.getNodes.value.flatMap(sourceNode => {
      if (sourceNode.id === id || connected.has(sourceNode.id)) return [];
      const data = sourceNode.data as NodeData;
      return (data.handles ?? []).flatMap<MaterialMention>(handle => {
        if (handle.type !== "source") return [];
        const output = data.outputs?.[handle.id];
        const valid = isNodeOutput(output) && isTypeCompatible(output.dataType, handle.dataType);
        const dataType = valid ? output.dataType : (Array.isArray(handle.dataType) ? handle.dataType : handle.dataType.split(","))
          .map(type => type.trim()).find(type => ["IMAGE", "VIDEO", "AUDIO", "STRING"].includes(type));
        if (dataType !== "IMAGE" && dataType !== "VIDEO" && dataType !== "AUDIO" && dataType !== "STRING") return [];
        const connection = { source: sourceNode.id, sourceHandle: handle.id, target: id, targetHandle: handleId };
        return [{
          id: referenceKey(connection),
          name: data.label?.trim() || sourceNode.id,
          dataType,
          source: sourceNode.id,
          sourceHandle: handle.id,
          disabled: !valid || (output.dataType === "STRING" && !output.value.trim()) || !flow.nodesConnectable.value
            || !targetHandle || !isTypeCompatible(output.dataType, targetHandle.dataType)
            || sourceNode.connectable === false || node.connectable === false
            || !!referenceLimitError(connection, { sourceNode, targetNode: node, nodes: flow.getNodes.value, edges: flow.getEdges.value })
            || !validateConnection(connection, { sourceNode, targetNode: node, nodes: flow.getNodes.value, edges: flow.getEdges.value }),
          media: valid && (output.dataType === "IMAGE" || output.dataType === "VIDEO" || output.dataType === "AUDIO") ? output.value : undefined,
        }];
      });
    });
  });

  async function selectMaterialReference(referenceId: string) {
    if (disposed || findNode(id) !== node) return;
    const current = materialMentions.value.find(item => item.id === referenceId);
    if (!current || current.disabled) return;
    flow.addEdges({ id: crypto.randomUUID(), source: current.source, sourceHandle: current.sourceHandle, target: id, targetHandle: handleId });
    await nextTick();
    if (!disposed) return referenceMentions.value.find(item => item.id === referenceId);
  }

  async function selectAssetReference() {
    if (disposed || findNode(id) !== node) return;
    if (!selectNodeAsset) throw new Error("当前画布未提供全局素材库选择能力");
    const source = await selectNodeAsset(id, handleId);
    await nextTick();
    if (!disposed && source) return referenceMentions.value.find(item => item.id === referenceKey(source));
  }

  useNodeEvent().on(`input:${handleId}`, (values) => {
    inputValues.value = values;
    const ids = new Set(values.filter(item => item.dataType === "IMAGE" || item.dataType === "VIDEO").map(referenceKey));
    for (const key of previews.value.keys()) {
      if (!ids.has(key)) previews.value.delete(key);
    }
  });

  function setReferencePreview(item: NodeInputValue, url: string) {
    previews.value.set(referenceKey(item), url);
  }

  function removeReference(item: NodeInputValue) {
    removeEdges(edges => edges.filter(edge =>
      edge.target === id && edge.targetHandle === handleId && edge.source === item.source && edge.sourceHandle === item.sourceHandle
    ));
  }

  const referenceUploadError = () => mediaLimitError("IMAGE", refList.value.filter(item => item.dataType === "IMAGE").length);
  return { refList, referenceMentions, materialMentions, selectMaterialReference, selectAssetReference, setReferencePreview, removeReference, referenceUploadError };
}

export function referenceKey(item: { source: string; sourceHandle: string }) {
  return encodeURIComponent(JSON.stringify([item.source, item.sourceHandle]));
}
