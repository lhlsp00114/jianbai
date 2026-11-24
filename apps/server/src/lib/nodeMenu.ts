export const storyboardNodeType = "canvasStoryboard";

const defaultHiddenNodeTypes = new Set(["remote-imageNode", "remote-videoNode", "remote-audioNode", "remote-imageLayerNode"]);

export type NodeMenuItem = {
  id: string;
  label: string;
  type?: string;
  alias?: string;
  hidden: boolean;
  children?: NodeMenuItem[];
};

export type StoredNodeMenuItem = string | { type: string; alias?: string; hidden?: true } | {
  id: string;
  label: string;
  children: StoredNodeMenuItem[];
  hidden?: true;
};

export function normalizeNodeMenu(value: unknown): NodeMenuItem[] {
  if (!Array.isArray(value)) return [];
  const result: NodeMenuItem[] = [];
  const ids = new Set<string>();
  const visited = new Set<object>();
  const pending = value.map(value => ({ value: value as unknown, depth: 1, hidden: false, output: result })).reverse();
  while (pending.length) {
    const { value, depth, hidden, output } = pending.pop()!;
    const candidate = typeof value === "string" ? { type: value } : value;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || visited.has(candidate)) continue;
    visited.add(candidate);
    const item = candidate as Record<string, unknown>;
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (typeof item.type === "string" && item.type.trim()) {
      const type = item.type.trim();
      const id = `node:${type}`;
      if (ids.has(id)) continue;
      ids.add(id);
      const alias = typeof item.alias === "string" ? item.alias.trim() : "";
      output.push({ id, type, label: label || type, hidden: hidden || item.hidden === true, ...(alias ? { alias } : {}) });
      continue;
    }
    if (typeof item.id !== "string" || !item.id.startsWith("group:") || item.id.length <= 6 || !label || !Array.isArray(item.children)) continue;
    // ACT: 超过三级的旧配置提升子项，保留节点的隐藏状态；编辑器在移动时限制深度。
    const promote = depth >= 3 || ids.has(item.id);
    const children: NodeMenuItem[] = promote ? output : [];
    if (!promote) {
      ids.add(item.id);
      output.push({ id: item.id, label, hidden: hidden || item.hidden === true, children });
    }
    for (let index = item.children.length - 1; index >= 0; index--) {
      pending.push({ value: item.children[index], depth: promote ? depth : depth + 1, hidden: promote && (hidden || item.hidden === true), output: children });
    }
  }
  return result;
}

export function resolveNodeMenu(saved: NodeMenuItem[], nodes: { type: string; label: string }[]): NodeMenuItem[] {
  const items = normalizeNodeMenu(saved);
  const labels = new Map(nodes.map(node => [node.type, node.label]));
  const existing = new Set<string>();
  function updateLabels(items: NodeMenuItem[]) {
    for (const item of items) {
      if (item.type) {
        existing.add(item.type);
        item.label = item.alias || labels.get(item.type) || item.label;
      } else if (item.children) updateLabels(item.children);
    }
  }
  updateLabels(items);
  function moveAfter(items: NodeMenuItem[], targetType: string, nodeType: string): boolean {
    const targetIndex = items.findIndex(item => item.type === targetType);
    const nodeIndex = items.findIndex(item => item.type === nodeType);
    if (targetIndex >= 0 && nodeIndex >= 0) {
      const [node] = items.splice(nodeIndex, 1);
      const nextTargetIndex = items.findIndex(item => item.type === targetType);
      items.splice(nextTargetIndex + 1, 0, node!);
      return true;
    }
    return items.some(item => item.children && moveAfter(item.children, targetType, nodeType));
  }
  moveAfter(items, "remote-audioNode", "remote-imageLayerNode");
  const order: Record<string, number> = {
    "remote-textNode": 0, "remote-imageGenerationNode": 1, "remote-videoGenerationNode": 2,
    "remote-audioGenerationNode": 3, "remote-scriptGeneratorNode": 4, "remote-imageNode": 5, "remote-videoNode": 6,
    "remote-audioNode": 7, "remote-imageLayerNode": 8, "remote-director3dNode": 9,
    "remote-frameAnalysisNode": 10,
  };
  function insertAfter(items: NodeMenuItem[], targetType: string, node: NodeMenuItem): boolean {
    const index = items.findIndex(item => item.type === targetType);
    if (index >= 0) { items.splice(index + 1, 0, node); return true; }
    return items.some(item => item.children && insertAfter(item.children, targetType, node));
  }
  for (const node of [...nodes].sort((left, right) => (order[left.type] ?? 10) - (order[right.type] ?? 10) || left.type.localeCompare(right.type))) {
    if (existing.has(node.type)) continue;
    existing.add(node.type);
    const newItem = { id: `node:${node.type}`, type: node.type, label: node.label, hidden: defaultHiddenNodeTypes.has(node.type) };
    if (node.type === "remote-audioGenerationNode" && insertAfter(items, "remote-videoGenerationNode", newItem)) continue;
    const audioTarget = existing.has("remote-audioNode") ? "remote-audioNode"
      : existing.has("remote-audioGenerationNode") ? "remote-audioGenerationNode" : "remote-videoGenerationNode";
    if (node.type === "remote-imageLayerNode" && insertAfter(items, audioTarget, newItem)) continue;
    const scriptTarget = existing.has("remote-audioGenerationNode") ? "remote-audioGenerationNode" : "remote-videoGenerationNode";
    if (node.type === "remote-scriptGeneratorNode" && insertAfter(items, scriptTarget, newItem)) continue;
    items.push(newItem);
  }
  return items;
}

export function filterNodeMenu(items: NodeMenuItem[], nodeTypes: ReadonlySet<string>): NodeMenuItem[] {
  return items.flatMap((item): NodeMenuItem[] => {
    if (item.hidden) return [];
    if (item.type) return nodeTypes.has(item.type) ? [{ ...item }] : [];
    const children = filterNodeMenu(item.children ?? [], nodeTypes);
    return children.length ? [{ ...item, children }] : [];
  });
}

export function serializeNodeMenu(items: NodeMenuItem[], installedTypes?: ReadonlySet<string>): StoredNodeMenuItem[] {
  function serialize(items: NodeMenuItem[]): StoredNodeMenuItem[] {
    return items.flatMap((item): StoredNodeMenuItem[] => {
      if (item.type) {
        if (installedTypes && item.type !== storyboardNodeType && !installedTypes.has(item.type)) return [];
        return [item.alias || item.hidden
          ? { type: item.type, ...(item.alias ? { alias: item.alias } : {}), ...(item.hidden ? { hidden: true as const } : {}) }
          : item.type];
      }
      return [{ id: item.id, label: item.label, children: serialize(item.children ?? []), ...(item.hidden ? { hidden: true as const } : {}) }];
    });
  }
  return serialize(normalizeNodeMenu(items));
}
