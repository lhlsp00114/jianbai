import { colorOptions } from "./components/colorOptions";
import { isCustomColor, readCustomColors } from "./customColors";

export function getColorPrompt(preset: unknown, snapshot?: unknown): string {
  if (!preset) return "";
  let option = colorOptions.find(item => item.name === preset);
  if (!option && typeof preset === "string" && preset.startsWith("customColor")) {
    let custom = isCustomColor(snapshot) && snapshot.name === preset ? snapshot : undefined;
    if (!custom) {
      try { custom = readCustomColors().find(item => item.name === preset); } catch { return ""; }
    }
    if (custom) option = { ...custom, paths: [], image: "", prompt: "以第一个颜色为主色，其余颜色用于辅助和点缀，协调画面的整体色彩关系。" };
  }
  if (!option) return "";
  return `配色指导（${option.label}）：${option.prompt}参考色值：${option.colors.join("、")}，用于整体色彩关系，不要求等比例使用所有颜色。保留用户指定的主体与场景；除黑白配色外保持合理肤色，不添加色卡、色块、色值文字。`;
}
