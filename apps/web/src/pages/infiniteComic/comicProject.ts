import type { NodeImageRequest } from "@toonflow/nodes-scaffold/nodeAi";

export const comicFileName = "comicProject.json";
export type ComicReference = { id: string; label: string; path: string; mimeType: string; kind: string };
export type ComicCharacter = { id: string; name: string; aliases: string; description: string; reference: ComicReference | null; descriptionModel?: string; descriptionError?: string };
export type ComicPanel = { id: string; label: string; description: string };
export type ComicRequestRecord = { providerId: string; modelId: string; other: Record<string, unknown>; references: ComicReference[]; mode: "page" | "redraw"; panelLabel?: string; instruction?: string };
export type ComicVersion = { id: string; createdAt: string; prompt: string; images: ComicReference[]; model?: string; ratio?: string; size?: string; request?: ComicRequestRecord };
export type ComicPage = {
  id: string; number?: number; title: string; script: string; description: string; panels: ComicPanel[];
  characterIds: string[]; automaticCharacters: boolean; references: ComicReference[];
  prompt: string; versions: ComicVersion[]; error: string;
  task: { id: string; prompt: string; input: NodeImageRequest; cancelled?: boolean; submitted?: boolean; request?: ComicRequestRecord; remaining?: number; startedAt?: number } | null;
};
export type ComicProject = {
  toonflowComic: true; schemaVersion: 1; name: string; activeStep: number; selectedPageId: string;
  creation: { topic: string; requirements: string; narrativeStyle: string; pageCount: number; panelMode: string; panelsPerPage: string; model: string; rawOutput: string; draftPages: ComicPage[]; error?: string; generatedAt?: string };
  settings: { model: string; characterModel?: string; generationCount?: number; size: string; ratio: string; other: Record<string, unknown>; includeText: boolean; usePreviousPageReference: boolean; promptPrefix: string; promptSuffix: string; references: ComicReference[] };
  characters: ComicCharacter[]; pages: ComicPage[];
};

export function createComicPage(number: number, script = "", description = ""): ComicPage {
  return { id: crypto.randomUUID(), number, title: `第 ${number} 页`, script, description, panels: splitPanels(description, number), characterIds: [], automaticCharacters: true, references: [], prompt: "", versions: [], error: "", task: null };
}

export function createComicProject(name: string): ComicProject {
  return {
    toonflowComic: true, schemaVersion: 1, name, activeStep: 1, selectedPageId: "",
    creation: { topic: "", requirements: "", narrativeStyle: "自然、连贯、有漫画节奏", pageCount: 6, panelMode: "auto", panelsPerPage: "1-4", model: "", rawOutput: "", draftPages: [] },
    settings: { model: "", size: "2K", ratio: "3:4", other: {}, includeText: true, usePreviousPageReference: false,
      promptPrefix: "日常随笔漫画风格，治愈系绘本风，情感向条漫。铅笔手绘质感线条，画面有留白，氛围温馨、细腻，简笔画，日式日常生活感。", promptSuffix: "", references: [] },
    characters: [], pages: [],
  };
}

