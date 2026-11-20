import { z } from "@toonflow/nodes-scaffold/runtime";
import { isNodeOutput } from "@toonflow/nodes-scaffold/values";

const identifier = z.string().min(1).max(100);
export const assetKinds = [{ value: "character", label: "角色" }, { value: "scene", label: "场景" }, { value: "prop", label: "道具" }] as const;
export const assetSchema = z.object({
  id: identifier,
  kind: z.enum(["character", "scene", "prop"]),
  name: z.string().max(100),
  description: z.string().max(4000),
  source: identifier.optional(),
  sourceHandle: identifier.optional(),
  imageNodeId: z.string().max(100).optional(),
}).refine(asset => !!asset.source === !!asset.sourceHandle, "参考节点与端口必须同时指定");
export const shotSchema = z.object({
  id: identifier,
  duration: z.number().finite().min(1).max(120),
  color: z.string().regex(/^#[\da-fA-F]{6}$/).optional(),
  description: z.string().max(6000),
  shotSize: z.string().max(200),
  lighting: z.string().max(1000),
  dialogue: z.string().max(3000),
  sound: z.string().max(1000),
  movement: z.string().max(1000),
  assetIds: z.array(identifier).max(60),
  imagePrompt: z.string().max(14000),
  videoPrompt: z.string().max(16000),
  promptSource: z.string().max(200000),
  imageNodeId: z.string().max(100).optional(),
  videoNodeId: z.string().max(100).optional(),
});
export const scriptSchema = z.object({
  version: z.literal(1),
  title: z.string().max(200),
  mode: z.enum(["script", "character", "manual"]),
  input: z.string().max(60000),
  style: z.string().max(4000),
  model: z.string().max(1000),
  imageModel: z.string().max(1000),
  videoModel: z.string().max(1000),
  shotCount: z.number().int().min(1).max(60),
  ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]),
  step: z.number().int().min(0).max(2),
  assets: z.array(assetSchema).max(60),
  shots: z.array(shotSchema).max(120),
  rawResponse: z.string().max(200000),
}).superRefine((data, ctx) => {
  for (const key of ["assets", "shots"] as const) {
    if (new Set(data[key].map(item => item.id)).size !== data[key].length) ctx.addIssue({ code: "custom", path: [key], message: "编号重复" });
  }
  const ids = new Set(data.assets.map(asset => asset.id));
  data.shots.forEach((shot, index) => {
    if (shot.assetIds.some(id => !ids.has(id))) ctx.addIssue({ code: "custom", path: ["shots", index, "assetIds"], message: "分镜引用的资产不存在" });
  });
});
export type ScriptDocument = z.infer<typeof scriptSchema>;
export type ScriptAsset = z.infer<typeof assetSchema>;
export type ScriptShot = z.infer<typeof shotSchema>;
export type AssetReference = { source: string; sourceHandle: string; label: string };
export type MediaKind = "image" | "video";

export function assetImage(asset: ScriptAsset, readOutput: (id: string, handle: string) => unknown) {
  const sources = [
    { source: asset.imageNodeId, sourceHandle: "image" },
    { source: asset.source, sourceHandle: asset.sourceHandle },
  ];
  for (const { source, sourceHandle } of sources) {
    if (!source || !sourceHandle) continue;
    const output = readOutput(source, sourceHandle);
    if (isNodeOutput(output) && output.dataType === "IMAGE") return { source, sourceHandle, output };
  }
}

export function createScript(): ScriptDocument {
  return { version: 1, title: "", mode: "script", input: "", style: "", model: "", imageModel: "", videoModel: "", shotCount: 8, ratio: "16:9", step: 0, assets: [], shots: [], rawResponse: "" };
}
export function createShot(): ScriptShot {
  return { id: crypto.randomUUID(), duration: 5, description: "", shotSize: "中景", lighting: "", dialogue: "", sound: "", movement: "", assetIds: [], imagePrompt: "", videoPrompt: "", promptSource: "" };
}
export function shotSource(shot: ScriptShot, assets: ScriptAsset[], style: string) {
  return JSON.stringify([shot.description, shot.duration, shot.shotSize, shot.lighting, shot.dialogue, shot.sound, shot.movement, style, assets.filter(asset => shot.assetIds.includes(asset.id)).map(asset => ({ id: asset.id, kind: asset.kind, name: asset.name, description: asset.description }))]);
}
export function composeShot(shot: ScriptShot, assets: ScriptAsset[], style: string) {
  const text = [
    style.trim() && "统一视觉风格：" + style.trim(),
    "画面：" + shot.description.trim(),
    shot.shotSize.trim() && "景别：" + shot.shotSize.trim(),
    shot.lighting.trim() && "光影氛围：" + shot.lighting.trim(),
    ...assets.filter(asset => shot.assetIds.includes(asset.id)).map(asset => asset.name.trim() + "：" + asset.description.trim()),
  ].filter(Boolean).join("\n");
  return {
    imagePrompt: text,
    videoPrompt: [text, "镜头时长：" + shot.duration + " 秒", shot.movement.trim() && "运镜与动作：" + shot.movement.trim(), shot.dialogue.trim() && "对白／旁白：" + shot.dialogue.trim(), shot.sound.trim() && "音效：" + shot.sound.trim()].filter(Boolean).join("\n"),
  };
}
export function formatScript(data: ScriptDocument) {
  if (!data.shots.length) return "";
  return ["# " + (data.title.trim() || "分镜脚本"), data.style.trim() && "视觉风格：" + data.style.trim(), ...data.shots.map((shot, index) => [
    "## 镜头 " + (index + 1) + " · " + shot.duration + " 秒",
    "画面：" + shot.description, "景别：" + shot.shotSize, "光影：" + shot.lighting,
    "对白／旁白：" + shot.dialogue, "音效：" + shot.sound, "运镜：" + shot.movement,
    "资产：" + data.assets.filter(asset => shot.assetIds.includes(asset.id)).map(asset => asset.name).join("、"),
    shot.imagePrompt && "### 图片提示词\n" + shot.imagePrompt,
    shot.videoPrompt && "### 视频提示词\n" + shot.videoPrompt,
  ].filter(Boolean).join("\n\n"))].filter(Boolean).join("\n\n");
}
