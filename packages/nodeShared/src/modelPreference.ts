import { findNodeModel, getNodeModelKey, useNodeModelMemory, type NodeMediaModel } from "@toonflow/nodes-scaffold/nodeAi";

export function useNodeModelPreferences() {
  const memory = { image: useNodeModelMemory("image"), video: useNodeModelMemory("video") };
  return {
    readLastNodeModel(type: "image" | "video", models: NodeMediaModel[]) {
      return readLastNodeModel(type, models) ?? findNodeModel(models, memory[type].get());
    },
    rememberNodeModel(model: NodeMediaModel) {
      if (model.type !== "image" && model.type !== "video") return;
      rememberNodeModel(model);
      memory[model.type].set(getNodeModelKey(model));
    },
  };
}

export function readLastNodeModel(type: "image" | "video", models: NodeMediaModel[]) {
  try {
    const key = localStorage.getItem(`toonflow.lastNodeModel.${type}`);
    return key ? findNodeModel(models, key) : undefined;
  } catch { return undefined; }
}

export function rememberNodeModel(model: NodeMediaModel) {
  if (model.type !== "image" && model.type !== "video") return;
  // ACT: 只在用户选择或发起生成时记忆；加载旧节点不覆盖最近选择。
  try { localStorage.setItem(`toonflow.lastNodeModel.${model.type}`, getNodeModelKey(model)); }
  catch { /* 浏览器禁用存储时仍允许选择和生成。 */ }
}
