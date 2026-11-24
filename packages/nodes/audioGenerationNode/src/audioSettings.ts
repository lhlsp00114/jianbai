import type { NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";

export const languageOptions = [
  { label: "中文", value: "zh-CN" },
  { label: "英文", value: "en" },
];
export const sampleRateOptions = [8000, 16000, 24000, 48000];
export const formatOptions = ["wav", "mp3", "pcm", "ogg_opus"];
export const audioContentFields = ["instructions", "lyrics", "infillLyrics", "voiceId", "sampleUrl", "previewText", "audioUrl", "audioUrls", "coverAudioUrl", "sourceAudioUrl", "clipId", "secondClipId", "continueClipId", "coverClipId", "personaName", "title", "negativeTags"];
export const audioQuickFields = ["operation", "voice", "personaId", "version", "mode", "speed", "responseFormat", "sampleRate", "bitrate", "duration", "vocalGender", "tier", "quality", "emotion", "emotionScale", "pitch", "soundEffects", "continueAt", "startS", "endS", "language", "audioDurationSec"];
export function audioTaskPresentation(model: NodeMediaModel | undefined, other: Record<string, unknown>) {
  if (!model?.audioOptions?.nativeParameters) return { action: "生成音频", placeholder: "描述您想要的音频效果或输入待朗读文本", prompt: true };
  if (model.modelId === "whisper-1") return { action: "转写文本", placeholder: "", prompt: false };
  if (model.modelId === "voice-clone") return { action: "克隆音色", placeholder: "", prompt: false };
  if (model.modelId === "voice-design") return { action: "设计音色", placeholder: "描述音色特点，例如年龄、音高、语气和口音", prompt: true };
  if (model.modelId === "music") {
    const operation = String(other.operation ?? "generate");
    const rule = model.rules?.find(item => item.field === "operation");
    const label = Array.isArray(rule?.options) ? rule.options.find(item => item.value === operation)?.label : undefined;
    return { action: typeof label === "string" ? label : "生成音乐", placeholder: operation === "lyrics" ? "描述歌词主题、语言和风格" : "描述音乐风格、氛围和主题", prompt: !["stems", "stems_all", "concat", "persona", "import"].includes(operation) };
  }
  return { action: "生成语音", placeholder: "输入想要朗读的文本…", prompt: true };
}
export function audioReferenceLimit(model: NodeMediaModel | undefined, other: Record<string, unknown>) {
  const limits = model?.audioOptions?.referenceLimits;
  return limits ? limits[String(other.operation ?? "default")] ?? limits.default ?? 0 : 1;
}

export function getAudioRules(model: NodeMediaModel | undefined, other: Record<string, unknown>) {
  const modeRule = model?.rules?.find(rule => rule.field === "mode");
  const instrumental = model?.audioOptions?.nativeParameters && model.modelId === "music" && other.mode === "instrumental"
    && Array.isArray(modeRule?.audioOperations) && modeRule.audioOperations.includes(other.operation ?? "generate");
  return (model?.rules ?? []).filter(rule => {
    if (model?.audioOptions?.nativeParameters && model.modelId === "music" && rule.field === "duration"
      && ((other.operation ?? "generate") !== "generate" || other.mode !== "instrumental" && !String(other.lyrics ?? "").trim())) return false;
    if (instrumental && ["lyrics", "vocalGender", "personaId"].includes(String(rule.field))) return false;
    const operations = rule.audioOperations;
    if (Array.isArray(operations) && !operations.includes(other.operation ?? "generate")) return false;
    const when = rule.audioWhen as Record<string, unknown[]> | undefined;
    return !when || Object.entries(when).every(([key, values]) => values.includes(other[key]));
  });
}

export function validateAudioParameters(model: NodeMediaModel, other: Record<string, unknown>, audioCount: number, prompt = "") {
  if (model.audioOptions?.nativeParameters && model.modelId === "whisper-1" && !audioCount) throw new Error("请先连接或添加需要转写的音频");
  const requiredFields: Record<string, string[]> = {
    extend: ["continueClipId"], cover: ["coverClipId"], upload_cover: ["coverAudioUrl"],
    stems: ["clipId"], stems_all: ["clipId"], concat: ["clipId"], persona: ["clipId", "personaName"],
    import: ["audioUrl"], upload_extend: ["audioUrl", "continueAt"], inspo: ["audioUrls"],
    sample: ["clipId", "startS", "endS"], add_vocals: ["clipId"], add_instrumental: ["clipId"],
    add_stem: ["clipId"], replace_section: ["clipId", "startS", "endS", "infillLyrics"], mashup: ["clipId", "secondClipId"],
  };
  const required = model.audioOptions?.nativeParameters && model.modelId === "music" ? requiredFields[String(other.operation)] ?? [] : [];
  for (const rule of getAudioRules(model, other)) {
    const rawValue = other[String(rule.field)];
    const value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
    if (audioCount > 0 && rule.field === "audioDurationSec") continue;
    if (audioCount > 0 && ["sampleUrl", "audioUrl", "audioUrls", "coverAudioUrl", "sourceAudioUrl"].includes(String(rule.field))) {
      if (value) throw new Error("已连接参考音频，请清空手填音频地址后再提交");
      continue;
    }
    if ((required.includes(String(rule.field)) || Array.isArray(rule.validate) && rule.validate.some(item => "required" in item && item.required)) && (value === undefined || value === null || value === "")) throw new Error(`请填写${rule.title}`);
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(rule.options) && !rule.options.some(item => item.value === value)) throw new Error(`请重新选择${rule.title}`);
    if (rule.type === "inputNumber" && (!Number.isFinite(Number(value)) || Number(value) < (rule.props?.min ?? -Infinity) || Number(value) > (rule.props?.max ?? Infinity))) throw new Error(`${rule.title}超出允许范围`);
  }
  if (!model.audioOptions?.nativeParameters) return;
  if (model.modelId === "gpt-4o-mini-tts" && !(Number(other.speed) >= 0.25 && Number(other.speed) <= 4)) throw new Error("语速须在 0.25–4 之间");
  if (model.modelId === "voice-design" && !/^[a-zA-Z][a-zA-Z0-9]{7,255}$/.test(String(other.voiceId ?? "").trim())) throw new Error("音色 ID 须以字母开头，包含 8–256 位字母或数字");
  if (model.modelId === "voice-clone" && !/^[a-zA-Z][a-zA-Z0-9_-]{7,255}$/.test(String(other.voiceId ?? "").trim())) throw new Error("音色 ID 须以字母开头，包含 8–256 位字母、数字、短横线或下划线");
  if (model.modelId !== "music") return;
  const operation = String(other.operation ?? "generate");
  const lyrics = typeof other.lyrics === "string" ? other.lyrics.trim() : "";
  if (["generate", "lyrics"].includes(operation) && !prompt.trim() && !lyrics) throw new Error("请输入音乐描述或歌词");
  if (operation === "upload_cover" && other.mode !== "instrumental" && !lyrics) throw new Error("上传歌曲翻唱需要填写歌词");
  if (other.personaId && (!lyrics || other.mode === "instrumental")) throw new Error("使用歌手音色时须选择歌曲模式并填写歌词");
  if (other.continueAt !== undefined && other.continueAt !== "" && (!Number.isFinite(Number(other.continueAt)) || Number(other.continueAt) < 1)) throw new Error("续写起点须为不小于 1 秒的有效数值");
  if ([other.startS, other.endS].some(value => value !== undefined && value !== "")
    && !([other.startS, other.endS].every(value => value !== undefined && value !== null && String(value).trim() !== "" && Number.isFinite(Number(value)))
      && Number(other.startS) >= 0 && Number(other.endS) > Number(other.startS))) throw new Error("请填写有效片段范围，终点须大于起点");
  if (operation === "mashup" && String(other.clipId).trim() === String(other.secondClipId).trim()) throw new Error("混搭须选择两首不同的作品");
}
