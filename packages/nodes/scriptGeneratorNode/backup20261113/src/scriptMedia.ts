import { inject, nextTick } from "vue";
import { useNode, useVueFlow, type Node, type Edge } from "@vue-flow/core";
import { useNodeToolsContext, useNodeInputs, validateConnection, type NodeMediaModel, type NodeOutput, getNodeModelIdentity, getNodeModelKey } from "@toonflow/nodes-scaffold/runtime";
import { isNodeOutput } from "@toonflow/nodes-scaffold/values";
import { getModelFormValues } from "@toonflow/node-shared/useModelForm";
import { assetImage, type AssetReference, type MediaKind, type ScriptDocument } from "./scriptData";

type MediaPlan = { id: string; label: string; prompt: string; duration?: number; references: AssetReference[]; previous?: string; assign: (id: string) => void };
export type MediaReport = { id: string; nodeId?: string; label: string; message: string; failed?: boolean };

export function useScriptMedia() {
  const { node } = useNode();
  const flow = useVueFlow();
  const tools = useNodeToolsContext();
  const inputs = useNodeInputs();
  const saveNodeToAssets = inject<((label: string, outputs: { label: string; output: NodeOutput }[]) => void) | undefined>("saveNodeToAssets");
  const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());

  function focus(id?: string) {
    if (!id || !flow.findNode(id)) throw new Error("关联节点已不存在");
    void flow.fitView({ nodes: [id], padding: 0.3, maxZoom: 1, duration: 250 });
  }

  async function create(data: ScriptDocument, kind: MediaKind, ids: string[], assetsOnly: boolean, model: NodeMediaModel | undefined, start: boolean, signal: AbortSignal, onReport: (report: MediaReport) => void, options: { size?: string; ratio?: string; other?: Record<string, unknown>; prompt?: string } = {}) {
    signal.throwIfAborted();
    if (flow.findNode(node.id) !== node) throw new Error("脚本节点已切换");
    const type = kind === "image" ? "remote-imageGenerationNode" : "remote-videoGenerationNode";
    if (!flow.nodeTypes?.value?.[type]) throw new Error("请先启用" + (kind === "image" ? "图片" : "视频") + "生成节点插件");
    if (!model || model.type !== kind) throw new Error("请先选择有效的生成模型，以检查比例和时长");
    if (kind === "image") {
      const sizes = model.imageSizes?.length ? model.imageSizes : ["2K"];
      const size = options.size || sizes.toSorted((left, right) => (Number.parseFloat(left) || Infinity) - (Number.parseFloat(right) || Infinity))[0]!;
      if (!sizes.includes(size)) throw new Error("当前模型不支持分辨率 " + size);
      options = { ...options, size, other: getModelFormValues(model, {}, options.other) };
    }
    const ratios = model.imageRatios?.length ? model.imageRatios : kind === "image" ? ["16:9"] : ["16:9", "9:16", "1:1", "4:3", "3:4"];
    const ratio = options.ratio ?? data.ratio;
    if (!ratios.includes(ratio)) throw new Error("当前模型不支持画幅 " + ratio + "，可选：" + ratios.join("、"));
    if (assetsOnly && data.assets.some(asset => ids.includes(asset.id) && (!asset.name.trim() || !asset.description.trim()))) throw new Error("请先补全资产名称和视觉描述");
    const plans: MediaPlan[] = assetsOnly ? data.assets.filter(asset => ids.includes(asset.id)).map(asset => ({
      id: asset.id, label: asset.name, prompt: options.prompt || [data.style, asset.name + "：" + asset.description, "单独展示该资产，保持外观特征清晰一致"].filter(Boolean).join("\n"),
      references: asset.source && asset.sourceHandle ? [{ source: asset.source, sourceHandle: asset.sourceHandle, label: asset.name }] : [],
      previous: asset.imageNodeId, assign: id => { asset.imageNodeId = id; },
    })) : data.shots.filter(shot => ids.includes(shot.id)).map(shot => {
      const image = shot.imageNodeId ? inputs.getSourceValue(shot.imageNodeId, "image") : undefined;
      const references = kind === "video" && image?.dataType === "IMAGE" ? [{ source: shot.imageNodeId!, sourceHandle: "image", label: "分镜首帧" }]
        : data.assets.filter(asset => shot.assetIds.includes(asset.id)).flatMap(asset => {
          const ready = assetImage(asset, inputs.getSourceValue);
          const source = ready?.source ?? asset.source ?? asset.imageNodeId;
          const sourceHandle = ready?.sourceHandle ?? (asset.source ? asset.sourceHandle : "image");
          return source && sourceHandle ? [{ source, sourceHandle, label: asset.name }] : [];
        });
      return { id: shot.id, label: "镜头 " + (data.shots.indexOf(shot) + 1), prompt: kind === "image" ? shot.imagePrompt : shot.videoPrompt, duration: shot.duration, references,
        previous: kind === "image" ? shot.imageNodeId : shot.videoNodeId, assign: id => { if (kind === "image") shot.imageNodeId = id; else shot.videoNodeId = id; } };
    });
    if (!plans.length) throw new Error("请先选择要创建的" + (assetsOnly ? "资产" : "分镜"));
    if (plans.some(plan => !plan.label.trim() || !plan.prompt.trim())) throw new Error("名称或提示词为空，请先完善资产或合成分镜提示词");
    if (kind === "video") {
      const durations = [...new Set((model.durationResolutionMap ?? []).flatMap(item => item.duration))];
      const invalid = plans.find(plan => !durations.includes(plan.duration!));
      if (invalid) throw new Error(durations.length ? invalid.label + "的时长不受该视频模型支持，可选秒数：" + durations.join("、") : "该视频模型未声明可用时长，请选择其他模型");
    }
    const prepared = plans.map(plan => {
      const references = [...new Map(plan.references.map(reference => [JSON.stringify([reference.source, reference.sourceHandle]), reference])).values()];
      for (const reference of references) {
        const source = flow.findNode(reference.source);
        if (!source || !source.data.handles?.some((handle: { id: string; type: string }) => handle.id === reference.sourceHandle && handle.type === "source")) throw new Error("参考资产“" + reference.label + "”已失效，请重新关联");
      }
      const prompt = [plan.prompt, ...references.map((reference, index) => "视觉参考“" + reference.label + "”：{{ref " + (index + 1) + "}}")].join("\n");
      const signature = JSON.stringify([kind, assetsOnly, prompt, model ? getNodeModelIdentity(model) : null, ratio, options.size, options.other, plan.duration, references]);
      const previous = plan.previous ? flow.findNode(plan.previous) : undefined;
      const origin = previous?.data.scriptOrigin;
      const previousEdges = previous ? flow.getEdges.value.filter(edge => edge.target === previous.id && edge.targetHandle === "in") : [];
      const sameReferences = previousEdges.length === references.length && references.every((reference, index) => previousEdges[index]?.source === reference.source && previousEdges[index]?.sourceHandle === reference.sourceHandle);
      const reused = previous?.type === type && origin?.ownerId === node.id && origin.itemId === plan.id && origin.signature === signature
        && previous.data.prompt === prompt && previous.data.model === getNodeModelKey(model) && previous.data.ratio === ratio
        && (kind !== "image" || previous.data.size === options.size && JSON.stringify(previous.data.other ?? {}) === JSON.stringify(options.other ?? {}))
        && (kind !== "video" || previous.data.duration === plan.duration) && sameReferences && !previous.data.referenceOrder?.in?.length;
      return { plan, prompt, references, signature, id: reused ? previous!.id : crypto.randomUUID(), reused };
    });
    const created: Node[] = [];
    const edges: Edge[] = [];
    const newCount = prepared.filter(item => !item.reused).length;
    const columns = Math.min(3, Math.max(1, newCount));
    const x = assetsOnly && kind === "image" ? node.computedPosition.x - columns * 420 - 100 : node.computedPosition.x + (node.dimensions.width || 340) + 100;
    let y = node.computedPosition.y;
    const totalHeight = Math.ceil(newCount / columns) * 400;
    for (const other of [...flow.getNodes.value].filter(item => item.id !== node.id).sort((a, b) => a.computedPosition.y - b.computedPosition.y)) {
      if (other.computedPosition.x < x + columns * 420 && other.computedPosition.x + (other.dimensions.width || 340) > x
        && other.computedPosition.y < y + totalHeight && other.computedPosition.y + (other.dimensions.height || 300) > y) y = other.computedPosition.y + (other.dimensions.height || 300) + 60;
    }
    await batchHistory(async () => {
      signal.throwIfAborted();
      if (flow.findNode(node.id) !== node) throw new Error("脚本节点已切换");
      prepared.forEach(item => {
        if (item.reused) return;
        const index = created.length;
        created.push({ id: item.id, type, position: { x: x + index % columns * 420, y: y + Math.floor(index / columns) * 400 }, data: {
          label: (data.title.trim() || "脚本") + " · " + item.plan.label, prompt: item.prompt, promptModel: item.prompt.split("\n").map(text => [{ type: "Write", text }]),
          ...(model ? { model: JSON.stringify([getNodeModelIdentity(model).providerId, getNodeModelIdentity(model).modelId]) } : {}), ratio, ...(kind === "image" ? { size: options.size ?? "", other: options.other ?? {} } : {}), ...(kind === "video" ? { duration: item.plan.duration } : {}),
          scriptOrigin: { ownerId: node.id, itemId: item.plan.id, signature: item.signature, kind },
        } });
        item.references.forEach(reference => edges.push({ id: crypto.randomUUID(), source: reference.source, sourceHandle: reference.sourceHandle, target: item.id, targetHandle: "in" }));
      });
      const assetEdges = assetsOnly && kind === "image" ? prepared.flatMap(item => flow.getEdges.value.some(edge => edge.source === item.id && edge.sourceHandle === "image" && edge.target === node.id && edge.targetHandle === "in") ? [] : [{ id: crypto.randomUUID(), source: item.id, sourceHandle: "image", target: node.id, targetHandle: "in" }]) : [];
      try {
        if (created.length) flow.addNodes(created);
        await nextTick();
        signal.throwIfAborted();
        for (const edge of edges) {
          const sourceNode = flow.findNode(edge.source);
          const targetNode = flow.findNode(edge.target);
          if (!sourceNode || !targetNode) throw new Error("创建参考连线时节点已变化");
          if (!validateConnection(edge, { sourceNode, targetNode, nodes: flow.getNodes.value, edges: flow.getEdges.value })) throw new Error("参考连线不被目标节点支持");
          flow.addEdges(edge);
          if (!flow.findEdge(edge.id)) throw new Error("参考连线创建失败");
        }
        for (const edge of assetEdges) {
          const sourceNode = flow.findNode(edge.source);
          const targetNode = flow.findNode(edge.target);
          if (!sourceNode || !targetNode || !validateConnection(edge, { sourceNode, targetNode, nodes: flow.getNodes.value, edges: flow.getEdges.value })) throw new Error("素材图片无法连接到脚本节点");
          flow.addEdges(edge);
          if (!flow.findEdge(edge.id)) throw new Error("素材图片连接失败");
        }
      } catch (error) {
        // 仅回滚本次尚未启动任务的新节点和新边，不触发素材删除。
        flow.removeEdges([...edges, ...assetEdges].map(edge => edge.id));
        flow.removeNodes(created.map(item => item.id), true, false);
        throw error;
      }
      for (const item of prepared) item.plan.assign(item.id);
    });
    for (const item of prepared) {
      if (signal.aborted) { onReport({ id: item.plan.id, nodeId: item.id, label: item.plan.label, message: "已创建，未继续启动" }); continue; }
      try {
        if (!start) { onReport({ id: item.plan.id, nodeId: item.id, label: item.plan.label, message: item.reused ? "沿用已有关联节点" : "已创建，尚未生成" }); continue; }
        const deadline = Date.now() + 15000;
        while (!tools().list([item.id], ["node:setConfig"]).next().value) {
          signal.throwIfAborted();
          if (!flow.findNode(item.id) || Date.now() > deadline) throw new Error("生成节点尚未就绪，请到该节点继续操作");
          await new Promise(resolve => setTimeout(resolve, 80));
        }
        const target = flow.findNode(item.id);
        if (!target) throw new Error("关联节点已不存在");
        const output = target.data.outputs?.[kind];
        const task = target.data.mediaTask;
        if (isNodeOutput(output) && output.dataType === kind.toUpperCase()) { onReport({ id: item.plan.id, nodeId: item.id, label: item.plan.label, message: "已有生成结果，未重复提交" }); continue; }
        if (task && task.state !== "failed" && task.state !== "cancelled") { onReport({ id: item.plan.id, nodeId: item.id, label: item.plan.label, message: "已有运行中或待确认任务，请到关联节点查看，未重复提交" }); continue; }
        for (const reference of item.references) if (inputs.getSourceValue(reference.source, reference.sourceHandle)?.dataType !== "IMAGE") throw new Error("参考资产“" + reference.label + "”尚无图片，请先完成资产图生成");
        await tools().call({ nodeId: item.id, name: "node:setConfig", args: { ...getNodeModelIdentity(model!), ratio, ...(kind === "image" ? { ...(options.size ? { size: options.size } : {}), ...(options.other ? { other: options.other } : {}) } : {}), ...(kind === "video" ? { duration: item.plan.duration } : {}) } }, signal);
        await tools().call({ nodeId: item.id, name: kind === "image" ? "node:generateImage" : "node:generateVideo", args: {} }, signal);
        onReport({ id: item.plan.id, nodeId: item.id, label: item.plan.label, message: "已启动，进度与结果请在关联节点查看" });
      } catch (error) { onReport({ id: item.plan.id, nodeId: item.id, label: item.plan.label, message: error instanceof Error ? error.message : "启动失败", failed: true }); }
    }
  }
  function saveAsset(asset: ScriptDocument["assets"][number]) {
    if (!saveNodeToAssets) throw new Error("当前账户无法保存到个人素材库");
    const image = assetImage(asset, (id, handle) => flow.findNode(id)?.data.outputs?.[handle]);
    if (!image) throw new Error("该资产还没有可保存的图片");
    saveNodeToAssets(asset.name.trim() || flow.findNode(image.source)?.data.label || "脚本资产", [{ label: asset.name.trim() || "图片", output: image.output }]);
  }
  return { create, focus, saveAsset };
}
