export type OutpaintDraftInput = {
  prompt: string;
  targetRatio: string;
  targetWidth: number;
  targetHeight: number;
  left: number;
  top: number;
  model: string;
  size: string;
};

export type OutpaintLayout = {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export const outpaintRatioOptions = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];

export const outpaintDefaultPrompt = "向外自然延展场景，连续衔接原图边缘的轮廓、纹理与光影，保持主体位置、大小和画风一致，输出完整连贯的画面，不出现拼接线、边框或重复主体。";

export function getOutpaintLayout(sourceWidth: number, sourceHeight: number, input: OutpaintDraftInput): OutpaintLayout {
  const { targetWidth, targetHeight, left, top } = input;
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight, left, top].every(Number.isSafeInteger)
    || sourceWidth < 1 || sourceHeight < 1 || targetWidth < sourceWidth || targetHeight < sourceHeight
    || left < 0 || top < 0 || left + sourceWidth > targetWidth || top + sourceHeight > targetHeight) throw new Error("扩图范围无效，原图必须完整保留在边框内");
  if (targetWidth === sourceWidth && targetHeight === sourceHeight) throw new Error("请向外拖动边框，增加需要扩展的区域");
  return { sourceWidth, sourceHeight, targetWidth, targetHeight, left, top, right: targetWidth - sourceWidth - left, bottom: targetHeight - sourceHeight - top };
}

const previousOutpaintInstruction = "根据第一张扩展画布和第二张红色区域参考图完成扩图。原图主体位于扩展画布中的非红色区域，红色区域表示需要补全的画面范围；保持原图主体、光线、材质、透视和画风一致，自然延续边缘内容，不重复主体，不添加文字或水印，输出完整的目标比例图片。";
const outpaintInstruction = "参考图是一张待补全的扩展画布：已有图像为原始内容，外围留白为需要生成的区域。以整张扩展画布为构图，保持已有主体的位置、大小、身份与画风，自然补全外围场景，使跨越原图边缘的轮廓、纹理、透视、色彩和光照连续过渡。统一生成一张完整连贯的图片，不要把原图画成相框或画中画，不要重复主体，不要保留留白、矩形边界、接缝或添加水印。";
export const outpaintPromptInstructionId = "imageOutpaint";
export const defaultOutpaintPromptInstruction = outpaintInstruction + "\n\n扩图要求：\n" + outpaintDefaultPrompt;

export function readOutpaintPromptInstruction(stores: unknown): string {
  if (stores === undefined) return defaultOutpaintPromptInstruction;
  if (!stores || typeof stores !== "object" || Array.isArray(stores)) throw new Error("内置扩图指令设置格式错误");
  const instructions = (stores as Record<string, unknown>).nodeInstructions;
  if (instructions === undefined) return defaultOutpaintPromptInstruction;
  if (!instructions || typeof instructions !== "object" || Array.isArray(instructions)) throw new Error("内置扩图指令设置格式错误");
  const value = (instructions as Record<string, unknown>)[outpaintPromptInstructionId];
  if (value === undefined) return defaultOutpaintPromptInstruction;
  if (typeof value !== "string" || !value.trim() || value.length > 16000) throw new Error("内置扩图指令必须是 1–16000 字符的非空文本");
  return value;
}

export function readOutpaintPrompt(prompt: string) {
  const instruction = [outpaintInstruction, previousOutpaintInstruction].find(value => prompt.startsWith(value));
  if (!instruction) return { prompt, context: "" };
  const content = prompt.slice(instruction.length).replace(/^\s*扩图要求：\s*/, "");
  const context = content.match(/\n\n目标画布：\d+ × \d+；原图大小：\d+ × \d+；原图左上角位置：\(\d+, \d+\)。$/)?.[0] ?? "";
  return { prompt: context ? content.slice(0, -context.length) : content, context };
}

export function buildOutpaintPrompt(prompt: string, context = "", instruction = defaultOutpaintPromptInstruction) {
  if (prompt.startsWith(previousOutpaintInstruction)) prompt = prompt.slice(previousOutpaintInstruction.length).replace(/^\s*扩图要求：\s*/, "");
  if (prompt.startsWith(outpaintInstruction) || prompt.startsWith(instruction)) return prompt;
  if (instruction === defaultOutpaintPromptInstruction && prompt.trim()) return outpaintInstruction + "\n\n扩图要求：\n" + (prompt + context).trim();
  return instruction + (prompt.trim() ? "\n\n补充要求：\n" + prompt.trim() : "") + context;
}