export function readComicProject(value: unknown): ComicProject {
  if (!isRecord(value) || value.toonflowComic !== true || value.schemaVersion !== 1
    || typeof value.name !== "string" || !isRecord(value.creation) || !isRecord(value.settings)
    || !Array.isArray(value.pages) || !Array.isArray(value.characters)) throw new Error("不是受支持的无限漫画项目文件");
  const result = value as unknown as ComicProject;
  const stringFields = [result.selectedPageId, result.creation.topic, result.creation.requirements, result.creation.narrativeStyle, result.creation.panelMode,
    result.creation.panelsPerPage, result.creation.model, result.creation.rawOutput, result.settings.model, result.settings.size, result.settings.ratio, result.settings.promptPrefix, result.settings.promptSuffix];
  if (stringFields.some(item => typeof item !== "string") || !Number.isInteger(result.activeStep) || result.activeStep < 1 || result.activeStep > 5
    || !Number.isInteger(result.creation.pageCount) || result.creation.pageCount < 1 || result.creation.pageCount > 50
    || !isRecord(result.settings.other) || typeof result.settings.includeText !== "boolean" || typeof result.settings.usePreviousPageReference !== "boolean"
    || [result.creation.error, result.creation.generatedAt, result.settings.characterModel].some(item => item !== undefined && typeof item !== "string")
    || result.settings.generationCount !== undefined && (!Number.isInteger(result.settings.generationCount) || result.settings.generationCount < 1 || result.settings.generationCount > 4)
    || !Array.isArray(result.creation.draftPages)) throw new Error("漫画项目配置格式不正确，未覆盖原文件");
  const ids = new Set<string>();
  for (const page of [...result.pages, ...result.creation.draftPages]) {
    if (!isRecord(page) || [page.id, page.title, page.script, page.description, page.prompt, page.error].some(item => typeof item !== "string")
      || !Array.isArray(page.panels) || !Array.isArray(page.versions) || !Array.isArray(page.characterIds) || page.characterIds.some(id => typeof id !== "string")
      || typeof page.automaticCharacters !== "boolean" || ids.has(page.id)
      || page.number !== undefined && (!Number.isSafeInteger(page.number) || page.number < 1)) throw new Error("漫画页面格式不正确");
    ids.add(page.id);
    for (const panel of page.panels) if (!isRecord(panel) || [panel.id, panel.label, panel.description].some(item => typeof item !== "string")) throw new Error("漫画分格格式不正确");
    validateReferences(page.references);
    for (const version of page.versions) {
      if (!isRecord(version) || [version.id, version.createdAt, version.prompt].some(item => typeof item !== "string")) throw new Error("漫画版本格式不正确");
      validateReferences(version.images);
      validateRequestRecord(version.request);
    }
    if (page.task !== null && (!isRecord(page.task) || typeof page.task.id !== "string" || typeof page.task.prompt !== "string" || !isRecord(page.task.input)
      || [page.task.input.directory, page.task.input.providerId, page.task.input.modelId, page.task.input.prompt, page.task.input.outputDirectory].some(item => typeof item !== "string")
      || [page.task.cancelled, page.task.submitted].some(item => item !== undefined && typeof item !== "boolean"))) throw new Error("漫画任务格式不正确");
    if (page.task) {
      validateRequestRecord(page.task.request);
      if (page.task.remaining !== undefined && (!Number.isInteger(page.task.remaining) || page.task.remaining < 1 || page.task.remaining > 4)) throw new Error("漫画任务次数无效");
      if (page.task.startedAt !== undefined && !Number.isFinite(page.task.startedAt)) throw new Error("漫画任务时间无效");
    }
  }
  validateReferences(result.settings.references);
  for (const character of result.characters) {
    if (!isRecord(character) || [character.id, character.name, character.aliases, character.description].some(item => typeof item !== "string")
      || [character.descriptionModel, character.descriptionError].some(item => item !== undefined && typeof item !== "string")) throw new Error("漫画角色格式不正确");
    if (character.reference !== null) validateReferences([character.reference]);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateRequestRecord(value: unknown) {
  if (value === undefined) return;
  if (!isRecord(value) || typeof value.providerId !== "string" || typeof value.modelId !== "string" || !isRecord(value.other)
    || !["page", "redraw"].includes(value.mode as string) || [value.panelLabel, value.instruction].some(item => item !== undefined && typeof item !== "string")) throw new Error("漫画生成记录格式不正确");
  validateReferences(value.references);
}

function validateReferences(value: unknown) {
  if (!Array.isArray(value) || value.some(item => !isRecord(item) || [item.id, item.label, item.path, item.mimeType, item.kind].some(field => typeof field !== "string")
    || !item.path || /^(?:[a-z]+:|[\\/])/i.test(item.path as string) || (item.path as string).replaceAll("\\", "/").split("/").includes(".."))) throw new Error("漫画素材路径无效");
}

// 沿用旧漫画的分格标记规则，支持“1-1：描述”和斜线分格。
export function splitPanels(description: string, number: number): ComicPanel[] {
  const text = description.replace(/\r/g, "").trim();
  if (!text) return [];
  const matches = [...text.matchAll(/(?:^|\n|\s)(\d+)(?:[-.、])?(\d+)?\s*[：:、.]\s*/g)];
  if (matches.length) return matches.map((match, index) => ({ id: crypto.randomUUID(), label: `${number}-${match[2] || index + 1}`,
    description: text.slice(match.index! + match[0].length, matches[index + 1]?.index ?? text.length).trim() })).filter(panel => panel.description);
  return text.split(/\s*\/\s*/).filter(Boolean).map((description, index) => ({ id: crypto.randomUUID(), label: `${number}-${index + 1}`, description }));
}

export function pageCharacters(project: ComicProject, page: ComicPage) {
  if (!page.automaticCharacters) return project.characters.filter(item => page.characterIds.includes(item.id));
  const text = characterMatchText(`${page.script}\n${page.description}\n${page.panels.map(item => item.description).join("\n")}\n${page.prompt}`);
  return project.characters.filter(item => [item.name, ...item.aliases.split(/[，,、;；\n]/)].some(name => characterMatchText(name) && text.includes(characterMatchText(name))));
}

function characterMatchText(value: string) {
  return value.toLowerCase().replace(/[\s：:（）()【】\[\]“”"'，,。.!！?？、_-]/g, "");
}

export function pageReferences(project: ComicProject, page: ComicPage): ComicReference[] {
  const previous = project.pages[project.pages.findIndex(item => item.id === page.id) - 1];
  const shared = [...project.settings.references.filter(item => item.kind === "style"), ...project.settings.references.filter(item => item.kind !== "style")];
  return [...shared, ...pageCharacters(project, page).flatMap(item => item.reference ? [{ ...item.reference, label: item.name, kind: "character" }] : []), ...page.references,
    ...(project.settings.usePreviousPageReference && previous?.versions[0]?.images[0] ? [{ ...previous.versions[0].images[0], kind: "previousPage", label: "上一页结果" }] : [])];
}

export function pagePrompt(project: ComicProject, page: ComicPage, panel?: ComicPanel, instruction = "") {
  const references = pageReferences(project, page);
  const kinds: Record<string, string> = { style: "仅参考整页画风、媒介、线条、色彩、光影和材质，不复制人物身份、姿势、构图或文字", composition: "仅参考页面外框、分格形状、间距、边距和整体版式，不复制具体画面", character: "严格保持对应角色的身份、外貌、体型、服装和配色，不得融合、换装或增减肢体", pose: "仅参考人物动作、姿势和朝向，不复制角色身份、脸部或服装", framing: "仅参考镜头机位、主体位置和构图关系，不复制人物身份", scene: "仅参考场景布局、空间关系和环境元素", other: "仅参考与本页描述有关的视觉结构", previousPage: "延续上一页的角色外观、服装、场景、色彩和镜头关系，不复制上一页文字或版面" };
  const referenceRules = references.map((item, index) => `参考图 ${index + 1}（${item.label}）：${kinds[item.kind] ?? "参考本页画面关系"}。`).join("\n");
  const scriptBlocks = project.settings.includeText ? splitScriptBlocks(page.script, page.panels.length) : [];
  const scriptByPanel = new Map(scriptBlocks.map(item => [item.index, item.text]));
  const panelContent = page.panels.map((item, index) => [
    `第${panelOrdinal(index)}格（${item.label}）：${item.description}`,
    project.settings.includeText
      ? `对白：${scriptByPanel.get(index) || "本格无对白，不添加对白、旁白文字或气泡。"}`
      : "本格不要出现文字、字母、水印和对白气泡。",
  ].join("\n")).join("\n\n");
  const body = panel ? ["对现有漫画整页图片进行单格定向重绘。最后一张参考图是当前漫画页。",
    referenceRules, `只修改分格 ${panel.label}，保持其他分格、人物、服装、画风、比例、文字和版式不变，不增删分格。`,
    project.settings.includeText ? `目标格对白：${scriptByPanel.get(page.panels.indexOf(panel)) || "不添加对白或旁白"}` : "目标格不要出现文字或对白气泡。",
    `原始画面描述：${panel.description}`, `修改要求：${instruction}`].join("\n")
    : stripPromptAffixes(project, page.prompt) || [referenceRules,
      pageCharacters(project, page).map(item => `角色 ${item.name}：${item.description}`).join("\n"),
      "漫画格内容（每格的画面描述与对白必须对应，不得串格）：", panelContent || [page.description, `剧情与动作：${page.script}`, project.settings.includeText ? "按脚本安排对白与旁白。" : "不要出现文字、字母、水印或对白气泡。"].filter(Boolean).join("\n"),
    ].filter(Boolean).join("\n\n");
  return [project.settings.promptPrefix, body, project.settings.promptSuffix].filter(Boolean).join("\n\n");
}

export function stripPromptAffixes(project: ComicProject, prompt: string) {
  let body = prompt.trim();
  const prefix = project.settings.promptPrefix.trim();
  const suffix = project.settings.promptSuffix.trim();
  while (prefix && body.startsWith(prefix)) body = body.slice(prefix.length).trim();
  while (suffix && body.endsWith(suffix)) body = body.slice(0, -suffix.length).trim();
  return body;
}

function splitScriptBlocks(script: string, panelCount: number) {
  const text = script.replace(/\r/g, "").trim();
  const lines = text.split("\n");
  if (!text || !panelCount) return [];
  const numbered = /^\s*(\d+)(?:[-.、)）])?\s*[：:]\s*/;
  if (lines.some(line => numbered.test(line))) {
    const blocks: { index: number; lines: string[] }[] = [];
    for (const line of lines) {
      const match = line.match(numbered);
      if (match) blocks.push({ index: Number(match[1]) - 1, lines: [line.replace(numbered, "").trim()] });
      else if (blocks.length && line.trim()) blocks.at(-1)!.lines.push(line.trim());
    }
    return blocks.filter(item => item.index >= 0 && item.index < panelCount)
      .map(item => ({ index: item.index, text: item.lines.filter(Boolean).join("\n") }));
  }
  const paragraphs = text.split(/\n\s*\n+/).map(item => item.trim()).filter(Boolean);
  if (paragraphs.length > 1 && paragraphs.length <= panelCount) return paragraphs.map((value, index) => ({ index, text: value }));
  const compactLines = lines.map(item => item.trim()).filter(Boolean);
  if (compactLines.length <= panelCount) return compactLines.map((value, index) => ({ index, text: value }));
  const groupSize = Math.ceil(compactLines.length / panelCount);
  return Array.from({ length: panelCount }, (_, index) => ({ index, text: compactLines.slice(index * groupSize, (index + 1) * groupSize).join("\n") }));
}

function panelOrdinal(index: number) {
  return ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][index] ?? String(index + 1);
}

export function inspectPage(project: ComicProject, page: ComicPage) {
  const errors = [!page.script.trim() && "脚本为空", !page.description.trim() && "画面描述为空", !page.panels.length && "没有识别到分格", page.panels.some(item => !item.description.trim()) && "有分格描述为空"].filter(Boolean) as string[];
  const warnings = pageCharacters(project, page).filter(item => !item.reference).map(item => `角色缺少参考图：${item.name}`);
  if (!pageReferences(project, page).length) warnings.push("本页没有参考图，将使用文生图");
  return { errors, warnings, canGenerate: !!(page.prompt.trim() || page.script.trim() || page.description.trim() || page.panels.some(item => item.description.trim())) };
}

export const scriptSystemPrompt = "你是一名专业漫画编剧和分镜策划。根据用户主题、角色与创作要求输出分页脚本。只输出 JSON，格式为 {\"pages\":[{\"number\":1,\"script\":\"剧情、对白、旁白和动作\",\"description\":\"1-1：第一格描述\\n1-2：第二格描述\"}]}。页数必须符合要求，number 从1连续递增。对白使用角色名：对白格式。自动分格时每页独立决定1到12格；自定义分格时遵循数量或范围。保持角色身份、外观、服装、场景和剧情连续，不要输出额外说明。";

export function parseScript(text: string, count: number): ComicPage[] {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data: unknown;
  try { data = JSON.parse(trimmed); }
  catch { data = JSON.parse(trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1)); }
  if (!isRecord(data) || !Array.isArray(data.pages) || data.pages.length !== count) throw new Error(`AI 返回的页面数量不符，需要 ${count} 页，原始结果已保留`);
  return data.pages.map((item, index) => {
    if (!isRecord(item)) throw new Error("AI 返回的脚本格式不正确，原始结果已保留");
    const script = item.script ?? item.dialogue ?? "";
    const description = item.description ?? item.visual ?? item.scene ?? "";
    if (typeof script !== "string" || typeof description !== "string" || !script.trim() && !description.trim()) throw new Error("AI 返回的脚本格式不正确，原始结果已保留");
    return createComicPage(index + 1, script.trim(), description.trim());
  });
}

export function parseTable(text: string, offset = 0): ComicPage[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') { if (quoted && text[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted; }
    else if (!quoted && (char === "\t" || char === "\n" || char === "\r")) {
      row.push(cell); cell = "";
      if (char !== "\t") { if (char === "\r" && text[index + 1] === "\n") index++; rows.push(row); row = []; }
    } else cell += char;
  }
  row.push(cell); rows.push(row);
  const items = rows.filter(item => item.some(value => value.trim()));
  const header = (items[0] ?? []).map(item => item.replace(/\s/g, ""));
  const hasHeader = header.some(item => /^(页码|序号|脚本|台词|对白|画面描述|分镜|画面|描述)$/.test(item));
  const scriptIndex = hasHeader ? header.findIndex(item => /脚本|台词|对白/.test(item)) : 1;
  const descriptionIndex = hasHeader ? header.findIndex(item => /画面|分镜|描述/.test(item)) : 2;
  const numberIndex = hasHeader ? header.findIndex(item => /^(页码|序号)$/.test(item.trim())) : 0;
  if (quoted) throw new Error("表格引号未闭合，请重新复制完整单元格");
  return (hasHeader ? items.slice(1) : items).filter(item => item[scriptIndex]?.trim() || item[descriptionIndex]?.trim())
    .map((item, index) => {
      const number = Number(item[numberIndex]?.trim());
      return createComicPage(Number.isSafeInteger(number) && number > 0 ? number : offset + index + 1, item[scriptIndex] ?? "", item[descriptionIndex] ?? "");
    });
}
