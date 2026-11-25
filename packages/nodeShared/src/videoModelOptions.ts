import type { NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";

export function videoResolutions(model: NodeMediaModel | undefined, duration: number | undefined, ratio: string) {
  return [...new Set((model?.durationResolutionMap ?? []).filter(item =>
    (duration === undefined ? !item.duration.length : item.duration.includes(duration)) &&
    (!item.imageRatios || item.imageRatios.includes(ratio))).flatMap(item => item.resolution))];
}

export function videoReferenceLimits(mode: string | string[] | undefined) {
  const limits = { IMAGE: 0, VIDEO: 0, AUDIO: 0 };
  if (mode === "singleImage") limits.IMAGE = 1;
  else if (typeof mode === "string" && ["startEndRequired", "endFrameOptional", "startFrameOptional"].includes(mode)) limits.IMAGE = 2;
  else if (Array.isArray(mode)) {
    for (const [type, prefix] of [["IMAGE", "image"], ["VIDEO", "video"], ["AUDIO", "audio"]] as const) {
      const count = Number(mode.find(item => item.startsWith(`${prefix}Reference:`))?.split(":")[1] ?? 0);
      limits[type] = Number.isInteger(count) && count > 0 ? count : 0;
    }
  }
  return limits;
}

// 同一模型的档位与任务决定可选模式；模式进一步决定时长、清晰度和比例。
export function videoModelOptions(model: NodeMediaModel | undefined, other: Record<string, unknown>, selectedMode: string) {
  if (!model?.videoVariants) return model;
  const quality = other.quality ?? model.rules?.find(rule => rule.field === "quality")?.value;
  const operation = other.videoOperation ?? model.rules?.find(rule => rule.field === "videoOperation")?.value ?? (model.promptOptional ? "avatar" : "reference");
  const variants = model.videoVariants.filter(item => (item.quality === undefined || item.quality === quality) && item.operation === operation);
  const modes = [...new Map(variants.map(item => [JSON.stringify(item.mode), item.mode])).values()];
  const active = variants.filter(item => JSON.stringify(item.mode) === selectedMode);
  const options = active.length ? active : variants;
  return { ...model, mode: modes, imageRatios: [...new Set(options.flatMap(item => item.imageRatios))],
    durationResolutionMap: options.flatMap(item => item.durationResolutionMap) };
}
