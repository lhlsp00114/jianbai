import type { GraphNode, Node, XYPosition } from "@vue-flow/core";
import { isNodeOutput, type NodeOutput } from "@toonflow/nodes-scaffold/values";
import { mediaMimeTypes } from "@toonflow/node-shared/mediaTypes";

export type StackMember = {
  id: string;
  position: XYPosition;
  style?: Node["style"];
  draggable?: boolean;
  selectable?: boolean;
};

export function getStackMembers(node: Pick<Node, "data">): StackMember[] {
  return Array.isArray(node.data?.stackMembers) ? node.data.stackMembers.filter((member: StackMember) =>
    member && typeof member.id === "string" && Number.isFinite(member.position?.x) && Number.isFinite(member.position?.y)) : [];
}

export function getStackImage(node?: Pick<GraphNode, "data">): { id: string; output: Extract<NodeOutput, { dataType: "IMAGE" }> } | undefined {
  for (const [id, output] of Object.entries(node?.data?.outputs ?? {})) {
    if (isNodeOutput(output) && output.dataType === "IMAGE") return { id, output };
  }
}

export function getStackMedia(node?: Pick<GraphNode, "data">): { id: string; output: Extract<NodeOutput, { dataType: "IMAGE" | "VIDEO" }> } | undefined {
  for (const [id, output] of Object.entries(node?.data?.outputs ?? {})) {
    if (isNodeOutput(output) && (output.dataType === "IMAGE" || output.dataType === "VIDEO")) return { id, output };
  }
}

export function getStackFileNames(items: { label: string; output: NodeOutput }[]) {
  const used = new Set<string>();
  return items.map((item, index) => {
    const media = typeof item.output.value === "object" ? item.output.value : undefined;
    const extension = media?.url.match(/\.([a-z0-9]{1,10})$/i)?.[1]
      ?? Object.keys(mediaMimeTypes).find(key => mediaMimeTypes[key] === media?.mimeType) ?? (item.output.dataType === "VIDEO" ? "mp4" : "png");
    let name = item.label.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().replace(/[. ]+$/, "");
    const labelExtension = name.split(".").at(-1)?.toLowerCase();
    if (labelExtension && mediaMimeTypes[labelExtension]) name = name.slice(0, -(labelExtension.length + 1));
    name = name.slice(0, 160).replace(/[. ]+$/, "") || `图片${index + 1}`;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `图片-${name}`;
    let fileName = `${name}.${extension}`;
    for (let copy = 2; used.has(fileName.toLowerCase()); copy++) fileName = `${name} (${copy}).${extension}`;
    used.add(fileName.toLowerCase());
    return fileName;
  });
}
