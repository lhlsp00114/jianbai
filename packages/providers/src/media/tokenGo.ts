const apiOrigin = "https://jianbai.token6688.com";
const flareId = "gt-image-2.5-flare";
const seedreamId = "doubao-seedream-5-5";
const imageRatios = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "5:4", "4:5", "21:9"];

type Context = ProviderContext<{ apiKey?: string }>;
type TaskType = "image" | "video" | "audio";
type ApiResponse = {
  task_id?: string;
  status?: string;
  is_final?: boolean;
  output_url?: string;
  url?: string;
  data?: { url?: string; original_url?: string; text?: string; source_id?: string; title?: string }[];
  texts?: unknown[];
  result?: Record<string, unknown>;
  text?: string;
  voice_id?: string;
  error?: unknown;
};

async function call(context: Context, path: string, body?: Record<string, unknown> | FormData) {
  const apiKey = context.config.apiKey?.trim();
  if (!apiKey) throw new Error("请在「设置 → 媒体模型 → 见白 AI」中填写 API 密钥");
  const headers: Record<string, string> = { Authorization: "Bearer " + apiKey };
  if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await context.tool.fetch(apiOrigin + path, {
    method: body ? "POST" : "GET",
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal: context.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
  });
  const result = await response.json().catch(() => null) as ApiResponse | null;
  return { response, result };
}

async function toReferenceUrl(context: Context, input: MediaInput) {
  if (input.type === "url") return input.url;
  const bytes = input.type === "binary" ? new Uint8Array(input.data) : Uint8Array.from(atob(input.data), char => char.charCodeAt(0));
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: input.mimeType }), input.name || "reference");
  const { response, result } = await call(context, "/v1/files", form);
  if (!response.ok || !result?.url) {
    throw new Error("见白 AI 素材上传失败：" + (result?.error ? context.tool.errorMessage(result.error) : `HTTP ${response.status}`));
  }
  return result.url;
}

async function references(context: Context, inputs: MediaInput[] = []) {
  const urls: string[] = [];
  for (const input of inputs) urls.push(await toReferenceUrl(context, input));
  return urls;
}

async function waitForTask(context: Context, taskId: string, mediaType: TaskType): Promise<MediaAsset[]> {
  const deadline = Date.now() + 20 * 60 * 1000;
  let queryFailures = 0;
  while (Date.now() < deadline) {
    const query = await call(context, "/v1/tasks/" + encodeURIComponent(taskId)).catch((error: unknown) => {
      context.signal?.throwIfAborted();
      const failure = error as { name?: string; message?: string; code?: string; cause?: { code?: string } } | null;
      if (failure?.name === "TimeoutError" || failure?.message === "fetch failed"
        || /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_|ConnectionClosed|ConnectionRefused|FailedToOpenSocket|TimeoutError)/.test(failure?.cause?.code ?? failure?.code ?? "")) return undefined;
      throw error;
    });
    context.signal?.throwIfAborted();
    const response = query?.response;
    const result = query?.result;
    if (response?.ok && result?.is_final) {
      if (result.status !== "completed") {
        throw Object.assign(new Error("见白 AI 生成失败：" + context.tool.errorMessage(result.error ?? result.status)), {
          code: "MEDIA_TASK_FAILED",
        });
      }
      if (mediaType === "audio") return audioTaskAssets(result);
      const imageResults = mediaType === "image" && Array.isArray(result.result?.images) ? result.result.images : [];
      const originals = imageResults.flatMap<MediaAsset>((item: unknown) => {
        if (!item || typeof item !== "object") return [];
        const asset = item as { original_url?: unknown; url?: unknown; layer?: Record<string, unknown> };
        const url = typeof asset.original_url === "string" && asset.original_url ? asset.original_url : asset.url;
        if (typeof url !== "string" || !url) return [];
        const layout = asset.layer;
        const imageLayer: ImageLayerLayout = {};
        if (layout && typeof layout === "object") {
          if (typeof layout.name === "string") imageLayer.name = layout.name.slice(0, 1000);
          if (typeof layout.z_index === "number" && Number.isFinite(layout.z_index)) imageLayer.zIndex = layout.z_index;
          if (typeof layout.transparent === "boolean") imageLayer.transparent = layout.transparent;
          const box = layout.box_normalized;
          if (Array.isArray(box) && box.length === 4 && box.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000)
            && box[2] > box[0] && box[3] > box[1]) imageLayer.box = box.map(value => value / 1000) as [number, number, number, number];
        }
        return [{ type: "url", mediaType, url, ...(Object.keys(imageLayer).length ? { imageLayer } : {}) }];
      });
      if (originals.length) return originals;
      const urls = (result.data ?? []).map(item => item.original_url || item.url).filter((url): url is string => Boolean(url));
      if (!urls.length && result.output_url) urls.push(result.output_url);
      if (!urls.length) throw new Error("见白 AI 任务已完成，但响应没有媒体地址：" + taskId);
      return urls.map(url => ({ type: "url", mediaType, url }));
    }
    if (response?.ok && result) {
      queryFailures = 0;
    } else {
      const transient = !response || response.ok || [408, 429, 500, 502, 503, 504].includes(response.status);
      if (!transient || ++queryFailures > 3) {
        const reason = result?.error ? context.tool.errorMessage(result.error)
          : response?.ok ? "响应格式无效" : response ? `HTTP ${response.status}` : "网络连接中断";
        throw new Error("见白 AI 任务查询失败：" + reason);
      }
    }
    await new Promise<void>((resolve, reject) => {
      const signal = context.signal;
      signal?.throwIfAborted();
      const abort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, 5000);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  throw new Error("见白 AI 任务仍在处理，可继续查询原任务：" + taskId);
}

async function generate(context: Context, model: string, mediaType: TaskType, params: Record<string, unknown>, operation?: string, attachments?: string[]) {
  const { response, result } = await call(context, "/api/v1/model-runtime/invoke", {
    model_id: model,
    modality: mediaType,
    operation,
    ...(attachments?.length ? { attachments } : {}),
    params,
    client_request_id: crypto.randomUUID(),
  });
  if (!response.ok || !result?.task_id) {
    throw new Error("见白 AI 提交失败：" + (result?.error ? context.tool.errorMessage(result.error) : `HTTP ${response.status}，未取得任务号`));
  }
  await context.saveTaskData?.({ taskId: result.task_id, mediaType });
  return waitForTask(context, result.task_id, mediaType);
}

function audioTaskAssets(result: ApiResponse): MediaAsset[] {
  const nested = result.result ?? {};
  const rawTexts = result.texts ?? (Array.isArray(nested.texts) ? nested.texts : []);
  const texts = rawTexts.map(value => typeof value === "string" ? value : JSON.stringify(value)).filter(Boolean);
  const text = result.text ?? (typeof nested.text === "string" ? nested.text : undefined);
  if (text) texts.push(text);
  const voiceId = result.voice_id ?? nested.voice_id;
  if (typeof voiceId === "string") texts.push(`音色 ID：${voiceId}`);
  if (Array.isArray(nested.words) || Array.isArray(nested.segments)) texts.push(JSON.stringify({ words: nested.words, segments: nested.segments }, null, 2));
  const data = result.data ?? (Array.isArray(nested.data) ? nested.data as NonNullable<ApiResponse["data"]> : []);
  for (const item of data) {
    if (item.text) texts.push(item.text);
    if (item.source_id) texts.push(`${item.title || "作品"}：${item.source_id}`);
  }
  const details = [...new Set(texts)].join("\n\n");
  const urls = data.map(item => item.original_url || item.url).filter((url): url is string => typeof url === "string" && !!url);
  if (!urls.length && result.output_url) urls.push(result.output_url);
  if (!urls.length && typeof nested.output_url === "string") urls.push(nested.output_url);
  if (urls.length) return urls.map(url => ({ type: "url", mediaType: "audio", url, ...(details ? { text: details } : {}) }));
  if (details) return [{ type: "text", mediaType: "audio", text: details }];
  throw new Error("音频任务已完成，但没有返回音频、文本或音色信息，请通过任务详情复查");
}

async function generateCatalogAudio(context: Context, request: AudioRequest) {
  const definition = audioDefinitions.find(model => model.id === request.model);
  if (!definition) throw new Error("未知的见白 AI 音频模型");
  const values = request.other ?? {};
  const operation = request.model === "music" ? String(values.operation ?? "generate") : undefined;
  const text = (request.text ?? request.prompt ?? "").trim();
  if (definition.maxPrompt && text.length > definition.maxPrompt) throw new Error(`输入文本最多支持 ${definition.maxPrompt} 个字符`);
  if (request.images?.length) throw new Error("当前音频模型不支持参考图片");
  const audioLimit = request.model === "music" ? ({ import: 1, upload_extend: 1, upload_cover: 1, inspo: 4, replace_section: 1 } as Record<string, number>)[operation!] ?? 0
    : ["voice-clone", "whisper-1"].includes(request.model) ? 1 : 0;
  if ((request.audios?.length ?? 0) > audioLimit) throw new Error(`当前音频任务最多支持 ${audioLimit} 段参考音频`);
  const params: Record<string, unknown> = {};
  for (const [key, parameter] of Object.entries(definition.parameters)) {
    if (key === "operation" || parameter.type === "upload" || key === "prompt") continue;
    if (parameter.operations && !parameter.operations.includes(operation ?? "")) continue;
    if (request.model === "music" && key === "duration" && values.mode !== "instrumental" && !String(values.lyrics ?? "").trim()) continue;
    if (request.model === "music" && values.mode === "instrumental" && ["lyrics", "persona_id", "vocal_gender"].includes(key) && definition.parameters.mode?.operations?.includes(operation ?? "")) continue;
    if (request.model === "doubao-tts-2.0" && key === "emotion_scale" && (values.emotion ?? "auto") === "auto") continue;
    const rawValue = values[parameter.field] ?? parameter.default;
    const value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
    if (value === undefined || value === null || value === "") continue;
    if (parameter.values && !parameter.values.includes(String(value))) throw new Error(`${parameter.title}选项无效，请重新选择`);
    if (parameter.type === "int" && (!Number.isInteger(Number(value)) || Number(value) < (parameter.min ?? -Infinity) || Number(value) > (parameter.max ?? Infinity))) throw new Error(`${parameter.title}超出允许范围`);
    if (parameter.type === "string" && typeof value !== "string") throw new Error(`${parameter.title}须为文本`);
    params[key] = parameter.type === "int" ? Number(value) : value;
  }
  if (operation && !definition.parameters.operation?.values?.includes(operation)) throw new Error("请选择有效的音频操作");
  if (request.model === "voice-design" || request.model === "music") params.prompt = text;
  else if (!["voice-clone", "whisper-1"].includes(request.model)) {
    if (!text) throw new Error("请输入待朗读文本");
    params.text = text;
  }
  const sourceKey = request.model === "voice-clone" ? "sample_url" : request.model === "whisper-1" ? "audios"
    : ({ import: "audio_url", upload_extend: "audio_url", upload_cover: "cover_audio_url", inspo: "audio_urls", replace_section: "source_audio_url" } as Record<string, string>)[operation ?? ""];
  const inputs = request.audios ?? [];
  if (sourceKey && inputs.length && params[sourceKey]) throw new Error("请在连接参考音频和填写音频地址之间选择一种，避免素材来源冲突");
  for (const input of inputs) {
    const metadata = input.metadata;
    const maxBytes = request.model === "voice-clone" ? 20 * 1024 * 1024 : request.model === "whisper-1" ? 25 * 1024 * 1024 : 100 * 1024 * 1024;
    if (metadata && (metadata.sizeBytes > maxBytes || request.model === "voice-clone" && metadata.sizeBytes >= maxBytes)) throw new Error("参考音频文件过大，请压缩后重试");
    if (["voice-clone", "whisper-1"].includes(request.model) && input.mimeType && !["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/m4a", "audio/x-m4a"].includes(input.mimeType)) throw new Error("此模型仅支持 MP3、WAV、M4A 参考音频");
    if (request.model === "voice-clone") {
      if (!metadata?.duration) throw new Error("无法读取克隆样本时长，请安装音频处理工具后重试");
      if (metadata.duration < 10 || metadata.duration > 300) throw new Error("克隆样本须为 10 秒至 5 分钟");
    }
  }
  if (request.model === "whisper-1" && inputs[0]?.metadata?.duration) params.audio_duration_sec = String(inputs[0].metadata.duration);
  if (request.model === "whisper-1" && (!Number.isFinite(Number(params.audio_duration_sec)) || !(Number(params.audio_duration_sec) > 0))) throw new Error("请填写有效的音频时长（秒）");
  if (request.model === "gpt-4o-mini-tts" && !(Number(params.speed) >= 0.25 && Number(params.speed) <= 4)) throw new Error("语速必须在 0.25 到 4 之间");
  if (request.model === "voice-design" && !/^[a-zA-Z][a-zA-Z0-9]{7,255}$/.test(String(params.voice_id ?? ""))) throw new Error("音色 ID 须以字母开头，包含 8–256 位字母或数字");
  if (request.model === "voice-clone" && !/^[a-zA-Z][a-zA-Z0-9_-]{7,255}$/.test(String(params.voice_id ?? ""))) throw new Error("音色 ID 须以字母开头，包含 8–256 位字母、数字、短横线或下划线");
  if (operation) {
    const required: Record<string, string[]> = { extend: ["continue_clip_id"], cover: ["cover_clip_id"], upload_cover: ["cover_audio_url"],
      stems: ["clip_id"], stems_all: ["clip_id"], concat: ["clip_id"], persona: ["clip_id", "persona_name"], import: ["audio_url"],
      upload_extend: ["audio_url", "continue_at"], inspo: ["audio_urls"], sample: ["clip_id", "start_s", "end_s"], add_vocals: ["clip_id"],
      add_instrumental: ["clip_id"], add_stem: ["clip_id"], replace_section: ["clip_id", "start_s", "end_s", "infill_lyrics"], mashup: ["clip_id", "second_clip_id"] };
    for (const key of required[operation] ?? []) if (!params[key] && !(key === sourceKey && inputs.length)) throw new Error(`请填写${definition.parameters[key]?.title ?? key}`);
    if (["generate", "lyrics"].includes(operation) && !text && !params.lyrics) throw new Error("请输入音乐描述或歌词");
    if (operation === "upload_cover" && params.mode !== "instrumental" && !params.lyrics) throw new Error("上传歌曲翻唱需要填写歌词");
    if (params.persona_id && (!params.lyrics || params.mode === "instrumental")) throw new Error("使用歌手音色时须选择歌曲模式并填写歌词");
    if (params.continue_at !== undefined && (!Number.isFinite(Number(params.continue_at)) || !(Number(params.continue_at) >= 1))) throw new Error("续写起点须为不小于 1 秒的有效数值");
    if ((params.start_s !== undefined || params.end_s !== undefined) && !(Number.isFinite(Number(params.start_s)) && Number.isFinite(Number(params.end_s)) && Number(params.start_s) >= 0 && Number(params.end_s) > Number(params.start_s))) throw new Error("请填写有效片段范围，终点须大于起点");
    if (params.persona_name && String(params.persona_name).length > 50) throw new Error("歌手音色名称不能超过 50 个字符");
    if (operation === "mashup" && params.clip_id === params.second_clip_id) throw new Error("混搭须选择两首不同的作品");
  }
  for (const [key, parameter] of Object.entries(definition.parameters)) {
    if (parameter.required && !params[key] && !(key === sourceKey && inputs.length)) throw new Error(`请填写${parameter.title}`);
  }
  for (const key of ["sample_url", "audio_url", "cover_audio_url", "source_audio_url"]) {
    if (params[key] && !/^https?:\/\//i.test(String(params[key]))) throw new Error("音频地址须为 HTTP 或 HTTPS 链接");
  }
  if (typeof params.audio_urls === "string") {
    const urls = params.audio_urls.split(/[,\n]/).map(url => url.trim()).filter(Boolean);
    if (!urls.length || urls.length > 4 || urls.some(url => !/^https?:\/\//i.test(url))) throw new Error("参考音频须为 1–4 个 HTTP 或 HTTPS 地址");
    params.audio_urls = urls;
  }
  // 所有参数先校验，再上传素材；上传或提交失败不自动重提付费任务。
  if (sourceKey && inputs.length) {
    const urls = await references(context, inputs);
    params[sourceKey] = ["audios", "audio_urls"].includes(sourceKey) ? urls : urls[0];
  }
  return generate(context, request.model, "audio", params, operation ?? (params.text ? "speech" : undefined));
}

type AudioParameter = { field: string; title: string; type: string; default?: string | number | boolean; required?: boolean; min?: number; max?: number; values?: string[]; operations?: string[]; };
type AudioDefinition = { id: string; label: string; maxPrompt?: number; parameters: Record<string, AudioParameter>; };
// 音频参数来自 TokenGo CLI 模型目录，2026-11-23。
const audioDefinitions: AudioDefinition[] = [
  {
    "id": "music",
    "label": "Suno 音乐生成",
    "maxPrompt": 5000,
    "parameters": {
      "audio_url": {
        "field": "audioUrl",
        "title": "源音频",
        "type": "string",
        "required": false,
        "operations": [
          "import",
          "upload_extend"
        ]
      },
      "audio_urls": {
        "field": "audioUrls",
        "title": "参考音频",
        "type": "string",
        "required": false,
        "operations": [
          "inspo"
        ]
      },
      "bitrate": {
        "field": "bitrate",
        "title": "码率",
        "type": "enum",
        "default": "256000",
        "required": false,
        "values": [
          "128000",
          "192000",
          "256000"
        ]
      },
      "clip_id": {
        "field": "clipId",
        "title": "源 clip",
        "type": "string",
        "required": false,
        "operations": [
          "stems",
          "stems_all",
          "concat",
          "persona",
          "sample",
          "add_vocals",
          "add_instrumental",
          "add_stem",
          "replace_section",
          "mashup"
        ]
      },
      "continue_at": {
        "field": "continueAt",
        "title": "续写起点(秒)",
        "type": "string",
        "required": false,
        "operations": [
          "extend",
          "upload_extend"
        ]
      },
      "continue_clip_id": {
        "field": "continueClipId",
        "title": "续写源 clip",
        "type": "string",
        "required": false,
        "operations": [
          "extend"
        ]
      },
      "cover_audio_url": {
        "field": "coverAudioUrl",
        "title": "翻唱源音频",
        "type": "string",
        "required": false,
        "operations": [
          "upload_cover"
        ]
      },
      "cover_clip_id": {
        "field": "coverClipId",
        "title": "翻唱源 clip",
        "type": "string",
        "required": false,
        "operations": [
          "cover"
        ]
      },
      "duration": {
        "field": "duration",
        "title": "目标时长 (秒)",
        "type": "int",
        "required": false,
        "min": 10,
        "max": 360,
        "operations": ["generate"]
      },
      "end_s": {
        "field": "endS",
        "title": "片段终点(秒)",
        "type": "string",
        "required": false,
        "operations": [
          "persona",
          "sample",
          "replace_section"
        ]
      },
      "infill_lyrics": {
        "field": "infillLyrics",
        "title": "替换段歌词",
        "type": "string",
        "required": false,
        "operations": [
          "replace_section"
        ]
      },
      "lyrics": {
        "field": "lyrics",
        "title": "歌词",
        "type": "string",
        "required": false,
        "operations": [
          "generate",
          "extend",
          "cover",
          "upload_cover",
          "upload_extend",
          "inspo",
          "sample",
          "add_vocals",
          "add_instrumental",
          "add_stem",
          "mashup"
        ]
      },
      "mode": {
        "field": "mode",
        "title": "模式",
        "type": "enum",
        "default": "song",
        "required": false,
        "values": [
          "song",
          "instrumental"
        ],
        "operations": [
          "generate",
          "extend",
          "cover",
          "upload_cover",
          "upload_extend",
          "inspo",
          "sample",
          "mashup"
        ]
      },
      "negative_tags": {
        "field": "negativeTags",
        "title": "排除风格",
        "type": "string",
        "required": false,
        "operations": [
          "generate",
          "extend",
          "cover",
          "upload_cover",
          "upload_extend",
          "inspo",
          "sample",
          "mashup"
        ]
      },
      "operation": {
        "field": "operation",
        "title": "操作",
        "type": "enum",
        "default": "generate",
        "required": false,
        "values": [
          "generate",
          "extend",
          "cover",
          "upload_cover",
          "lyrics",
          "stems",
          "stems_all",
          "concat",
          "persona",
          "import",
          "upload_extend",
          "inspo",
          "sample",
          "add_vocals",
          "add_instrumental",
          "add_stem",
          "replace_section",
          "mashup"
        ]
      },
      "persona_id": {
        "field": "personaId",
        "title": "歌手音色",
        "type": "string",
        "required": false,
        "operations": [
          "generate",
          "upload_cover",
          "extend",
          "cover"
        ]
      },
      "persona_name": {
        "field": "personaName",
        "title": "歌手音色名称",
        "type": "string",
        "required": false,
        "operations": [
          "persona"
        ]
      },
      "sample_rate": {
        "field": "sampleRate",
        "title": "采样率",
        "type": "enum",
        "default": "44100",
        "required": false,
        "values": [
          "44100",
          "48000"
        ]
      },
      "second_clip_id": {
        "field": "secondClipId",
        "title": "第二首源",
        "type": "string",
        "required": false,
        "operations": [
          "mashup"
        ]
      },
      "source_audio_url": {
        "field": "sourceAudioUrl",
        "title": "原曲地址",
        "type": "string",
        "required": false,
        "operations": [
          "replace_section"
        ]
      },
      "start_s": {
        "field": "startS",
        "title": "片段起点(秒)",
        "type": "string",
        "required": false,
        "operations": [
          "persona",
          "sample",
          "replace_section"
        ]
      },
      "style": {
        "field": "style",
        "title": "风格标签",
        "type": "string",
        "required": false,
        "operations": [
          "generate",
          "extend",
          "cover",
          "upload_cover",
          "upload_extend",
          "inspo",
          "sample",
          "add_vocals",
          "add_instrumental",
          "add_stem",
          "replace_section",
          "mashup"
        ]
      },
      "title": {
        "field": "title",
        "title": "歌曲标题",
        "type": "string",
        "required": false,
        "operations": [
          "generate",
          "extend",
          "cover",
          "upload_cover",
          "upload_extend",
          "inspo",
          "sample",
          "mashup"
        ]
      },
      "version": {
        "field": "version",
        "title": "模型版本",
        "type": "enum",
        "default": "chirp-v6",
        "required": false,
        "values": [
          "chirp-v6",
          "chirp-v6-wild",
          "chirp-v6-mini",
          "chirp-v5",
          "chirp-v4-5"
        ]
      },
      "vocal_gender": {
        "field": "vocalGender",
        "title": "演唱声线",
        "type": "enum",
        "default": "auto",
        "required": false,
        "values": [
          "auto",
          "m",
          "f"
        ],
        "operations": [
          "generate",
          "extend",
          "cover",
          "upload_cover",
          "upload_extend",
          "inspo",
          "sample",
          "mashup"
        ]
      }
    }
  },
  {
    "id": "gemini-2.5-pro-tts",
    "label": "GM-2.5 Pro TTS",
    "parameters": {
      "instructions": {
        "field": "instructions",
        "title": "风格指令",
        "type": "string",
        "required": false
      },
      "response_format": {
        "field": "responseFormat",
        "title": "输出格式",
        "type": "enum",
        "default": "wav",
        "required": false,
        "values": [
          "wav"
        ]
      },
      "voice": {
        "field": "voice",
        "title": "音色",
        "type": "enum",
        "default": "Zephyr",
        "required": true,
        "values": [
          "Zephyr",
          "Puck",
          "Charon",
          "Kore",
          "Fenrir",
          "Leda",
          "Orus",
          "Aoede",
          "Callirrhoe",
          "Autonoe",
          "Enceladus",
          "Iapetus",
          "Umbriel",
          "Algieba",
          "Despina",
          "Erinome",
          "Algenib",
          "Rasalgethi",
          "Laomedeia",
          "Achernar",
          "Alnilam",
          "Schedar",
          "Gacrux",
          "Pulcherrima",
          "Achird",
          "Zubenelgenubi",
          "Vindemiatrix",
          "Sadachbia",
          "Sadaltager",
          "Sulafat"
        ]
      }
    }
  },
  {
    "id": "gpt-4o-mini-tts",
    "label": "GT-4o Mini TTS",
    "maxPrompt": 2100,
    "parameters": {
      "instructions": {
        "field": "instructions",
        "title": "风格指令",
        "type": "string",
        "required": false
      },
      "response_format": {
        "field": "responseFormat",
        "title": "输出格式",
        "type": "enum",
        "default": "mp3",
        "required": false,
        "values": [
          "mp3",
          "opus",
          "aac",
          "flac",
          "wav",
          "pcm"
        ]
      },
      "speed": {
        "field": "speed",
        "title": "语速",
        "type": "string",
        "default": "1.0",
        "required": false
      },
      "voice": {
        "field": "voice",
        "title": "音色",
        "type": "enum",
        "default": "alloy",
        "required": true,
        "values": [
          "alloy",
          "echo",
          "fable",
          "onyx",
          "nova",
          "shimmer"
        ]
      }
    }
  },
  {
    "id": "speech-2.8",
    "label": "海螺 语音克隆 2.8",
    "maxPrompt": 10000,
    "parameters": {
      "emotion": {
        "field": "emotion",
        "title": "情绪",
        "type": "enum",
        "default": "auto",
        "required": false,
        "values": [
          "auto",
          "happy",
          "sad",
          "angry",
          "fearful",
          "surprised",
          "calm"
        ]
      },
      "pitch": {
        "field": "pitch",
        "title": "变声",
        "type": "enum",
        "default": "0",
        "required": false,
        "values": [
          "-6",
          "-3",
          "0",
          "3",
          "6"
        ]
      },
      "sound_effects": {
        "field": "soundEffects",
        "title": "音效",
        "type": "enum",
        "default": "none",
        "required": false,
        "values": [
          "none",
          "spacious_echo",
          "auditorium_echo",
          "lofi_telephone",
          "robotic"
        ]
      },
      "speed": {
        "field": "speed",
        "title": "语速",
        "type": "enum",
        "default": "1",
        "required": false,
        "values": [
          "0.5",
          "0.75",
          "1",
          "1.25",
          "1.5",
          "2"
        ]
      },
      "tier": {
        "field": "tier",
        "title": "档位",
        "type": "enum",
        "default": "hd",
        "required": false,
        "values": [
          "hd",
          "turbo"
        ]
      },
      "version": {
        "field": "version",
        "title": "版本",
        "type": "enum",
        "default": "2.8",
        "required": false,
        "values": [
          "2.8",
          "2.6"
        ]
      },
      "voice": {
        "field": "voice",
        "title": "音色",
        "type": "string",
        "required": true
      }
    }
  },
  {
    "id": "voice-design",
    "label": "海螺 音色设计",
    "parameters": {
      "preview_text": {
        "field": "previewText",
        "title": "试听文本",
        "type": "string",
        "required": true
      },
      "prompt": {
        "field": "prompt",
        "title": "音色描述词",
        "type": "string",
        "required": true
      },
      "voice_id": {
        "field": "voiceId",
        "title": "音色 ID",
        "type": "string",
        "required": true
      }
    }
  },
  {
    "id": "voice-clone",
    "label": "海螺 音色克隆",
    "parameters": {
      "sample_url": {
        "field": "sampleUrl",
        "title": "音频样本",
        "type": "string",
        "required": true
      },
      "voice_id": {
        "field": "voiceId",
        "title": "音色 ID",
        "type": "string",
        "required": true
      }
    }
  },
  {
    "id": "doubao-tts-2.0",
    "label": "豆包 语音合成 2.0",
    "parameters": {
      "emotion": {
        "field": "emotion",
        "title": "情绪",
        "type": "enum",
        "default": "auto",
        "required": false,
        "values": [
          "auto",
          "happy",
          "sad",
          "angry",
          "fearful",
          "surprised",
          "calm"
        ]
      },
      "emotion_scale": {
        "field": "emotionScale",
        "title": "情绪强度",
        "type": "enum",
        "default": "4",
        "required": false,
        "values": [
          "1",
          "2",
          "3",
          "4",
          "5"
        ]
      },
      "response_format": {
        "field": "responseFormat",
        "title": "输出格式",
        "type": "enum",
        "default": "mp3",
        "required": false,
        "values": [
          "mp3",
          "wav"
        ]
      },
      "speed": {
        "field": "speed",
        "title": "语速",
        "type": "enum",
        "default": "1",
        "required": false,
        "values": [
          "0.5",
          "0.75",
          "1",
          "1.25",
          "1.5",
          "2"
        ]
      },
      "voice": {
        "field": "voice",
        "title": "音色",
        "type": "string",
        "required": true
      }
    }
  },
  {
    "id": "whisper-1",
    "label": "GT 语音转文字",
    "parameters": {
      "audio_duration_sec": {
        "field": "audioDurationSec",
        "title": "音频时长 (秒)",
        "type": "string",
        "required": true
      },
      "audios": {
        "field": "audios",
        "title": "音频",
        "type": "upload",
        "required": true
      },
      "language": {
        "field": "language",
        "title": "语言",
        "type": "string",
        "required": false
      }
    }
  },
  {
    "id": "gemini-3.8-flash-tts",
    "label": "GM-3.8 Flash TTS",
    "parameters": {
      "instructions": {
        "field": "instructions",
        "title": "风格指令",
        "type": "string",
        "required": false
      },
      "quality": {
        "field": "quality",
        "title": "档位",
        "type": "enum",
        "default": "lite",
        "required": false,
        "values": [
          "standard",
          "lite"
        ]
      },
      "response_format": {
        "field": "responseFormat",
        "title": "输出格式",
        "type": "enum",
        "default": "wav",
        "required": false,
        "values": [
          "wav"
        ]
      },
      "voice": {
        "field": "voice",
        "title": "音色",
        "type": "enum",
        "default": "Zephyr",
        "required": true,
        "values": [
          "Zephyr",
          "Puck",
          "Charon",
          "Kore",
          "Fenrir",
          "Leda",
          "Orus",
          "Aoede",
          "Callirrhoe",
          "Autonoe",
          "Enceladus",
          "Iapetus",
          "Umbriel",
          "Algieba",
          "Despina",
          "Erinome",
          "Algenib",
          "Rasalgethi",
          "Laomedeia",
          "Achernar",
          "Alnilam",
          "Schedar",
          "Gacrux",
          "Pulcherrima",
          "Achird",
          "Zubenelgenubi",
          "Vindemiatrix",
          "Sadachbia",
          "Sadaltager",
          "Sulafat"
        ]
      }
    }
  }
];

type ImageParameter = {
  title: string;
  type: string;
  default?: string | number | boolean;
  values?: string[];
  labels?: string[];
  min?: number;
  max?: number;
  when?: Record<string, string[]>;
  hint?: string;
};
type ImageDefinition = {
  id: string;
  label: string;
  ratios: string[];
  sizes: string[];
  ratioKey: string;
  sizeKey?: string;
  sizeValues?: string[];
  pixelSizes?: Record<string, string>;
  modes: string[];
  maxImages: number;
  maxImageBytes?: number;
  maxPrompt?: number;
  parameters: Record<string, ImageParameter>;
};

// 来自见白 CLI 模型目录；API 参数名及取值保留服务端定义。
const additionalImageDefinitions: ImageDefinition[] = [
  {"id":"doubao-seedream-5-0-pro","label":"Seedream 5.0 Pro","ratios":["auto","1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"],"sizes":["1K","2K"],"ratioKey":"size","sizeKey":"resolution","sizeValues":["1k","2k"],"modes":["text-to-image","image-edit","multi-reference"],"maxImages":10,"maxImageBytes":10485760,"maxPrompt":100000,"parameters":{}},
  {"id":"doubao-seedream-5-0","label":"Seedream 5.0","ratios":["16:9","9:16","1:1","21:9","4:3","3:4","3:2","2:3","5:4","4:5","2:1","1:2","3:1","1:3","9:21"],"sizes":["2K","4K"],"ratioKey":"size","sizeKey":"resolution","sizeValues":["2k","4k"],"modes":["text-to-image","image-edit","multi-reference"],"maxImages":10,"maxImageBytes":10485760,"maxPrompt":30000,"parameters":{}},
  {"id":"doubao-seedream-4-5","label":"Seedream 4.5","ratios":["1:1","3:2","2:3","4:3","3:4","5:4","4:5","16:9","9:16","2:1","1:2","21:9","3:1","1:3","9:21"],"sizes":["2K","4K"],"ratioKey":"size","sizeKey":"resolution","sizeValues":["2k","4k"],"modes":["text-to-image","image-edit","multi-reference"],"maxImages":4,"maxImageBytes":10485760,"maxPrompt":30000,"parameters":{}},
  {"id":"gt-image-2.6-sunburst","label":"GT Image 2.6 Sunb","ratios":["auto","1:1","3:2","2:3","4:3","3:4","5:4","4:5","16:9","9:16","21:9","9:21"],"sizes":["1K","2K","4K"],"ratioKey":"aspect_ratio","sizeKey":"resolution","sizeValues":["1K","2K","4K"],"modes":["text-to-image","image-edit","multi-reference"],"maxImages":16,"maxImageBytes":26214400,"maxPrompt":32000,"parameters":{"frame_count":{"title":"动图帧数","type":"int","default":9,"min":2,"max":16,"when":{"output_format":["gif"]}},"frame_duration_ms":{"title":"每帧时长（毫秒）","type":"int","default":200,"min":20,"max":655350,"when":{"output_format":["gif"]}},"moderation":{"title":"内容审核","type":"enum","default":"low","values":["low","auto"],"labels":["宽松","标准"]},"output_format":{"title":"输出格式","type":"enum","default":"jpeg","values":["png","jpeg","gif","svg"],"labels":["PNG","JPEG","GIF 动图","SVG 矢量图"]},"quality":{"title":"图片质量","type":"enum","default":"low","values":["low","medium","high","xhigh","max"],"labels":["低","中","高","超高","极致"],"when":{"output_format":["png","jpeg"]}}}},
  {"id":"gt-image-2.6-flare","label":"GT Image 2.6 Flare","ratios":["auto","1:1","3:2","2:3","4:3","3:4","5:4","4:5","16:9","9:16","21:9","9:21"],"sizes":["1K","2K","4K"],"ratioKey":"aspect_ratio","sizeKey":"resolution","sizeValues":["1K","2K","4K"],"modes":["text-to-image","image-edit","multi-reference"],"maxImages":16,"maxImageBytes":26214400,"maxPrompt":32000,"parameters":{"frame_count":{"title":"动图帧数","type":"int","default":9,"min":2,"max":16,"when":{"output_format":["gif"]}},"frame_duration_ms":{"title":"每帧时长（毫秒）","type":"int","default":200,"min":20,"max":655350,"when":{"output_format":["gif"]}},"moderation":{"title":"内容审核","type":"enum","default":"low","values":["low","auto"],"labels":["宽松","标准"]},"output_format":{"title":"输出格式","type":"enum","default":"jpeg","values":["png","jpeg","gif","svg"],"labels":["PNG","JPEG","GIF 动图","SVG 矢量图"]},"quality":{"title":"图片质量","type":"enum","default":"low","values":["low","medium","high","xhigh","max"],"labels":["低","中","高","超高","极致"],"when":{"output_format":["png","jpeg"]}}}},
  {"id":"gt-image-2.5-sunburst","label":"GT Image 2.5 Sunb","ratios":["auto","1:1","3:2","2:3","4:3","3:4","5:4","4:5","16:9","9:16","21:9","9:21"],"sizes":["1K","2K","4K"],"ratioKey":"aspect_ratio","sizeKey":"resolution","sizeValues":["1K","2K","4K"],"modes":["text-to-image","image-edit","multi-reference"],"maxImages":16,"maxImageBytes":26214400,"maxPrompt":32000,"parameters":{"background":{"title":"背景","type":"enum","default":"opaque","values":["opaque","transparent"],"labels":["实色底","透明底"]},"moderation":{"title":"内容审核","type":"enum","default":"low","values":["low","auto"],"labels":["宽松","标准"]},"output_compression":{"title":"输出压缩率","type":"int","default":100,"min":0,"max":100},"output_format":{"title":"输出格式","type":"enum","default":"jpeg","values":["png","jpeg"],"labels":["PNG","JPEG"]},"quality":{"title":"图片质量","type":"enum","default":"low","values":["low","medium","high","xhigh","max"],"labels":["低","中","高","超高","极致"]}}},
  {"id":"gt-image-2","label":"GT Image 2","ratios":["auto","1:1","3:2","2:3","4:3","3:4","5:4","4:5","16:9","9:16","21:9","9:21"],"sizes":["1K","2K","4K"],"ratioKey":"aspect_ratio","sizeKey":"resolution","sizeValues":["1K","2K","4K"],"modes":["text-to-image","image-edit","multi-reference"],"maxImages":16,"maxImageBytes":26214400,"maxPrompt":50000,"parameters":{"output_format":{"title":"输出格式","type":"enum","default":"jpeg","values":["png","jpeg"],"labels":["PNG","JPEG"]},"quality":{"title":"图片质量","type":"enum","default":"high","values":["auto","high","medium","low"],"labels":["自适应","高","中","低"]}}},
  {"id":"gt-image-2-official","label":"GT Image 2 Official","ratios":["auto","1:1","3:2","2:3","4:3","3:4","5:4","4:5","16:9","9:16","2:1","1:2","3:1","1:3","21:9","9:21"],"sizes":["1K","2K","4K"],"ratioKey":"size","sizeKey":"resolution","sizeValues":["1k","2k","4k"],"modes":["text-to-image","image-edit","multi-reference"],"maxImages":16,"maxImageBytes":26214400,"maxPrompt":32000,"parameters":{"output_format":{"title":"输出格式","type":"enum","default":"png","values":["png","jpeg"],"labels":["PNG","JPEG"]},"quality":{"title":"质量","type":"enum","default":"low","values":["low","medium","high"],"labels":["低","中","高"]}}},
  {"id":"gt-image-2-c","label":"GT Image 2 C","ratios":["1:1","16:9","9:16"],"sizes":["1K"],"ratioKey":"size","pixelSizes":{"1:1":"1024x1024","16:9":"1792x1024","9:16":"1024x1792"},"modes":["text-to-image","image-edit"],"maxImages":1,"maxImageBytes":26214400,"maxPrompt":32000,"parameters":{"output_format":{"title":"输出格式","type":"enum","default":"jpeg","values":["png","jpeg"],"labels":["PNG","JPEG"]},"quality":{"title":"图片质量","type":"enum","default":"high","values":["auto","high","medium","low"],"labels":["自适应","高","中","低"]}}},
  {"id":"mj-img","label":"MJ","ratios":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","4:5","5:4","21:9"],"sizes":["默认"],"ratioKey":"aspect_ratio","modes":["text-to-image","multi-reference"],"maxImages":4,"maxPrompt":1024,"parameters":{"bot_type":{"title":"模型引擎","type":"enum","default":"MID_JOURNEY","values":["MID_JOURNEY","NIJI_JOURNEY"],"labels":["MJ 写实模式","Niji 动漫模式"]},"chaos":{"title":"混乱度","type":"enum","default":"0","values":["0","5","10","15","20","25","30","35","40","45","50","55","60","65","70","75","80","85","90","95","100"],"labels":["0 稳定","5 轻微变化","10 轻微变化","15 轻微变化","20 轻微变化","25 轻微变化","30 中等变化","35 中等变化","40 中等变化","45 中等变化","50 中等变化","55 大变化","60 大变化","65 大变化","70 大变化","75 大变化","80 大变化","85 大变化","90 大变化","95 大变化","100 最大变化"],"min":0,"max":100},"cref":{"title":"角色参考图链接","type":"string","when":{"version":["6","6.1","7"]},"hint":"让生成的人物保持成同一个角色（换场景/换动作不换脸）。填公网可访问的图片地址，可直接用本站已生成图片的链接。仅 v6 / v6.1 可用（v7 起 MJ 官方已移除该参数）"},"cw":{"title":"角色相似度","type":"enum","default":"100","values":["0","50","100"],"labels":["0 只保留脸","50 中等","100 完整保留"],"when":{"version":["6","6.1","7"]},"hint":"配合角色参考图使用：0 = 只保留脸，100 = 连发型和服装一起保留。仅 v6 / v6.1 可用"},"draft":{"title":"草图模式","type":"bool","default":false,"when":{"version":["7","8.1"]}},"extra":{"title":"高级参数","type":"string","hint":"给熟悉 MJ 的用户：直接填官方参数原样追加，如 --sameseed。⚠ 三条硬规则：① 必须双横线（--sameseed 对，-sameseed 错，会被 MJ 直接拒）；② 上面已有独立字段的参数（比例/版本/风格/种子等）请用对应字段，不要在这里或 prompt 里重复写，重复会冲突；③ 不允许改变出图张数或任务类型的参数（--repeat/--video）；速度档（--fast/--turbo/--relax）会被自动去掉，不影响出图内容"},"hd":{"title":"HD 高清","type":"bool","default":false,"when":{"version":["","8.1","8.2"]}},"iw":{"title":"参考图权重","type":"enum","default":"2","values":["0.5","1","2","3"],"labels":["0.5 自由","1 较弱","2 贴近","3 最贴近"]},"mode":{"title":"生成模式","type":"enum","default":"text-to-image","values":["text-to-image","multi-reference"],"labels":["文生图","多图融合"]},"negative_prompt":{"title":"排除内容","type":"string"},"output_format":{"title":"输出格式","type":"enum","default":"jpeg","values":["png","jpeg"],"labels":["PNG","JPEG"]},"quality":{"title":"质量","type":"enum","default":"1","values":["0.25","0.5","1","2"],"labels":["0.25 快速","0.5 标准","1 高清","2 超清"]},"seed":{"title":"随机种子","type":"int","min":0,"max":4294967295},"sref":{"title":"风格参考图链接","type":"string"},"stop":{"title":"提前停止","type":"enum","default":"100","values":["50","80","100"],"labels":["50% 很朦胧","80% 略柔化","100% 不停止"],"when":{"version":["5.1","5.2","6","6.1"]}},"style":{"title":"渲染模式","type":"enum","values":["","raw"],"labels":["默认","Raw 原始"]},"stylize":{"title":"风格化强度","type":"enum","default":"100","values":["0","50","100","150","200","250","300","350","400","450","500","550","600","650","700","750","800","850","900","950","1000"],"labels":["0 写实","50 轻微","100 默认","150 轻微","200 轻微","250 中等","300 中等","350 中等","400 中等","450 中等","500 强烈","550 强烈","600 强烈","650 强烈","700 强烈","750 极强","800 极强","850 极强","900 极强","950 极强","1000 极致"],"min":0,"max":1000},"sw":{"title":"风格强度","type":"enum","default":"100","values":["0","100","500","1000"],"labels":["0 几乎不用","100 默认","500 强烈","1000 最强"]},"tile":{"title":"无缝平铺","type":"bool","default":false},"version":{"title":"模型版本","type":"enum","values":["","8.2","8.1","7","6.1","6","5.2","5.1"],"labels":["默认","v8.2 最新","v8.1","v7 / Niji 7","v6.1","v6 / Niji 6","v5.2","v5.1"],"hint":"MJ 引擎版本；不选则跟随账号默认版本。⚠ Niji 动漫模式只接受 5 / 6 / 7 —— 选 6.1 或 8.x 会直接提交失败（不扣费）"},"weird":{"title":"怪异度","type":"enum","default":"0","values":["0","250","1000","3000"],"labels":["0 正常","250 轻微","1000 明显","3000 极致"]}}},
  {"id":"gm-nb-2.1-image","label":"GM NB 2.1 Image","ratios":["1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9","1:4","4:1","8:1"],"sizes":["1K","2K","4K"],"ratioKey":"aspect_ratio","sizeKey":"size","sizeValues":["1K","2K","4K"],"modes":["text-to-image","image-edit","multi-reference"],"maxImages":14,"maxImageBytes":10485760,"parameters":{}},
  {"id":"gm-3.1-flash-image","label":"GM-3.1 Flash Image","ratios":["auto","1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9","1:4","4:1","1:8","8:1"],"sizes":["0.5K","1K","2K","4K"],"ratioKey":"aspect_ratio","sizeKey":"size","sizeValues":["0.5K","1K","2K","4K"],"modes":["text-to-image","image-edit","multi-reference"],"maxImages":14,"maxImageBytes":10485760,"maxPrompt":30000,"parameters":{"thinking_level":{"title":"思考等级","type":"enum","default":"minimal","values":["minimal","high"],"labels":["快速","深度"]}}},
  {"id":"gm-3-pro-image","label":"GM-3 Pro Image","ratios":["auto","1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9"],"sizes":["1K","2K","4K"],"ratioKey":"aspect_ratio","sizeKey":"size","sizeValues":["1K","2K","4K"],"modes":["text-to-image","image-edit","multi-reference"],"maxImages":14,"maxImageBytes":10485760,"maxPrompt":30000,"parameters":{}},
  {"id":"gm-3.1-flash-lite-image","label":"GM-3.1 Flash Lite Image","ratios":["1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9"],"sizes":["1K"],"ratioKey":"aspect_ratio","sizeKey":"size","sizeValues":["1K"],"modes":["text-to-image","image-edit","multi-reference"],"maxImages":14,"maxImageBytes":10485760,"maxPrompt":30000,"parameters":{}},
  {"id":"minimax-h3-image","label":"MiniMax H3 Image","ratios":["auto","1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9","3:1","1:3"],"sizes":["1K","2K","4K"],"ratioKey":"aspect_ratio","sizeKey":"size","sizeValues":["1K","2K","4K"],"modes":["text-to-image","image-edit","multi-reference"],"maxImages":16,"maxImageBytes":67108864,"maxPrompt":32000,"parameters":{}},
  {"id":"wan2.7-image","label":"Wan 2.7 Image","ratios":["auto","1:1","3:2","2:3","4:3","3:4","5:4","4:5","16:9","9:16","2:1","1:2","3:1","1:3","21:9","9:21"],"sizes":["1K","2K"],"ratioKey":"size","sizeKey":"resolution","sizeValues":["1k","2k"],"modes":["text-to-image","image-edit","multi-reference"],"maxImages":9,"maxImageBytes":20971520,"maxPrompt":5000,"parameters":{"quality":{"title":"质量档位","type":"enum","default":"standard","values":["standard","pro"],"labels":["标准","专业"]},"seed":{"title":"随机种子","type":"int","min":0,"max":2147483647}}},
  {"id":"mu-image","label":"MU Image","ratios":["1:1","16:9","9:16","4:3","3:4","3:2","2:3"],"sizes":["2K"],"ratioKey":"size","sizeKey":"resolution","sizeValues":["2K"],"modes":["text-to-image","image-edit","multi-reference"],"maxImages":9,"maxImageBytes":10485760,"parameters":{"output_format":{"title":"输出格式","type":"enum","default":"jpeg","values":["png","jpeg"],"labels":["PNG","JPEG"]}}},
  {"id":"gk-imagine-image-2.0","label":"GK Imagine 2.0 图像","ratios":["1:1","16:9","9:16","3:2","2:3","4:3","3:4"],"sizes":["默认"],"ratioKey":"size","modes":["text-to-image","image-edit","multi-reference"],"maxImages":5,"maxImageBytes":5242880,"maxPrompt":20000,"parameters":{}},
  {"id":"gk-imagine-image","label":"GK Imagine 1.0 Image","ratios":["1:1","16:9","9:16","3:2","2:3","4:3","3:4"],"sizes":["默认"],"ratioKey":"size","modes":["text-to-image","image-edit","multi-reference"],"maxImages":7,"maxImageBytes":5242880,"maxPrompt":16000,"parameters":{}},
];

function imageField(parameter: string) {
  return parameter.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

async function generateAdditionalImage(context: Context, request: ImageRequest, definition: ImageDefinition) {
  if (request.mask) throw new Error("当前见白 AI 图片适配暂未开放蒙版编辑");
  const imageCount = request.images?.length ?? 0;
  if (imageCount > definition.maxImages) throw new Error(`${definition.label} 最多支持 ${definition.maxImages} 张参考图`);
  if (definition.maxPrompt && request.prompt.length > definition.maxPrompt) throw new Error(`提示词最多支持 ${definition.maxPrompt} 个字符`);
  for (const input of request.images ?? []) {
    const bytes = input.type === "binary" ? input.data.byteLength : input.type === "base64" ? atob(input.data).length : 0;
    if (definition.maxImageBytes && bytes > definition.maxImageBytes) throw new Error(`单张参考图不能超过 ${definition.maxImageBytes / 1024 / 1024} MB`);
  }
  const values: Record<string, unknown> = {};
  for (const [parameter, field] of Object.entries(definition.parameters)) {
    values[parameter] = request.other?.[imageField(parameter)] ?? field.default;
  }
  if (request.outputFormat !== undefined) values.output_format = request.outputFormat;
  if (request.quality !== undefined) values.quality = request.quality;
  if (values.background === "transparent" && definition.parameters.output_format?.values?.includes("png")) values.output_format = "png";
  const params: Record<string, unknown> = { prompt: request.prompt, count: request.n ?? 1 };
  if (!Number.isInteger(params.count) || Number(params.count) < 1 || Number(params.count) > 50) throw new Error("图片数量必须在 1 到 50 之间");
  for (const [parameter, field] of Object.entries(definition.parameters)) {
    const value = values[parameter];
    if (field.when && !Object.entries(field.when).every(([key, allowed]) => allowed.includes(String(values[key] ?? "")))) continue;
    if (value === undefined || value === null || value === "") continue;
    if (field.values && !field.values.includes(String(value))) throw new Error(`${field.title}选项无效`);
    if (field.type === "int" && (typeof value !== "number" || !Number.isInteger(value) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))) throw new Error(`${field.title}超出允许范围`);
    if (field.type === "bool" && typeof value !== "boolean") throw new Error(`${field.title}必须是布尔值`);
    if (field.type === "string" && typeof value !== "string") throw new Error(`${field.title}必须是文本`);
    params[parameter] = value;
  }
  const ratio = request.ratio ?? definition.ratios[0]!;
  const size = request.size ?? definition.sizes[0]!;
  if (values.output_format !== "gif" && values.output_format !== "svg") {
    if (!definition.ratios.includes(ratio)) throw new Error("当前模型不支持此比例");
    if (!definition.sizes.includes(size)) throw new Error("当前模型不支持此分辨率");
    params[definition.ratioKey] = definition.pixelSizes?.[ratio] ?? ratio;
    if (definition.sizeKey) params[definition.sizeKey] = definition.sizeValues?.[definition.sizes.indexOf(size)];
  }
  if (definition.id === "mj-img") {
    if (values.bot_type === "NIJI_JOURNEY" && values.version && !["6", "7"].includes(String(values.version))) throw new Error("Niji 动漫引擎请选择默认、6 或 7 版本");
    if (params.mode === "multi-reference" && imageCount < 2) throw new Error("MJ 多图融合至少需要两张参考图");
    if (values.bot_type === "NIJI_JOURNEY" && values.version === "7") delete params.quality;
    if (!["6", "6.1"].includes(String(values.version))) { delete params.cref; delete params.cw; }
  }
  params.mode ??= imageCount > 1 ? "multi-reference" : imageCount ? "image-edit" : "text-to-image";
  if (!definition.modes.includes(String(params.mode))) throw new Error("当前模型不支持此生成模式");
  params.images = await references(context, request.images);
  return generate(context, definition.id, "image", params, definition.id === "mj-img" || !imageCount ? "generate" : "edit");
}

type VideoParameter = {
  max_total_duration_sec?: number;
  min_duration_sec?: number;
  min_duration_sec_by_mode?: Record<string, number>;
  min_fps?: number;
  max_fps?: number;
  min_pixels?: number;
  max_pixels?: number;
  max_combined_items?: number;
  combined_duration_budget?: boolean;
  duration_tolerance_sec?: number;
  title: string;
  type: string;
  default?: unknown;
  enum?: string[];
  min?: number;
  max?: number;
  required?: boolean;
  available_when?: Record<string, string[]>;
  enum_values_by_quality?: Record<string, string[]>;
  options?: { value: string; available?: boolean; available_when?: Record<string, string[]> }[];
  max_items?: number;
  max_items_by_mode?: Record<string, number>;
  max_items_by_quality?: Record<string, number>;
  max_bytes?: number;
  requires_visual_reference?: boolean;
  min_edge_px?: number;
  max_edge_px?: number;
  aspect_min?: number;
  aspect_max?: number;
};
type VideoDefinition = { id: string; label: string; maxPrompt?: number; parameters: Record<string, VideoParameter> };
// 见白 CLI 视频目录快照；保留 API 原始字段及条件，提交前校验。
const videoDefinitions: VideoDefinition[] = [
  {"id":"seedance-2-5-special","label":"Seedance 2.5 · 特价按次","maxPrompt":20000,"parameters":{"aspect_ratio":{"title":"视频比例","type":"enum","default":"9:16","enum":["9:16","16:9","1:1","4:3","3:4","21:9"],"required":false,"options":[{"value":"9:16"},{"value":"16:9"},{"value":"1:1"},{"value":"4:3","available_when":{"mode":["reference","text-to-video"]}},{"value":"3:4","available_when":{"mode":["reference","text-to-video"]}},{"value":"21:9"}]},"audios":{"title":"参考音频","type":"upload","required":false,"max_items":10,"max_items_by_mode":{"first-frame":0,"reference":10,"text-to-video":0},"max_items_by_quality":{"flash":5,"标准":10},"max_bytes":15728640,"requires_visual_reference":true,"max_total_duration_sec":15,"min_duration_sec":2,"max_combined_items":50},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"视频时长","type":"enum","default":"30","enum":["30"],"required":false,"options":[{"value":"30"}]},"images":{"title":"参考图片","type":"upload","required":false,"max_items":30,"max_items_by_mode":{"first-frame":20,"reference":30,"text-to-video":0},"max_items_by_quality":{"flash":10,"标准":30},"max_bytes":31457280,"min_edge_px":300,"max_edge_px":6000,"aspect_min":0.4,"aspect_max":2.5,"max_combined_items":50},"mode":{"title":"生成模式","type":"enum","default":"first-frame","enum":["reference","first-frame","text-to-video"],"required":false,"enum_values_by_quality":{"flash":["reference","text-to-video"],"标准":["first-frame","reference","text-to-video"]},"options":[{"value":"reference"},{"value":"first-frame"},{"value":"text-to-video"}]},"quality":{"title":"版本档位","type":"enum","default":"标准","enum":["标准","flash"],"required":false,"enum_values_by_quality":{"flash":["flash"],"标准":["标准"]},"options":[{"value":"标准"},{"value":"flash","available_when":{"mode":["reference","text-to-video"]}}]},"resolution":{"title":"清晰度","type":"enum","default":"720p","enum":["480p","720p","1080p"],"required":false,"enum_values_by_quality":{"flash":["480p","720p"],"标准":["1080p","480p","720p"]},"options":[{"value":"480p"},{"value":"720p"},{"value":"1080p","available":false}]},"videos":{"title":"参考视频","type":"upload","required":false,"max_items":10,"max_items_by_mode":{"first-frame":0,"reference":10,"text-to-video":0},"max_items_by_quality":{"flash":5,"标准":10},"max_bytes":20971520,"min_edge_px":300,"max_edge_px":6000,"aspect_min":0.4,"aspect_max":2.5,"max_total_duration_sec":30,"min_duration_sec":2,"max_fps":59.94,"min_fps":24,"max_pixels":8295044,"max_combined_items":50}}},
  {"id":"seedance-2-5-promo","label":"Seedance 2.5 · 特价按秒","maxPrompt":25000,"parameters":{"aspect_ratio":{"title":"视频比例","type":"enum","default":"16:9","enum":["16:9","9:16","21:9","3:4","1:1","4:3","adaptive"],"required":false,"enum_values_by_quality":{"flash":["16:9","1:1","21:9","3:4","4:3","9:16"],"标准":["16:9","1:1","21:9","3:4","4:3","9:16","adaptive"]},"options":[{"value":"16:9"},{"value":"9:16"},{"value":"21:9"},{"value":"3:4"},{"value":"1:1"},{"value":"4:3"},{"value":"adaptive","available":false,"available_when":{"mode":[]}}]},"audios":{"title":"参考音频","type":"upload","required":false,"max_items":10,"max_items_by_mode":{"first-frame":0,"reference":10,"text-to-video":0},"max_items_by_quality":{"flash":1,"标准":10},"max_bytes":52428800,"max_total_duration_sec":15,"min_duration_sec":2},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"视频时长","type":"enum","default":"5","enum":["4","5","6","8","10","12","15","20","25","29","30","7","9","11","13","14","16","17","18","19","21","22","23","24","26","27","28"],"required":false,"enum_values_by_quality":{"flash":["10","12","15","20","25","29","30","4","5","6","8"],"标准":["10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30","4","5","6","7","8","9"]},"options":[{"value":"4"},{"value":"5"},{"value":"6"},{"value":"8"},{"value":"10"},{"value":"12"},{"value":"15"},{"value":"20"},{"value":"25"},{"value":"29"},{"value":"30"},{"value":"7"},{"value":"9"},{"value":"11"},{"value":"13"},{"value":"14"},{"value":"16"},{"value":"17"},{"value":"18"},{"value":"19"},{"value":"21"},{"value":"22"},{"value":"23"},{"value":"24"},{"value":"26"},{"value":"27"},{"value":"28"}]},"images":{"title":"参考图片","type":"upload","required":false,"max_items":30,"max_items_by_mode":{"first-frame":30,"reference":30,"text-to-video":0},"max_items_by_quality":{"flash":10,"标准":30},"max_bytes":20971520,"min_edge_px":300,"max_edge_px":6000,"aspect_min":0.4,"aspect_max":2.5},"mode":{"title":"生成模式","type":"enum","default":"first-frame","enum":["text-to-video","first-frame","reference"],"required":false,"enum_values_by_quality":{"flash":["reference","text-to-video"],"标准":["first-frame","reference","text-to-video"]},"options":[{"value":"text-to-video"},{"value":"first-frame"},{"value":"reference"}]},"quality":{"title":"版本档位","type":"enum","default":"标准","enum":["标准","flash"],"required":false,"enum_values_by_quality":{"flash":["flash"],"标准":["标准"]},"options":[{"value":"标准"},{"value":"flash","available_when":{"mode":["text-to-video","reference"]}}]},"resolution":{"title":"清晰度","type":"enum","default":"480p","enum":["480p","720p","1080p","4k"],"required":false,"enum_values_by_quality":{"flash":["480p","720p"],"标准":["1080p","480p","4k","720p"]},"options":[{"value":"480p"},{"value":"720p"},{"value":"1080p"},{"value":"4k"}]},"videos":{"title":"参考视频","type":"upload","required":false,"max_items":10,"max_items_by_mode":{"first-frame":0,"reference":10,"text-to-video":0},"max_items_by_quality":{"flash":5,"标准":10},"max_bytes":52428800,"min_edge_px":300,"max_edge_px":6000,"aspect_min":0.4,"aspect_max":2.5,"max_total_duration_sec":15,"min_duration_sec":2,"max_fps":59.94,"min_fps":24,"max_pixels":8295044}}},
  {"id":"seedance-2-5","label":"Seedance 2.5 · 官方直连","maxPrompt":30000,"parameters":{"aspect_ratio":{"title":"视频比例","type":"enum","default":"16:9","enum":["16:9","9:16","21:9","3:4","1:1","4:3"],"required":false,"available_when":{"mode":["text-to-video","reference"]},"options":[{"value":"16:9"},{"value":"9:16"},{"value":"21:9"},{"value":"3:4"},{"value":"1:1"},{"value":"4:3"}]},"audios":{"title":"参考音频","type":"upload","required":false,"max_items":10,"max_items_by_mode":{"edit":10,"extend":10,"first-frame":0,"first-last":0,"reference":10,"text-to-video":0},"max_bytes":52428800,"max_total_duration_sec":30,"min_duration_sec":1.8},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"视频时长","type":"enum","default":"5","enum":["4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30"],"required":false,"options":[{"value":"4"},{"value":"5"},{"value":"6"},{"value":"7"},{"value":"8"},{"value":"9"},{"value":"10"},{"value":"11"},{"value":"12"},{"value":"13"},{"value":"14"},{"value":"15"},{"value":"16"},{"value":"17"},{"value":"18"},{"value":"19"},{"value":"20"},{"value":"21"},{"value":"22"},{"value":"23"},{"value":"24"},{"value":"25"},{"value":"26"},{"value":"27"},{"value":"28"},{"value":"29"},{"value":"30"}]},"images":{"title":"参考图片","type":"upload","required":false,"max_items":30,"max_items_by_mode":{"edit":30,"extend":30,"first-frame":30,"first-last":30,"reference":30,"text-to-video":0},"max_items_by_quality":{"flash":10,"标准":30},"max_bytes":5242880,"min_edge_px":300,"max_edge_px":6000,"aspect_min":0.4,"aspect_max":2.5},"mode":{"title":"生成模式","type":"enum","default":"first-frame","enum":["text-to-video","first-frame","reference","first-last","edit","extend"],"required":false,"options":[{"value":"text-to-video"},{"value":"first-frame"},{"value":"reference"},{"value":"first-last"},{"value":"edit"},{"value":"extend"}]},"quality":{"title":"版本档位","type":"enum","default":"标准","enum":["标准","flash"],"required":false,"enum_values_by_quality":{"flash":["flash"],"标准":["标准"]},"options":[{"value":"标准"},{"value":"flash"}]},"resolution":{"title":"清晰度","type":"enum","default":"480p","enum":["480p","720p","1080p"],"required":false,"enum_values_by_quality":{"flash":["480p","720p"],"标准":["1080p","480p","720p"]},"options":[{"value":"480p"},{"value":"720p"},{"value":"1080p"}]},"videos":{"title":"参考视频","type":"upload","required":false,"max_items":10,"max_items_by_mode":{"edit":10,"extend":1,"first-frame":0,"first-last":0,"reference":10,"text-to-video":0},"max_items_by_quality":{"flash":5,"标准":10},"max_bytes":209715200,"min_edge_px":300,"max_edge_px":6000,"aspect_min":0.4,"aspect_max":2.5,"max_total_duration_sec":30,"min_duration_sec":1.8,"min_duration_sec_by_mode":{"edit":4},"max_fps":59.94,"min_fps":24,"min_pixels":409600,"max_pixels":8295044}}},
  {"id":"seedance-2-0-official","label":"Seedance 2.0 · 官方直连","maxPrompt":30000,"parameters":{"aspect_ratio":{"title":"视频比例","type":"enum","default":"16:9","enum":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"required":false,"options":[{"value":"16:9"},{"value":"9:16"},{"value":"1:1"},{"value":"4:3"},{"value":"3:4"},{"value":"21:9"},{"value":"adaptive"}]},"audios":{"title":"参考音频","type":"upload","required":false,"max_items":3,"max_items_by_mode":{"edit":3,"extend":3,"first-frame":0,"first-last":0,"reference":3,"text-to-video":0},"max_bytes":52428800,"requires_visual_reference":true,"max_total_duration_sec":15,"min_duration_sec":1.8,"combined_duration_budget":true},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"视频时长","type":"enum","default":"4","enum":["4","5","6","7","8","9","10","11","12","13","14","15"],"required":false,"options":[{"value":"4"},{"value":"5"},{"value":"6"},{"value":"7"},{"value":"8"},{"value":"9"},{"value":"10"},{"value":"11"},{"value":"12"},{"value":"13"},{"value":"14"},{"value":"15"}]},"images":{"title":"参考图片","type":"upload","required":false,"max_items":9,"max_items_by_mode":{"edit":9,"extend":9,"first-frame":9,"first-last":9,"reference":9,"text-to-video":0},"max_bytes":5242880,"min_edge_px":300,"max_edge_px":6000,"aspect_min":0.4,"aspect_max":2.5},"mode":{"title":"生成模式","type":"enum","default":"first-frame","enum":["text-to-video","reference","first-frame","first-last","edit","extend"],"required":false,"options":[{"value":"text-to-video"},{"value":"reference"},{"value":"first-frame"},{"value":"first-last"},{"value":"edit"},{"value":"extend"}]},"quality":{"title":"版本档位","type":"enum","default":"mini","enum":["标准","fast","mini"],"required":false,"options":[{"value":"标准"},{"value":"fast"},{"value":"mini"}]},"resolution":{"title":"清晰度","type":"enum","default":"480p","enum":["480p","720p","1080p","4k"],"required":false,"enum_values_by_quality":{"fast":["480p","720p"],"mini":["480p","720p"],"标准":["1080p","480p","4k","720p"]},"options":[{"value":"480p"},{"value":"720p"},{"value":"1080p"},{"value":"4k"}]},"videos":{"title":"参考视频","type":"upload","required":false,"max_items":3,"max_items_by_mode":{"edit":3,"extend":1,"first-frame":0,"first-last":0,"reference":3,"text-to-video":0},"max_bytes":52428800,"min_edge_px":300,"max_edge_px":1280,"aspect_min":0.4,"aspect_max":2.5,"max_total_duration_sec":15,"min_duration_sec":2,"max_fps":59.94,"min_fps":24,"min_pixels":409600,"max_pixels":2086876,"combined_duration_budget":true}}},
  {"id":"seedance-2-0-special","label":"Seedance 2.0 · 特价按次","maxPrompt":20000,"parameters":{"aspect_ratio":{"title":"视频比例","type":"enum","default":"9:16","enum":["9:16","16:9","21:9","1:1","4:3","3:4"],"required":false,"enum_values_by_quality":{"快速":["16:9","1:1","21:9","3:4","4:3","9:16"],"标准":["16:9","1:1","21:9","3:4","4:3","9:16"],"高清":["16:9","21:9","9:16"]},"options":[{"value":"9:16"},{"value":"16:9"},{"value":"21:9"},{"value":"1:1"},{"value":"4:3"},{"value":"3:4"}]},"audios":{"title":"参考音频","type":"upload","required":false,"max_items":3,"max_items_by_mode":{"first-frame":0,"first-last":0,"reference":3,"text-to-video":0},"max_bytes":15728640,"requires_visual_reference":true,"max_total_duration_sec":15,"min_duration_sec":1.8,"combined_duration_budget":true},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"视频时长","type":"enum","default":"15","enum":["15"],"required":false,"options":[{"value":"15"}]},"images":{"title":"参考图片","type":"upload","required":false,"max_items":9,"max_items_by_mode":{"first-frame":9,"first-last":9,"reference":9,"text-to-video":0},"max_bytes":5242880,"min_edge_px":300,"max_edge_px":6000,"aspect_min":0.4,"aspect_max":2.5},"mode":{"title":"生成模式","type":"enum","default":"first-frame","enum":["reference","first-frame","first-last","text-to-video"],"required":false,"enum_values_by_quality":{"快速":["first-frame","first-last","reference","text-to-video"],"标准":["first-frame","first-last","reference","text-to-video"],"高清":["first-last","reference","text-to-video"]},"options":[{"value":"reference"},{"value":"first-frame"},{"value":"first-last"},{"value":"text-to-video"}]},"quality":{"title":"版本档位","type":"enum","default":"标准","enum":["高清","快速","标准"],"required":false,"enum_values_by_quality":{"快速":["快速","标准","高清"],"标准":["快速","标准"],"高清":["快速","高清"]},"options":[{"value":"高清","available_when":{"mode":["reference","first-last","text-to-video"]}},{"value":"快速"},{"value":"标准"}]},"resolution":{"title":"清晰度","type":"enum","default":"720p","enum":["720p","480p"],"required":false,"options":[{"value":"720p"},{"value":"480p"}]},"videos":{"title":"参考视频","type":"upload","required":false,"max_items":3,"max_items_by_mode":{"first-frame":0,"first-last":0,"reference":3,"text-to-video":0},"max_bytes":52428800,"min_edge_px":300,"max_edge_px":1280,"aspect_min":0.4,"aspect_max":2.5,"max_total_duration_sec":15,"min_duration_sec":2,"max_fps":59.94,"min_fps":24,"min_pixels":409600,"combined_duration_budget":true}}},
  {"id":"seedance-2-0-manju-special","label":"Seedance 2.0 · 漫剧特价","maxPrompt":8000,"parameters":{"aspect_ratio":{"title":"视频比例","type":"enum","default":"16:9","enum":["16:9","9:16","1:1","4:3","3:4"],"required":false,"options":[{"value":"16:9"},{"value":"9:16"},{"value":"1:1"},{"value":"4:3"},{"value":"3:4"}]},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"视频时长","type":"enum","default":"15","enum":["5","10","15"],"required":false,"options":[{"value":"5"},{"value":"10"},{"value":"15"}]},"images":{"title":"首尾帧 / 参考图片","type":"upload","required":false,"max_items":9,"max_items_by_mode":{"first-frame":9,"first-last":9,"reference":9,"text-to-video":0},"min_edge_px":300,"max_edge_px":6000,"aspect_min":0.4,"aspect_max":2.5},"mode":{"title":"生成模式","type":"enum","default":"first-frame","enum":["text-to-video","first-frame","first-last","reference"],"required":false,"options":[{"value":"text-to-video"},{"value":"first-frame"},{"value":"first-last"},{"value":"reference"}]},"resolution":{"title":"清晰度","type":"enum","default":"720p","enum":["720p"],"required":false,"options":[{"value":"720p"}]}}},
  {"id":"seedance-2-0-promo","label":"Seedance 2.0 · 特价按秒","maxPrompt":60000,"parameters":{"aspect_ratio":{"title":"视频比例","type":"enum","default":"9:16","enum":["9:16","16:9","1:1","4:3","3:4","21:9","adaptive"],"required":false,"enum_values_by_quality":{"fast":["16:9","1:1","21:9","3:4","4:3","9:16","adaptive"],"mini":["16:9","1:1","21:9","3:4","4:3","9:16","adaptive"],"标准":["16:9","1:1","21:9","3:4","4:3","9:16"]},"options":[{"value":"9:16"},{"value":"16:9"},{"value":"1:1"},{"value":"4:3"},{"value":"3:4"},{"value":"21:9"},{"value":"adaptive"}]},"audios":{"title":"参考音频","type":"upload","required":false,"max_items":3,"max_items_by_mode":{"first-frame":0,"first-last":0,"reference":3,"text-to-video":0},"requires_visual_reference":true,"max_total_duration_sec":15,"min_duration_sec":1.8,"max_combined_items":15,"combined_duration_budget":true},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"视频时长","type":"enum","default":"4","enum":["4","5","6","7","8","9","10","12","15","11","13","14"],"required":false,"options":[{"value":"4"},{"value":"5"},{"value":"6"},{"value":"7"},{"value":"8"},{"value":"9"},{"value":"10"},{"value":"12"},{"value":"15"},{"value":"11"},{"value":"13"},{"value":"14"}]},"images":{"title":"参考图片","type":"upload","required":false,"max_items":9,"max_items_by_mode":{"first-frame":9,"first-last":9,"reference":9,"text-to-video":0},"max_bytes":5242880,"min_edge_px":300,"max_edge_px":6000,"aspect_min":0.4,"aspect_max":2.5,"max_combined_items":15},"mode":{"title":"生成模式","type":"enum","default":"reference","enum":["reference","first-last","text-to-video","first-frame"],"required":false,"options":[{"value":"reference"},{"value":"first-last"},{"value":"text-to-video"},{"value":"first-frame"}]},"quality":{"title":"版本档位","type":"enum","default":"mini","enum":["标准","fast","mini"],"required":false,"options":[{"value":"标准"},{"value":"fast"},{"value":"mini"}]},"resolution":{"title":"清晰度","type":"enum","default":"480p","enum":["480p","720p","1080p","4k"],"required":false,"enum_values_by_quality":{"fast":["480p","720p"],"mini":["480p","4k","720p"],"标准":["1080p","480p","4k","720p"]},"options":[{"value":"480p"},{"value":"720p"},{"value":"1080p"},{"value":"4k"}]},"videos":{"title":"参考视频","type":"upload","required":false,"max_items":3,"max_items_by_mode":{"first-frame":0,"first-last":0,"reference":3,"text-to-video":0},"max_bytes":52428800,"min_edge_px":300,"max_edge_px":1280,"aspect_min":0.4,"aspect_max":2.5,"max_total_duration_sec":15,"min_duration_sec":2,"max_fps":59.94,"min_fps":24,"min_pixels":409600,"max_combined_items":15,"combined_duration_budget":true}}},
  {"id":"minimax-h3","label":"MiniMax H3","maxPrompt":20000,"parameters":{"aspect_ratio":{"title":"画面比例","type":"enum","default":"16:9","enum":["16:9","9:16","21:9","4:3","1:1","3:4"],"required":false,"available_when":{"mode":["text-to-video","reference"]},"options":[{"value":"16:9"},{"value":"9:16"},{"value":"21:9"},{"value":"4:3"},{"value":"1:1"},{"value":"3:4"}]},"audios":{"title":"参考音频","type":"upload","required":false,"max_items":3,"max_items_by_mode":{"first-frame":0,"first-last":0,"reference":3,"text-to-video":0},"max_bytes":15728640,"max_total_duration_sec":15,"min_duration_sec":2},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"时长","type":"enum","default":"4","enum":["4","5","6","7","8","9","10","11","12","13","14","15"],"required":true,"options":[{"value":"4"},{"value":"5"},{"value":"6"},{"value":"7"},{"value":"8"},{"value":"9"},{"value":"10"},{"value":"11"},{"value":"12"},{"value":"13"},{"value":"14"},{"value":"15"}]},"images":{"title":"images","type":"upload","required":false,"max_items":9,"max_items_by_mode":{"first-frame":9,"first-last":9,"reference":9,"text-to-video":0},"max_bytes":31457280,"min_edge_px":256,"max_edge_px":5760,"aspect_min":0.4,"aspect_max":2.5},"mode":{"title":"生成模式","type":"enum","default":"first-frame","enum":["text-to-video","first-frame","first-last","reference"],"required":false,"options":[{"value":"text-to-video"},{"value":"first-frame"},{"value":"first-last"},{"value":"reference"}]},"resolution":{"title":"分辨率","type":"enum","default":"2k","enum":["768p","2k"],"required":false,"options":[{"value":"768p"},{"value":"2k"}]},"videos":{"title":"参考视频","type":"upload","required":false,"max_items":3,"max_items_by_mode":{"first-frame":0,"first-last":0,"reference":3,"text-to-video":0},"max_bytes":52428800,"min_edge_px":256,"max_edge_px":1536,"max_total_duration_sec":15,"min_duration_sec":2,"max_fps":60,"min_fps":23.976}}},
  {"id":"gk-imagine-1-5-7tu-special","label":"GK Imagine 1.5 Pro","maxPrompt":8000,"parameters":{"aspect_ratio":{"title":"画面比例","type":"enum","default":"16:9","enum":["16:9","9:16","1:1","4:3","3:4","3:2","2:3"],"required":true,"options":[{"value":"16:9"},{"value":"9:16"},{"value":"1:1"},{"value":"4:3"},{"value":"3:4"},{"value":"3:2"},{"value":"2:3"}]},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"视频时长","type":"enum","default":"3","enum":["3","4","5","6","8","10","12","15"],"required":false,"options":[{"value":"3"},{"value":"4"},{"value":"5"},{"value":"6"},{"value":"8"},{"value":"10"},{"value":"12"},{"value":"15"}]},"images":{"title":"参考图（最多 14 张，可不传）","type":"upload","required":false,"max_items":14,"max_items_by_mode":{"first-frame":14,"first-last":2,"reference":14,"text-to-video":0},"max_bytes":5242880},"mode":{"title":"生成模式","type":"enum","default":"reference","enum":["text-to-video","first-frame","reference","first-last"],"required":false,"options":[{"value":"text-to-video"},{"value":"first-frame"},{"value":"reference"},{"value":"first-last"}]},"resolution":{"title":"清晰度","type":"enum","default":"480p","enum":["480p","720p"],"required":false,"options":[{"value":"480p"},{"value":"720p"}]},"voices":{"title":"配音音色","type":"multi_enum","enum":["eve","ara","luna","ursa","celeste","iris","carina","rex","leo","sal","zagan","helix","orion","altair","zenith","perseus","helios","lux","kepler","rigel","cosmo","sirius","lumen","castor","naksh","atlas"],"required":false,"max_items":3,"options":[{"value":"eve"},{"value":"ara"},{"value":"luna"},{"value":"ursa"},{"value":"celeste"},{"value":"iris"},{"value":"carina"},{"value":"rex"},{"value":"leo"},{"value":"sal"},{"value":"zagan"},{"value":"helix"},{"value":"orion"},{"value":"altair"},{"value":"zenith"},{"value":"perseus"},{"value":"helios"},{"value":"lux"},{"value":"kepler"},{"value":"rigel"},{"value":"cosmo"},{"value":"sirius"},{"value":"lumen"},{"value":"castor"},{"value":"naksh"},{"value":"atlas"}]}}},
  {"id":"gk-imagine-1.5","label":"GK Imagine 1.5","maxPrompt":4096,"parameters":{"aspect_ratio":{"title":"画面比例","type":"enum","default":"16:9","enum":["16:9","9:16","1:1"],"required":true,"options":[{"value":"16:9"},{"value":"9:16"},{"value":"1:1"}]},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"视频时长","type":"enum","default":"4","enum":["6","10","15","20","30","4","8","12"],"required":false,"options":[{"value":"6"},{"value":"10"},{"value":"15"},{"value":"20","available_when":{"resolution":["480p","720p"]}},{"value":"30","available_when":{"resolution":["480p","720p"]}},{"value":"4"},{"value":"8"},{"value":"12"}]},"images":{"title":"参考图","type":"upload","required":false,"max_items":14,"max_items_by_mode":{"first-frame":14,"first-last":2,"reference":14,"text-to-video":0},"max_bytes":5242880},"mode":{"title":"生成模式","type":"enum","default":"first-frame","enum":["text-to-video","first-frame","reference","first-last"],"required":false,"options":[{"value":"text-to-video"},{"value":"first-frame"},{"value":"reference"},{"value":"first-last"}]},"resolution":{"title":"清晰度","type":"enum","default":"480p","enum":["720p","480p","1080p"],"required":false,"options":[{"value":"720p"},{"value":"480p"},{"value":"1080p","available_when":{"mode":["text-to-video","first-frame"]}}]},"voices":{"title":"配音音色","type":"multi_enum","enum":["eve","ara","luna","ursa","celeste","iris","carina","rex","leo","sal","zagan","helix","orion","altair","zenith","perseus","helios","lux","kepler","rigel","cosmo","sirius","lumen","castor","naksh","atlas"],"required":false,"max_items":3,"options":[{"value":"eve"},{"value":"ara"},{"value":"luna"},{"value":"ursa"},{"value":"celeste"},{"value":"iris"},{"value":"carina"},{"value":"rex"},{"value":"leo"},{"value":"sal"},{"value":"zagan"},{"value":"helix"},{"value":"orion"},{"value":"altair"},{"value":"zenith"},{"value":"perseus"},{"value":"helios"},{"value":"lux"},{"value":"kepler"},{"value":"rigel"},{"value":"cosmo"},{"value":"sirius"},{"value":"lumen"},{"value":"castor"},{"value":"naksh"},{"value":"atlas"}]}}},
  {"id":"gk-imagine-video","label":"GK Imagine 1.0","maxPrompt":4096,"parameters":{"aspect_ratio":{"title":"画面比例","type":"enum","default":"16:9","enum":["16:9","9:16","1:1","4:3","3:4"],"required":false,"available_when":{"mode":["text-to-video","first-frame","reference"]},"options":[{"value":"16:9"},{"value":"9:16"},{"value":"1:1"},{"value":"4:3"},{"value":"3:4"}]},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"时长","type":"enum","default":"3","enum":["6","10","15","20","30","3","4","5","8","12"],"required":false,"options":[{"value":"6"},{"value":"10"},{"value":"15","available_when":{"mode":["text-to-video","first-frame","reference"]}},{"value":"20","available_when":{"mode":["text-to-video","first-frame","reference"]}},{"value":"30","available_when":{"mode":["text-to-video","first-frame","reference"]}},{"value":"3"},{"value":"4"},{"value":"5"},{"value":"8"},{"value":"12","available_when":{"mode":["text-to-video","first-frame","reference"]}}]},"images":{"title":"images","type":"upload","required":false,"max_items":7,"max_items_by_mode":{"extend":0,"first-frame":7,"reference":7,"text-to-video":0},"max_bytes":5242880},"mode":{"title":"生成模式","type":"enum","default":"first-frame","enum":["text-to-video","first-frame","reference","extend"],"required":false,"options":[{"value":"text-to-video"},{"value":"first-frame"},{"value":"reference"},{"value":"extend"}]},"resolution":{"title":"分辨率","type":"enum","default":"480p","enum":["480p","720p"],"required":false,"available_when":{"mode":["text-to-video","first-frame","reference"]},"options":[{"value":"480p"},{"value":"720p"}]},"videos":{"title":"源视频","type":"upload","required":false,"max_items":1,"max_items_by_mode":{"extend":1,"first-frame":0,"reference":0,"text-to-video":0},"max_total_duration_sec":15,"min_duration_sec":2}}},
  {"id":"gk-imagine-video-special","label":"GK-1.0 多图 · 特价","maxPrompt":8000,"parameters":{"aspect_ratio":{"title":"画面比例","type":"enum","default":"16:9","enum":["16:9","9:16"],"required":true,"options":[{"value":"16:9"},{"value":"9:16"}]},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"视频时长","type":"enum","default":"10","enum":["6","10"],"required":false,"options":[{"value":"6"},{"value":"10"}]},"images":{"title":"参考图","type":"upload","required":false,"max_items":7,"max_items_by_mode":{"first-frame":7,"reference":7,"text-to-video":0},"max_bytes":5242880},"mode":{"title":"生成模式","type":"enum","default":"first-frame","enum":["text-to-video","first-frame","reference"],"required":false,"options":[{"value":"text-to-video"},{"value":"first-frame"},{"value":"reference"}]},"resolution":{"title":"清晰度","type":"enum","default":"720p","enum":["720p"],"required":false,"options":[{"value":"720p"}]}}},
  {"id":"gk-imagine-1.5-special","label":"GK-1.5 图生 · 特价","maxPrompt":8000,"parameters":{"aspect_ratio":{"title":"画面比例","type":"enum","default":"16:9","enum":["16:9","9:16"],"required":true,"options":[{"value":"16:9"},{"value":"9:16"}]},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"视频时长","type":"enum","default":"6","enum":["6","15"],"required":false,"options":[{"value":"6"},{"value":"15"}]},"images":{"title":"参考图（必传）","type":"upload","required":true,"max_items":1,"max_items_by_mode":{"first-frame":1,"reference":1,"text-to-video":0},"max_bytes":5242880},"resolution":{"title":"清晰度","type":"enum","default":"720p","enum":["720p"],"required":false,"options":[{"value":"720p"}]}}},
  {"id":"seedance-2-0-9tu-special","label":"Seedance 2.0 · 九图特价","maxPrompt":8000,"parameters":{"aspect_ratio":{"title":"视频比例","type":"enum","default":"9:16","enum":["9:16","16:9"],"required":false,"options":[{"value":"9:16"},{"value":"16:9"}]},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"时长","type":"enum","default":"15","enum":["15","10","5"],"required":false,"enum_values_by_quality":{"Fast":["10","15"],"标准":["10","15","5"]},"options":[{"value":"15"},{"value":"10"},{"value":"5"}]},"images":{"title":"参考图片","type":"upload","required":false,"max_items":9,"max_items_by_mode":{"first-frame":9,"reference":9,"text-to-video":0},"min_edge_px":300,"max_edge_px":6000,"aspect_min":0.4,"aspect_max":2.5},"mode":{"title":"生成模式","type":"enum","default":"reference","enum":["text-to-video","first-frame","reference"],"required":false,"enum_values_by_quality":{"Fast":["first-frame","reference","text-to-video"],"标准":["reference","text-to-video"]},"options":[{"value":"text-to-video"},{"value":"first-frame"},{"value":"reference"}]},"quality":{"title":"版本档位","type":"enum","default":"Fast","enum":["Fast","标准"],"required":false,"enum_values_by_quality":{"Fast":["Fast"],"标准":["标准"]},"options":[{"value":"Fast"},{"value":"标准","available_when":{"mode":["text-to-video","reference"]}}]},"resolution":{"title":"清晰度","type":"enum","default":"720p","enum":["720p"],"required":false,"options":[{"value":"720p"}]}}},
  {"id":"seedance-2-0-ecom-special","label":"Seedance 2.0 · 电商特价","maxPrompt":24400,"parameters":{"aspect_ratio":{"title":"视频比例","type":"enum","default":"9:16","enum":["9:16","16:9","1:1"],"required":false,"enum_values_by_quality":{"标准":["16:9","1:1","9:16"],"满血9图":["16:9","9:16"],"真人模特":["16:9","1:1","9:16"]},"options":[{"value":"9:16"},{"value":"16:9"},{"value":"1:1"}]},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"时长","type":"enum","default":"5","enum":["5","10","15"],"required":false,"enum_values_by_quality":{"标准":["10","15","5"],"满血9图":["10","15"],"真人模特":["10","15","5"]},"options":[{"value":"5"},{"value":"10"},{"value":"15"}]},"images":{"title":"参考图片","type":"upload","required":false,"max_items":9,"max_items_by_mode":{"reference":9,"text-to-video":0},"min_edge_px":300,"max_edge_px":6000,"aspect_min":0.4,"aspect_max":2.5},"mode":{"title":"生成模式","type":"enum","default":"reference","enum":["reference","text-to-video"],"required":false,"options":[{"value":"reference"},{"value":"text-to-video"}]},"quality":{"title":"画质档位","type":"enum","default":"满血9图","enum":["标准","真人模特","满血9图"],"required":false,"options":[{"value":"标准"},{"value":"真人模特"},{"value":"满血9图"}]}}},
  {"id":"minimax-hailuo-2-3","label":"MiniMax 海螺 2.3","maxPrompt":2000,"parameters":{"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"duration":{"title":"时长","type":"enum","default":"6","enum":["6","10"],"required":false,"options":[{"value":"6"},{"value":"10","available_when":{"resolution":["768p"]}}]},"images":{"title":"images","type":"upload","required":false,"max_items":1,"max_items_by_mode":{"first-frame":1,"text-to-video":0},"max_bytes":20971520,"min_edge_px":300},"mode":{"title":"生成模式","type":"enum","default":"first-frame","enum":["text-to-video","first-frame"],"required":false,"options":[{"value":"text-to-video"},{"value":"first-frame"}]},"resolution":{"title":"分辨率","type":"enum","default":"768p","enum":["768p","1080p"],"required":false,"options":[{"value":"768p"},{"value":"1080p"}]}}},
  {"id":"minimax-h3-lipsync","label":"MiniMax H3 · 对口型 / 数字人口播","parameters":{"aspect_ratio":{"title":"画面比例","type":"enum","default":"9:16","enum":["9:16","16:9"],"required":false,"options":[{"value":"9:16"},{"value":"16:9"}]},"audios":{"title":"语音","type":"upload","required":true,"max_items":1,"requires_visual_reference":true,"max_total_duration_sec":15,"duration_tolerance_sec":0},"count":{"title":"生成数量","type":"int","default":1,"min":1,"max":50,"required":false},"images":{"title":"人物形象图","type":"upload","required":true,"max_items":1},"mode":{"title":"模式","type":"enum","default":"avatar","enum":["avatar"],"required":false,"options":[{"value":"avatar"}]}}}
];

async function generateCatalogVideo(context: Context, request: VideoRequest) {
  const definition = videoDefinitions.find(item => item.id === request.model);
  if (!definition) throw new Error("未知的见白 AI 视频模型");
  const fields = definition.parameters;
  const avatar = fields.mode?.enum?.includes("avatar");
  if (!avatar && !request.prompt.trim()) throw new Error("请输入生成提示词");
  if (definition.maxPrompt && request.prompt.length > definition.maxPrompt) throw new Error(`提示词最多支持 ${definition.maxPrompt} 个字符`);
  const frames = [request.firstFrame, request.lastFrame].filter((item): item is MediaInput => Boolean(item));
  if (request.lastFrame && !request.firstFrame) throw new Error("首尾帧模式需要首帧");
  if (frames.length && (request.images?.length || request.videos?.length || request.audios?.length)) throw new Error("首尾帧和参考素材须分别提交");
  const images = frames.length ? frames : request.images ?? [];
  const videos = request.videos ?? [];
  const audios = request.audios ?? [];
  const referenceMode = Array.isArray(request.mode);
  const operation = String(request.other?.videoOperation ?? "reference");
  const mode = avatar ? "avatar" : request.mode === "text" ? "text-to-video" : frames.length === 2 ? "first-last" : frames.length === 1 || request.mode === "singleImage" ? "first-frame"
    : referenceMode ? operation : images.length || videos.length || audios.length ? "reference" : "text-to-video";
  const params: Record<string, unknown> = { prompt: request.prompt, count: 1 };
  for (const [key, field] of Object.entries(fields)) {
    if (field.type === "upload") continue;
    const common: Record<string, unknown> = { mode, duration: request.duration === undefined ? undefined : String(request.duration), resolution: request.resolution, aspect_ratio: request.ratio };
    params[key] = common[key] ?? request.other?.[imageField(key)] ?? field.default;
  }
  if (!fields.mode && mode !== "first-frame") throw new Error("当前模型必须使用单张首帧图片");
  const matches = (condition?: Record<string, string[]>) => !condition || Object.entries(condition).every(([key, values]) => values.includes(String(params[key])));
  for (const [key, field] of Object.entries(fields)) {
    if (field.type === "upload") continue;
    const value = params[key];
    if (!matches(field.available_when)) { delete params[key]; continue; }
    if (value === undefined || value === null || value === "") {
      if (field.required) throw new Error(`请设置${field.title}`);
      delete params[key];
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    if (field.type === "multi_enum" && (!Array.isArray(value) || value.length > (field.max_items ?? Infinity))) throw new Error(`${field.title}最多选择 ${field.max_items} 项`);
    for (const item of values) {
      const option = field.options?.find(option => option.value === String(item));
      const qualityValues = key === "quality" ? undefined : field.enum_values_by_quality?.[String(params.quality)];
      if (field.enum && !field.enum.includes(String(item)) || qualityValues && !qualityValues.includes(String(item))
        || option?.available === false || !matches(option?.available_when)) throw new Error(`${field.title}与当前模式或档位不兼容，请重新选择`);
    }
  }
  if (mode === "first-frame" && images.length !== 1 || mode === "first-last" && images.length !== 2) throw new Error("首帧模式需要一张图片，首尾帧模式需要两张图片");
  if (["edit", "extend"].includes(mode) && !videos.length) throw new Error("编辑或延长视频需要连接参考视频");
  if (mode === "avatar" && (images.length !== 1 || audios.length !== 1)) throw new Error("数字人口播需要一张人物图片和一段音频");
  for (const [key, items] of Object.entries({ images, videos, audios })) {
    const field = fields[key];
    const duration = items.reduce((total, item) => total + (item.metadata?.duration ?? 0), 0);
    if (field?.max_total_duration_sec && duration > field.max_total_duration_sec + (field.duration_tolerance_sec ?? 0)) throw new Error(`${field.title}总时长不能超过 ${field.max_total_duration_sec} 秒`);
    if (field?.max_combined_items && images.length + videos.length + audios.length > field.max_combined_items) throw new Error(`参考素材合计不能超过 ${field.max_combined_items} 个`);
    const limit = field ? Math.min(field.max_items ?? Infinity, field.max_items_by_mode?.[mode] ?? Infinity, field.max_items_by_quality?.[String(params.quality)] ?? Infinity) : 0;
    if (items.length > limit) throw new Error(`${field?.title ?? key}最多支持 ${limit} 个，请减少素材或更换模式 / 档位`);
    if (field?.required && !items.length) throw new Error(`请连接${field.title}`);
    if (items.length && field?.requires_visual_reference && !images.length && !videos.length) throw new Error("参考音频需要同时提供图片或视频");
    for (const item of items) {
      const metadata = item.metadata;
      const minDuration = field?.min_duration_sec_by_mode?.[mode] ?? field?.min_duration_sec;
      if (metadata?.duration !== undefined && minDuration && metadata.duration < minDuration) throw new Error(`${field?.title}单段时长至少 ${minDuration} 秒`);
      if (metadata?.frameRate !== undefined && (field?.min_fps && metadata.frameRate < field.min_fps || field?.max_fps && metadata.frameRate > field.max_fps)) throw new Error("参考视频帧率不符合模型要求");
      if (metadata?.width && metadata.height && field) {
        const { width, height } = metadata;
        if (field.min_edge_px && Math.min(width, height) < field.min_edge_px || field.max_edge_px && Math.max(width, height) > field.max_edge_px
          || field.min_pixels && width * height < field.min_pixels || field.max_pixels && width * height > field.max_pixels
          || field.aspect_min && width / height < field.aspect_min || field.aspect_max && width / height > field.aspect_max) throw new Error("参考视频尺寸或宽高比不符合模型要求");
      }
      const bytes = item.type === "binary" ? item.data.byteLength : item.type === "base64" ? atob(item.data).length : undefined;
      if (field?.max_bytes && bytes !== undefined && bytes > field.max_bytes) throw new Error(`${field.title}单个文件不能超过 ${field.max_bytes / 1024 / 1024} MB`);
      if (key === "images" && field && (field.min_edge_px || field.max_edge_px || field.aspect_min || field.aspect_max)) {
        const { width, height } = await context.tool.media.inspectImage(item);
        if (field.min_edge_px && Math.min(width, height) < field.min_edge_px || field.max_edge_px && Math.max(width, height) > field.max_edge_px
          || field.aspect_min && width / height < field.aspect_min || field.aspect_max && width / height > field.aspect_max) throw new Error(`${definition.label}参考图尺寸或宽高比不符合模型要求`);
      }
    }
  }
  if (fields.videos?.combined_duration_budget && fields.audios?.combined_duration_budget) {
    const total = [...videos, ...audios].reduce((sum, item) => sum + (item.metadata?.duration ?? 0), 0);
    const limit = Math.min(fields.videos.max_total_duration_sec ?? Infinity, fields.audios.max_total_duration_sec ?? Infinity);
    if (total > limit) throw new Error(`参考视频与音频合计时长不能超过 ${limit} 秒`);
  }
  params.prompt = request.prompt.replace(/\{\{ref (\d+)\}\}/g, (marker, number) => {
    const reference = request.referenceOrder?.[Number(number) - 1];
    if (!reference) throw new Error(`引用标记 ${marker} 没有对应素材`);
    if (reference.type === "text") return `参考 ${number}`;
    if (reference.type === "firstFrame") return "@图片1";
    if (reference.type === "lastFrame") return "@图片2";
    if ("index" in reference) return `@${{ image: "图片", video: "视频", audio: "音频" }[reference.type]}${reference.index + 1}`;
    throw new Error("参考素材类型无效");
  });
  for (const [key, items] of Object.entries({ images, videos, audios })) {
    if (items.length) params[key] = await references(context, items);
  }
  return generate(context, definition.id, "video", params);
}

export default {
  id: "tokenGo",
  label: "见白 AI",
  version: "1.3.0",
  readme: "在见白 AI 的 API 密钥页面创建密钥，并为所用模型开启图片、视频、音频权限。使用本地参考素材时还需开启文件权限，素材会上传到见白 AI。",
  rules: [{
    type: "input",
    field: "apiKey",
    title: "API 密钥",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  }],
  models: [
    {"id":"music","label":"Suno 音乐生成","type":"audio","maxPromptLength":5000,"maxReferenceImages":0,"promptOptional":true,"audioOptions":{"nativeParameters":true,"referenceLimits":{"generate":0,"import":1,"upload_extend":1,"upload_cover":1,"inspo":4,"replace_section":1}},"rules":[{"field":"operation","title":"操作","type":"select","value":"generate","options":[{"value":"generate","label":"生成"},{"value":"extend","label":"续写"},{"value":"cover","label":"翻唱"},{"value":"upload_cover","label":"上传翻唱"},{"value":"lyrics","label":"AI 写词"},{"value":"stems","label":"人声伴奏分离"},{"value":"stems_all","label":"12轨分离"},{"value":"concat","label":"整曲拼接"},{"value":"persona","label":"存为歌手音色"},{"value":"import","label":"导入音频"},{"value":"upload_extend","label":"上传续写"},{"value":"inspo","label":"参考音频生成"},{"value":"sample","label":"样本转歌"},{"value":"add_vocals","label":"加人声"},{"value":"add_instrumental","label":"加伴奏"},{"value":"add_stem","label":"加音轨"},{"value":"replace_section","label":"段落替换"},{"value":"mashup","label":"两首混搭"}],"props":{"teleported":false,"placement":"top-start","filterable":false}},{"field":"version","title":"模型版本","type":"select","value":"chirp-v6","options":[{"value":"chirp-v6","label":"v6"},{"value":"chirp-v6-wild","label":"v6 Wild"},{"value":"chirp-v6-mini","label":"v6 Mini"},{"value":"chirp-v5","label":"v5"},{"value":"chirp-v4-5","label":"v4.5"}],"props":{"teleported":false,"placement":"top-start","filterable":false}},{"field":"mode","title":"模式","type":"select","value":"song","options":[{"value":"song","label":"歌曲"},{"value":"instrumental","label":"纯音乐"}],"props":{"teleported":false,"placement":"top-start","filterable":false},"audioOperations":["generate","extend","cover","upload_cover","upload_extend","inspo","sample","mashup"]},{"field":"lyrics","title":"歌词","type":"input","value":"","props":{"type":"textarea","autosize":{"minRows":2,"maxRows":5}},"audioOperations":["generate","extend","cover","upload_cover","upload_extend","inspo","sample","add_vocals","add_instrumental","add_stem","mashup"]},{"field":"style","title":"风格标签","type":"input","value":"","props":{},"audioOperations":["generate","extend","cover","upload_cover","upload_extend","inspo","sample","add_vocals","add_instrumental","add_stem","replace_section","mashup"]},{"field":"title","title":"歌曲标题","type":"input","value":"","props":{},"audioOperations":["generate","extend","cover","upload_cover","upload_extend","inspo","sample","mashup"]},{"field":"sampleRate","title":"采样率","type":"select","value":"44100","options":[{"value":"44100","label":"44100 Hz"},{"value":"48000","label":"48000 Hz"}],"props":{"teleported":false,"placement":"top-start","filterable":false}},{"field":"bitrate","title":"码率","type":"select","value":"256000","options":[{"value":"128000","label":"128 kbps"},{"value":"192000","label":"192 kbps"},{"value":"256000","label":"256 kbps"}],"props":{"teleported":false,"placement":"top-start","filterable":false}},{"field":"audioUrl","title":"源音频","type":"input","value":"","props":{},"audioOperations":["import","upload_extend"]},{"field":"audioUrls","title":"参考音频","type":"input","value":"","props":{},"audioOperations":["inspo"]},{"field":"clipId","title":"源 clip","type":"input","value":"","props":{},"audioOperations":["stems","stems_all","concat","persona","sample","add_vocals","add_instrumental","add_stem","replace_section","mashup"]},{"field":"continueAt","title":"续写起点(秒)","type":"input","value":"","props":{},"audioOperations":["extend","upload_extend"]},{"field":"continueClipId","title":"续写源 clip","type":"input","value":"","props":{},"audioOperations":["extend"]},{"field":"coverAudioUrl","title":"翻唱源音频","type":"input","value":"","props":{},"audioOperations":["upload_cover"]},{"field":"coverClipId","title":"翻唱源 clip","type":"input","value":"","props":{},"audioOperations":["cover"]},{"field":"duration","title":"目标时长 (秒)","type":"inputNumber","value":null,"props":{"min":10,"max":360,"controlsPosition":"right"},"audioOperations":["generate"]},{"field":"endS","title":"片段终点(秒)","type":"input","value":"","props":{},"audioOperations":["persona","sample","replace_section"]},{"field":"infillLyrics","title":"替换段歌词","type":"input","value":"","props":{"type":"textarea","autosize":{"minRows":2,"maxRows":5}},"audioOperations":["replace_section"]},{"field":"negativeTags","title":"排除风格","type":"input","value":"","props":{},"audioOperations":["generate","extend","cover","upload_cover","upload_extend","inspo","sample","mashup"]},{"field":"personaId","title":"歌手音色","type":"input","value":"","props":{},"audioOperations":["generate","upload_cover","extend","cover"]},{"field":"personaName","title":"歌手音色名称","type":"input","value":"","props":{},"audioOperations":["persona"]},{"field":"secondClipId","title":"第二首源","type":"input","value":"","props":{},"audioOperations":["mashup"]},{"field":"sourceAudioUrl","title":"原曲地址","type":"input","value":"","props":{},"audioOperations":["replace_section"]},{"field":"startS","title":"片段起点(秒)","type":"input","value":"","props":{},"audioOperations":["persona","sample","replace_section"]},{"field":"vocalGender","title":"演唱声线","type":"select","value":"auto","options":[{"value":"auto","label":"自动"},{"value":"m","label":"男声"},{"value":"f","label":"女声"}],"props":{"teleported":false,"placement":"top-start","filterable":false},"audioOperations":["generate","extend","cover","upload_cover","upload_extend","inspo","sample","mashup"]}]},
    {"id":"gemini-2.5-pro-tts","label":"GM-2.5 Pro TTS","type":"audio","maxReferenceImages":0,"promptOptional":false,"audioOptions":{"nativeParameters":true,"referenceLimits":{"default":0}},"rules":[{"field":"voice","title":"音色","type":"select","value":"Zephyr","options":[{"value":"Zephyr","label":"Zephyr","description":"明亮","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Zephyr.mp3","language":"多语种"},{"value":"Puck","label":"Puck","description":"活泼","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Puck.mp3","language":"多语种"},{"value":"Charon","label":"Charon","description":"清晰叙述","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Charon.mp3","language":"多语种"},{"value":"Kore","label":"Kore","description":"坚定","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Kore.mp3","language":"多语种"},{"value":"Fenrir","label":"Fenrir","description":"激昂","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Fenrir.mp3","language":"多语种"},{"value":"Leda","label":"Leda","description":"年轻","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Leda.mp3","language":"多语种"},{"value":"Orus","label":"Orus","description":"坚定","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Orus.mp3","language":"多语种"},{"value":"Aoede","label":"Aoede","description":"轻盈","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Aoede.mp3","language":"多语种"},{"value":"Callirrhoe","label":"Callirrhoe","description":"随和","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Callirrhoe.mp3","language":"多语种"},{"value":"Autonoe","label":"Autonoe","description":"明亮","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Autonoe.mp3","language":"多语种"},{"value":"Enceladus","label":"Enceladus","description":"气声","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Enceladus.mp3","language":"多语种"},{"value":"Iapetus","label":"Iapetus","description":"清晰","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Iapetus.mp3","language":"多语种"},{"value":"Umbriel","label":"Umbriel","description":"随和","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Umbriel.mp3","language":"多语种"},{"value":"Algieba","label":"Algieba","description":"流畅","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Algieba.mp3","language":"多语种"},{"value":"Despina","label":"Despina","description":"流畅","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Despina.mp3","language":"多语种"},{"value":"Erinome","label":"Erinome","description":"清晰","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Erinome.mp3","language":"多语种"},{"value":"Algenib","label":"Algenib","description":"沙哑","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Algenib.mp3","language":"多语种"},{"value":"Rasalgethi","label":"Rasalgethi","description":"清晰叙述","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Rasalgethi.mp3","language":"多语种"},{"value":"Laomedeia","label":"Laomedeia","description":"活泼","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Laomedeia.mp3","language":"多语种"},{"value":"Achernar","label":"Achernar","description":"柔和","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Achernar.mp3","language":"多语种"},{"value":"Alnilam","label":"Alnilam","description":"坚定","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Alnilam.mp3","language":"多语种"},{"value":"Schedar","label":"Schedar","description":"平稳","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Schedar.mp3","language":"多语种"},{"value":"Gacrux","label":"Gacrux","description":"成熟","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Gacrux.mp3","language":"多语种"},{"value":"Pulcherrima","label":"Pulcherrima","description":"直接","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Pulcherrima.mp3","language":"多语种"},{"value":"Achird","label":"Achird","description":"友好","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Achird.mp3","language":"多语种"},{"value":"Zubenelgenubi","label":"Zubenelgenubi","description":"随性","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Zubenelgenubi.mp3","language":"多语种"},{"value":"Vindemiatrix","label":"Vindemiatrix","description":"温柔","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Vindemiatrix.mp3","language":"多语种"},{"value":"Sadachbia","label":"Sadachbia","description":"生动","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Sadachbia.mp3","language":"多语种"},{"value":"Sadaltager","label":"Sadaltager","description":"沉稳博学","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Sadaltager.mp3","language":"多语种"},{"value":"Sulafat","label":"Sulafat","description":"温暖","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Sulafat.mp3","language":"多语种"}],"props":{"teleported":false,"placement":"top-start","filterable":true},"validate":[{"required":true,"message":"请填写音色"}]},{"field":"instructions","title":"风格指令","type":"input","value":"","props":{"type":"textarea","autosize":{"minRows":2,"maxRows":5}}},{"field":"responseFormat","title":"输出格式","type":"select","value":"wav","options":[{"value":"wav","label":"WAV"}],"props":{"teleported":false,"placement":"top-start","filterable":false}}]},
    {"id":"gpt-4o-mini-tts","label":"GT-4o Mini TTS","type":"audio","maxPromptLength":2100,"maxReferenceImages":0,"promptOptional":false,"audioOptions":{"nativeParameters":true,"referenceLimits":{"default":0}},"rules":[{"field":"voice","title":"音色","type":"select","value":"alloy","options":[{"value":"alloy","label":"alloy","gender":"中性","language":"多语种","description":"多用途","previewUrl":"https://cdn.token6688.com/voice-previews/openai/alloy.mp3"},{"value":"echo","label":"echo","gender":"男声","language":"多语种","description":"沉稳","previewUrl":"https://cdn.token6688.com/voice-previews/openai/echo.mp3"},{"value":"fable","label":"fable","gender":"男声","language":"多语种","description":"英式 · 叙述","previewUrl":"https://cdn.token6688.com/voice-previews/openai/fable.mp3"},{"value":"onyx","label":"onyx","gender":"男声","language":"多语种","description":"低沉 · 有力","previewUrl":"https://cdn.token6688.com/voice-previews/openai/onyx.mp3"},{"value":"nova","label":"nova","gender":"女声","language":"多语种","description":"温暖","previewUrl":"https://cdn.token6688.com/voice-previews/openai/nova.mp3"},{"value":"shimmer","label":"shimmer","gender":"女声","language":"多语种","description":"柔和","previewUrl":"https://cdn.token6688.com/voice-previews/openai/shimmer.mp3"}],"props":{"teleported":false,"placement":"top-start","filterable":true},"validate":[{"required":true,"message":"请填写音色"}]},{"field":"instructions","title":"风格指令","type":"input","value":"","props":{"type":"textarea","autosize":{"minRows":2,"maxRows":5}}},{"field":"speed","title":"语速","type":"input","value":"1.0","props":{}},{"field":"responseFormat","title":"输出格式","type":"select","value":"mp3","options":[{"value":"mp3","label":"MP3"},{"value":"opus","label":"OPUS"},{"value":"aac","label":"AAC"},{"value":"flac","label":"FLAC"},{"value":"wav","label":"WAV"},{"value":"pcm","label":"PCM"}],"props":{"teleported":false,"placement":"top-start","filterable":false}}]},
    {"id":"speech-2.8","label":"海螺 语音克隆 2.8","type":"audio","maxPromptLength":10000,"maxReferenceImages":0,"promptOptional":false,"audioOptions":{"nativeParameters":true,"referenceLimits":{"default":0}},"rules":[{"field":"version","title":"版本","type":"select","value":"2.8","options":[{"value":"2.8","label":"2.8"},{"value":"2.6","label":"2.6"}],"props":{"teleported":false,"placement":"top-start","filterable":false}},{"field":"tier","title":"档位","type":"select","value":"hd","options":[{"value":"hd","label":"HD 高音质"},{"value":"turbo","label":"Turbo 速度"}],"props":{"teleported":false,"placement":"top-start","filterable":false}},{"field":"voice","title":"音色","type":"input","value":"","props":{},"validate":[{"required":true,"message":"请填写音色"}],"voiceLibrary":[{"value":"male-qn-qingse","label":"青涩青年音色","gender":"男声","language":"中文","description":"青年 · 清新","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/male-qn-qingse.mp3"},{"value":"male-qn-jingying","label":"精英青年音色","gender":"男声","language":"中文","description":"精英青年音色","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/male-qn-jingying.mp3"},{"value":"male-qn-badao","label":"霸道青年音色","gender":"男声","language":"中文","description":"霸道青年音色","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/male-qn-badao.mp3"},{"value":"male-qn-daxuesheng","label":"青年大学生音色","gender":"男声","language":"中文","description":"青年大学生音色","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/male-qn-daxuesheng.mp3"},{"value":"female-shaonv","label":"少女音色","gender":"女声","language":"中文","description":"少女音色","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/female-shaonv.mp3"},{"value":"female-yujie","label":"御姐音色","gender":"女声","language":"中文","description":"御姐音色","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/female-yujie.mp3"},{"value":"female-chengshu","label":"成熟女性音色","gender":"女声","language":"中文","description":"成熟女性音色","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/female-chengshu.mp3"},{"value":"female-tianmei","label":"甜美女性音色","gender":"女声","language":"中文","description":"甜美女性音色","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/female-tianmei.mp3"},{"value":"male-qn-qingse-jingpin","label":"青涩青年音色-beta","gender":"男声","language":"中文","description":"青涩青年音色-beta","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/male-qn-qingse-jingpin.mp3"},{"value":"male-qn-jingying-jingpin","label":"精英青年音色-beta","gender":"男声","language":"中文","description":"精英青年音色-beta","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/male-qn-jingying-jingpin.mp3"},{"value":"male-qn-badao-jingpin","label":"霸道青年音色-beta","gender":"男声","language":"中文","description":"霸道青年音色-beta","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/male-qn-badao-jingpin.mp3"},{"value":"male-qn-daxuesheng-jingpin","label":"青年大学生音色-beta","gender":"男声","language":"中文","description":"青年大学生音色-beta","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/male-qn-daxuesheng-jingpin.mp3"},{"value":"female-shaonv-jingpin","label":"少女音色-beta","gender":"女声","language":"中文","description":"少女音色-beta","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/female-shaonv-jingpin.mp3"},{"value":"female-yujie-jingpin","label":"御姐音色-beta","gender":"女声","language":"中文","description":"御姐音色-beta","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/female-yujie-jingpin.mp3"},{"value":"female-chengshu-jingpin","label":"成熟女性音色-beta","gender":"女声","language":"中文","description":"成熟女性音色-beta","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/female-chengshu-jingpin.mp3"},{"value":"female-tianmei-jingpin","label":"甜美女性音色-beta","gender":"女声","language":"中文","description":"甜美女性音色-beta","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/female-tianmei-jingpin.mp3"},{"value":"clever_boy","label":"聪明男童","gender":"","language":"中文","description":"聪明男童","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/clever_boy.mp3"},{"value":"cute_boy","label":"可爱男童","gender":"","language":"中文","description":"可爱男童","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/cute_boy.mp3"},{"value":"lovely_girl","label":"萌萌女童","gender":"","language":"中文","description":"萌萌女童","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/lovely_girl.mp3"},{"value":"cartoon_pig","label":"卡通猪小琪","gender":"中性","language":"中文","description":"卡通猪小琪","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/cartoon_pig.mp3"},{"value":"bingjiao_didi","label":"病娇弟弟","gender":"男声","language":"中文","description":"病娇弟弟","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/bingjiao_didi.mp3"},{"value":"junlang_nanyou","label":"俊朗男友","gender":"男声","language":"中文","description":"俊朗男友","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/junlang_nanyou.mp3"},{"value":"chunzhen_xuedi","label":"纯真学弟","gender":"男声","language":"中文","description":"纯真学弟","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/chunzhen_xuedi.mp3"},{"value":"lengdan_xiongzhang","label":"冷淡学长","gender":"男声","language":"中文","description":"冷淡学长","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/lengdan_xiongzhang.mp3"},{"value":"badao_shaoye","label":"霸道少爷","gender":"男声","language":"中文","description":"霸道少爷","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/badao_shaoye.mp3"},{"value":"tianxin_xiaoling","label":"甜心小玲","gender":"女声","language":"中文","description":"甜心小玲","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/tianxin_xiaoling.mp3"},{"value":"qiaopi_mengmei","label":"俏皮萌妹","gender":"女声","language":"中文","description":"俏皮萌妹","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/qiaopi_mengmei.mp3"},{"value":"wumei_yujie","label":"妩媚御姐","gender":"女声","language":"中文","description":"妩媚御姐","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/wumei_yujie.mp3"},{"value":"diadia_xuemei","label":"嗲嗲学妹","gender":"女声","language":"中文","description":"嗲嗲学妹","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/diadia_xuemei.mp3"},{"value":"danya_xuejie","label":"淡雅学姐","gender":"女声","language":"中文","description":"淡雅学姐","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/danya_xuejie.mp3"},{"value":"Chinese (Mandarin)_Reliable_Executive","label":"沉稳高管","gender":"中性","language":"中文","description":"沉稳高管","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Reliable_Executive.mp3"},{"value":"Chinese (Mandarin)_News_Anchor","label":"新闻女声","gender":"女声","language":"中文","description":"新闻女声","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__News_Anchor.mp3"},{"value":"Chinese (Mandarin)_Mature_Woman","label":"傲娇御姐","gender":"女声","language":"中文","description":"傲娇御姐","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Mature_Woman.mp3"},{"value":"Chinese (Mandarin)_Unrestrained_Young_Man","label":"不羁青年","gender":"男声","language":"中文","description":"不羁青年","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Unrestrained_Young_Man.mp3"},{"value":"Arrogant_Miss","label":"嚣张小姐","gender":"女声","language":"中文","description":"嚣张小姐","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Arrogant_Miss.mp3"},{"value":"Robot_Armor","label":"机械战甲","gender":"中性","language":"中文","description":"机械战甲","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Robot_Armor.mp3"},{"value":"Chinese (Mandarin)_Kind-hearted_Antie","label":"热心大婶","gender":"女声","language":"中文","description":"热心大婶","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Kind-hearted_Antie.mp3"},{"value":"Chinese (Mandarin)_HK_Flight_Attendant","label":"港普空姐","gender":"女声","language":"中文","description":"港普空姐","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__HK_Flight_Attendant.mp3"},{"value":"Chinese (Mandarin)_Humorous_Elder","label":"搞笑大爷","gender":"男声","language":"中文","description":"搞笑大爷","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Humorous_Elder.mp3"},{"value":"Chinese (Mandarin)_Gentleman","label":"温润男声","gender":"男声","language":"中文","description":"温润男声","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Gentleman.mp3"},{"value":"Chinese (Mandarin)_Warm_Bestie","label":"温暖闺蜜","gender":"女声","language":"中文","description":"温暖闺蜜","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Warm_Bestie.mp3"},{"value":"Chinese (Mandarin)_Male_Announcer","label":"播报男声","gender":"男声","language":"中文","description":"播报男声","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Male_Announcer.mp3"},{"value":"Chinese (Mandarin)_Sweet_Lady","label":"甜美女声","gender":"女声","language":"中文","description":"甜美女声","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Sweet_Lady.mp3"},{"value":"Chinese (Mandarin)_Southern_Young_Man","label":"南方小哥","gender":"男声","language":"中文","description":"南方小哥","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Southern_Young_Man.mp3"},{"value":"Chinese (Mandarin)_Wise_Women","label":"阅历姐姐","gender":"中性","language":"中文","description":"阅历姐姐","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Wise_Women.mp3"},{"value":"Chinese (Mandarin)_Gentle_Youth","label":"温润青年","gender":"中性","language":"中文","description":"温润青年","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Gentle_Youth.mp3"},{"value":"Chinese (Mandarin)_Warm_Girl","label":"温暖少女","gender":"女声","language":"中文","description":"温暖少女","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Warm_Girl.mp3"},{"value":"Chinese (Mandarin)_Kind-hearted_Elder","label":"花甲奶奶","gender":"女声","language":"中文","description":"花甲奶奶","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Kind-hearted_Elder.mp3"},{"value":"Chinese (Mandarin)_Cute_Spirit","label":"憨憨萌兽","gender":"中性","language":"中文","description":"憨憨萌兽","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Cute_Spirit.mp3"},{"value":"Chinese (Mandarin)_Radio_Host","label":"电台男主播","gender":"中性","language":"中文","description":"电台男主播","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Radio_Host.mp3"},{"value":"Chinese (Mandarin)_Lyrical_Voice","label":"抒情男声","gender":"男声","language":"中文","description":"抒情 · 温柔","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Lyrical_Voice.mp3"},{"value":"Chinese (Mandarin)_Straightforward_Boy","label":"率真弟弟","gender":"男声","language":"中文","description":"率真弟弟","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Straightforward_Boy.mp3"},{"value":"Chinese (Mandarin)_Sincere_Adult","label":"真诚青年","gender":"中性","language":"中文","description":"真诚青年","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Sincere_Adult.mp3"},{"value":"Chinese (Mandarin)_Gentle_Senior","label":"温柔学姐","gender":"女声","language":"中文","description":"温柔学姐","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Gentle_Senior.mp3"},{"value":"Chinese (Mandarin)_Stubborn_Friend","label":"嘴硬竹马","gender":"男声","language":"中文","description":"嘴硬竹马","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Stubborn_Friend.mp3"},{"value":"Chinese (Mandarin)_Crisp_Girl","label":"清脆少女","gender":"女声","language":"中文","description":"清脆少女","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Crisp_Girl.mp3"},{"value":"Chinese (Mandarin)_Pure-hearted_Boy","label":"清澈邻家弟弟","gender":"男声","language":"中文","description":"清澈邻家弟弟","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Pure-hearted_Boy.mp3"},{"value":"Chinese (Mandarin)_Soft_Girl","label":"柔和少女","gender":"女声","language":"中文","description":"柔和少女","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Chinese__Mandarin__Soft_Girl.mp3"},{"value":"Cantonese_ProfessionalHost（F)","label":"专业女主持","gender":"中性","language":"yue","description":"专业女主持","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Cantonese_ProfessionalHost_F_.mp3"},{"value":"Cantonese_GentleLady","label":"温柔女声","gender":"女声","language":"yue","description":"温柔女声","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Cantonese_GentleLady.mp3"},{"value":"Cantonese_ProfessionalHost（M)","label":"专业男主持","gender":"中性","language":"yue","description":"专业男主持","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Cantonese_ProfessionalHost_M_.mp3"},{"value":"Cantonese_PlayfulMan","label":"活泼男声","gender":"男声","language":"yue","description":"活泼男声","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Cantonese_PlayfulMan.mp3"},{"value":"Cantonese_CuteGirl","label":"可爱女孩","gender":"中性","language":"yue","description":"可爱女孩","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Cantonese_CuteGirl.mp3"},{"value":"Cantonese_KindWoman","label":"善良女声","gender":"女声","language":"yue","description":"善良女声","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Cantonese_KindWoman.mp3"},{"value":"Santa_Claus","label":"Santa Claus","gender":"中性","language":"英文","description":"Santa Claus","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Santa_Claus.mp3"},{"value":"Grinch","label":"Grinch","gender":"中性","language":"英文","description":"Grinch","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Grinch.mp3"},{"value":"Rudolph","label":"Rudolph","gender":"中性","language":"英文","description":"Rudolph","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Rudolph.mp3"},{"value":"Arnold","label":"Arnold","gender":"中性","language":"英文","description":"Arnold","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Arnold.mp3"},{"value":"Charming_Santa","label":"Charming Santa","gender":"中性","language":"英文","description":"Charming Santa","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Charming_Santa.mp3"},{"value":"Charming_Lady","label":"Charming Lady","gender":"女声","language":"英文","description":"Charming Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Charming_Lady.mp3"},{"value":"Sweet_Girl","label":"Sweet Girl","gender":"女声","language":"英文","description":"Sweet Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Sweet_Girl.mp3"},{"value":"Cute_Elf","label":"Cute Elf","gender":"中性","language":"英文","description":"Cute Elf","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Cute_Elf.mp3"},{"value":"Attractive_Girl","label":"Attractive Girl","gender":"女声","language":"英文","description":"Attractive Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Attractive_Girl.mp3"},{"value":"Serene_Woman","label":"Serene Woman","gender":"女声","language":"英文","description":"Serene Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Serene_Woman.mp3"},{"value":"English_Trustworthy_Man","label":"Trustworthy Man","gender":"男声","language":"英文","description":"Trustworthy Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/English_Trustworthy_Man.mp3"},{"value":"English_Graceful_Lady","label":"Graceful Lady","gender":"女声","language":"英文","description":"graceful","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/English_Graceful_Lady.mp3"},{"value":"English_Aussie_Bloke","label":"Aussie Bloke","gender":"男声","language":"英文","description":"Aussie Bloke","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/English_Aussie_Bloke.mp3"},{"value":"English_Whispering_girl","label":"Whispering girl","gender":"女声","language":"英文","description":"Whispering girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/English_Whispering_girl.mp3"},{"value":"English_Diligent_Man","label":"Diligent Man","gender":"男声","language":"英文","description":"Diligent Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/English_Diligent_Man.mp3"},{"value":"English_Gentle-voiced_man","label":"Gentle-voiced man","gender":"男声","language":"英文","description":"Gentle-voiced man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/English_Gentle-voiced_man.mp3"},{"value":"Japanese_IntellectualSenior","label":"Intellectual Senior","gender":"中性","language":"日语","description":"Intellectual Senior","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Japanese_IntellectualSenior.mp3"},{"value":"Japanese_DecisivePrincess","label":"Decisive Princess","gender":"中性","language":"日语","description":"Decisive Princess","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Japanese_DecisivePrincess.mp3"},{"value":"Japanese_LoyalKnight","label":"Loyal Knight","gender":"中性","language":"日语","description":"Loyal Knight","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Japanese_LoyalKnight.mp3"},{"value":"Japanese_DominantMan","label":"Dominant Man","gender":"男声","language":"日语","description":"Dominant Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Japanese_DominantMan.mp3"},{"value":"Japanese_SeriousCommander","label":"Serious Commander","gender":"中性","language":"日语","description":"Serious Commander","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Japanese_SeriousCommander.mp3"},{"value":"Japanese_ColdQueen","label":"Cold Queen","gender":"中性","language":"日语","description":"Cold Queen","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Japanese_ColdQueen.mp3"},{"value":"Japanese_DependableWoman","label":"Dependable Woman","gender":"女声","language":"日语","description":"Dependable Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Japanese_DependableWoman.mp3"},{"value":"Japanese_GentleButler","label":"Gentle Butler","gender":"中性","language":"日语","description":"Gentle Butler","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Japanese_GentleButler.mp3"},{"value":"Japanese_KindLady","label":"Kind Lady","gender":"女声","language":"日语","description":"Kind Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Japanese_KindLady.mp3"},{"value":"Japanese_CalmLady","label":"Calm Lady","gender":"女声","language":"日语","description":"Calm Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Japanese_CalmLady.mp3"},{"value":"Japanese_OptimisticYouth","label":"Optimistic Youth","gender":"中性","language":"日语","description":"Optimistic Youth","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Japanese_OptimisticYouth.mp3"},{"value":"Japanese_GenerousIzakayaOwner","label":"Generous Izakaya Owner","gender":"中性","language":"日语","description":"Generous Izakaya Owner","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Japanese_GenerousIzakayaOwner.mp3"},{"value":"Japanese_SportyStudent","label":"Sporty Student","gender":"中性","language":"日语","description":"Sporty Student","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Japanese_SportyStudent.mp3"},{"value":"Japanese_InnocentBoy","label":"Innocent Boy","gender":"男声","language":"日语","description":"Innocent Boy","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Japanese_InnocentBoy.mp3"},{"value":"Japanese_GracefulMaiden","label":"Graceful Maiden","gender":"中性","language":"日语","description":"Graceful Maiden","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Japanese_GracefulMaiden.mp3"},{"value":"Korean_SweetGirl","label":"Sweet Girl","gender":"女声","language":"韩语","description":"Sweet Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_SweetGirl.mp3"},{"value":"Korean_CheerfulBoyfriend","label":"Cheerful Boyfriend","gender":"中性","language":"韩语","description":"Cheerful Boyfriend","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_CheerfulBoyfriend.mp3"},{"value":"Korean_EnchantingSister","label":"Enchanting Sister","gender":"中性","language":"韩语","description":"Enchanting Sister","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_EnchantingSister.mp3"},{"value":"Korean_ShyGirl","label":"Shy Girl","gender":"女声","language":"韩语","description":"Shy Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_ShyGirl.mp3"},{"value":"Korean_ReliableSister","label":"Reliable Sister","gender":"中性","language":"韩语","description":"Reliable Sister","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_ReliableSister.mp3"},{"value":"Korean_StrictBoss","label":"Strict Boss","gender":"中性","language":"韩语","description":"Strict Boss","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_StrictBoss.mp3"},{"value":"Korean_SassyGirl","label":"Sassy Girl","gender":"女声","language":"韩语","description":"Sassy Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_SassyGirl.mp3"},{"value":"Korean_ChildhoodFriendGirl","label":"Childhood Friend Girl","gender":"","language":"韩语","description":"Childhood Friend Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_ChildhoodFriendGirl.mp3"},{"value":"Korean_PlayboyCharmer","label":"Playboy Charmer","gender":"中性","language":"韩语","description":"Playboy Charmer","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_PlayboyCharmer.mp3"},{"value":"Korean_ElegantPrincess","label":"Elegant Princess","gender":"中性","language":"韩语","description":"Elegant Princess","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_ElegantPrincess.mp3"},{"value":"Korean_BraveFemaleWarrior","label":"Brave Female Warrior","gender":"女声","language":"韩语","description":"Brave Female Warrior","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_BraveFemaleWarrior.mp3"},{"value":"Korean_BraveYouth","label":"Brave Youth","gender":"中性","language":"韩语","description":"Brave Youth","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_BraveYouth.mp3"},{"value":"Korean_CalmLady","label":"Calm Lady","gender":"女声","language":"韩语","description":"Calm Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_CalmLady.mp3"},{"value":"Korean_EnthusiasticTeen","label":"Enthusiastic Teen","gender":"中性","language":"韩语","description":"Enthusiastic Teen","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_EnthusiasticTeen.mp3"},{"value":"Korean_SoothingLady","label":"Soothing Lady","gender":"女声","language":"韩语","description":"Soothing Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_SoothingLady.mp3"},{"value":"Korean_IntellectualSenior","label":"Intellectual Senior","gender":"中性","language":"韩语","description":"Intellectual Senior","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_IntellectualSenior.mp3"},{"value":"Korean_LonelyWarrior","label":"Lonely Warrior","gender":"中性","language":"韩语","description":"Lonely Warrior","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_LonelyWarrior.mp3"},{"value":"Korean_MatureLady","label":"Mature Lady","gender":"女声","language":"韩语","description":"Mature Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_MatureLady.mp3"},{"value":"Korean_InnocentBoy","label":"Innocent Boy","gender":"男声","language":"韩语","description":"Innocent Boy","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_InnocentBoy.mp3"},{"value":"Korean_CharmingSister","label":"Charming Sister","gender":"中性","language":"韩语","description":"Charming Sister","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_CharmingSister.mp3"},{"value":"Korean_AthleticStudent","label":"Athletic Student","gender":"中性","language":"韩语","description":"Athletic Student","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_AthleticStudent.mp3"},{"value":"Korean_BraveAdventurer","label":"Brave Adventurer","gender":"中性","language":"韩语","description":"Brave Adventurer","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_BraveAdventurer.mp3"},{"value":"Korean_CalmGentleman","label":"Calm Gentleman","gender":"男声","language":"韩语","description":"Calm Gentleman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_CalmGentleman.mp3"},{"value":"Korean_WiseElf","label":"Wise Elf","gender":"中性","language":"韩语","description":"Wise Elf","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_WiseElf.mp3"},{"value":"Korean_CheerfulCoolJunior","label":"Cheerful Cool Junior","gender":"中性","language":"韩语","description":"Cheerful Cool Junior","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_CheerfulCoolJunior.mp3"},{"value":"Korean_DecisiveQueen","label":"Decisive Queen","gender":"中性","language":"韩语","description":"Decisive Queen","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_DecisiveQueen.mp3"},{"value":"Korean_ColdYoungMan","label":"Cold Young Man","gender":"男声","language":"韩语","description":"Cold Young Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_ColdYoungMan.mp3"},{"value":"Korean_MysteriousGirl","label":"Mysterious Girl","gender":"女声","language":"韩语","description":"Mysterious Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_MysteriousGirl.mp3"},{"value":"Korean_QuirkyGirl","label":"Quirky Girl","gender":"女声","language":"韩语","description":"Quirky Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_QuirkyGirl.mp3"},{"value":"Korean_ConsiderateSenior","label":"Considerate Senior","gender":"中性","language":"韩语","description":"Considerate Senior","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_ConsiderateSenior.mp3"},{"value":"Korean_CheerfulLittleSister","label":"Cheerful Little Sister","gender":"中性","language":"韩语","description":"Cheerful Little Sister","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_CheerfulLittleSister.mp3"},{"value":"Korean_DominantMan","label":"Dominant Man","gender":"男声","language":"韩语","description":"Dominant Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_DominantMan.mp3"},{"value":"Korean_AirheadedGirl","label":"Airheaded Girl","gender":"女声","language":"韩语","description":"Airheaded Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_AirheadedGirl.mp3"},{"value":"Korean_ReliableYouth","label":"Reliable Youth","gender":"中性","language":"韩语","description":"Reliable Youth","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_ReliableYouth.mp3"},{"value":"Korean_FriendlyBigSister","label":"Friendly Big Sister","gender":"中性","language":"韩语","description":"Friendly Big Sister","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_FriendlyBigSister.mp3"},{"value":"Korean_GentleBoss","label":"Gentle Boss","gender":"中性","language":"韩语","description":"Gentle Boss","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_GentleBoss.mp3"},{"value":"Korean_ColdGirl","label":"Cold Girl","gender":"女声","language":"韩语","description":"Cold Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_ColdGirl.mp3"},{"value":"Korean_HaughtyLady","label":"Haughty Lady","gender":"女声","language":"韩语","description":"Haughty Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_HaughtyLady.mp3"},{"value":"Korean_CharmingElderSister","label":"Charming Elder Sister","gender":"中性","language":"韩语","description":"Charming Elder Sister","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_CharmingElderSister.mp3"},{"value":"Korean_IntellectualMan","label":"Intellectual Man","gender":"男声","language":"韩语","description":"Intellectual Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_IntellectualMan.mp3"},{"value":"Korean_CaringWoman","label":"Caring Woman","gender":"女声","language":"韩语","description":"Caring Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_CaringWoman.mp3"},{"value":"Korean_WiseTeacher","label":"Wise Teacher","gender":"中性","language":"韩语","description":"Wise Teacher","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_WiseTeacher.mp3"},{"value":"Korean_ConfidentBoss","label":"Confident Boss","gender":"中性","language":"韩语","description":"Confident Boss","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_ConfidentBoss.mp3"},{"value":"Korean_AthleticGirl","label":"Athletic Girl","gender":"女声","language":"韩语","description":"Athletic Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_AthleticGirl.mp3"},{"value":"Korean_PossessiveMan","label":"Possessive Man","gender":"男声","language":"韩语","description":"Possessive Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_PossessiveMan.mp3"},{"value":"Korean_GentleWoman","label":"Gentle Woman","gender":"女声","language":"韩语","description":"Gentle Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_GentleWoman.mp3"},{"value":"Korean_CockyGuy","label":"Cocky Guy","gender":"男声","language":"韩语","description":"Cocky Guy","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_CockyGuy.mp3"},{"value":"Korean_ThoughtfulWoman","label":"Thoughtful Woman","gender":"女声","language":"韩语","description":"Thoughtful Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_ThoughtfulWoman.mp3"},{"value":"Korean_OptimisticYouth","label":"Optimistic Youth","gender":"中性","language":"韩语","description":"Optimistic Youth","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Korean_OptimisticYouth.mp3"},{"value":"Spanish_SereneWoman","label":"Serene Woman","gender":"女声","language":"西班牙语","description":"Serene Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_SereneWoman.mp3"},{"value":"Spanish_MaturePartner","label":"Mature Partner","gender":"中性","language":"西班牙语","description":"Mature Partner","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_MaturePartner.mp3"},{"value":"Spanish_CaptivatingStoryteller","label":"Captivating Storyteller","gender":"中性","language":"西班牙语","description":"Captivating Storyteller","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_CaptivatingStoryteller.mp3"},{"value":"Spanish_Narrator","label":"Narrator","gender":"中性","language":"西班牙语","description":"Narrator","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_Narrator.mp3"},{"value":"Spanish_WiseScholar","label":"Wise Scholar","gender":"中性","language":"西班牙语","description":"Wise Scholar","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_WiseScholar.mp3"},{"value":"Spanish_Kind-heartedGirl","label":"Kind-hearted Girl","gender":"女声","language":"西班牙语","description":"Kind-hearted Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_Kind-heartedGirl.mp3"},{"value":"Spanish_DeterminedManager","label":"Determined Manager","gender":"中性","language":"西班牙语","description":"Determined Manager","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_DeterminedManager.mp3"},{"value":"Spanish_BossyLeader","label":"Bossy Leader","gender":"中性","language":"西班牙语","description":"Bossy Leader","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_BossyLeader.mp3"},{"value":"Spanish_ReservedYoungMan","label":"Reserved Young Man","gender":"男声","language":"西班牙语","description":"Reserved Young Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_ReservedYoungMan.mp3"},{"value":"Spanish_ConfidentWoman","label":"Confident Woman","gender":"女声","language":"西班牙语","description":"Confident Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_ConfidentWoman.mp3"},{"value":"Spanish_ThoughtfulMan","label":"Thoughtful Man","gender":"男声","language":"西班牙语","description":"Thoughtful Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_ThoughtfulMan.mp3"},{"value":"Spanish_Strong-WilledBoy","label":"Strong-willed Boy","gender":"男声","language":"西班牙语","description":"Strong-willed Boy","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_Strong-WilledBoy.mp3"},{"value":"Spanish_SophisticatedLady","label":"Sophisticated Lady","gender":"女声","language":"西班牙语","description":"Sophisticated Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_SophisticatedLady.mp3"},{"value":"Spanish_RationalMan","label":"Rational Man","gender":"男声","language":"西班牙语","description":"Rational Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_RationalMan.mp3"},{"value":"Spanish_AnimeCharacter","label":"Anime Character","gender":"中性","language":"西班牙语","description":"Anime Character","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_AnimeCharacter.mp3"},{"value":"Spanish_Deep-tonedMan","label":"Deep-toned Man","gender":"男声","language":"西班牙语","description":"Deep-toned Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_Deep-tonedMan.mp3"},{"value":"Spanish_Fussyhostess","label":"Fussy hostess","gender":"中性","language":"西班牙语","description":"Fussy hostess","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_Fussyhostess.mp3"},{"value":"Spanish_SincereTeen","label":"Sincere Teen","gender":"中性","language":"西班牙语","description":"Sincere Teen","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_SincereTeen.mp3"},{"value":"Spanish_FrankLady","label":"Frank Lady","gender":"女声","language":"西班牙语","description":"Frank Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_FrankLady.mp3"},{"value":"Spanish_Comedian","label":"Comedian","gender":"中性","language":"西班牙语","description":"Comedian","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_Comedian.mp3"},{"value":"Spanish_Debator","label":"Debator","gender":"中性","language":"西班牙语","description":"Debator","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_Debator.mp3"},{"value":"Spanish_ToughBoss","label":"Tough Boss","gender":"中性","language":"西班牙语","description":"Tough Boss","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_ToughBoss.mp3"},{"value":"Spanish_Wiselady","label":"Wise Lady","gender":"女声","language":"西班牙语","description":"Wise Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_Wiselady.mp3"},{"value":"Spanish_Steadymentor","label":"Steady Mentor","gender":"中性","language":"西班牙语","description":"Steady Mentor","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_Steadymentor.mp3"},{"value":"Spanish_Jovialman","label":"Jovial Man","gender":"男声","language":"西班牙语","description":"Jovial Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_Jovialman.mp3"},{"value":"Spanish_SantaClaus","label":"Santa Claus","gender":"中性","language":"西班牙语","description":"Santa Claus","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_SantaClaus.mp3"},{"value":"Spanish_Rudolph","label":"Rudolph","gender":"中性","language":"西班牙语","description":"Rudolph","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_Rudolph.mp3"},{"value":"Spanish_Intonategirl","label":"Intonate Girl","gender":"女声","language":"西班牙语","description":"Intonate Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_Intonategirl.mp3"},{"value":"Spanish_Arnold","label":"Arnold","gender":"中性","language":"西班牙语","description":"Arnold","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_Arnold.mp3"},{"value":"Spanish_Ghost","label":"Ghost","gender":"中性","language":"西班牙语","description":"Ghost","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_Ghost.mp3"},{"value":"Spanish_HumorousElder","label":"Humorous Elder","gender":"中性","language":"西班牙语","description":"Humorous Elder","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_HumorousElder.mp3"},{"value":"Spanish_EnergeticBoy","label":"Energetic Boy","gender":"男声","language":"西班牙语","description":"Energetic Boy","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_EnergeticBoy.mp3"},{"value":"Spanish_WhimsicalGirl","label":"Whimsical Girl","gender":"女声","language":"西班牙语","description":"Whimsical Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_WhimsicalGirl.mp3"},{"value":"Spanish_StrictBoss","label":"Strict Boss","gender":"中性","language":"西班牙语","description":"Strict Boss","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_StrictBoss.mp3"},{"value":"Spanish_ReliableMan","label":"Reliable Man","gender":"男声","language":"西班牙语","description":"Reliable Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_ReliableMan.mp3"},{"value":"Spanish_SereneElder","label":"Serene Elder","gender":"中性","language":"西班牙语","description":"Serene Elder","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_SereneElder.mp3"},{"value":"Spanish_AngryMan","label":"Angry Man","gender":"男声","language":"西班牙语","description":"Angry Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_AngryMan.mp3"},{"value":"Spanish_AssertiveQueen","label":"Assertive Queen","gender":"中性","language":"西班牙语","description":"Assertive Queen","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_AssertiveQueen.mp3"},{"value":"Spanish_CaringGirlfriend","label":"Caring Girlfriend","gender":"中性","language":"西班牙语","description":"Caring Girlfriend","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_CaringGirlfriend.mp3"},{"value":"Spanish_PowerfulSoldier","label":"Powerful Soldier","gender":"中性","language":"西班牙语","description":"Powerful Soldier","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_PowerfulSoldier.mp3"},{"value":"Spanish_PassionateWarrior","label":"Passionate Warrior","gender":"中性","language":"西班牙语","description":"Passionate Warrior","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_PassionateWarrior.mp3"},{"value":"Spanish_ChattyGirl","label":"Chatty Girl","gender":"女声","language":"西班牙语","description":"Chatty Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_ChattyGirl.mp3"},{"value":"Spanish_RomanticHusband","label":"Romantic Husband","gender":"中性","language":"西班牙语","description":"Romantic Husband","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_RomanticHusband.mp3"},{"value":"Spanish_CompellingGirl","label":"Compelling Girl","gender":"女声","language":"西班牙语","description":"Compelling Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_CompellingGirl.mp3"},{"value":"Spanish_PowerfulVeteran","label":"Powerful Veteran","gender":"中性","language":"西班牙语","description":"Powerful Veteran","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_PowerfulVeteran.mp3"},{"value":"Spanish_SensibleManager","label":"Sensible Manager","gender":"中性","language":"西班牙语","description":"Sensible Manager","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_SensibleManager.mp3"},{"value":"Spanish_ThoughtfulLady","label":"Thoughtful Lady","gender":"女声","language":"西班牙语","description":"Thoughtful Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Spanish_ThoughtfulLady.mp3"},{"value":"Portuguese_SentimentalLady","label":"Sentimental Lady","gender":"女声","language":"葡萄牙语","description":"Sentimental Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_SentimentalLady.mp3"},{"value":"Portuguese_BossyLeader","label":"Bossy Leader","gender":"中性","language":"葡萄牙语","description":"Bossy Leader","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_BossyLeader.mp3"},{"value":"Portuguese_Wiselady","label":"Wise lady","gender":"女声","language":"葡萄牙语","description":"Wise lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Wiselady.mp3"},{"value":"Portuguese_Strong-WilledBoy","label":"Strong-willed Boy","gender":"男声","language":"葡萄牙语","description":"Strong-willed Boy","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Strong-WilledBoy.mp3"},{"value":"Portuguese_Deep-VoicedGentleman","label":"Deep-voiced Gentleman","gender":"男声","language":"葡萄牙语","description":"Deep-voiced Gentleman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Deep-VoicedGentleman.mp3"},{"value":"Portuguese_UpsetGirl","label":"Upset Girl","gender":"女声","language":"葡萄牙语","description":"Upset Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_UpsetGirl.mp3"},{"value":"Portuguese_PassionateWarrior","label":"Passionate Warrior","gender":"中性","language":"葡萄牙语","description":"Passionate Warrior","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_PassionateWarrior.mp3"},{"value":"Portuguese_AnimeCharacter","label":"Anime Character","gender":"中性","language":"葡萄牙语","description":"Anime Character","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_AnimeCharacter.mp3"},{"value":"Portuguese_ConfidentWoman","label":"Confident Woman","gender":"女声","language":"葡萄牙语","description":"Confident Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_ConfidentWoman.mp3"},{"value":"Portuguese_AngryMan","label":"Angry Man","gender":"男声","language":"葡萄牙语","description":"Angry Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_AngryMan.mp3"},{"value":"Portuguese_CaptivatingStoryteller","label":"Captivating Storyteller","gender":"中性","language":"葡萄牙语","description":"Captivating Storyteller","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_CaptivatingStoryteller.mp3"},{"value":"Portuguese_Godfather","label":"Godfather","gender":"中性","language":"葡萄牙语","description":"Godfather","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Godfather.mp3"},{"value":"Portuguese_ReservedYoungMan","label":"Reserved Young Man","gender":"男声","language":"葡萄牙语","description":"Reserved Young Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_ReservedYoungMan.mp3"},{"value":"Portuguese_SmartYoungGirl","label":"Smart Young Girl","gender":"女声","language":"葡萄牙语","description":"Smart Young Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_SmartYoungGirl.mp3"},{"value":"Portuguese_Kind-heartedGirl","label":"Kind-hearted Girl","gender":"女声","language":"葡萄牙语","description":"Kind-hearted Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Kind-heartedGirl.mp3"},{"value":"Portuguese_Pompouslady","label":"Pompous lady","gender":"女声","language":"葡萄牙语","description":"Pompous lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Pompouslady.mp3"},{"value":"Portuguese_Grinch","label":"Grinch","gender":"中性","language":"葡萄牙语","description":"Grinch","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Grinch.mp3"},{"value":"Portuguese_Debator","label":"Debator","gender":"中性","language":"葡萄牙语","description":"Debator","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Debator.mp3"},{"value":"Portuguese_SweetGirl","label":"Sweet Girl","gender":"女声","language":"葡萄牙语","description":"Sweet Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_SweetGirl.mp3"},{"value":"Portuguese_AttractiveGirl","label":"Attractive Girl","gender":"女声","language":"葡萄牙语","description":"Attractive Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_AttractiveGirl.mp3"},{"value":"Portuguese_ThoughtfulMan","label":"Thoughtful Man","gender":"男声","language":"葡萄牙语","description":"Thoughtful Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_ThoughtfulMan.mp3"},{"value":"Portuguese_PlayfulGirl","label":"Playful Girl","gender":"女声","language":"葡萄牙语","description":"Playful Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_PlayfulGirl.mp3"},{"value":"Portuguese_GorgeousLady","label":"Gorgeous Lady","gender":"女声","language":"葡萄牙语","description":"Gorgeous Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_GorgeousLady.mp3"},{"value":"Portuguese_LovelyLady","label":"Lovely Lady","gender":"女声","language":"葡萄牙语","description":"Lovely Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_LovelyLady.mp3"},{"value":"Portuguese_SereneWoman","label":"Serene Woman","gender":"女声","language":"葡萄牙语","description":"Serene Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_SereneWoman.mp3"},{"value":"Portuguese_SadTeen","label":"Sad Teen","gender":"中性","language":"葡萄牙语","description":"Sad Teen","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_SadTeen.mp3"},{"value":"Portuguese_MaturePartner","label":"Mature Partner","gender":"中性","language":"葡萄牙语","description":"Mature Partner","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_MaturePartner.mp3"},{"value":"Portuguese_Comedian","label":"Comedian","gender":"中性","language":"葡萄牙语","description":"Comedian","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Comedian.mp3"},{"value":"Portuguese_NaughtySchoolgirl","label":"Naughty Schoolgirl","gender":"中性","language":"葡萄牙语","description":"Naughty Schoolgirl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_NaughtySchoolgirl.mp3"},{"value":"Portuguese_Narrator","label":"Narrator","gender":"中性","language":"葡萄牙语","description":"Narrator","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Narrator.mp3"},{"value":"Portuguese_ToughBoss","label":"Tough Boss","gender":"中性","language":"葡萄牙语","description":"Tough Boss","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_ToughBoss.mp3"},{"value":"Portuguese_Fussyhostess","label":"Fussy hostess","gender":"中性","language":"葡萄牙语","description":"Fussy hostess","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Fussyhostess.mp3"},{"value":"Portuguese_Dramatist","label":"Dramatist","gender":"中性","language":"葡萄牙语","description":"Dramatist","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Dramatist.mp3"},{"value":"Portuguese_Steadymentor","label":"Steady Mentor","gender":"中性","language":"葡萄牙语","description":"Steady Mentor","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Steadymentor.mp3"},{"value":"Portuguese_Jovialman","label":"Jovial Man","gender":"男声","language":"葡萄牙语","description":"Jovial Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Jovialman.mp3"},{"value":"Portuguese_CharmingQueen","label":"Charming Queen","gender":"中性","language":"葡萄牙语","description":"Charming Queen","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_CharmingQueen.mp3"},{"value":"Portuguese_SantaClaus","label":"Santa Claus","gender":"中性","language":"葡萄牙语","description":"Santa Claus","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_SantaClaus.mp3"},{"value":"Portuguese_Rudolph","label":"Rudolph","gender":"中性","language":"葡萄牙语","description":"Rudolph","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Rudolph.mp3"},{"value":"Portuguese_Arnold","label":"Arnold","gender":"中性","language":"葡萄牙语","description":"Arnold","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Arnold.mp3"},{"value":"Portuguese_CharmingSanta","label":"Charming Santa","gender":"中性","language":"葡萄牙语","description":"Charming Santa","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_CharmingSanta.mp3"},{"value":"Portuguese_CharmingLady","label":"Charming Lady","gender":"女声","language":"葡萄牙语","description":"Charming Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_CharmingLady.mp3"},{"value":"Portuguese_Ghost","label":"Ghost","gender":"中性","language":"葡萄牙语","description":"Ghost","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Ghost.mp3"},{"value":"Portuguese_HumorousElder","label":"Humorous Elder","gender":"中性","language":"葡萄牙语","description":"Humorous Elder","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_HumorousElder.mp3"},{"value":"Portuguese_CalmLeader","label":"Calm Leader","gender":"中性","language":"葡萄牙语","description":"Calm Leader","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_CalmLeader.mp3"},{"value":"Portuguese_GentleTeacher","label":"Gentle Teacher","gender":"中性","language":"葡萄牙语","description":"Gentle Teacher","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_GentleTeacher.mp3"},{"value":"Portuguese_EnergeticBoy","label":"Energetic Boy","gender":"男声","language":"葡萄牙语","description":"Energetic Boy","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_EnergeticBoy.mp3"},{"value":"Portuguese_ReliableMan","label":"Reliable Man","gender":"男声","language":"葡萄牙语","description":"Reliable Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_ReliableMan.mp3"},{"value":"Portuguese_SereneElder","label":"Serene Elder","gender":"中性","language":"葡萄牙语","description":"Serene Elder","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_SereneElder.mp3"},{"value":"Portuguese_GrimReaper","label":"Grim Reaper","gender":"中性","language":"葡萄牙语","description":"Grim Reaper","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_GrimReaper.mp3"},{"value":"Portuguese_AssertiveQueen","label":"Assertive Queen","gender":"中性","language":"葡萄牙语","description":"Assertive Queen","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_AssertiveQueen.mp3"},{"value":"Portuguese_WhimsicalGirl","label":"Whimsical Girl","gender":"女声","language":"葡萄牙语","description":"Whimsical Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_WhimsicalGirl.mp3"},{"value":"Portuguese_StressedLady","label":"Stressed Lady","gender":"女声","language":"葡萄牙语","description":"Stressed Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_StressedLady.mp3"},{"value":"Portuguese_FriendlyNeighbor","label":"Friendly Neighbor","gender":"中性","language":"葡萄牙语","description":"Friendly Neighbor","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_FriendlyNeighbor.mp3"},{"value":"Portuguese_CaringGirlfriend","label":"Caring Girlfriend","gender":"中性","language":"葡萄牙语","description":"Caring Girlfriend","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_CaringGirlfriend.mp3"},{"value":"Portuguese_PowerfulSoldier","label":"Powerful Soldier","gender":"中性","language":"葡萄牙语","description":"Powerful Soldier","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_PowerfulSoldier.mp3"},{"value":"Portuguese_FascinatingBoy","label":"Fascinating Boy","gender":"男声","language":"葡萄牙语","description":"Fascinating Boy","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_FascinatingBoy.mp3"},{"value":"Portuguese_RomanticHusband","label":"Romantic Husband","gender":"中性","language":"葡萄牙语","description":"Romantic Husband","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_RomanticHusband.mp3"},{"value":"Portuguese_StrictBoss","label":"Strict Boss","gender":"中性","language":"葡萄牙语","description":"Strict Boss","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_StrictBoss.mp3"},{"value":"Portuguese_InspiringLady","label":"Inspiring Lady","gender":"女声","language":"葡萄牙语","description":"Inspiring Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_InspiringLady.mp3"},{"value":"Portuguese_PlayfulSpirit","label":"Playful Spirit","gender":"中性","language":"葡萄牙语","description":"Playful Spirit","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_PlayfulSpirit.mp3"},{"value":"Portuguese_ElegantGirl","label":"Elegant Girl","gender":"女声","language":"葡萄牙语","description":"Elegant Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_ElegantGirl.mp3"},{"value":"Portuguese_CompellingGirl","label":"Compelling Girl","gender":"女声","language":"葡萄牙语","description":"Compelling Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_CompellingGirl.mp3"},{"value":"Portuguese_PowerfulVeteran","label":"Powerful Veteran","gender":"中性","language":"葡萄牙语","description":"Powerful Veteran","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_PowerfulVeteran.mp3"},{"value":"Portuguese_SensibleManager","label":"Sensible Manager","gender":"中性","language":"葡萄牙语","description":"Sensible Manager","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_SensibleManager.mp3"},{"value":"Portuguese_ThoughtfulLady","label":"Thoughtful Lady","gender":"女声","language":"葡萄牙语","description":"Thoughtful Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_ThoughtfulLady.mp3"},{"value":"Portuguese_TheatricalActor","label":"Theatrical Actor","gender":"中性","language":"葡萄牙语","description":"Theatrical Actor","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_TheatricalActor.mp3"},{"value":"Portuguese_FragileBoy","label":"Fragile Boy","gender":"男声","language":"葡萄牙语","description":"Fragile Boy","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_FragileBoy.mp3"},{"value":"Portuguese_ChattyGirl","label":"Chatty Girl","gender":"女声","language":"葡萄牙语","description":"Chatty Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_ChattyGirl.mp3"},{"value":"Portuguese_Conscientiousinstructor","label":"Conscientious Instructor","gender":"中性","language":"葡萄牙语","description":"Conscientious Instructor","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_Conscientiousinstructor.mp3"},{"value":"Portuguese_RationalMan","label":"Rational Man","gender":"男声","language":"葡萄牙语","description":"Rational Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_RationalMan.mp3"},{"value":"Portuguese_WiseScholar","label":"Wise Scholar","gender":"中性","language":"葡萄牙语","description":"Wise Scholar","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_WiseScholar.mp3"},{"value":"Portuguese_FrankLady","label":"Frank Lady","gender":"女声","language":"葡萄牙语","description":"Frank Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_FrankLady.mp3"},{"value":"Portuguese_DeterminedManager","label":"Determined Manager","gender":"中性","language":"葡萄牙语","description":"Determined Manager","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Portuguese_DeterminedManager.mp3"},{"value":"French_Male_Speech_New","label":"Level-Headed Man","gender":"男声","language":"法语","description":"Level-Headed Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/French_Male_Speech_New.mp3"},{"value":"French_Female_News Anchor","label":"Patient Female Presenter","gender":"女声","language":"法语","description":"Patient Female Presenter","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/French_Female_News_Anchor.mp3"},{"value":"French_CasualMan","label":"Casual Man","gender":"男声","language":"法语","description":"Casual Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/French_CasualMan.mp3"},{"value":"French_MovieLeadFemale","label":"Movie Lead Female","gender":"女声","language":"法语","description":"Movie Lead Female","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/French_MovieLeadFemale.mp3"},{"value":"French_FemaleAnchor","label":"Female Anchor","gender":"女声","language":"法语","description":"Female Anchor","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/French_FemaleAnchor.mp3"},{"value":"French_MaleNarrator","label":"Male Narrator","gender":"男声","language":"法语","description":"Male Narrator","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/French_MaleNarrator.mp3"},{"value":"Indonesian_SweetGirl","label":"Sweet Girl","gender":"女声","language":"id","description":"Sweet Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Indonesian_SweetGirl.mp3"},{"value":"Indonesian_ReservedYoungMan","label":"Reserved Young Man","gender":"男声","language":"id","description":"Reserved Young Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Indonesian_ReservedYoungMan.mp3"},{"value":"Indonesian_CharmingGirl","label":"Charming Girl","gender":"女声","language":"id","description":"Charming Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Indonesian_CharmingGirl.mp3"},{"value":"Indonesian_CalmWoman","label":"Calm Woman","gender":"女声","language":"id","description":"Calm Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Indonesian_CalmWoman.mp3"},{"value":"Indonesian_ConfidentWoman","label":"Confident Woman","gender":"女声","language":"id","description":"Confident Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Indonesian_ConfidentWoman.mp3"},{"value":"Indonesian_CaringMan","label":"Caring Man","gender":"男声","language":"id","description":"Caring Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Indonesian_CaringMan.mp3"},{"value":"Indonesian_BossyLeader","label":"Bossy Leader","gender":"中性","language":"id","description":"Bossy Leader","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Indonesian_BossyLeader.mp3"},{"value":"Indonesian_DeterminedBoy","label":"Determined Boy","gender":"男声","language":"id","description":"Determined Boy","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Indonesian_DeterminedBoy.mp3"},{"value":"Indonesian_GentleGirl","label":"Gentle Girl","gender":"女声","language":"id","description":"Gentle Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Indonesian_GentleGirl.mp3"},{"value":"German_FriendlyMan","label":"Friendly Man","gender":"男声","language":"德语","description":"Friendly Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/German_FriendlyMan.mp3"},{"value":"German_SweetLady","label":"Sweet Lady","gender":"女声","language":"德语","description":"Sweet Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/German_SweetLady.mp3"},{"value":"German_PlayfulMan","label":"Playful Man","gender":"男声","language":"德语","description":"Playful Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/German_PlayfulMan.mp3"},{"value":"Russian_HandsomeChildhoodFriend","label":"Handsome Childhood Friend","gender":"","language":"俄语","description":"Handsome Childhood Friend","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Russian_HandsomeChildhoodFriend.mp3"},{"value":"Russian_BrightHeroine","label":"Bright Queen","gender":"中性","language":"俄语","description":"Bright Queen","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Russian_BrightHeroine.mp3"},{"value":"Russian_AmbitiousWoman","label":"Ambitious Woman","gender":"女声","language":"俄语","description":"Ambitious Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Russian_AmbitiousWoman.mp3"},{"value":"Russian_ReliableMan","label":"Reliable Man","gender":"男声","language":"俄语","description":"Reliable Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Russian_ReliableMan.mp3"},{"value":"Russian_CrazyQueen","label":"Crazy Girl","gender":"女声","language":"俄语","description":"Crazy Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Russian_CrazyQueen.mp3"},{"value":"Russian_PessimisticGirl","label":"Pessimistic Girl","gender":"女声","language":"俄语","description":"Pessimistic Girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Russian_PessimisticGirl.mp3"},{"value":"Russian_AttractiveGuy","label":"Attractive Guy","gender":"男声","language":"俄语","description":"Attractive Guy","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Russian_AttractiveGuy.mp3"},{"value":"Russian_Bad-temperedBoy","label":"Bad-tempered Boy","gender":"男声","language":"俄语","description":"Bad-tempered Boy","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Russian_Bad-temperedBoy.mp3"},{"value":"Italian_BraveHeroine","label":"Brave Heroine","gender":"中性","language":"it","description":"Brave Heroine","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Italian_BraveHeroine.mp3"},{"value":"Italian_Narrator","label":"Narrator","gender":"中性","language":"it","description":"Narrator","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Italian_Narrator.mp3"},{"value":"Italian_WanderingSorcerer","label":"Wandering Sorcerer","gender":"中性","language":"it","description":"Wandering Sorcerer","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Italian_WanderingSorcerer.mp3"},{"value":"Italian_DiligentLeader","label":"Diligent Leader","gender":"中性","language":"it","description":"Diligent Leader","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Italian_DiligentLeader.mp3"},{"value":"Arabic_CalmWoman","label":"Calm Woman","gender":"女声","language":"ar","description":"Calm Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Arabic_CalmWoman.mp3"},{"value":"Arabic_FriendlyGuy","label":"Friendly Guy","gender":"男声","language":"ar","description":"Friendly Guy","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Arabic_FriendlyGuy.mp3"},{"value":"Turkish_CalmWoman","label":"Calm Woman","gender":"女声","language":"tr","description":"Calm Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Turkish_CalmWoman.mp3"},{"value":"Turkish_Trustworthyman","label":"Trustworthy man","gender":"男声","language":"tr","description":"Trustworthy man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Turkish_Trustworthyman.mp3"},{"value":"Ukrainian_CalmWoman","label":"Calm Woman","gender":"女声","language":"uk","description":"Calm Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Ukrainian_CalmWoman.mp3"},{"value":"Ukrainian_WiseScholar","label":"Wise Scholar","gender":"中性","language":"uk","description":"Wise Scholar","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Ukrainian_WiseScholar.mp3"},{"value":"Dutch_kindhearted_girl","label":"Kind-hearted girl","gender":"女声","language":"nl","description":"Kind-hearted girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Dutch_kindhearted_girl.mp3"},{"value":"Dutch_bossy_leader","label":"Bossy leader","gender":"中性","language":"nl","description":"Bossy leader","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Dutch_bossy_leader.mp3"},{"value":"Vietnamese_kindhearted_girl","label":"Kind-hearted girl","gender":"女声","language":"vi","description":"Kind-hearted girl","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Vietnamese_kindhearted_girl.mp3"},{"value":"Thai_male_1_sample8","label":"Serene Man","gender":"男声","language":"th","description":"Serene Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Thai_male_1_sample8.mp3"},{"value":"Thai_male_2_sample2","label":"Friendly Man","gender":"男声","language":"th","description":"Friendly Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Thai_male_2_sample2.mp3"},{"value":"Thai_female_1_sample1","label":"Confident Woman","gender":"女声","language":"th","description":"Confident Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Thai_female_1_sample1.mp3"},{"value":"Thai_female_2_sample2","label":"Energetic Woman","gender":"女声","language":"th","description":"Energetic Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Thai_female_2_sample2.mp3"},{"value":"Polish_male_1_sample4","label":"Male Narrator","gender":"男声","language":"pl","description":"Male Narrator","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Polish_male_1_sample4.mp3"},{"value":"Polish_male_2_sample3","label":"Male Anchor","gender":"男声","language":"pl","description":"Male Anchor","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Polish_male_2_sample3.mp3"},{"value":"Polish_female_1_sample1","label":"Calm Woman","gender":"女声","language":"pl","description":"Calm Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Polish_female_1_sample1.mp3"},{"value":"Polish_female_2_sample3","label":"Casual Woman","gender":"女声","language":"pl","description":"Casual Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Polish_female_2_sample3.mp3"},{"value":"Romanian_male_1_sample2","label":"Reliable Man","gender":"男声","language":"ro","description":"Reliable Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Romanian_male_1_sample2.mp3"},{"value":"Romanian_male_2_sample1","label":"Energetic Youth","gender":"男声","language":"ro","description":"Energetic Youth","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Romanian_male_2_sample1.mp3"},{"value":"Romanian_female_1_sample4","label":"Optimistic Youth","gender":"女声","language":"ro","description":"Optimistic Youth","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Romanian_female_1_sample4.mp3"},{"value":"Romanian_female_2_sample1","label":"Gentle Woman","gender":"女声","language":"ro","description":"Gentle Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Romanian_female_2_sample1.mp3"},{"value":"greek_male_1a_v1","label":"Thoughtful Mentor","gender":"男声","language":"el","description":"Thoughtful Mentor","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/greek_male_1a_v1.mp3"},{"value":"Greek_female_1_sample1","label":"Gentle Lady","gender":"女声","language":"el","description":"Gentle Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Greek_female_1_sample1.mp3"},{"value":"Greek_female_2_sample3","label":"Girl Next Door","gender":"女声","language":"el","description":"Girl Next Door","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/Greek_female_2_sample3.mp3"},{"value":"czech_male_1_v1","label":"Assured Presenter","gender":"男声","language":"cs","description":"Assured Presenter","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/czech_male_1_v1.mp3"},{"value":"czech_female_5_v7","label":"Steadfast Narrator","gender":"女声","language":"cs","description":"Steadfast Narrator","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/czech_female_5_v7.mp3"},{"value":"czech_female_2_v2","label":"Elegant Lady","gender":"女声","language":"cs","description":"Elegant Lady","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/czech_female_2_v2.mp3"},{"value":"finnish_male_3_v1","label":"Upbeat Man","gender":"男声","language":"fi","description":"Upbeat Man","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/finnish_male_3_v1.mp3"},{"value":"finnish_male_1_v2","label":"Friendly Boy","gender":"男声","language":"fi","description":"Friendly Boy","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/finnish_male_1_v2.mp3"},{"value":"finnish_female_4_v1","label":"Assetive Woman","gender":"女声","language":"fi","description":"Assetive Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/finnish_female_4_v1.mp3"},{"value":"hindi_male_1_v2","label":"Trustworthy Advisor","gender":"男声","language":"hi","description":"Trustworthy Advisor","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/hindi_male_1_v2.mp3"},{"value":"hindi_female_2_v1","label":"Tranquil Woman","gender":"女声","language":"hi","description":"Tranquil Woman","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/hindi_female_2_v1.mp3"},{"value":"hindi_female_1_v2","label":"News Anchor","gender":"女声","language":"hi","description":"News Anchor","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/hindi_female_1_v2.mp3"},{"value":"audiobook_male_1","label":"audiobook_male_1","gender":"男声","language":"中文","description":"有声书 · 沉稳","previewUrl":"https://cdn.token6688.com/voice-previews/minimax/audiobook_male_1.mp3"}]},{"field":"speed","title":"语速","type":"select","value":"1","options":[{"value":"0.5","label":"0.5x"},{"value":"0.75","label":"0.75x"},{"value":"1","label":"1.0x"},{"value":"1.25","label":"1.25x"},{"value":"1.5","label":"1.5x"},{"value":"2","label":"2.0x"}],"props":{"teleported":false,"placement":"top-start","filterable":false}},{"field":"pitch","title":"变声","type":"select","value":"0","options":[{"value":"-6","label":"低沉"},{"value":"-3","label":"偏低"},{"value":"0","label":"原声"},{"value":"3","label":"偏高"},{"value":"6","label":"高亮"}],"props":{"teleported":false,"placement":"top-start","filterable":false}},{"field":"emotion","title":"情绪","type":"select","value":"auto","options":[{"value":"auto","label":"自动"},{"value":"happy","label":"开心"},{"value":"sad","label":"悲伤"},{"value":"angry","label":"愤怒"},{"value":"fearful","label":"害怕"},{"value":"surprised","label":"惊讶"},{"value":"calm","label":"平静"}],"props":{"teleported":false,"placement":"top-start","filterable":false}},{"field":"soundEffects","title":"音效","type":"select","value":"none","options":[{"value":"none","label":"无"},{"value":"spacious_echo","label":"空旷回音"},{"value":"auditorium_echo","label":"礼堂广播"},{"value":"lofi_telephone","label":"电话失真"},{"value":"robotic","label":"电音"}],"props":{"teleported":false,"placement":"top-start","filterable":false}}]},
    {"id":"voice-design","label":"海螺 音色设计","type":"audio","maxReferenceImages":0,"promptOptional":false,"audioOptions":{"nativeParameters":true,"referenceLimits":{"default":0}},"rules":[{"field":"voiceId","title":"音色 ID","type":"input","value":"","props":{},"validate":[{"required":true,"message":"请填写音色 ID"}]},{"field":"previewText","title":"试听文本","type":"input","value":"","props":{"type":"textarea","autosize":{"minRows":2,"maxRows":5}},"validate":[{"required":true,"message":"请填写试听文本"}]}]},
    {"id":"voice-clone","label":"海螺 音色克隆","type":"audio","maxReferenceImages":0,"promptOptional":true,"audioOptions":{"nativeParameters":true,"referenceLimits":{"default":1}},"rules":[{"field":"voiceId","title":"音色 ID","type":"input","value":"","props":{},"validate":[{"required":true,"message":"请填写音色 ID"}]},{"field":"sampleUrl","title":"音频样本","type":"input","value":"","props":{},"validate":[{"required":true,"message":"请填写音频样本"}]}]},
    {"id":"doubao-tts-2.0","label":"豆包 语音合成 2.0","type":"audio","maxReferenceImages":0,"promptOptional":false,"audioOptions":{"nativeParameters":true,"referenceLimits":{"default":0}},"rules":[{"field":"voice","title":"音色","type":"input","value":"","props":{},"validate":[{"required":true,"message":"请填写音色"}],"voiceLibrary":[{"value":"zh_female_vv_uranus_bigtts","label":"Vivi 2.0","gender":"女声","language":"多语种","description":"多语种、方言支持","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_vv_uranus_bigtts.mp3"},{"value":"zh_female_xiaohe_uranus_bigtts","label":"小何 2.0","gender":"女声","language":"中文","description":"清新自然","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_xiaohe_uranus_bigtts.mp3"},{"value":"zh_male_m191_uranus_bigtts","label":"云舟 2.0","gender":"男声","language":"中文","description":"成熟稳重","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_male_m191_uranus_bigtts.mp3"},{"value":"zh_male_taocheng_uranus_bigtts","label":"小天 2.0","gender":"男声","language":"中文","description":"年轻活力","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_male_taocheng_uranus_bigtts.mp3"},{"value":"zh_male_liufei_uranus_bigtts","label":"刘飞 2.0","gender":"男声","language":"中文","description":"磁性低沉","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_male_liufei_uranus_bigtts.mp3"},{"value":"zh_male_sophie_uranus_bigtts","label":"魅力苏菲 2.0","gender":"女声","language":"中文","description":"温柔魅力","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_male_sophie_uranus_bigtts.mp3"},{"value":"zh_female_qingxinnvsheng_uranus_bigtts","label":"清新女声 2.0","gender":"女声","language":"中文","description":"清新自然","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_qingxinnvsheng_uranus_bigtts.mp3"},{"value":"zh_female_tianmeixiaoyuan_uranus_bigtts","label":"甜美小源 2.0","gender":"女声","language":"中文","description":"甜美可爱","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_tianmeixiaoyuan_uranus_bigtts.mp3"},{"value":"zh_female_tianmeitaozi_uranus_bigtts","label":"甜美桃子 2.0","gender":"女声","language":"中文","description":"甜美活泼","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_tianmeitaozi_uranus_bigtts.mp3"},{"value":"zh_female_shuangkuaisisi_uranus_bigtts","label":"爽快思思 2.0","gender":"女声","language":"中文","description":"爽朗大方","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_shuangkuaisisi_uranus_bigtts.mp3"},{"value":"zh_female_linjianvhai_uranus_bigtts","label":"邻家女孩 2.0","gender":"女声","language":"中文","description":"亲切温和","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_linjianvhai_uranus_bigtts.mp3"},{"value":"zh_male_shaonianzixin_uranus_bigtts","label":"少年梓辛 2.0","gender":"男声","language":"中文","description":"少年感","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_male_shaonianzixin_uranus_bigtts.mp3"},{"value":"zh_female_meilinvyou_uranus_bigtts","label":"魅力女友 2.0","gender":"女声","language":"中文","description":"温柔魅力","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_meilinvyou_uranus_bigtts.mp3"},{"value":"zh_female_cancan_uranus_bigtts","label":"知性灣灣 2.0","gender":"女声","language":"中文","description":"知性优雅","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_cancan_uranus_bigtts.mp3"},{"value":"zh_female_sajiaoxuemei_uranus_bigtts","label":"撒娇学妹 2.0","gender":"女声","language":"中文","description":"可爱撒娇","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_sajiaoxuemei_uranus_bigtts.mp3"},{"value":"saturn_zh_female_keainvsheng_tob","label":"可爱女生","gender":"女声","language":"中文","description":"可爱活泼","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/saturn_zh_female_keainvsheng_tob.mp3"},{"value":"saturn_zh_female_tiaopigongzhu_tob","label":"调皮公主","gender":"女声","language":"中文","description":"调皮可爱","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/saturn_zh_female_tiaopigongzhu_tob.mp3"},{"value":"saturn_zh_male_shuanglangshaonian_tob","label":"爽朗少年","gender":"男声","language":"中文","description":"少年感","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/saturn_zh_male_shuanglangshaonian_tob.mp3"},{"value":"saturn_zh_male_tiancaitongzhuo_tob","label":"天才同桌","gender":"男声","language":"中文","description":"聪明活泼","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/saturn_zh_male_tiancaitongzhuo_tob.mp3"},{"value":"saturn_zh_female_cancan_tob","label":"知性灣灣","gender":"女声","language":"中文","description":"知性优雅","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/saturn_zh_female_cancan_tob.mp3"},{"value":"zh_female_peiqi_uranus_bigtts","label":"佩奇猪 2.0","gender":"女声","language":"中文","description":"可爱卡通","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_peiqi_uranus_bigtts.mp3"},{"value":"zh_male_sunwukong_uranus_bigtts","label":"猴哥 2.0","gender":"男声","language":"中文","description":"活泼谐趣","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_male_sunwukong_uranus_bigtts.mp3"},{"value":"zh_male_dayi_uranus_bigtts","label":"大壹 2.0","gender":"男声","language":"中文","description":"成熟稳重","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_male_dayi_uranus_bigtts.mp3"},{"value":"zh_female_mizai_uranus_bigtts","label":"黑猫侦探社咪仔 2.0","gender":"女声","language":"中文","description":"神秘俈皮","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_mizai_uranus_bigtts.mp3"},{"value":"zh_female_jitangnv_uranus_bigtts","label":"鸡汤女 2.0","gender":"女声","language":"中文","description":"温暖治愈","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_jitangnv_uranus_bigtts.mp3"},{"value":"zh_female_liuchangnv_uranus_bigtts","label":"流畅女声 2.0","gender":"女声","language":"中文","description":"流畅自然","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_liuchangnv_uranus_bigtts.mp3"},{"value":"zh_male_ruyayichen_uranus_bigtts","label":"儒雅逸辰 2.0","gender":"男声","language":"中文","description":"儒雅文气","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_male_ruyayichen_uranus_bigtts.mp3"},{"value":"en_male_tim_uranus_bigtts","label":"Tim","gender":"男声","language":"英文","description":"成熟稳重","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/en_male_tim_uranus_bigtts.mp3"},{"value":"en_female_dacey_uranus_bigtts","label":"Dacey","gender":"女声","language":"英文","description":"清新自然","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/en_female_dacey_uranus_bigtts.mp3"},{"value":"en_female_stokie_uranus_bigtts","label":"Stokie","gender":"女声","language":"英文","description":"活力开朗","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/en_female_stokie_uranus_bigtts.mp3"},{"value":"zh_female_yingyujiaoxue_uranus_bigtts","label":"Tina老师 2.0","gender":"女声","language":"中文","description":"耐心专业","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_yingyujiaoxue_uranus_bigtts.mp3"},{"value":"zh_female_kefunvsheng_uranus_bigtts","label":"暖阳女声 2.0","gender":"女声","language":"中文","description":"温和专业","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_kefunvsheng_uranus_bigtts.mp3"},{"value":"saturn_zh_female_qingyingduoduo_cs_tob","label":"轻盈朵朵 2.0","gender":"女声","language":"中文","description":"轻盈温柔","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/saturn_zh_female_qingyingduoduo_cs_tob.mp3"},{"value":"saturn_zh_female_wenwanshanshan_cs_tob","label":"温婉珊珊 2.0","gender":"女声","language":"中文","description":"温婉亲切","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/saturn_zh_female_wenwanshanshan_cs_tob.mp3"},{"value":"saturn_zh_female_reqingaina_cs_tob","label":"热情艾娜 2.0","gender":"女声","language":"中文","description":"热情开朗","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/saturn_zh_female_reqingaina_cs_tob.mp3"},{"value":"zh_female_xiaoxue_uranus_bigtts","label":"儿童绘本 2.0","gender":"","language":"中文","description":"童真活泼","previewUrl":"https://cdn.token6688.com/voice-previews/doubao/zh_female_xiaoxue_uranus_bigtts.mp3"},{"value":"zh_female_sophie_uranus_bigtts","label":"魅力苏菲 2.0","gender":"女声","language":"中文","description":"魅力苏菲 2.0"},{"value":"zh_female_wenroumama_uranus_bigtts","label":"温柔妈妈 2.0","gender":"女声","language":"中文","description":"温柔妈妈 2.0"},{"value":"zh_male_jieshuoxiaoming_uranus_bigtts","label":"解说小明 2.0","gender":"男声","language":"中文","description":"解说小明 2.0"},{"value":"zh_female_tvbnv_uranus_bigtts","label":"TVB女声 2.0","gender":"女声","language":"中文","description":"TVB女声 2.0"},{"value":"zh_male_yizhipiannan_uranus_bigtts","label":"译制片男 2.0","gender":"男声","language":"中文","description":"译制片男 2.0"},{"value":"zh_female_qiaopinv_uranus_bigtts","label":"俏皮女声 2.0","gender":"女声","language":"中文","description":"俏皮女声 2.0"},{"value":"zh_female_zhishuaiyingzi_uranus_bigtts","label":"直率英子 2.0","gender":"女声","language":"中文","description":"直率英子 2.0"},{"value":"zh_male_linjiananhai_uranus_bigtts","label":"邻家男孩 2.0","gender":"男声","language":"中文","description":"邻家男孩 2.0"},{"value":"zh_male_silang_uranus_bigtts","label":"四郎 2.0","gender":"男声","language":"中文","description":"四郎 2.0"},{"value":"zh_male_ruyaqingnian_uranus_bigtts","label":"儒雅青年 2.0","gender":"男声","language":"中文","description":"儒雅青年 2.0"},{"value":"zh_male_qingcang_uranus_bigtts","label":"擎苍 2.0","gender":"男声","language":"中文","description":"擎苍 2.0"},{"value":"zh_male_xionger_uranus_bigtts","label":"熊二 2.0","gender":"男声","language":"中文","description":"熊二 2.0"},{"value":"zh_female_yingtaowanzi_uranus_bigtts","label":"樱桃丸子 2.0","gender":"女声","language":"中文","description":"樱桃丸子 2.0"},{"value":"zh_male_wennuanahu_uranus_bigtts","label":"温暖阿虎 2.0","gender":"男声","language":"中文","description":"温暖阿虎 2.0"},{"value":"zh_male_naiqimengwa_uranus_bigtts","label":"奶气萌娃 2.0","gender":"男声","language":"中文","description":"奶气萌娃 2.0"},{"value":"zh_female_popo_uranus_bigtts","label":"婆婆 2.0","gender":"女声","language":"中文","description":"婆婆 2.0"},{"value":"zh_female_gaolengyujie_uranus_bigtts","label":"高冷御姐 2.0","gender":"女声","language":"中文","description":"高冷御姐 2.0"},{"value":"zh_male_aojiaobazong_uranus_bigtts","label":"傲娇霸总 2.0","gender":"男声","language":"中文","description":"傲娇霸总 2.0"},{"value":"zh_male_lanyinmianbao_uranus_bigtts","label":"懒音绵宝 2.0","gender":"男声","language":"中文","description":"懒音绵宝 2.0"},{"value":"zh_male_fanjuanqingnian_uranus_bigtts","label":"反卷青年 2.0","gender":"男声","language":"中文","description":"反卷青年 2.0"},{"value":"zh_female_wenroushunv_uranus_bigtts","label":"温柔淑女 2.0","gender":"女声","language":"中文","description":"温柔淑女 2.0"},{"value":"zh_female_gufengshaoyu_uranus_bigtts","label":"古风少御 2.0","gender":"女声","language":"中文","description":"古风少御 2.0"},{"value":"zh_male_huolixiaoge_uranus_bigtts","label":"活力小哥 2.0","gender":"男声","language":"中文","description":"活力小哥 2.0"},{"value":"zh_male_baqiqingshu_uranus_bigtts","label":"霸气青叔 2.0","gender":"男声","language":"中文","description":"霸气青叔 2.0"},{"value":"zh_male_xuanyijieshuo_uranus_bigtts","label":"悬疑解说 2.0","gender":"男声","language":"中文","description":"悬疑解说 2.0"},{"value":"zh_female_mengyatou_uranus_bigtts","label":"萌丫头 2.0","gender":"女声","language":"中文","description":"萌丫头 2.0"},{"value":"zh_female_tiexinnvsheng_uranus_bigtts","label":"贴心女声 2.0","gender":"女声","language":"中文","description":"贴心女声 2.0"},{"value":"zh_female_jitangmei_uranus_bigtts","label":"鸡汤妹妹 2.0","gender":"女声","language":"中文","description":"鸡汤妹妹 2.0"},{"value":"zh_male_cixingjieshuonan_uranus_bigtts","label":"磁性解说男声 2.0","gender":"男声","language":"中文","description":"磁性解说男声 2.0"},{"value":"zh_male_liangsangmengzai_uranus_bigtts","label":"亮嗓萌仔 2.0","gender":"男声","language":"中文","description":"亮嗓萌仔 2.0"},{"value":"zh_female_kailangjiejie_uranus_bigtts","label":"开朗姐姐 2.0","gender":"女声","language":"中文","description":"开朗姐姐 2.0"},{"value":"zh_male_gaolengchenwen_uranus_bigtts","label":"高冷沉稳 2.0","gender":"男声","language":"中文","description":"高冷沉稳 2.0"},{"value":"zh_male_shenyeboke_uranus_bigtts","label":"深夜播客 2.0","gender":"男声","language":"中文","description":"深夜播客 2.0"},{"value":"zh_male_lubanqihao_uranus_bigtts","label":"鲁班七号 2.0","gender":"男声","language":"中文","description":"鲁班七号 2.0"},{"value":"zh_female_jiaochuannv_uranus_bigtts","label":"娇喘女声 2.0","gender":"女声","language":"中文","description":"娇喘女声 2.0"},{"value":"zh_female_linxiao_uranus_bigtts","label":"林潇 2.0","gender":"女声","language":"中文","description":"林潇 2.0"},{"value":"zh_female_lingling_uranus_bigtts","label":"玲玲姐姐 2.0","gender":"女声","language":"中文","description":"玲玲姐姐 2.0"},{"value":"zh_female_chunribu_uranus_bigtts","label":"春日部姐姐 2.0","gender":"女声","language":"中文","description":"春日部姐姐 2.0"},{"value":"zh_male_tangseng_uranus_bigtts","label":"唐僧 2.0","gender":"男声","language":"中文","description":"唐僧 2.0"},{"value":"zh_male_zhuangzhou_uranus_bigtts","label":"庄周 2.0","gender":"男声","language":"中文","description":"庄周 2.0"},{"value":"zh_male_kailangdidi_uranus_bigtts","label":"开朗弟弟 2.0","gender":"男声","language":"中文","description":"开朗弟弟 2.0"},{"value":"zh_male_zhubajie_uranus_bigtts","label":"猪八戒 2.0","gender":"男声","language":"中文","description":"猪八戒 2.0"},{"value":"zh_female_ganmaodianyin_uranus_bigtts","label":"感冒电音姐姐 2.0","gender":"女声","language":"中文","description":"感冒电音姐姐 2.0"},{"value":"zh_female_chanmeinv_uranus_bigtts","label":"谄媚女声 2.0","gender":"女声","language":"中文","description":"谄媚女声 2.0"},{"value":"zh_female_nvleishen_uranus_bigtts","label":"女雷神 2.0","gender":"女声","language":"中文","description":"女雷神 2.0"},{"value":"zh_female_qinqienv_uranus_bigtts","label":"亲切女声 2.0","gender":"女声","language":"中文","description":"亲切女声 2.0"},{"value":"zh_male_kuailexiaodong_uranus_bigtts","label":"快乐小东 2.0","gender":"男声","language":"中文","description":"快乐小东 2.0"},{"value":"zh_male_kailangxuezhang_uranus_bigtts","label":"开朗学长 2.0","gender":"男声","language":"中文","description":"开朗学长 2.0"},{"value":"zh_male_youyoujunzi_uranus_bigtts","label":"悠悠君子 2.0","gender":"男声","language":"中文","description":"悠悠君子 2.0"},{"value":"zh_female_wenjingmaomao_uranus_bigtts","label":"文静毛毛 2.0","gender":"女声","language":"中文","description":"文静毛毛 2.0"},{"value":"zh_female_zhixingnv_uranus_bigtts","label":"知性女声 2.0","gender":"女声","language":"中文","description":"知性女声 2.0"},{"value":"zh_male_qingshuangnanda_uranus_bigtts","label":"清爽男大 2.0","gender":"男声","language":"中文","description":"清爽男大 2.0"},{"value":"zh_male_yuanboxiaoshu_uranus_bigtts","label":"渊博小叔 2.0","gender":"男声","language":"中文","description":"渊博小叔 2.0"},{"value":"zh_male_yangguangqingnian_uranus_bigtts","label":"阳光青年 2.0","gender":"男声","language":"中文","description":"阳光青年 2.0"},{"value":"zh_female_qingchezizi_uranus_bigtts","label":"清澈梓梓 2.0","gender":"女声","language":"中文","description":"清澈梓梓 2.0"},{"value":"zh_female_tianmeiyueyue_uranus_bigtts","label":"甜美悦悦 2.0","gender":"女声","language":"中文","description":"甜美悦悦 2.0"},{"value":"zh_female_xinlingjitang_uranus_bigtts","label":"心灵鸡汤 2.0","gender":"女声","language":"中文","description":"心灵鸡汤 2.0"},{"value":"zh_male_wenrouxiaoge_uranus_bigtts","label":"温柔小哥 2.0","gender":"男声","language":"中文","description":"温柔小哥 2.0"},{"value":"zh_female_roumeinvyou_uranus_bigtts","label":"柔美女友 2.0","gender":"女声","language":"中文","description":"柔美女友 2.0"},{"value":"zh_male_dongfanghaoran_uranus_bigtts","label":"东方浩然 2.0","gender":"男声","language":"中文","description":"东方浩然 2.0"},{"value":"zh_female_wenrouxiaoya_uranus_bigtts","label":"温柔小雅 2.0","gender":"女声","language":"中文","description":"温柔小雅 2.0"},{"value":"zh_male_tiancaitongsheng_uranus_bigtts","label":"天才童声 2.0","gender":"","language":"中文","description":"天才童声 2.0"},{"value":"zh_female_wuzetian_uranus_bigtts","label":"武则天 2.0","gender":"女声","language":"中文","description":"武则天 2.0"},{"value":"zh_female_gujie_uranus_bigtts","label":"顾姐 2.0","gender":"女声","language":"中文","description":"顾姐 2.0"},{"value":"zh_male_guanggaojieshuo_uranus_bigtts","label":"广告解说 2.0","gender":"男声","language":"中文","description":"广告解说 2.0"},{"value":"zh_female_shaoergushi_uranus_bigtts","label":"少儿故事 2.0","gender":"女声","language":"中文","description":"少儿故事 2.0"},{"value":"ICL_uranus_en_female_charlie_tob","label":"Charlie 2.0","gender":"女声","language":"英文","description":"Charlie 2.0"},{"value":"ICL_uranus_en_male_ethan_tob","label":"Ethan 2.0","gender":"男声","language":"英文","description":"Ethan 2.0"},{"value":"ICL_uranus_en_male_alastor_tob","label":"Alastor 2.0","gender":"男声","language":"英文","description":"Alastor 2.0"},{"value":"ICL_uranus_en_male_chucky_tob","label":"Chucky 2.0","gender":"男声","language":"英文","description":"Chucky 2.0"},{"value":"ICL_uranus_en_male_noah_tob","label":"Noah 2.0","gender":"男声","language":"英文","description":"Noah 2.0"},{"value":"ICL_uranus_en_male_jigsaw_tob","label":"Jigsaw 2.0","gender":"男声","language":"英文","description":"Jigsaw 2.0"},{"value":"ICL_uranus_en_male_clown_man_tob","label":"Clown Man 2.0","gender":"男声","language":"英文","description":"Clown Man 2.0"},{"value":"ICL_uranus_en_male_cartoon_chef_tob","label":"Cartoon Chef 2.0","gender":"男声","language":"英文","description":"Cartoon Chef 2.0"},{"value":"ICL_uranus_en_male_frosty_man_tob","label":"Frosty Man 2.0","gender":"男声","language":"英文","description":"Frosty Man 2.0"},{"value":"ICL_uranus_en_male_the_grinch_tob","label":"The Grinch 2.0","gender":"男声","language":"英文","description":"The Grinch 2.0"},{"value":"ICL_uranus_en_male_kevin_mccallister_tob","label":"Kevin McCallister 2.0","gender":"男声","language":"英文","description":"Kevin McCallister 2.0"},{"value":"ICL_uranus_en_male_michael_tob","label":"Michael 2.0","gender":"男声","language":"英文","description":"Michael 2.0"},{"value":"ICL_uranus_en_male_big_boogie_tob","label":"Big Boogie 2.0","gender":"男声","language":"英文","description":"Big Boogie 2.0"},{"value":"ICL_uranus_en_male_xavier_tob","label":"Xavier 2.0","gender":"男声","language":"英文","description":"Xavier 2.0"},{"value":"ICL_uranus_en_male_zayne_tob","label":"Zayne 2.0","gender":"男声","language":"英文","description":"Zayne 2.0"},{"value":"ICL_uranus_zh_female_kefuwanjun_tob","label":"客服婉君 2.0","gender":"女声","language":"中文","description":"客服婉君 2.0"},{"value":"ICL_uranus_zh_female_yingxiaokefu_v2_tob","label":"营销小楠 2.0","gender":"女声","language":"中文","description":"营销小楠 2.0"},{"value":"ICL_uranus_zh_female_aojiaonvyou_tob","label":"傲娇女友 2.0","gender":"女声","language":"中文","description":"傲娇女友 2.0"},{"value":"ICL_uranus_zh_female_aomanjiaosheng_tob","label":"傲慢娇声 2.0","gender":"女声","language":"中文","description":"傲慢娇声 2.0"},{"value":"ICL_uranus_zh_female_xiemeinvwang_tob","label":"邪魅女王 2.0","gender":"女声","language":"中文","description":"邪魅女王 2.0"},{"value":"ICL_uranus_zh_female_bingjiaojiejie_tob","label":"病娇姐姐 2.0","gender":"女声","language":"中文","description":"病娇姐姐 2.0"},{"value":"ICL_uranus_zh_female_bingjiaomengmei_tob","label":"病娇萌妹 2.0","gender":"女声","language":"中文","description":"病娇萌妹 2.0"},{"value":"ICL_uranus_zh_female_bingruoshaonv_tob","label":"病弱少女 2.0","gender":"女声","language":"中文","description":"病弱少女 2.0"},{"value":"ICL_uranus_zh_female_chengshuwenrou_tob","label":"成熟温柔 2.0","gender":"女声","language":"中文","description":"成熟温柔 2.0"},{"value":"ICL_uranus_zh_female_chengshujiejie_tob","label":"成熟姐姐 2.0","gender":"女声","language":"中文","description":"成熟姐姐 2.0"},{"value":"ICL_uranus_zh_female_chunzhenshaonv_tob","label":"纯真少女 2.0","gender":"女声","language":"中文","description":"纯真少女 2.0"},{"value":"ICL_uranus_zh_female_chunchenvsheng_tob","label":"纯澈女生 2.0","gender":"女声","language":"中文","description":"纯澈女生 2.0"},{"value":"ICL_uranus_zh_female_wumeikeren_tob","label":"妩媚可人 2.0","gender":"女声","language":"中文","description":"妩媚可人 2.0"},{"value":"ICL_uranus_zh_female_guaiqiaokeer_tob","label":"乖巧可儿 2.0","gender":"女声","language":"中文","description":"乖巧可儿 2.0"},{"value":"ICL_uranus_zh_female_heainainai_tob","label":"和蔼奶奶 2.0","gender":"女声","language":"中文","description":"和蔼奶奶 2.0"},{"value":"ICL_uranus_zh_female_huopodiaoman_tob","label":"活泼刁蛮 2.0","gender":"女声","language":"中文","description":"活泼刁蛮 2.0"},{"value":"ICL_uranus_zh_female_huoponvhai_tob","label":"活泼女孩 2.0","gender":"女声","language":"中文","description":"活泼女孩 2.0"},{"value":"ICL_uranus_zh_female_jiaohannvwang_tob","label":"娇憨女王 2.0","gender":"女声","language":"中文","description":"娇憨女王 2.0"},{"value":"ICL_uranus_zh_female_jiaoruoluoli_tob","label":"娇弱萝莉 2.0","gender":"女声","language":"中文","description":"娇弱萝莉 2.0"},{"value":"ICL_uranus_zh_female_jiaxiaozi_tob","label":"假小子 2.0","gender":"女声","language":"中文","description":"假小子 2.0"},{"value":"ICL_uranus_zh_female_jinglingxiangdao_tob","label":"精灵向导 2.0","gender":"女声","language":"中文","description":"精灵向导 2.0"},{"value":"ICL_uranus_zh_female_kailangtingting_tob","label":"开朗婷婷 2.0","gender":"女声","language":"中文","description":"开朗婷婷 2.0"},{"value":"ICL_uranus_zh_female_kefunvshengwenhecuishou_tob","label":"外呼凌凌 2.0","gender":"女声","language":"中文","description":"外呼凌凌 2.0"},{"value":"ICL_uranus_zh_female_kaixinxiaohong_tob","label":"开心小鸿 2.0","gender":"女声","language":"中文","description":"开心小鸿 2.0"},{"value":"ICL_uranus_zh_female_keainvsheng_tob","label":"可爱女生 2.0","gender":"女声","language":"中文","description":"可爱女生 2.0"},{"value":"ICL_uranus_zh_female_lingdongxinxin_tob","label":"灵动欣欣 2.0","gender":"女声","language":"中文","description":"灵动欣欣 2.0"},{"value":"ICL_uranus_zh_female_linjuayi_tob","label":"邻居阿姨 2.0","gender":"女声","language":"中文","description":"邻居阿姨 2.0"},{"value":"ICL_uranus_zh_female_tianmeijiaoqiao_tob","label":"甜美娇俏 2.0","gender":"女声","language":"中文","description":"甜美娇俏 2.0"},{"value":"ICL_uranus_zh_female_qinglenggaoya_tob","label":"清冷高雅 2.0","gender":"女声","language":"中文","description":"清冷高雅 2.0"},{"value":"ICL_uranus_zh_female_lixingyuanzi_tob","label":"理性圆子 2.0","gender":"女声","language":"中文","description":"理性圆子 2.0"},{"value":"ICL_uranus_zh_female_xingganmeihuo_tob","label":"性感魅惑 2.0","gender":"女声","language":"中文","description":"性感魅惑 2.0"},{"value":"ICL_uranus_zh_female_nuanxinqianqian_tob","label":"暖心茜茜 2.0","gender":"女声","language":"中文","description":"暖心茜茜 2.0"},{"value":"ICL_uranus_zh_female_nuanxinxuejie_tob","label":"暖心学姐 2.0","gender":"女声","language":"中文","description":"暖心学姐 2.0"},{"value":"ICL_uranus_zh_female_qingtianmeimei_tob","label":"清甜莓莓 2.0","gender":"女声","language":"中文","description":"清甜莓莓 2.0"},{"value":"ICL_uranus_zh_female_qingtiantaotao_tob","label":"清甜桃桃 2.0","gender":"女声","language":"中文","description":"清甜桃桃 2.0"},{"value":"ICL_uranus_zh_female_qingxixiaoxue_tob","label":"清晰小雪 2.0","gender":"女声","language":"中文","description":"清晰小雪 2.0"},{"value":"ICL_uranus_zh_female_qingxinshaonv_tob","label":"倾心少女 2.0","gender":"女声","language":"中文","description":"倾心少女 2.0"},{"value":"ICL_uranus_zh_female_rouguhunshi_tob","label":"柔骨魂师 2.0","gender":"女声","language":"中文","description":"柔骨魂师 2.0"},{"value":"ICL_uranus_zh_female_ruanmengtangtang_tob","label":"软萌糖糖 2.0","gender":"女声","language":"中文","description":"软萌糖糖 2.0"},{"value":"ICL_uranus_zh_female_ruanmengtuanzi_tob","label":"软萌团子 2.0","gender":"女声","language":"中文","description":"软萌团子 2.0"},{"value":"ICL_uranus_zh_female_tianmeihuopo_tob","label":"甜美活泼 2.0","gender":"女声","language":"中文","description":"甜美活泼 2.0"},{"value":"ICL_uranus_zh_female_tianmeixiaoju_tob","label":"甜美小橘 2.0","gender":"女声","language":"中文","description":"甜美小橘 2.0"},{"value":"ICL_uranus_zh_female_tianmeixiaoyu_tob","label":"甜美小雨 2.0","gender":"女声","language":"中文","description":"甜美小雨 2.0"},{"value":"ICL_uranus_zh_female_tiaopigongzhu_tob","label":"调皮公主 2.0","gender":"女声","language":"中文","description":"调皮公主 2.0"},{"value":"ICL_uranus_zh_female_tiexinnvyou_tob","label":"贴心女友 2.0","gender":"女声","language":"中文","description":"贴心女友 2.0"},{"value":"ICL_uranus_zh_female_wenrounvshen_tob","label":"温柔女神 2.0","gender":"女声","language":"中文","description":"温柔女神 2.0"},{"value":"ICL_uranus_zh_female_wenrouwenya_tob","label":"温柔文雅 2.0","gender":"女声","language":"中文","description":"温柔文雅 2.0"},{"value":"ICL_uranus_zh_female_zhixinjiejie_tob","label":"知心姐姐 2.0","gender":"女声","language":"中文","description":"知心姐姐 2.0"},{"value":"ICL_uranus_zh_female_wumeiyujie_tob","label":"妩媚御姐 2.0","gender":"女声","language":"中文","description":"妩媚御姐 2.0"},{"value":"ICL_uranus_zh_female_yuanqitianmei_tob","label":"元气甜妹 2.0","gender":"女声","language":"中文","description":"元气甜妹 2.0"},{"value":"ICL_uranus_zh_female_xiemeiyujie_tob","label":"邪魅御姐 2.0","gender":"女声","language":"中文","description":"邪魅御姐 2.0"},{"value":"ICL_uranus_zh_female_xingganyujie_tob","label":"性感御姐 2.0","gender":"女声","language":"中文","description":"性感御姐 2.0"},{"value":"ICL_uranus_zh_female_xiuliqianqian_tob","label":"秀丽倩倩 2.0","gender":"女声","language":"中文","description":"秀丽倩倩 2.0"},{"value":"ICL_uranus_zh_female_tiexinguimi_tob","label":"贴心闺蜜 2.0","gender":"女声","language":"中文","description":"贴心闺蜜 2.0"},{"value":"ICL_uranus_zh_female_tiexinmeimei_tob","label":"贴心妹妹 2.0","gender":"女声","language":"中文","description":"贴心妹妹 2.0"},{"value":"ICL_uranus_zh_female_wenroubaiyueguang_tob","label":"温柔白月光 2.0","gender":"女声","language":"中文","description":"温柔白月光 2.0"},{"value":"ICL_uranus_zh_female_chuliannvyou_tob","label":"初恋女友 2.0","gender":"女声","language":"中文","description":"初恋女友 2.0"},{"value":"ICL_uranus_zh_female_zhixingwenwan_tob","label":"知性温婉 2.0","gender":"女声","language":"中文","description":"知性温婉 2.0"},{"value":"ICL_uranus_zh_male_aoqilingren_tob","label":"傲气凌人 2.0","gender":"男声","language":"中文","description":"傲气凌人 2.0"},{"value":"ICL_uranus_zh_male_anrenqinzhu_tob","label":"黯刃秦主 2.0","gender":"男声","language":"中文","description":"黯刃秦主 2.0"},{"value":"ICL_uranus_zh_male_aojiaogongzi_tob","label":"傲娇公子 2.0","gender":"男声","language":"中文","description":"傲娇公子 2.0"},{"value":"ICL_uranus_zh_male_aojiaojingying_tob","label":"傲娇精英 2.0","gender":"男声","language":"中文","description":"傲娇精英 2.0"},{"value":"ICL_uranus_zh_male_aomanqingnian_tob","label":"傲慢青年 2.0","gender":"男声","language":"中文","description":"傲慢青年 2.0"},{"value":"ICL_uranus_zh_male_aomanshaoye_tob","label":"傲慢少爷 2.0","gender":"男声","language":"中文","description":"傲慢少爷 2.0"},{"value":"ICL_uranus_zh_male_zhenbiandiyu_tob","label":"枕边低语 2.0","gender":"男声","language":"中文","description":"枕边低语 2.0"},{"value":"ICL_uranus_zh_male_badaoshaoye_tob","label":"霸道少爷 2.0","gender":"男声","language":"中文","description":"霸道少爷 2.0"},{"value":"ICL_uranus_zh_male_badaozongcai_tob","label":"霸道总裁 2.0","gender":"男声","language":"中文","description":"霸道总裁 2.0"},{"value":"ICL_uranus_zh_male_bingjiaobailian_tob","label":"病娇白莲 2.0","gender":"男声","language":"中文","description":"病娇白莲 2.0"},{"value":"ICL_uranus_zh_male_bingjiaodidi_tob","label":"病娇弟弟 2.0","gender":"男声","language":"中文","description":"病娇弟弟 2.0"},{"value":"ICL_uranus_zh_male_bingjiaogege_tob","label":"病娇哥哥 2.0","gender":"男声","language":"中文","description":"病娇哥哥 2.0"},{"value":"ICL_uranus_zh_male_bingjiaonanyou_tob","label":"病娇男友 2.0","gender":"男声","language":"中文","description":"病娇男友 2.0"},{"value":"ICL_uranus_zh_male_bingjiaoshaonian_tob","label":"病娇少年 2.0","gender":"男声","language":"中文","description":"病娇少年 2.0"},{"value":"ICL_uranus_zh_male_bingruogongzi_tob","label":"病弱公子 2.0","gender":"男声","language":"中文","description":"病弱公子 2.0"},{"value":"ICL_uranus_zh_male_bingruoshaonian_tob","label":"病弱少年 2.0","gender":"男声","language":"中文","description":"病弱少年 2.0"},{"value":"ICL_uranus_zh_male_bujiqingnian_tob","label":"不羁青年 2.0","gender":"男声","language":"中文","description":"不羁青年 2.0"},{"value":"ICL_uranus_zh_male_chunhoudiyin_tob","label":"醇厚低音 2.0","gender":"男声","language":"中文","description":"醇厚低音 2.0"},{"value":"ICL_uranus_zh_male_paoxiaoxiaoge_tob","label":"咆哮小哥 2.0","gender":"男声","language":"中文","description":"咆哮小哥 2.0"},{"value":"ICL_uranus_zh_male_yangyang_tob","label":"炀炀 2.0","gender":"男声","language":"中文","description":"炀炀 2.0"},{"value":"ICL_uranus_zh_male_chanruoshaoye_tob","label":"孱弱少爷 2.0","gender":"男声","language":"中文","description":"孱弱少爷 2.0"},{"value":"ICL_uranus_zh_male_chengshuzongcai_tob","label":"成熟总裁 2.0","gender":"男声","language":"中文","description":"成熟总裁 2.0"},{"value":"ICL_uranus_zh_male_chenwenmingzai_tob","label":"沉稳明仔 2.0","gender":"男声","language":"中文","description":"沉稳明仔 2.0"},{"value":"ICL_uranus_zh_male_qingyisugan_tob","label":"清逸苏感 2.0","gender":"男声","language":"中文","description":"清逸苏感 2.0"},{"value":"ICL_uranus_zh_male_chunzhenxuedi_tob","label":"纯真学弟 2.0","gender":"男声","language":"中文","description":"纯真学弟 2.0"},{"value":"ICL_uranus_zh_male_cixingnansang_tob","label":"磁性男嗓 2.0","gender":"男声","language":"中文","description":"磁性男嗓 2.0"},{"value":"ICL_uranus_zh_male_cujingnansheng_tob","label":"醋精男生 2.0","gender":"男声","language":"中文","description":"醋精男生 2.0"},{"value":"ICL_uranus_zh_male_cujingnanyou_tob","label":"醋精男友 2.0","gender":"男声","language":"中文","description":"醋精男友 2.0"},{"value":"ICL_uranus_zh_male_diyinchenyu_tob","label":"低音沉郁 2.0","gender":"男声","language":"中文","description":"低音沉郁 2.0"},{"value":"ICL_uranus_zh_male_fengfashaonian_tob","label":"风发少年 2.0","gender":"男声","language":"中文","description":"风发少年 2.0"},{"value":"ICL_uranus_zh_male_ruyagongzi_tob","label":"儒雅公子 2.0","gender":"男声","language":"中文","description":"儒雅公子 2.0"},{"value":"ICL_uranus_zh_male_fuheigongzi_tob","label":"腹黑公子 2.0","gender":"男声","language":"中文","description":"腹黑公子 2.0"},{"value":"ICL_uranus_zh_male_ganjingshaonian_tob","label":"干净少年 2.0","gender":"男声","language":"中文","description":"干净少年 2.0"},{"value":"ICL_uranus_zh_male_gaolengzongcai_tob","label":"高冷总裁 2.0","gender":"男声","language":"中文","description":"高冷总裁 2.0"},{"value":"ICL_uranus_zh_male_guaogongzi_tob","label":"孤傲公子 2.0","gender":"男声","language":"中文","description":"孤傲公子 2.0"},{"value":"ICL_uranus_zh_male_gugaogongzi_tob","label":"孤高公子 2.0","gender":"男声","language":"中文","description":"孤高公子 2.0"},{"value":"ICL_uranus_zh_male_guiyishenmi_tob","label":"诡异神秘 2.0","gender":"男声","language":"中文","description":"诡异神秘 2.0"},{"value":"ICL_uranus_zh_male_guzhibingjiao_tob","label":"固执病娇 2.0","gender":"男声","language":"中文","description":"固执病娇 2.0"},{"value":"ICL_uranus_zh_male_hanhoudunshi_tob","label":"憨厚敦实 2.0","gender":"男声","language":"中文","description":"憨厚敦实 2.0"},{"value":"ICL_uranus_zh_male_huoliqingnian_tob","label":"活力青年 2.0","gender":"男声","language":"中文","description":"活力青年 2.0"},{"value":"ICL_uranus_zh_male_huoponanyou_tob","label":"活泼男友 2.0","gender":"男声","language":"中文","description":"活泼男友 2.0"},{"value":"ICL_uranus_zh_male_huoposhuanglang_tob","label":"活泼爽朗 2.0","gender":"男声","language":"中文","description":"活泼爽朗 2.0"},{"value":"ICL_uranus_zh_male_huzishushu_tob","label":"胡子叔叔 2.0","gender":"男声","language":"中文","description":"胡子叔叔 2.0"},{"value":"ICL_uranus_zh_male_jijiazhineng_tob","label":"机甲智能 2.0","gender":"男声","language":"中文","description":"机甲智能 2.0"},{"value":"ICL_uranus_zh_male_jingyingqingnian_tob","label":"精英青年 2.0","gender":"男声","language":"中文","description":"精英青年 2.0"},{"value":"ICL_uranus_zh_male_junyigongzi_tob","label":"俊逸公子 2.0","gender":"男声","language":"中文","description":"俊逸公子 2.0"},{"value":"ICL_uranus_zh_male_kailangqingkuai_tob","label":"开朗轻快 2.0","gender":"男声","language":"中文","description":"开朗轻快 2.0"},{"value":"ICL_uranus_zh_male_kailangqingnian_tob","label":"开朗青年 2.0","gender":"男声","language":"中文","description":"开朗青年 2.0"},{"value":"ICL_uranus_zh_male_lanyincaohunshi_tob","label":"蓝银草魂师 2.0","gender":"男声","language":"中文","description":"蓝银草魂师 2.0"},{"value":"ICL_uranus_zh_male_lengaozongcai_tob","label":"冷傲总裁 2.0","gender":"男声","language":"中文","description":"冷傲总裁 2.0"},{"value":"ICL_uranus_zh_male_lengdanshuli_tob","label":"冷淡疏离 2.0","gender":"男声","language":"中文","description":"冷淡疏离 2.0"},{"value":"ICL_uranus_zh_male_lengjungaozhi_tob","label":"冷峻高智 2.0","gender":"男声","language":"中文","description":"冷峻高智 2.0"},{"value":"ICL_uranus_zh_male_lengjunshangsi_tob","label":"冷峻上司 2.0","gender":"男声","language":"中文","description":"冷峻上司 2.0"},{"value":"ICL_uranus_zh_male_lengkugege_tob","label":"冷酷哥哥 2.0","gender":"男声","language":"中文","description":"冷酷哥哥 2.0"},{"value":"ICL_uranus_zh_male_lenglianxiongzhang_tob","label":"冷脸兄长 2.0","gender":"男声","language":"中文","description":"冷脸兄长 2.0"},{"value":"ICL_uranus_zh_male_lenglianxueba_tob","label":"冷脸学霸 2.0","gender":"男声","language":"中文","description":"冷脸学霸 2.0"},{"value":"ICL_uranus_zh_male_lengmonanyou_tob","label":"冷漠男友 2.0","gender":"男声","language":"中文","description":"冷漠男友 2.0"},{"value":"ICL_uranus_zh_male_lengmoxiongzhang_tob","label":"冷漠兄长 2.0","gender":"男声","language":"中文","description":"冷漠兄长 2.0"},{"value":"ICL_uranus_zh_male_lingyunqingnian_tob","label":"凌云青年 2.0","gender":"男声","language":"中文","description":"凌云青年 2.0"},{"value":"ICL_uranus_zh_male_qinglengjingui_tob","label":"清冷矜贵 2.0","gender":"男声","language":"中文","description":"清冷矜贵 2.0"},{"value":"ICL_uranus_zh_male_lvchaxiaoge_tob","label":"绿茶小哥 2.0","gender":"男声","language":"中文","description":"绿茶小哥 2.0"},{"value":"ICL_uranus_zh_male_mengdongqingnian_tob","label":"懵懂青年 2.0","gender":"男声","language":"中文","description":"懵懂青年 2.0"},{"value":"ICL_uranus_zh_male_menyoupingxiaoge_tob","label":"闷油瓶小哥 2.0","gender":"男声","language":"中文","description":"闷油瓶小哥 2.0"},{"value":"ICL_uranus_zh_male_xiaozhangxiaoge_tob","label":"嚣张小哥 2.0","gender":"男声","language":"中文","description":"嚣张小哥 2.0"},{"value":"ICL_uranus_zh_male_nianrennanyou_tob","label":"粘人男友 2.0","gender":"男声","language":"中文","description":"粘人男友 2.0"},{"value":"ICL_uranus_zh_male_neiliancaijun_tob","label":"内敛才俊 2.0","gender":"男声","language":"中文","description":"内敛才俊 2.0"},{"value":"ICL_uranus_zh_male_nuanxintitie_tob","label":"暖心体贴 2.0","gender":"男声","language":"中文","description":"暖心体贴 2.0"},{"value":"ICL_uranus_zh_male_pianpiangongzi_tob","label":"翩翩公子 2.0","gender":"男声","language":"中文","description":"翩翩公子 2.0"},{"value":"ICL_uranus_zh_male_chenwenyouya_tob","label":"沉稳优雅 2.0","gender":"男声","language":"中文","description":"沉稳优雅 2.0"},{"value":"ICL_uranus_zh_male_qingsexiaosheng_tob","label":"青涩小生 2.0","gender":"男声","language":"中文","description":"青涩小生 2.0"},{"value":"ICL_uranus_zh_male_qingseqingnian_tob","label":"青涩青年 2.0","gender":"男声","language":"中文","description":"青涩青年 2.0"},{"value":"ICL_uranus_zh_male_qingshuangshaonian_tob","label":"清爽少年 2.0","gender":"男声","language":"中文","description":"清爽少年 2.0"},{"value":"ICL_uranus_zh_male_qingxinbobo_tob","label":"清新波波 2.0","gender":"男声","language":"中文","description":"清新波波 2.0"},{"value":"ICL_uranus_zh_male_qinqieqingnian_tob","label":"亲切青年 2.0","gender":"男声","language":"中文","description":"亲切青年 2.0"},{"value":"ICL_uranus_zh_male_qinqiexiaozhuo_tob","label":"亲切小卓 2.0","gender":"男声","language":"中文","description":"亲切小卓 2.0"},{"value":"ICL_uranus_zh_male_qinglangwenrun_tob","label":"清朗温润 2.0","gender":"男声","language":"中文","description":"清朗温润 2.0"},{"value":"ICL_uranus_zh_male_rexueshaonian_tob","label":"热血少年 2.0","gender":"男声","language":"中文","description":"热血少年 2.0"},{"value":"ICL_uranus_zh_male_ruyacaijun_tob","label":"儒雅才俊 2.0","gender":"男声","language":"中文","description":"儒雅才俊 2.0"},{"value":"ICL_uranus_zh_male_ruyajunzi_tob","label":"儒雅君子 2.0","gender":"男声","language":"中文","description":"儒雅君子 2.0"},{"value":"ICL_uranus_zh_male_ruyazongcai_tob","label":"儒雅总裁 2.0","gender":"男声","language":"中文","description":"儒雅总裁 2.0"},{"value":"ICL_uranus_zh_male_sajiaonansheng_tob","label":"撒娇男生 2.0","gender":"男声","language":"中文","description":"撒娇男生 2.0"},{"value":"ICL_uranus_zh_male_sajiaonanyou_tob","label":"撒娇男友 2.0","gender":"男声","language":"中文","description":"撒娇男友 2.0"},{"value":"ICL_uranus_zh_male_sajiaonianren_tob","label":"撒娇粘人 2.0","gender":"男声","language":"中文","description":"撒娇粘人 2.0"},{"value":"ICL_uranus_zh_male_satuoqingnian_tob","label":"洒脱青年 2.0","gender":"男声","language":"中文","description":"洒脱青年 2.0"},{"value":"ICL_uranus_zh_male_shaonianjiangjun_tob","label":"少年将军 2.0","gender":"男声","language":"中文","description":"少年将军 2.0"},{"value":"ICL_uranus_zh_male_shenchenzongcai_tob","label":"深沉总裁 2.0","gender":"男声","language":"中文","description":"深沉总裁 2.0"},{"value":"ICL_uranus_zh_male_jilingxiaohuo_tob","label":"机灵小伙 2.0","gender":"男声","language":"中文","description":"机灵小伙 2.0"},{"value":"ICL_uranus_zh_male_shenmifashi_tob","label":"神秘法师 2.0","gender":"男声","language":"中文","description":"神秘法师 2.0"},{"value":"ICL_uranus_zh_male_shuaizhenxiaohuo_tob","label":"率真小伙 2.0","gender":"男声","language":"中文","description":"率真小伙 2.0"},{"value":"ICL_uranus_zh_male_shuanglangxiaoyang_tob","label":"爽朗小阳 2.0","gender":"男声","language":"中文","description":"爽朗小阳 2.0"},{"value":"ICL_uranus_zh_male_dichenqianquan_tob","label":"低沉缱绻 2.0","gender":"男声","language":"中文","description":"低沉缱绻 2.0"},{"value":"ICL_uranus_zh_male_siwenqingnian_tob","label":"斯文青年 2.0","gender":"男声","language":"中文","description":"斯文青年 2.0"},{"value":"ICL_uranus_zh_male_tianxinanyou_tob","label":"甜系男友 2.0","gender":"男声","language":"中文","description":"甜系男友 2.0"},{"value":"ICL_uranus_zh_male_tiexinnanyou_tob","label":"贴心男友 2.0","gender":"男声","language":"中文","description":"贴心男友 2.0"},{"value":"ICL_uranus_zh_male_wenrounantongzhuo_tob","label":"温柔男同桌 2.0","gender":"男声","language":"中文","description":"温柔男同桌 2.0"},{"value":"ICL_uranus_zh_male_wenrounanyou_tob","label":"温柔男友 2.0","gender":"男声","language":"中文","description":"温柔男友 2.0"},{"value":"ICL_uranus_zh_male_wenrouxuezhang_tob","label":"温柔学长 2.0","gender":"男声","language":"中文","description":"温柔学长 2.0"},{"value":"ICL_uranus_zh_male_wenrunxuezhe_tob","label":"温润学者 2.0","gender":"男声","language":"中文","description":"温润学者 2.0"},{"value":"ICL_uranus_zh_male_wenshunshaonian_tob","label":"温顺少年 2.0","gender":"男声","language":"中文","description":"温顺少年 2.0"},{"value":"ICL_uranus_zh_male_guayanxiaoge_tob","label":"寡言小哥 2.0","gender":"男声","language":"中文","description":"寡言小哥 2.0"},{"value":"ICL_uranus_zh_male_xiaohouye_tob","label":"小侯爷 2.0","gender":"男声","language":"中文","description":"小侯爷 2.0"},{"value":"ICL_uranus_zh_male_naiqixiaosheng_tob","label":"奶气小生 2.0","gender":"男声","language":"中文","description":"奶气小生 2.0"},{"value":"ICL_uranus_zh_male_xiaosasuixing_tob","label":"潇洒随性 2.0","gender":"男声","language":"中文","description":"潇洒随性 2.0"},{"value":"ICL_uranus_zh_male_wenrouneilian_tob","label":"温柔内敛 2.0","gender":"男声","language":"中文","description":"温柔内敛 2.0"},{"value":"ICL_uranus_zh_male_xuebanantongzhuo_tob","label":"学霸男同桌 2.0","gender":"男声","language":"中文","description":"学霸男同桌 2.0"},{"value":"ICL_uranus_zh_male_xuebatongzhuo_tob","label":"学霸同桌 2.0","gender":"男声","language":"中文","description":"学霸同桌 2.0"},{"value":"ICL_uranus_zh_male_yangguangyangyang_tob","label":"阳光洋洋 2.0","gender":"男声","language":"中文","description":"阳光洋洋 2.0"},{"value":"ICL_uranus_zh_male_wennuanshaonian_tob","label":"温暖少年 2.0","gender":"男声","language":"中文","description":"温暖少年 2.0"},{"value":"ICL_uranus_zh_male_yiqishaonian_tob","label":"意气少年 2.0","gender":"男声","language":"中文","description":"意气少年 2.0"},{"value":"ICL_uranus_zh_male_younidashu_tob","label":"油腻大叔 2.0","gender":"男声","language":"中文","description":"油腻大叔 2.0"},{"value":"ICL_uranus_zh_male_youmodaye_tob","label":"幽默大爷 2.0","gender":"男声","language":"中文","description":"幽默大爷 2.0"},{"value":"ICL_uranus_zh_male_youmoshushu_tob","label":"幽默叔叔 2.0","gender":"男声","language":"中文","description":"幽默叔叔 2.0"},{"value":"ICL_uranus_zh_male_youroubangzhu_tob","label":"优柔帮主 2.0","gender":"男声","language":"中文","description":"优柔帮主 2.0"},{"value":"ICL_uranus_zh_male_yourougongzi_tob","label":"优柔公子 2.0","gender":"男声","language":"中文","description":"优柔公子 2.0"},{"value":"ICL_uranus_zh_male_yuanqishaonian_tob","label":"元气少年 2.0","gender":"男声","language":"中文","description":"元气少年 2.0"},{"value":"ICL_uranus_zh_male_zhangjianjunzi_tob","label":"仗剑君子 2.0","gender":"男声","language":"中文","description":"仗剑君子 2.0"},{"value":"ICL_uranus_zh_male_zhangjianxiake_tob","label":"仗剑侠客 2.0","gender":"男声","language":"中文","description":"仗剑侠客 2.0"},{"value":"ICL_uranus_zh_male_zhengzhiqingnian_tob","label":"正直青年 2.0","gender":"男声","language":"中文","description":"正直青年 2.0"},{"value":"ICL_uranus_zh_male_zhishuaiqingnian_tob","label":"直率青年 2.0","gender":"男声","language":"中文","description":"直率青年 2.0"},{"value":"ICL_uranus_zh_male_zhongerqingnian_tob","label":"中二青年 2.0","gender":"男声","language":"中文","description":"中二青年 2.0"},{"value":"ICL_uranus_zh_male_zifuqingnian_tob","label":"自负青年 2.0","gender":"男声","language":"中文","description":"自负青年 2.0"},{"value":"ICL_uranus_zh_male_zixinqingnian_tob","label":"自信青年 2.0","gender":"男声","language":"中文","description":"自信青年 2.0"},{"value":"ICL_uranus_zh_male_tiancaitongzhuo_tob","label":"天才同桌 2.0","gender":"男声","language":"中文","description":"天才同桌 2.0"},{"value":"ICL_uranus_zh_male_qingxinmumu_tob","label":"清新沐沐 2.0","gender":"男声","language":"中文","description":"清新沐沐 2.0"},{"value":"ICL_uranus_zh_female_wenwanshanshan_tob","label":"温婉珊珊 2.0","gender":"女声","language":"中文","description":"温婉珊珊 2.0"},{"value":"ICL_uranus_zh_female_reqingaina_tob","label":"热情艾娜 2.0","gender":"女声","language":"中文","description":"热情艾娜 2.0"},{"value":"ICL_uranus_zh_male_shuanglangshaonian_tob","label":"爽朗少年 2.0","gender":"男声","language":"中文","description":"爽朗少年 2.0"},{"value":"ICL_uranus_zh_female_qingyingduoduo_tob","label":"轻盈朵朵 2.0","gender":"女声","language":"中文","description":"轻盈朵朵 2.0"},{"value":"id_female_cesna_uranus_bigtts","label":"Cesna","gender":"女声","language":"id","description":"Cesna"},{"value":"id_male_ikbal_uranus_bigtts","label":"Ikbal","gender":"男声","language":"id","description":"Ikbal"},{"value":"vi_female_f01507b_uranus_bigtts","label":"Hannah","gender":"女声","language":"vi","description":"Hannah"},{"value":"es_male_mariano_uranus_bigtts","label":"Mariano","gender":"男声","language":"西班牙语","description":"Mariano"},{"value":"es_female_romina_uranus_bigtts","label":"Romina","gender":"女声","language":"西班牙语","description":"Romina"},{"value":"ms_male_hazeem_uranus_bigtts","label":"Hazeem","gender":"男声","language":"ms","description":"Hazeem"},{"value":"ms_female_qis_uranus_bigtts","label":"Qis","gender":"女声","language":"ms","description":"Qis"},{"value":"th_male_angpao_uranus_bigtts","label":"Angpao","gender":"男声","language":"th","description":"Angpao"},{"value":"th_female_elle_uranus_bigtts","label":"Elle","gender":"女声","language":"th","description":"Elle"},{"value":"th_female_cake_uranus_bigtts","label":"Cake","gender":"女声","language":"th","description":"Cake"},{"value":"th_male_paran_uranus_bigtts","label":"Paran","gender":"男声","language":"th","description":"Paran"},{"value":"id_female_prisma_uranus_bigtts","label":"Prisma","gender":"女声","language":"id","description":"Prisma"},{"value":"en_male_ryan_uranus_bigtts","label":"Ryan","gender":"男声","language":"英文","description":"Ryan"},{"value":"ja_male_yusuke_uranus_bigtts","label":"Yusuke","gender":"男声","language":"日语","description":"Yusuke"},{"value":"tl_male_jonathan-palad_uranus_bigtts","label":"Jonathan-Palad","gender":"男声","language":"tl","description":"Jonathan-Palad"},{"value":"mx_male_migu_uranus_bigtts","label":"Migu","gender":"男声","language":"西班牙语","description":"Migu"},{"value":"it_male_luca_uranus_bigtts","label":"Luca","gender":"男声","language":"it","description":"Luca"},{"value":"it_male_enzo2_uranus_bigtts","label":"Enzo2","gender":"男声","language":"it","description":"Enzo2"},{"value":"pt_male_eduardo-s_uranus_bigtts","label":"Eduardo-S","gender":"男声","language":"葡萄牙语","description":"Eduardo-S"},{"value":"es_male_angel_uranus_bigtts","label":"Angel","gender":"男声","language":"西班牙语","description":"Angel"},{"value":"es_male_francisc_uranus_bigtts","label":"Francisc","gender":"男声","language":"西班牙语","description":"Francisc"},{"value":"ar_female_dina_uranus_bigtts","label":"Dina","gender":"女声","language":"ar","description":"Dina"},{"value":"ar_female_fatma_uranus_bigtts","label":"Fatma","gender":"女声","language":"ar","description":"Fatma"},{"value":"ar_male_youssef_uranus_bigtts","label":"Youssef","gender":"男声","language":"ar","description":"Youssef"},{"value":"de_female_bv081_uranus_bigtts","label":"Stella","gender":"女声","language":"德语","description":"Stella"},{"value":"de_male_sven_uranus_bigtts","label":"Sven","gender":"男声","language":"德语","description":"Sven"},{"value":"en_male_adam-imitation_uranus_bigtts","label":"Rowan","gender":"男声","language":"英文","description":"Rowan"},{"value":"en_male_alberto_uranus_bigtts","label":"Alberto","gender":"男声","language":"英文","description":"Alberto"},{"value":"en_male_alex_uranus_bigtts","label":"Alex","gender":"男声","language":"英文","description":"Alex"},{"value":"en_female_allison_uranus_bigtts","label":"Allison","gender":"女声","language":"英文","description":"Allison"},{"value":"en_female_authoritative-british_uranus_bigtts","label":"Charlotte","gender":"女声","language":"英文","description":"Charlotte"},{"value":"en_female_authoritative-informative_uranus_bigtts","label":"Margaret","gender":"女声","language":"英文","description":"Margaret"},{"value":"en_male_bill-jones_uranus_bigtts","label":"Jones","gender":"男声","language":"英文","description":"Jones"},{"value":"en_male_bill_jones_corey_uranus_bigtts","label":"Bill","gender":"男声","language":"英文","description":"Bill"},{"value":"en_male_brad_pitt_p1_uranus_bigtts","label":"Brad_Pitt","gender":"男声","language":"英文","description":"Brad_Pitt"},{"value":"en_female_brittney_uranus_bigtts","label":"Brittney","gender":"女声","language":"英文","description":"Brittney"},{"value":"en_female_brittney_pimintel_uranus_bigtts","label":"Zoe","gender":"女声","language":"英文","description":"Zoe"},{"value":"en_male_bruce_uranus_bigtts","label":"Adrian","gender":"男声","language":"英文","description":"Adrian"},{"value":"en_male_chandler_p1_uranus_bigtts","label":"Leo","gender":"男声","language":"英文","description":"Leo"},{"value":"en_male_cowboy-bob_uranus_bigtts","label":"Bob","gender":"男声","language":"英文","description":"Bob"},{"value":"en_male_cowboy_john_b_uranus_bigtts","label":"John","gender":"男声","language":"英文","description":"John"},{"value":"en_male_david_uranus_bigtts","label":"David","gender":"男声","language":"英文","description":"David"},{"value":"en_male_deep-voice_uranus_bigtts","label":"Orion","gender":"男声","language":"英文","description":"Orion"},{"value":"en_male_diyuwenrounan_uranus_bigtts","label":"Julian","gender":"男声","language":"英文","description":"Julian"},{"value":"en_male_evil-guy-oxley_uranus_bigtts","label":"Harrison","gender":"男声","language":"英文","description":"Harrison"},{"value":"en_male_excited-male-voice_uranus_bigtts","label":"Jasper","gender":"男声","language":"英文","description":"Jasper"},{"value":"en_male_father-christmas_uranus_bigtts","label":"Alfred","gender":"男声","language":"英文","description":"Alfred"},{"value":"en_female_female_tutor_ms-jenny_uranus_bigtts","label":"Holly","gender":"女声","language":"英文","description":"Holly"},{"value":"en_male_fernando-martinez_uranus_bigtts","label":"Felix","gender":"男声","language":"英文","description":"Felix"},{"value":"en_male_godfather_uranus_bigtts","label":"Godfather","gender":"男声","language":"英文","description":"Godfather"},{"value":"en_male_gollum_uranus_bigtts","label":"Gollum","gender":"男声","language":"英文","description":"Gollum"},{"value":"en_male_hades_uranus_bigtts","label":"Beau","gender":"男声","language":"英文","description":"Beau"},{"value":"en_female_hayley_uranus_bigtts","label":"Hayley","gender":"女声","language":"英文","description":"Hayley"},{"value":"en_male_jamie_uranus_bigtts","label":"Jamie","gender":"男声","language":"英文","description":"Jamie"},{"value":"en_female_jane_uranus_bigtts","label":"Jane","gender":"女声","language":"英文","description":"Jane"},{"value":"en_female_jenny_uranus_bigtts","label":"Jenny","gender":"女声","language":"英文","description":"Jenny"},{"value":"en_male_jidongchuanjiaoshi_uranus_bigtts","label":"Blaze","gender":"男声","language":"英文","description":"Blaze"},{"value":"en_male_jimmy_uranus_bigtts","label":"Jimmy","gender":"男声","language":"英文","description":"Jimmy"},{"value":"en_female_joanne_uranus_bigtts","label":"Joanne","gender":"女声","language":"英文","description":"Joanne"},{"value":"en_male_joker_uranus_bigtts","label":"Joker","gender":"男声","language":"英文","description":"Joker"},{"value":"en_male_josh_uranus_bigtts","label":"Josh","gender":"男声","language":"英文","description":"Josh"},{"value":"en_male_josh_coery_uranus_bigtts","label":"Josiah","gender":"男声","language":"英文","description":"Josiah"},{"value":"en_male_kevin_uranus_bigtts","label":"Kevin","gender":"男声","language":"英文","description":"Kevin"},{"value":"en_male_knightley_uranus_bigtts","label":"Knightley","gender":"男声","language":"英文","description":"Knightley"},{"value":"en_female_lana_del_rey_kelley_d_p1_uranus_bigtts","label":"Lynn","gender":"女声","language":"英文","description":"Lynn"},{"value":"en_female_lana_del_rey_parky_s_p1_uranus_bigtts","label":"Ivy","gender":"女声","language":"英文","description":"Ivy"},{"value":"en_male_marcus_uranus_bigtts","label":"Marcus","gender":"男声","language":"英文","description":"Marcus"},{"value":"en_female_mel_uranus_bigtts","label":"Mel","gender":"女声","language":"英文","description":"Mel"},{"value":"en_male_michael_uranus_bigtts","label":"Hank","gender":"男声","language":"英文","description":"Hank"},{"value":"en_male_michael-mouse_uranus_bigtts","label":"Chip","gender":"男声","language":"英文","description":"Chip"},{"value":"en_male_michael_kevin_uranus_bigtts","label":"Michael_Kevin","gender":"男声","language":"英文","description":"Michael_Kevin"},{"value":"en_male_motivational-coach_uranus_bigtts","label":"Rory","gender":"男声","language":"英文","description":"Rory"},{"value":"en_female_myra_uranus_bigtts","label":"Myra","gender":"女声","language":"英文","description":"Myra"},{"value":"en_female_myra_cmb_uranus_bigtts","label":"Sunny","gender":"女声","language":"英文","description":"Sunny"},{"value":"en_female_nadia_uranus_bigtts","label":"Blair","gender":"女声","language":"英文","description":"Blair"},{"value":"en_female_natasha_uranus_bigtts","label":"Natasha","gender":"女声","language":"英文","description":"Natasha"},{"value":"en_female_pleasant-female_uranus_bigtts","label":"Elaine","gender":"女声","language":"英文","description":"Elaine"},{"value":"en_female_rachel_p1_uranus_bigtts","label":"Rachel","gender":"女声","language":"英文","description":"Rachel"},{"value":"en_male_ronald_uranus_bigtts","label":"Ronald","gender":"男声","language":"英文","description":"Ronald"},{"value":"en_male_russell_uranus_bigtts","label":"Russell","gender":"男声","language":"英文","description":"Russell"},{"value":"en_female_scarlet_p1_uranus_bigtts","label":"Scarlet","gender":"女声","language":"英文","description":"Scarlet"},{"value":"en_female_sharron_uranus_bigtts","label":"Sharron","gender":"女声","language":"英文","description":"Sharron"},{"value":"en_male_simba_p1_uranus_bigtts","label":"Simba","gender":"男声","language":"英文","description":"Simba"},{"value":"en_female_skye_uranus_bigtts","label":"Skye","gender":"女声","language":"英文","description":"Skye"},{"value":"en_male_tom_hiddleston_p1_uranus_bigtts","label":"Tom","gender":"男声","language":"英文","description":"Tom"},{"value":"en_male_valentino_uranus_bigtts","label":"Valentino","gender":"男声","language":"英文","description":"Valentino"},{"value":"en_male_valentino_corey_uranus_bigtts","label":"Clark","gender":"男声","language":"英文","description":"Clark"},{"value":"en_female_wenrouzhishijieshuonv_uranus_bigtts","label":"Megan","gender":"女声","language":"英文","description":"Megan"},{"value":"en_female_xinwenjieshuonv_uranus_bigtts","label":"Kayla","gender":"女声","language":"英文","description":"Kayla"},{"value":"en_male_yangguangjieshuonan_uranus_bigtts","label":"Dylan","gender":"男声","language":"英文","description":"Dylan"},{"value":"en_female_zendaya_p1_uranus_bigtts","label":"Zendaya","gender":"女声","language":"英文","description":"Zendaya"},{"value":"es_female_bv084_uranus_bigtts","label":"Gracie","gender":"女声","language":"西班牙语","description":"Gracie"},{"value":"es_male_dani_uranus_bigtts","label":"Dani","gender":"男声","language":"西班牙语","description":"Dani"},{"value":"es_male_guillem_uranus_bigtts","label":"Guillem","gender":"男声","language":"西班牙语","description":"Guillem"},{"value":"es_female_ht_mx_f6_uranus_bigtts","label":"Marisol","gender":"女声","language":"西班牙语","description":"Marisol"},{"value":"fr_female_fr_bv078_uranus_bigtts","label":"Simone","gender":"女声","language":"法语","description":"Simone"},{"value":"fr_female_fr_f47_uranus_bigtts","label":"Camille","gender":"女声","language":"法语","description":"Camille"},{"value":"fr_male_fr_m29_uranus_bigtts","label":"Maurice","gender":"男声","language":"法语","description":"Maurice"},{"value":"fr_male_usseau_uranus_bigtts","label":"Usseau","gender":"男声","language":"法语","description":"Usseau"},{"value":"id_male_bv160_uranus_bigtts","label":"Rocco","gender":"男声","language":"id","description":"Rocco"},{"value":"id_male_bv160dialogue_uranus_bigtts","label":"Jude","gender":"男声","language":"id","description":"Jude"},{"value":"id_male_bv160narration_uranus_bigtts","label":"Hugo","gender":"男声","language":"id","description":"Hugo"},{"value":"id_female_bv161_uranus_bigtts","label":"Clara","gender":"女声","language":"id","description":"Clara"},{"value":"id_female_bv161dialogue_uranus_bigtts","label":"Sylvia","gender":"女声","language":"id","description":"Sylvia"},{"value":"id_female_bv161narration_uranus_bigtts","label":"Celeste","gender":"女声","language":"id","description":"Celeste"},{"value":"id_female_bv164_uranus_bigtts","label":"Crew","gender":"女声","language":"id","description":"Crew"},{"value":"id_male_bv164dialogue_uranus_bigtts","label":"Elian","gender":"男声","language":"id","description":"Elian"},{"value":"id_male_bv164narration_uranus_bigtts","label":"Ronan","gender":"男声","language":"id","description":"Ronan"},{"value":"id_female_f20_uranus_bigtts","label":"Chloe","gender":"女声","language":"id","description":"Chloe"},{"value":"id_male_han_uranus_bigtts","label":"Han","gender":"男声","language":"id","description":"Han"},{"value":"id_male_m08_uranus_bigtts","label":"Kyle","gender":"男声","language":"id","description":"Kyle"},{"value":"id_female_phulia_uranus_bigtts","label":"Phulia","gender":"女声","language":"id","description":"Phulia"},{"value":"ja_female_bv024_uranus_bigtts","label":"Bonnie","gender":"女声","language":"日语","description":"Bonnie"},{"value":"ja_female_bv520_uranus_bigtts","label":"Poppy","gender":"女声","language":"日语","description":"Poppy"},{"value":"ja_female_bv521_uranus_bigtts","label":"Aoi","gender":"女声","language":"日语","description":"Aoi"},{"value":"ja_female_bv522_uranus_bigtts","label":"Hana","gender":"女声","language":"日语","description":"Hana"},{"value":"ja_female_bv523_uranus_bigtts","label":"Lily","gender":"女声","language":"日语","description":"Lily"},{"value":"ja_male_bv524_uranus_bigtts","label":"Ken","gender":"男声","language":"日语","description":"Ken"},{"value":"ja_female_minimi_uranus_bigtts","label":"Minimi","gender":"女声","language":"日语","description":"Minimi"},{"value":"ja_female_shirou_uranus_bigtts","label":"Shirou","gender":"女声","language":"日语","description":"Shirou"},{"value":"ko_male_bv545_uranus_bigtts","label":"Jay","gender":"男声","language":"韩语","description":"Jay"},{"value":"ko_female_bv546_uranus_bigtts","label":"Momo","gender":"女声","language":"韩语","description":"Momo"},{"value":"ko_male_m03_uranus_bigtts","label":"Minho","gender":"男声","language":"韩语","description":"Minho"},{"value":"ko_male_shane_uranus_bigtts","label":"Shane","gender":"男声","language":"韩语","description":"Shane"},{"value":"ms_male_ham_uranus_bigtts","label":"Ham","gender":"男声","language":"ms","description":"Ham"},{"value":"ms_male_naim_uranus_bigtts","label":"Naim","gender":"男声","language":"ms","description":"Naim"},{"value":"mx_female_bv065_uranus_bigtts","label":"Irene","gender":"女声","language":"西班牙语","description":"Irene"},{"value":"mx_male_bv165dialogue_uranus_bigtts","label":"Diego","gender":"男声","language":"西班牙语","description":"Diego"},{"value":"mx_male_bv165narrator_uranus_bigtts","label":"Marcos","gender":"男声","language":"西班牙语","description":"Marcos"},{"value":"mx_female_bv166dialogue_uranus_bigtts","label":"Lucy","gender":"女声","language":"西班牙语","description":"Lucy"},{"value":"mx_female_bv166emotion_uranus_bigtts","label":"Rosa","gender":"女声","language":"西班牙语","description":"Rosa"},{"value":"mx_female_bv166narrator_uranus_bigtts","label":"Freya","gender":"女声","language":"西班牙语","description":"Freya"},{"value":"mx_male_felipe_uranus_bigtts","label":"Felipe","gender":"男声","language":"西班牙语","description":"Felipe"},{"value":"mx_male_ht_mx_m012_uranus_bigtts","label":"Derek","gender":"男声","language":"西班牙语","description":"Derek"},{"value":"mx_female_leslie_uranus_bigtts","label":"Leslie","gender":"女声","language":"西班牙语","description":"Leslie"},{"value":"mx_male_marcelo_uranus_bigtts","label":"Marcelo","gender":"男声","language":"西班牙语","description":"Marcelo"},{"value":"pt_male_bv172_uranus_bigtts","label":"Sam","gender":"男声","language":"葡萄牙语","description":"Sam"},{"value":"pt_male_bv172dialogue_uranus_bigtts","label":"Walter","gender":"男声","language":"葡萄牙语","description":"Walter"},{"value":"pt_male_bv172emotion_uranus_bigtts","label":"Vincent","gender":"男声","language":"葡萄牙语","description":"Vincent"},{"value":"pt_male_bv172narrator_uranus_bigtts","label":"Miles","gender":"男声","language":"葡萄牙语","description":"Miles"},{"value":"pt_female_bv173_uranus_bigtts","label":"Diana","gender":"女声","language":"葡萄牙语","description":"Diana"},{"value":"pt_female_bv173dialogue_uranus_bigtts","label":"Elena","gender":"女声","language":"葡萄牙语","description":"Elena"},{"value":"pt_female_bv173emotion_uranus_bigtts","label":"Lola","gender":"女声","language":"葡萄牙语","description":"Lola"},{"value":"pt_female_bv173narrator_uranus_bigtts","label":"Emma","gender":"女声","language":"葡萄牙语","description":"Emma"},{"value":"pt_female_bv530_uranus_bigtts","label":"Sofia","gender":"女声","language":"葡萄牙语","description":"Sofia"},{"value":"pt_male_bv531_uranus_bigtts","label":"Arthur","gender":"男声","language":"葡萄牙语","description":"Arthur"},{"value":"pt_female_mari_uranus_bigtts","label":"Mari","gender":"女声","language":"葡萄牙语","description":"Mari"},{"value":"pt_male_martins_uranus_bigtts","label":"Toby","gender":"男声","language":"葡萄牙语","description":"Toby"},{"value":"pt_male_rael_uranus_bigtts","label":"Rael","gender":"男声","language":"葡萄牙语","description":"Rael"},{"value":"ru_female_af07_uranus_bigtts","label":"Amelia","gender":"女声","language":"俄语","description":"Amelia"},{"value":"ru_female_irinae_uranus_bigtts","label":"Irinae","gender":"女声","language":"俄语","description":"Irinae"},{"value":"ru_male_pavel_uranus_bigtts","label":"Pavel","gender":"男声","language":"俄语","description":"Pavel"},{"value":"ru_female_sophie_uranus_bigtts","label":"Ksenia","gender":"女声","language":"俄语","description":"Ksenia"},{"value":"ru_male_vlad_uranus_bigtts","label":"Silas","gender":"男声","language":"俄语","description":"Silas"},{"value":"th_female_bv568_angry_uranus_bigtts","label":"Valeria","gender":"女声","language":"th","description":"Valeria"},{"value":"th_female_bv568_fear_uranus_bigtts","label":"Iris","gender":"女声","language":"th","description":"Iris"},{"value":"th_female_bv568_happy_uranus_bigtts","label":"Zara","gender":"女声","language":"th","description":"Zara"},{"value":"th_female_bv568_hate_uranus_bigtts","label":"Valentina","gender":"女声","language":"th","description":"Valentina"},{"value":"th_female_bv568_neutral_uranus_bigtts","label":"Mildred","gender":"女声","language":"th","description":"Mildred"},{"value":"th_female_bv568_sad_uranus_bigtts","label":"Lydia","gender":"女声","language":"th","description":"Lydia"},{"value":"th_female_bv568_suprise_uranus_bigtts","label":"Phoebe","gender":"女声","language":"th","description":"Phoebe"},{"value":"tl_female_annika_uranus_bigtts","label":"Annika","gender":"女声","language":"tl","description":"Annika"},{"value":"tl_male_ed_uranus_bigtts","label":"Ed","gender":"男声","language":"tl","description":"Ed"},{"value":"tl_female_hervie_uranus_bigtts","label":"Hervie","gender":"女声","language":"tl","description":"Hervie"},{"value":"vi_female_hong_uranus_bigtts","label":"Hong","gender":"女声","language":"vi","description":"Hong"},{"value":"vi_female_ling_uranus_bigtts","label":"Ling","gender":"女声","language":"vi","description":"Ling"},{"value":"vi_female_linh_uranus_bigtts","label":"Linh","gender":"女声","language":"vi","description":"Linh"},{"value":"vi_female_partner_uranus_bigtts","label":"Partner","gender":"女声","language":"vi","description":"Partner"},{"value":"vi_female_ruan_uranus_bigtts","label":"Ruan","gender":"女声","language":"vi","description":"Ruan"},{"value":"vi_female_wu_uranus_bigtts","label":"Wu","gender":"女声","language":"vi","description":"Wu"},{"value":"vi_male_wumg_uranus_bigtts","label":"Wumg","gender":"男声","language":"vi","description":"Wumg"},{"value":"it_male_enzo_uranus_bigtts","label":"Enzo","gender":"男声","language":"it","description":"Enzo"}]},{"field":"speed","title":"语速","type":"select","value":"1","options":[{"value":"0.5","label":"0.5x"},{"value":"0.75","label":"0.75x"},{"value":"1","label":"1.0x"},{"value":"1.25","label":"1.25x"},{"value":"1.5","label":"1.5x"},{"value":"2","label":"2.0x"}],"props":{"teleported":false,"placement":"top-start","filterable":false}},{"field":"emotion","title":"情绪","type":"select","value":"auto","options":[{"value":"auto","label":"自动"},{"value":"happy","label":"开心"},{"value":"sad","label":"悲伤"},{"value":"angry","label":"愤怒"},{"value":"fearful","label":"害怕"},{"value":"surprised","label":"惊讶"},{"value":"calm","label":"平静"}],"props":{"teleported":false,"placement":"top-start","filterable":false}},{"field":"emotionScale","title":"情绪强度","type":"select","value":"4","options":[{"value":"1","label":"1"},{"value":"2","label":"2"},{"value":"3","label":"3"},{"value":"4","label":"4"},{"value":"5","label":"5"}],"props":{"teleported":false,"placement":"top-start","filterable":false},"audioWhen":{"emotion":["happy","sad","angry","fearful","surprised","calm"]}},{"field":"responseFormat","title":"输出格式","type":"select","value":"mp3","options":[{"value":"mp3","label":"MP3"},{"value":"wav","label":"WAV"}],"props":{"teleported":false,"placement":"top-start","filterable":false}}]},
    {"id":"whisper-1","label":"GT 语音转文字","type":"audio","maxReferenceImages":0,"promptOptional":true,"audioOptions":{"nativeParameters":true,"referenceLimits":{"default":1}},"rules":[{"field":"audioDurationSec","title":"音频时长 (秒)","type":"input","value":"","props":{},"validate":[{"required":true,"message":"请填写音频时长 (秒)"}]},{"field":"language","title":"语言","type":"input","value":"","props":{}}]},
    {"id":"gemini-3.8-flash-tts","label":"GM-3.8 Flash TTS","type":"audio","maxReferenceImages":0,"promptOptional":false,"audioOptions":{"nativeParameters":true,"referenceLimits":{"default":0}},"rules":[{"field":"quality","title":"档位","type":"select","value":"lite","options":[{"value":"standard","label":"标准"},{"value":"lite","label":"轻量"}],"props":{"teleported":false,"placement":"top-start","filterable":false}},{"field":"voice","title":"音色","type":"select","value":"Zephyr","options":[{"value":"Zephyr","label":"Zephyr","description":"明亮","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Zephyr.mp3","language":"多语种"},{"value":"Puck","label":"Puck","description":"活泼","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Puck.mp3","language":"多语种"},{"value":"Charon","label":"Charon","description":"清晰叙述","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Charon.mp3","language":"多语种"},{"value":"Kore","label":"Kore","description":"坚定","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Kore.mp3","language":"多语种"},{"value":"Fenrir","label":"Fenrir","description":"激昂","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Fenrir.mp3","language":"多语种"},{"value":"Leda","label":"Leda","description":"年轻","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Leda.mp3","language":"多语种"},{"value":"Orus","label":"Orus","description":"坚定","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Orus.mp3","language":"多语种"},{"value":"Aoede","label":"Aoede","description":"轻盈","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Aoede.mp3","language":"多语种"},{"value":"Callirrhoe","label":"Callirrhoe","description":"随和","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Callirrhoe.mp3","language":"多语种"},{"value":"Autonoe","label":"Autonoe","description":"明亮","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Autonoe.mp3","language":"多语种"},{"value":"Enceladus","label":"Enceladus","description":"气声","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Enceladus.mp3","language":"多语种"},{"value":"Iapetus","label":"Iapetus","description":"清晰","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Iapetus.mp3","language":"多语种"},{"value":"Umbriel","label":"Umbriel","description":"随和","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Umbriel.mp3","language":"多语种"},{"value":"Algieba","label":"Algieba","description":"流畅","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Algieba.mp3","language":"多语种"},{"value":"Despina","label":"Despina","description":"流畅","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Despina.mp3","language":"多语种"},{"value":"Erinome","label":"Erinome","description":"清晰","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Erinome.mp3","language":"多语种"},{"value":"Algenib","label":"Algenib","description":"沙哑","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Algenib.mp3","language":"多语种"},{"value":"Rasalgethi","label":"Rasalgethi","description":"清晰叙述","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Rasalgethi.mp3","language":"多语种"},{"value":"Laomedeia","label":"Laomedeia","description":"活泼","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Laomedeia.mp3","language":"多语种"},{"value":"Achernar","label":"Achernar","description":"柔和","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Achernar.mp3","language":"多语种"},{"value":"Alnilam","label":"Alnilam","description":"坚定","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Alnilam.mp3","language":"多语种"},{"value":"Schedar","label":"Schedar","description":"平稳","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Schedar.mp3","language":"多语种"},{"value":"Gacrux","label":"Gacrux","description":"成熟","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Gacrux.mp3","language":"多语种"},{"value":"Pulcherrima","label":"Pulcherrima","description":"直接","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Pulcherrima.mp3","language":"多语种"},{"value":"Achird","label":"Achird","description":"友好","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Achird.mp3","language":"多语种"},{"value":"Zubenelgenubi","label":"Zubenelgenubi","description":"随性","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Zubenelgenubi.mp3","language":"多语种"},{"value":"Vindemiatrix","label":"Vindemiatrix","description":"温柔","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Vindemiatrix.mp3","language":"多语种"},{"value":"Sadachbia","label":"Sadachbia","description":"生动","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Sadachbia.mp3","language":"多语种"},{"value":"Sadaltager","label":"Sadaltager","description":"沉稳博学","gender":"男声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Sadaltager.mp3","language":"多语种"},{"value":"Sulafat","label":"Sulafat","description":"温暖","gender":"女声","previewUrl":"https://cdn.token6688.com/voice-previews/gemini/Sulafat.mp3","language":"多语种"}],"props":{"teleported":false,"placement":"top-start","filterable":true},"validate":[{"required":true,"message":"请填写音色"}]},{"field":"instructions","title":"风格指令","type":"input","value":"","props":{"type":"textarea","autosize":{"minRows":2,"maxRows":5}}},{"field":"responseFormat","title":"输出格式","type":"select","value":"wav","options":[{"value":"wav","label":"WAV"}],"props":{"teleported":false,"placement":"top-start","filterable":false}}]},
    {
      maxReferenceImages: 16,
      maxPromptLength: 32000,
      "id": "gt-image-2.6-sunburst",
      "label": "GT Image 2.6 Sunb",
      "type": "image",
      "imageSizes": [
        "1K",
        "2K",
        "4K"
      ],
      "imageRatios": [
        "auto",
        "1:1",
        "3:2",
        "2:3",
        "4:3",
        "3:4",
        "5:4",
        "4:5",
        "16:9",
        "9:16",
        "21:9",
        "9:21"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": [
        {
          "field": "frameCount",
          "type": "inputNumber",
          "title": "动图帧数",
          "value": 9,
          "props": {
            "min": 2,
            "max": 16,
            "precision": 0,
            "controlsPosition": "right"
          }
        },
        {
          "field": "frameDurationMs",
          "type": "inputNumber",
          "title": "每帧时长（毫秒）",
          "value": 200,
          "props": {
            "min": 20,
            "max": 655350,
            "precision": 0,
            "controlsPosition": "right"
          }
        },
        {
          "field": "moderation",
          "hidden": true,
          "type": "select",
          "title": "内容审核",
          "value": "low",
          "options": [
            {
              "value": "low",
              "label": "宽松"
            },
            {
              "value": "auto",
              "label": "标准"
            }
          ],
          "props": {}
        },
        {
          "field": "outputFormat",
          "control": [{ "value": "gif", "rule": ["frameCount", "frameDurationMs"] }],
          "type": "select",
          "title": "输出格式",
          "value": "jpeg",
          "options": [
            {
              "value": "png",
              "label": "PNG"
            },
            {
              "value": "jpeg",
              "label": "JPEG"
            },
            {
              "value": "svg",
              "label": "SVG 矢量图"
            },
            {
              "value": "gif",
              "label": "GIF 动图"
            }
          ],
          "props": {}
        },
        {
          "field": "quality",
          "type": "select",
          "title": "图片质量",
          "value": "low",
          "options": [
            {
              "value": "low",
              "label": "低"
            },
            {
              "value": "medium",
              "label": "中"
            },
            {
              "value": "high",
              "label": "高"
            },
            {
              "value": "xhigh",
              "label": "超高"
            },
            {
              "value": "max",
              "label": "极致"
            }
          ],
          "props": {}
        }
      ]
    },
    {
      maxReferenceImages: 16,
      maxPromptLength: 32000,
      "id": "gt-image-2.6-flare",
      "label": "GT Image 2.6 Flare",
      "type": "image",
      "imageSizes": [
        "1K",
        "2K",
        "4K"
      ],
      "imageRatios": [
        "auto",
        "1:1",
        "3:2",
        "2:3",
        "4:3",
        "3:4",
        "5:4",
        "4:5",
        "16:9",
        "9:16",
        "21:9",
        "9:21"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": [
        {
          "field": "frameCount",
          "type": "inputNumber",
          "title": "动图帧数",
          "value": 9,
          "props": {
            "min": 2,
            "max": 16,
            "precision": 0,
            "controlsPosition": "right"
          }
        },
        {
          "field": "frameDurationMs",
          "type": "inputNumber",
          "title": "每帧时长（毫秒）",
          "value": 200,
          "props": {
            "min": 20,
            "max": 655350,
            "precision": 0,
            "controlsPosition": "right"
          }
        },
        {
          "field": "moderation",
          "hidden": true,
          "type": "select",
          "title": "内容审核",
          "value": "low",
          "options": [
            {
              "value": "low",
              "label": "宽松"
            },
            {
              "value": "auto",
              "label": "标准"
            }
          ],
          "props": {}
        },
        {
          "field": "outputFormat",
          "control": [{ "value": "gif", "rule": ["frameCount", "frameDurationMs"] }],
          "type": "select",
          "title": "输出格式",
          "value": "jpeg",
          "options": [
            {
              "value": "png",
              "label": "PNG"
            },
            {
              "value": "jpeg",
              "label": "JPEG"
            },
            {
              "value": "svg",
              "label": "SVG 矢量图"
            },
            {
              "value": "gif",
              "label": "GIF 动图"
            }
          ],
          "props": {}
        },
        {
          "field": "quality",
          "type": "select",
          "title": "图片质量",
          "value": "low",
          "options": [
            {
              "value": "low",
              "label": "低"
            },
            {
              "value": "medium",
              "label": "中"
            },
            {
              "value": "high",
              "label": "高"
            },
            {
              "value": "xhigh",
              "label": "超高"
            },
            {
              "value": "max",
              "label": "极致"
            }
          ],
          "props": {}
        }
      ]
    },
    {
      maxReferenceImages: 16,
      maxPromptLength: 32000,
      "id": "gt-image-2.5-sunburst",
      "label": "GT Image 2.5 Sunb",
      "type": "image",
      "imageSizes": [
        "1K",
        "2K",
        "4K"
      ],
      "imageRatios": [
        "auto",
        "1:1",
        "3:2",
        "2:3",
        "4:3",
        "3:4",
        "5:4",
        "4:5",
        "16:9",
        "9:16",
        "21:9",
        "9:21"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": [
        {
          "field": "background",
          "type": "select",
          "title": "背景",
          "value": "opaque",
          "options": [
            {
              "value": "opaque",
              "label": "实色底"
            },
            {
              "value": "transparent",
              "label": "透明底"
            }
          ],
          "props": {}
        },
        {
          "field": "moderation",
          "hidden": true,
          "type": "select",
          "title": "内容审核",
          "value": "low",
          "options": [
            {
              "value": "low",
              "label": "宽松"
            },
            {
              "value": "auto",
              "label": "标准"
            }
          ],
          "props": {}
        },
        {
          "field": "outputCompression",
          "type": "inputNumber",
          "title": "输出压缩率",
          "value": 100,
          "props": {
            "min": 0,
            "max": 100,
            "precision": 0,
            "controlsPosition": "right"
          }
        },
        {
          "field": "outputFormat",
          "type": "select",
          "title": "输出格式",
          "value": "jpeg",
          "options": [
            {
              "value": "png",
              "label": "PNG"
            },
            {
              "value": "jpeg",
              "label": "JPEG"
            }
          ],
          "props": {}
        },
        {
          "field": "quality",
          "type": "select",
          "title": "图片质量",
          "value": "low",
          "options": [
            {
              "value": "low",
              "label": "低"
            },
            {
              "value": "medium",
              "label": "中"
            },
            {
              "value": "high",
              "label": "高"
            },
            {
              "value": "xhigh",
              "label": "超高"
            },
            {
              "value": "max",
              "label": "极致"
            }
          ],
          "props": {}
        }
      ]
    },
    {
      maxReferenceImages: 17,
      maxPromptLength: 32000,
      id: "gt-image-2.5-flare",
      label: "GT Image 2.5 Flare",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageSizes: ["1K", "2K", "4K"],
      imageRatios: ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9", "9:21"],
      rules: [{
        type: "select", field: "outputFormat", title: "输出格式", value: "jpeg",
        options: [
          { label: "PNG", value: "png", description: "无损，体积大" },
          { label: "JPEG", value: "jpeg", description: "有损，体积小" },
        ],
      }, {
        type: "select", field: "background", title: "背景", value: "opaque",
        options: [{ label: "实色底", value: "opaque" }, { label: "透明底（PNG）", value: "transparent" }],
      }, {
        type: "select", field: "quality", title: "图片质量", value: "low",
        options: [
          { label: "低", value: "low" }, { label: "中", value: "medium" },
          { label: "高", value: "high" }, { label: "超高", value: "xhigh" }, { label: "极致", value: "max" },
        ],
      }],
    },
    {
      maxReferenceImages: 16,
      maxPromptLength: 50000,
      "id": "gt-image-2",
      "label": "GT Image 2",
      "type": "image",
      "imageSizes": [
        "1K",
        "2K",
        "4K"
      ],
      "imageRatios": [
        "auto",
        "1:1",
        "3:2",
        "2:3",
        "4:3",
        "3:4",
        "5:4",
        "4:5",
        "16:9",
        "9:16",
        "21:9",
        "9:21"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": [
        {
          "field": "outputFormat",
          "type": "select",
          "title": "输出格式",
          "value": "jpeg",
          "options": [
            {
              "value": "png",
              "label": "PNG"
            },
            {
              "value": "jpeg",
              "label": "JPEG"
            }
          ],
          "props": {}
        },
        {
          "field": "quality",
          "type": "select",
          "title": "图片质量",
          "value": "high",
          "options": [
            {
              "value": "auto",
              "label": "自适应"
            },
            {
              "value": "high",
              "label": "高"
            },
            {
              "value": "medium",
              "label": "中"
            },
            {
              "value": "low",
              "label": "低"
            }
          ],
          "props": {}
        }
      ]
    },
    {
      maxReferenceImages: 16,
      maxPromptLength: 32000,
      "id": "gt-image-2-official",
      "label": "GT Image 2 Official",
      "type": "image",
      "imageSizes": [
        "1K",
        "2K",
        "4K"
      ],
      "imageRatios": [
        "auto",
        "1:1",
        "3:2",
        "2:3",
        "4:3",
        "3:4",
        "5:4",
        "4:5",
        "16:9",
        "9:16",
        "2:1",
        "1:2",
        "3:1",
        "1:3",
        "21:9",
        "9:21"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": [
        {
          "field": "outputFormat",
          "type": "select",
          "title": "输出格式",
          "value": "png",
          "options": [
            {
              "value": "png",
              "label": "PNG"
            },
            {
              "value": "jpeg",
              "label": "JPEG"
            }
          ],
          "props": {}
        },
        {
          "field": "quality",
          "type": "select",
          "title": "图片质量",
          "value": "low",
          "options": [
            {
              "value": "low",
              "label": "低"
            },
            {
              "value": "medium",
              "label": "中"
            },
            {
              "value": "high",
              "label": "高"
            }
          ],
          "props": {}
        }
      ]
    },
    {
      maxReferenceImages: 1,
      maxPromptLength: 32000,
      "id": "gt-image-2-c",
      "label": "GT Image 2 C",
      "type": "image",
      "imageSizes": [
        "1K"
      ],
      "imageRatios": [
        "1:1",
        "16:9",
        "9:16"
      ],
      "mode": [
        "text",
        "singleImage"
      ],
      "rules": [
        {
          "field": "outputFormat",
          "type": "select",
          "title": "输出格式",
          "value": "jpeg",
          "options": [
            {
              "value": "png",
              "label": "PNG"
            },
            {
              "value": "jpeg",
              "label": "JPEG"
            }
          ],
          "props": {}
        },
        {
          "field": "quality",
          "type": "select",
          "title": "图片质量",
          "value": "high",
          "options": [
            {
              "value": "auto",
              "label": "自适应"
            },
            {
              "value": "high",
              "label": "高"
            },
            {
              "value": "medium",
              "label": "中"
            },
            {
              "value": "low",
              "label": "低"
            }
          ],
          "props": {}
        }
      ]
    },
    {
      maxReferenceImages: 10,
      maxPromptLength: 100000,
      id: "doubao-seedream-5-5",
      label: "Seedream 5.5",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageSizes: ["2K"],
      imageRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "5:4", "4:5", "21:9"],
    },
    {
      maxReferenceImages: 10,
      maxPromptLength: 100000,
      "id": "doubao-seedream-5-0-pro",
      "label": "Seedream 5.0 Pro",
      "type": "image",
      "imageSizes": [
        "1K",
        "2K"
      ],
      "imageRatios": [
        "auto",
        "1:1",
        "4:3",
        "3:4",
        "16:9",
        "9:16",
        "3:2",
        "2:3",
        "21:9"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": []
    },
    {
      maxReferenceImages: 10,
      maxPromptLength: 30000,
      "id": "doubao-seedream-5-0",
      "label": "Seedream 5.0",
      "type": "image",
      "imageSizes": [
        "2K",
        "4K"
      ],
      "imageRatios": [
        "16:9",
        "9:16",
        "1:1",
        "21:9",
        "4:3",
        "3:4",
        "3:2",
        "2:3",
        "5:4",
        "4:5",
        "2:1",
        "1:2",
        "3:1",
        "1:3",
        "9:21"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": []
    },
    {
      maxReferenceImages: 4,
      maxPromptLength: 30000,
      "id": "doubao-seedream-4-5",
      "label": "Seedream 4.5",
      "type": "image",
      "imageSizes": [
        "2K",
        "4K"
      ],
      "imageRatios": [
        "1:1",
        "3:2",
        "2:3",
        "4:3",
        "3:4",
        "5:4",
        "4:5",
        "16:9",
        "9:16",
        "2:1",
        "1:2",
        "21:9",
        "3:1",
        "1:3",
        "9:21"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": []
    },
    {
      maxReferenceImages: 14,
      "id": "gm-nb-2.1-image",
      "label": "GM NB 2.1 Image",
      "type": "image",
      "imageSizes": [
        "1K",
        "2K",
        "4K"
      ],
      "imageRatios": [
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9",
        "1:4",
        "4:1",
        "8:1"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": []
    },
    {
      maxReferenceImages: 14,
      maxPromptLength: 30000,
      "id": "gm-3.1-flash-image",
      "label": "GM-3.1 Flash Image",
      "type": "image",
      "imageSizes": [
        "0.5K",
        "1K",
        "2K",
        "4K"
      ],
      "imageRatios": [
        "auto",
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9",
        "1:4",
        "4:1",
        "1:8",
        "8:1"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": [
        {
          "field": "thinkingLevel",
          "type": "select",
          "title": "思考等级",
          "value": "minimal",
          "options": [
            {
              "value": "minimal",
              "label": "快速"
            },
            {
              "value": "high",
              "label": "深度"
            }
          ],
          "props": {}
        }
      ]
    },
    {
      maxReferenceImages: 14,
      maxPromptLength: 30000,
      "id": "gm-3-pro-image",
      "label": "GM-3 Pro Image",
      "type": "image",
      "imageSizes": [
        "1K",
        "2K",
        "4K"
      ],
      "imageRatios": [
        "auto",
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": []
    },
    {
      maxReferenceImages: 14,
      maxPromptLength: 30000,
      "id": "gm-3.1-flash-lite-image",
      "label": "GM-3.1 Flash Lite Image",
      "type": "image",
      "imageSizes": [
        "1K"
      ],
      "imageRatios": [
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": []
    },
    {
      maxReferenceImages: 5,
      maxPromptLength: 20000,
      "id": "gk-imagine-image-2.0",
      "label": "GK Imagine 2.0 图像",
      "type": "image",
      "imageSizes": [
        "默认"
      ],
      "imageRatios": [
        "1:1",
        "16:9",
        "9:16",
        "3:2",
        "2:3",
        "4:3",
        "3:4"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": []
    },
    {
      maxReferenceImages: 7,
      maxPromptLength: 16000,
      "id": "gk-imagine-image",
      "label": "GK Imagine 1.0 Image",
      "type": "image",
      "imageSizes": [
        "默认"
      ],
      "imageRatios": [
        "1:1",
        "16:9",
        "9:16",
        "3:2",
        "2:3",
        "4:3",
        "3:4"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": []
    },
    {
      maxReferenceImages: 4,
      maxPromptLength: 1024,
      "id": "mj-img",
      "label": "MJ",
      "type": "image",
      "imageSizes": [
        "默认"
      ],
      "imageRatios": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "3:2",
        "2:3",
        "4:5",
        "5:4",
        "21:9"
      ],
      "mode": [
        "text",
        "multiReference"
      ],
      "rules": [
        {
          "field": "botType",
          "type": "select",
          "title": "模型引擎",
          "value": "MID_JOURNEY",
          "options": [
            {
              "value": "MID_JOURNEY",
              "label": "MJ 写实模式"
            },
            {
              "value": "NIJI_JOURNEY",
              "label": "Niji 动漫模式"
            }
          ],
          "props": {}
        },
        {
          "field": "chaos",
          "type": "select",
          "title": "混乱度",
          "value": "0",
          "options": [
            {
              "value": "0",
              "label": "0 稳定"
            },
            {
              "value": "5",
              "label": "5 轻微变化"
            },
            {
              "value": "10",
              "label": "10 轻微变化"
            },
            {
              "value": "15",
              "label": "15 轻微变化"
            },
            {
              "value": "20",
              "label": "20 轻微变化"
            },
            {
              "value": "25",
              "label": "25 轻微变化"
            },
            {
              "value": "30",
              "label": "30 中等变化"
            },
            {
              "value": "35",
              "label": "35 中等变化"
            },
            {
              "value": "40",
              "label": "40 中等变化"
            },
            {
              "value": "45",
              "label": "45 中等变化"
            },
            {
              "value": "50",
              "label": "50 中等变化"
            },
            {
              "value": "55",
              "label": "55 大变化"
            },
            {
              "value": "60",
              "label": "60 大变化"
            },
            {
              "value": "65",
              "label": "65 大变化"
            },
            {
              "value": "70",
              "label": "70 大变化"
            },
            {
              "value": "75",
              "label": "75 大变化"
            },
            {
              "value": "80",
              "label": "80 大变化"
            },
            {
              "value": "85",
              "label": "85 大变化"
            },
            {
              "value": "90",
              "label": "90 大变化"
            },
            {
              "value": "95",
              "label": "95 大变化"
            },
            {
              "value": "100",
              "label": "100 最大变化"
            }
          ],
          "props": {}
        },
        {
          "field": "cref",
          "type": "input",
          "title": "角色参考图链接",
          "value": "",
          "props": {
            "clearable": true,
            "placeholder": "让生成的人物保持成同一个角色（换场景/换动作不换脸）。填公网可访问的图片地址，可直接用本站已生成图片的链接。仅 v6 / v6.1 可用（v7 起 MJ 官方已移除该参数）"
          }
        },
        {
          "field": "cw",
          "type": "select",
          "title": "角色相似度",
          "value": "100",
          "options": [
            {
              "value": "0",
              "label": "0 只保留脸"
            },
            {
              "value": "50",
              "label": "50 中等"
            },
            {
              "value": "100",
              "label": "100 完整保留"
            }
          ],
          "props": {}
        },
        {
          "field": "draft",
          "type": "switch",
          "title": "草图模式",
          "value": false,
          "props": {}
        },
        {
          "field": "extra",
          "type": "input",
          "title": "高级参数",
          "value": "",
          "props": {
            "clearable": true,
            "placeholder": "给熟悉 MJ 的用户：直接填官方参数原样追加，如 --sameseed。⚠ 三条硬规则：① 必须双横线（--sameseed 对，-sameseed 错，会被 MJ 直接拒）；② 上面已有独立字段的参数（比例/版本/风格/种子等）请用对应字段，不要在这里或 prompt 里重复写，重复会冲突；③ 不允许改变出图张数或任务类型的参数（--repeat/--video）；速度档（--fast/--turbo/--relax）会被自动去掉，不影响出图内容"
          }
        },
        {
          "field": "hd",
          "type": "switch",
          "title": "HD 高清",
          "value": false,
          "props": {}
        },
        {
          "field": "iw",
          "type": "select",
          "title": "参考图权重",
          "value": "2",
          "options": [
            {
              "value": "0.5",
              "label": "0.5 自由"
            },
            {
              "value": "1",
              "label": "1 较弱"
            },
            {
              "value": "2",
              "label": "2 贴近"
            },
            {
              "value": "3",
              "label": "3 最贴近"
            }
          ],
          "props": {}
        },
        {
          "field": "mode",
          "type": "select",
          "title": "生成模式",
          "value": "text-to-image",
          "options": [
            {
              "value": "text-to-image",
              "label": "文生图"
            },
            {
              "value": "multi-reference",
              "label": "多图融合"
            }
          ],
          "props": {}
        },
        {
          "field": "negativePrompt",
          "type": "input",
          "title": "排除内容",
          "value": "",
          "props": {
            "clearable": true
          }
        },
        {
          "field": "outputFormat",
          "type": "select",
          "title": "输出格式",
          "value": "jpeg",
          "options": [
            {
              "value": "png",
              "label": "PNG"
            },
            {
              "value": "jpeg",
              "label": "JPEG"
            }
          ],
          "props": {}
        },
        {
          "field": "quality",
          "type": "select",
          "title": "图片质量",
          "value": "1",
          "options": [
            {
              "value": "0.25",
              "label": "0.25 快速"
            },
            {
              "value": "0.5",
              "label": "0.5 标准"
            },
            {
              "value": "1",
              "label": "1 高清"
            },
            {
              "value": "2",
              "label": "2 超清"
            }
          ],
          "props": {}
        },
        {
          "field": "seed",
          "type": "inputNumber",
          "title": "随机种子",
          "value": null,
          "props": {
            "min": 0,
            "max": 4294967295,
            "precision": 0,
            "controlsPosition": "right"
          }
        },
        {
          "field": "sref",
          "type": "input",
          "title": "风格参考图链接",
          "value": "",
          "props": {
            "clearable": true
          }
        },
        {
          "field": "stop",
          "type": "select",
          "title": "提前停止",
          "value": "100",
          "options": [
            {
              "value": "50",
              "label": "50% 很朦胧"
            },
            {
              "value": "80",
              "label": "80% 略柔化"
            },
            {
              "value": "100",
              "label": "100% 不停止"
            }
          ],
          "props": {}
        },
        {
          "field": "style",
          "type": "select",
          "title": "渲染模式",
          "value": "",
          "options": [
            {
              "value": "",
              "label": "默认"
            },
            {
              "value": "raw",
              "label": "Raw 原始"
            }
          ],
          "props": {}
        },
        {
          "field": "stylize",
          "type": "select",
          "title": "风格化强度",
          "value": "100",
          "options": [
            {
              "value": "0",
              "label": "0 写实"
            },
            {
              "value": "50",
              "label": "50 轻微"
            },
            {
              "value": "100",
              "label": "100 默认"
            },
            {
              "value": "150",
              "label": "150 轻微"
            },
            {
              "value": "200",
              "label": "200 轻微"
            },
            {
              "value": "250",
              "label": "250 中等"
            },
            {
              "value": "300",
              "label": "300 中等"
            },
            {
              "value": "350",
              "label": "350 中等"
            },
            {
              "value": "400",
              "label": "400 中等"
            },
            {
              "value": "450",
              "label": "450 中等"
            },
            {
              "value": "500",
              "label": "500 强烈"
            },
            {
              "value": "550",
              "label": "550 强烈"
            },
            {
              "value": "600",
              "label": "600 强烈"
            },
            {
              "value": "650",
              "label": "650 强烈"
            },
            {
              "value": "700",
              "label": "700 强烈"
            },
            {
              "value": "750",
              "label": "750 极强"
            },
            {
              "value": "800",
              "label": "800 极强"
            },
            {
              "value": "850",
              "label": "850 极强"
            },
            {
              "value": "900",
              "label": "900 极强"
            },
            {
              "value": "950",
              "label": "950 极强"
            },
            {
              "value": "1000",
              "label": "1000 极致"
            }
          ],
          "props": {}
        },
        {
          "field": "sw",
          "type": "select",
          "title": "风格强度",
          "value": "100",
          "options": [
            {
              "value": "0",
              "label": "0 几乎不用"
            },
            {
              "value": "100",
              "label": "100 默认"
            },
            {
              "value": "500",
              "label": "500 强烈"
            },
            {
              "value": "1000",
              "label": "1000 最强"
            }
          ],
          "props": {}
        },
        {
          "field": "tile",
          "type": "switch",
          "title": "无缝平铺",
          "value": false,
          "props": {}
        },
        {
          "field": "version",
          "type": "select",
          "title": "模型版本",
          "value": "",
          "options": [
            {
              "value": "",
              "label": "默认"
            },
            {
              "value": "8.2",
              "label": "v8.2 最新"
            },
            {
              "value": "8.1",
              "label": "v8.1"
            },
            {
              "value": "7",
              "label": "v7 / Niji 7"
            },
            {
              "value": "6.1",
              "label": "v6.1"
            },
            {
              "value": "6",
              "label": "v6 / Niji 6"
            },
            {
              "value": "5.2",
              "label": "v5.2"
            },
            {
              "value": "5.1",
              "label": "v5.1"
            }
          ],
          "props": {}
        },
        {
          "field": "weird",
          "type": "select",
          "title": "怪异度",
          "value": "0",
          "options": [
            {
              "value": "0",
              "label": "0 正常"
            },
            {
              "value": "250",
              "label": "250 轻微"
            },
            {
              "value": "1000",
              "label": "1000 明显"
            },
            {
              "value": "3000",
              "label": "3000 极致"
            }
          ],
          "props": {}
        }
      ]
    },
    {
      maxReferenceImages: 16,
      maxPromptLength: 32000,
      "id": "minimax-h3-image",
      "label": "MiniMax H3 Image",
      "type": "image",
      "imageSizes": [
        "1K",
        "2K",
        "4K"
      ],
      "imageRatios": [
        "auto",
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "3:2",
        "2:3",
        "21:9",
        "3:1",
        "1:3"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": []
    },
    {
      maxReferenceImages: 9,
      maxPromptLength: 5000,
      "id": "wan2.7-image",
      "label": "Wan 2.7 Image",
      "type": "image",
      "imageSizes": [
        "1K",
        "2K"
      ],
      "imageRatios": [
        "auto",
        "1:1",
        "3:2",
        "2:3",
        "4:3",
        "3:4",
        "5:4",
        "4:5",
        "16:9",
        "9:16",
        "2:1",
        "1:2",
        "3:1",
        "1:3",
        "21:9",
        "9:21"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": [
        {
          "field": "quality",
          "type": "select",
          "title": "图片质量",
          "value": "standard",
          "options": [
            {
              "value": "standard",
              "label": "标准"
            },
            {
              "value": "pro",
              "label": "专业"
            }
          ],
          "props": {}
        },
        {
          "field": "seed",
          "type": "inputNumber",
          "title": "随机种子",
          "value": null,
          "props": {
            "min": 0,
            "max": 2147483647,
            "precision": 0,
            "controlsPosition": "right"
          }
        }
      ]
    },
    {
      maxReferenceImages: 9,
      "id": "mu-image",
      "label": "MU Image",
      "type": "image",
      "imageSizes": [
        "2K"
      ],
      "imageRatios": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "3:2",
        "2:3"
      ],
      "mode": [
        "text",
        "singleImage",
        "multiReference"
      ],
      "rules": [
        {
          "field": "outputFormat",
          "type": "select",
          "title": "输出格式",
          "value": "jpeg",
          "options": [
            {
              "value": "png",
              "label": "PNG"
            },
            {
              "value": "jpeg",
              "label": "JPEG"
            }
          ],
          "props": {}
        }
      ]
    },
    {"id":"seedance-2-5-special","label":"Seedance 2.5 · 特价按次","type":"video","mode":[["imageReference:30","videoReference:10","audioReference:10"],"singleImage","text",["imageReference:10","videoReference:5","audioReference:5"]],"audio":true,"imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9"],"durationResolutionMap":[{"duration":[30],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]}],"maxPromptLength":20000,"promptOptional":false,"videoVariants":[{"quality":"标准","operation":"reference","mode":["imageReference:30","videoReference:10","audioReference:10"],"imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9"],"durationResolutionMap":[{"duration":[30],"resolution":["480p","720p"]}]},{"quality":"标准","operation":"reference","mode":"singleImage","imageRatios":["9:16","16:9","1:1","21:9"],"durationResolutionMap":[{"duration":[30],"resolution":["480p","720p"]}]},{"quality":"标准","operation":"reference","mode":"text","imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9"],"durationResolutionMap":[{"duration":[30],"resolution":["480p","720p"]}]},{"quality":"flash","operation":"reference","mode":["imageReference:10","videoReference:5","audioReference:5"],"imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9"],"durationResolutionMap":[{"duration":[30],"resolution":["480p","720p"]}]},{"quality":"flash","operation":"reference","mode":"text","imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9"],"durationResolutionMap":[{"duration":[30],"resolution":["480p","720p"]}]}],"rules":[{"field":"quality","type":"select","title":"版本档位","value":"标准","options":[{"value":"标准","label":"标准"},{"value":"flash","label":"Flash"}],"props":{"teleported":false}}]},
    {"id":"seedance-2-5-promo","label":"Seedance 2.5 · 特价按秒","type":"video","mode":["text","singleImage",["imageReference:30","videoReference:10","audioReference:10"],["imageReference:10","videoReference:5","audioReference:1"]],"audio":true,"imageRatios":["16:9","9:16","21:9","3:4","1:1","4:3"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[20],"resolution":["480p","720p","1080p","4k"]},{"duration":[25],"resolution":["480p","720p","1080p","4k"]},{"duration":[29],"resolution":["480p","720p","1080p","4k"]},{"duration":[30],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[16],"resolution":["480p","720p","1080p","4k"]},{"duration":[17],"resolution":["480p","720p","1080p","4k"]},{"duration":[18],"resolution":["480p","720p","1080p","4k"]},{"duration":[19],"resolution":["480p","720p","1080p","4k"]},{"duration":[21],"resolution":["480p","720p","1080p","4k"]},{"duration":[22],"resolution":["480p","720p","1080p","4k"]},{"duration":[23],"resolution":["480p","720p","1080p","4k"]},{"duration":[24],"resolution":["480p","720p","1080p","4k"]},{"duration":[26],"resolution":["480p","720p","1080p","4k"]},{"duration":[27],"resolution":["480p","720p","1080p","4k"]},{"duration":[28],"resolution":["480p","720p","1080p","4k"]},{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[20],"resolution":["480p","720p","1080p","4k"]},{"duration":[25],"resolution":["480p","720p","1080p","4k"]},{"duration":[29],"resolution":["480p","720p","1080p","4k"]},{"duration":[30],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[16],"resolution":["480p","720p","1080p","4k"]},{"duration":[17],"resolution":["480p","720p","1080p","4k"]},{"duration":[18],"resolution":["480p","720p","1080p","4k"]},{"duration":[19],"resolution":["480p","720p","1080p","4k"]},{"duration":[21],"resolution":["480p","720p","1080p","4k"]},{"duration":[22],"resolution":["480p","720p","1080p","4k"]},{"duration":[23],"resolution":["480p","720p","1080p","4k"]},{"duration":[24],"resolution":["480p","720p","1080p","4k"]},{"duration":[26],"resolution":["480p","720p","1080p","4k"]},{"duration":[27],"resolution":["480p","720p","1080p","4k"]},{"duration":[28],"resolution":["480p","720p","1080p","4k"]},{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[20],"resolution":["480p","720p","1080p","4k"]},{"duration":[25],"resolution":["480p","720p","1080p","4k"]},{"duration":[29],"resolution":["480p","720p","1080p","4k"]},{"duration":[30],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[16],"resolution":["480p","720p","1080p","4k"]},{"duration":[17],"resolution":["480p","720p","1080p","4k"]},{"duration":[18],"resolution":["480p","720p","1080p","4k"]},{"duration":[19],"resolution":["480p","720p","1080p","4k"]},{"duration":[21],"resolution":["480p","720p","1080p","4k"]},{"duration":[22],"resolution":["480p","720p","1080p","4k"]},{"duration":[23],"resolution":["480p","720p","1080p","4k"]},{"duration":[24],"resolution":["480p","720p","1080p","4k"]},{"duration":[26],"resolution":["480p","720p","1080p","4k"]},{"duration":[27],"resolution":["480p","720p","1080p","4k"]},{"duration":[28],"resolution":["480p","720p","1080p","4k"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]}],"maxPromptLength":25000,"promptOptional":false,"videoVariants":[{"quality":"标准","operation":"reference","mode":"text","imageRatios":["16:9","9:16","21:9","3:4","1:1","4:3"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[20],"resolution":["480p","720p","1080p","4k"]},{"duration":[25],"resolution":["480p","720p","1080p","4k"]},{"duration":[29],"resolution":["480p","720p","1080p","4k"]},{"duration":[30],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[16],"resolution":["480p","720p","1080p","4k"]},{"duration":[17],"resolution":["480p","720p","1080p","4k"]},{"duration":[18],"resolution":["480p","720p","1080p","4k"]},{"duration":[19],"resolution":["480p","720p","1080p","4k"]},{"duration":[21],"resolution":["480p","720p","1080p","4k"]},{"duration":[22],"resolution":["480p","720p","1080p","4k"]},{"duration":[23],"resolution":["480p","720p","1080p","4k"]},{"duration":[24],"resolution":["480p","720p","1080p","4k"]},{"duration":[26],"resolution":["480p","720p","1080p","4k"]},{"duration":[27],"resolution":["480p","720p","1080p","4k"]},{"duration":[28],"resolution":["480p","720p","1080p","4k"]}]},{"quality":"标准","operation":"reference","mode":"singleImage","imageRatios":["16:9","9:16","21:9","3:4","1:1","4:3"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[20],"resolution":["480p","720p","1080p","4k"]},{"duration":[25],"resolution":["480p","720p","1080p","4k"]},{"duration":[29],"resolution":["480p","720p","1080p","4k"]},{"duration":[30],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[16],"resolution":["480p","720p","1080p","4k"]},{"duration":[17],"resolution":["480p","720p","1080p","4k"]},{"duration":[18],"resolution":["480p","720p","1080p","4k"]},{"duration":[19],"resolution":["480p","720p","1080p","4k"]},{"duration":[21],"resolution":["480p","720p","1080p","4k"]},{"duration":[22],"resolution":["480p","720p","1080p","4k"]},{"duration":[23],"resolution":["480p","720p","1080p","4k"]},{"duration":[24],"resolution":["480p","720p","1080p","4k"]},{"duration":[26],"resolution":["480p","720p","1080p","4k"]},{"duration":[27],"resolution":["480p","720p","1080p","4k"]},{"duration":[28],"resolution":["480p","720p","1080p","4k"]}]},{"quality":"标准","operation":"reference","mode":["imageReference:30","videoReference:10","audioReference:10"],"imageRatios":["16:9","9:16","21:9","3:4","1:1","4:3"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[20],"resolution":["480p","720p","1080p","4k"]},{"duration":[25],"resolution":["480p","720p","1080p","4k"]},{"duration":[29],"resolution":["480p","720p","1080p","4k"]},{"duration":[30],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[16],"resolution":["480p","720p","1080p","4k"]},{"duration":[17],"resolution":["480p","720p","1080p","4k"]},{"duration":[18],"resolution":["480p","720p","1080p","4k"]},{"duration":[19],"resolution":["480p","720p","1080p","4k"]},{"duration":[21],"resolution":["480p","720p","1080p","4k"]},{"duration":[22],"resolution":["480p","720p","1080p","4k"]},{"duration":[23],"resolution":["480p","720p","1080p","4k"]},{"duration":[24],"resolution":["480p","720p","1080p","4k"]},{"duration":[26],"resolution":["480p","720p","1080p","4k"]},{"duration":[27],"resolution":["480p","720p","1080p","4k"]},{"duration":[28],"resolution":["480p","720p","1080p","4k"]}]},{"quality":"flash","operation":"reference","mode":"text","imageRatios":["16:9","9:16","21:9","3:4","1:1","4:3"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]}]},{"quality":"flash","operation":"reference","mode":["imageReference:10","videoReference:5","audioReference:1"],"imageRatios":["16:9","9:16","21:9","3:4","1:1","4:3"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]}]}],"rules":[{"field":"quality","type":"select","title":"版本档位","value":"标准","options":[{"value":"标准","label":"标准"},{"value":"flash","label":"Flash"}],"props":{"teleported":false}}]},
    {"id":"seedance-2-5","label":"Seedance 2.5 · 官方直连","type":"video","mode":["text","singleImage",["imageReference:30","videoReference:10","audioReference:10"],"startEndRequired",["imageReference:30","videoReference:1","audioReference:10"],["imageReference:10","videoReference:5","audioReference:10"],["imageReference:10","videoReference:1","audioReference:10"]],"audio":true,"imageRatios":["16:9","9:16","21:9","3:4","1:1","4:3"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p"]},{"duration":[5],"resolution":["480p","720p","1080p"]},{"duration":[6],"resolution":["480p","720p","1080p"]},{"duration":[7],"resolution":["480p","720p","1080p"]},{"duration":[8],"resolution":["480p","720p","1080p"]},{"duration":[9],"resolution":["480p","720p","1080p"]},{"duration":[10],"resolution":["480p","720p","1080p"]},{"duration":[11],"resolution":["480p","720p","1080p"]},{"duration":[12],"resolution":["480p","720p","1080p"]},{"duration":[13],"resolution":["480p","720p","1080p"]},{"duration":[14],"resolution":["480p","720p","1080p"]},{"duration":[15],"resolution":["480p","720p","1080p"]},{"duration":[16],"resolution":["480p","720p","1080p"]},{"duration":[17],"resolution":["480p","720p","1080p"]},{"duration":[18],"resolution":["480p","720p","1080p"]},{"duration":[19],"resolution":["480p","720p","1080p"]},{"duration":[20],"resolution":["480p","720p","1080p"]},{"duration":[21],"resolution":["480p","720p","1080p"]},{"duration":[22],"resolution":["480p","720p","1080p"]},{"duration":[23],"resolution":["480p","720p","1080p"]},{"duration":[24],"resolution":["480p","720p","1080p"]},{"duration":[25],"resolution":["480p","720p","1080p"]},{"duration":[26],"resolution":["480p","720p","1080p"]},{"duration":[27],"resolution":["480p","720p","1080p"]},{"duration":[28],"resolution":["480p","720p","1080p"]},{"duration":[29],"resolution":["480p","720p","1080p"]},{"duration":[30],"resolution":["480p","720p","1080p"]},{"duration":[4],"resolution":["480p","720p","1080p"]},{"duration":[5],"resolution":["480p","720p","1080p"]},{"duration":[6],"resolution":["480p","720p","1080p"]},{"duration":[7],"resolution":["480p","720p","1080p"]},{"duration":[8],"resolution":["480p","720p","1080p"]},{"duration":[9],"resolution":["480p","720p","1080p"]},{"duration":[10],"resolution":["480p","720p","1080p"]},{"duration":[11],"resolution":["480p","720p","1080p"]},{"duration":[12],"resolution":["480p","720p","1080p"]},{"duration":[13],"resolution":["480p","720p","1080p"]},{"duration":[14],"resolution":["480p","720p","1080p"]},{"duration":[15],"resolution":["480p","720p","1080p"]},{"duration":[16],"resolution":["480p","720p","1080p"]},{"duration":[17],"resolution":["480p","720p","1080p"]},{"duration":[18],"resolution":["480p","720p","1080p"]},{"duration":[19],"resolution":["480p","720p","1080p"]},{"duration":[20],"resolution":["480p","720p","1080p"]},{"duration":[21],"resolution":["480p","720p","1080p"]},{"duration":[22],"resolution":["480p","720p","1080p"]},{"duration":[23],"resolution":["480p","720p","1080p"]},{"duration":[24],"resolution":["480p","720p","1080p"]},{"duration":[25],"resolution":["480p","720p","1080p"]},{"duration":[26],"resolution":["480p","720p","1080p"]},{"duration":[27],"resolution":["480p","720p","1080p"]},{"duration":[28],"resolution":["480p","720p","1080p"]},{"duration":[29],"resolution":["480p","720p","1080p"]},{"duration":[30],"resolution":["480p","720p","1080p"]},{"duration":[4],"resolution":["480p","720p","1080p"]},{"duration":[5],"resolution":["480p","720p","1080p"]},{"duration":[6],"resolution":["480p","720p","1080p"]},{"duration":[7],"resolution":["480p","720p","1080p"]},{"duration":[8],"resolution":["480p","720p","1080p"]},{"duration":[9],"resolution":["480p","720p","1080p"]},{"duration":[10],"resolution":["480p","720p","1080p"]},{"duration":[11],"resolution":["480p","720p","1080p"]},{"duration":[12],"resolution":["480p","720p","1080p"]},{"duration":[13],"resolution":["480p","720p","1080p"]},{"duration":[14],"resolution":["480p","720p","1080p"]},{"duration":[15],"resolution":["480p","720p","1080p"]},{"duration":[16],"resolution":["480p","720p","1080p"]},{"duration":[17],"resolution":["480p","720p","1080p"]},{"duration":[18],"resolution":["480p","720p","1080p"]},{"duration":[19],"resolution":["480p","720p","1080p"]},{"duration":[20],"resolution":["480p","720p","1080p"]},{"duration":[21],"resolution":["480p","720p","1080p"]},{"duration":[22],"resolution":["480p","720p","1080p"]},{"duration":[23],"resolution":["480p","720p","1080p"]},{"duration":[24],"resolution":["480p","720p","1080p"]},{"duration":[25],"resolution":["480p","720p","1080p"]},{"duration":[26],"resolution":["480p","720p","1080p"]},{"duration":[27],"resolution":["480p","720p","1080p"]},{"duration":[28],"resolution":["480p","720p","1080p"]},{"duration":[29],"resolution":["480p","720p","1080p"]},{"duration":[30],"resolution":["480p","720p","1080p"]},{"duration":[4],"resolution":["480p","720p","1080p"]},{"duration":[5],"resolution":["480p","720p","1080p"]},{"duration":[6],"resolution":["480p","720p","1080p"]},{"duration":[7],"resolution":["480p","720p","1080p"]},{"duration":[8],"resolution":["480p","720p","1080p"]},{"duration":[9],"resolution":["480p","720p","1080p"]},{"duration":[10],"resolution":["480p","720p","1080p"]},{"duration":[11],"resolution":["480p","720p","1080p"]},{"duration":[12],"resolution":["480p","720p","1080p"]},{"duration":[13],"resolution":["480p","720p","1080p"]},{"duration":[14],"resolution":["480p","720p","1080p"]},{"duration":[15],"resolution":["480p","720p","1080p"]},{"duration":[16],"resolution":["480p","720p","1080p"]},{"duration":[17],"resolution":["480p","720p","1080p"]},{"duration":[18],"resolution":["480p","720p","1080p"]},{"duration":[19],"resolution":["480p","720p","1080p"]},{"duration":[20],"resolution":["480p","720p","1080p"]},{"duration":[21],"resolution":["480p","720p","1080p"]},{"duration":[22],"resolution":["480p","720p","1080p"]},{"duration":[23],"resolution":["480p","720p","1080p"]},{"duration":[24],"resolution":["480p","720p","1080p"]},{"duration":[25],"resolution":["480p","720p","1080p"]},{"duration":[26],"resolution":["480p","720p","1080p"]},{"duration":[27],"resolution":["480p","720p","1080p"]},{"duration":[28],"resolution":["480p","720p","1080p"]},{"duration":[29],"resolution":["480p","720p","1080p"]},{"duration":[30],"resolution":["480p","720p","1080p"]},{"duration":[4],"resolution":["480p","720p","1080p"]},{"duration":[5],"resolution":["480p","720p","1080p"]},{"duration":[6],"resolution":["480p","720p","1080p"]},{"duration":[7],"resolution":["480p","720p","1080p"]},{"duration":[8],"resolution":["480p","720p","1080p"]},{"duration":[9],"resolution":["480p","720p","1080p"]},{"duration":[10],"resolution":["480p","720p","1080p"]},{"duration":[11],"resolution":["480p","720p","1080p"]},{"duration":[12],"resolution":["480p","720p","1080p"]},{"duration":[13],"resolution":["480p","720p","1080p"]},{"duration":[14],"resolution":["480p","720p","1080p"]},{"duration":[15],"resolution":["480p","720p","1080p"]},{"duration":[16],"resolution":["480p","720p","1080p"]},{"duration":[17],"resolution":["480p","720p","1080p"]},{"duration":[18],"resolution":["480p","720p","1080p"]},{"duration":[19],"resolution":["480p","720p","1080p"]},{"duration":[20],"resolution":["480p","720p","1080p"]},{"duration":[21],"resolution":["480p","720p","1080p"]},{"duration":[22],"resolution":["480p","720p","1080p"]},{"duration":[23],"resolution":["480p","720p","1080p"]},{"duration":[24],"resolution":["480p","720p","1080p"]},{"duration":[25],"resolution":["480p","720p","1080p"]},{"duration":[26],"resolution":["480p","720p","1080p"]},{"duration":[27],"resolution":["480p","720p","1080p"]},{"duration":[28],"resolution":["480p","720p","1080p"]},{"duration":[29],"resolution":["480p","720p","1080p"]},{"duration":[30],"resolution":["480p","720p","1080p"]},{"duration":[4],"resolution":["480p","720p","1080p"]},{"duration":[5],"resolution":["480p","720p","1080p"]},{"duration":[6],"resolution":["480p","720p","1080p"]},{"duration":[7],"resolution":["480p","720p","1080p"]},{"duration":[8],"resolution":["480p","720p","1080p"]},{"duration":[9],"resolution":["480p","720p","1080p"]},{"duration":[10],"resolution":["480p","720p","1080p"]},{"duration":[11],"resolution":["480p","720p","1080p"]},{"duration":[12],"resolution":["480p","720p","1080p"]},{"duration":[13],"resolution":["480p","720p","1080p"]},{"duration":[14],"resolution":["480p","720p","1080p"]},{"duration":[15],"resolution":["480p","720p","1080p"]},{"duration":[16],"resolution":["480p","720p","1080p"]},{"duration":[17],"resolution":["480p","720p","1080p"]},{"duration":[18],"resolution":["480p","720p","1080p"]},{"duration":[19],"resolution":["480p","720p","1080p"]},{"duration":[20],"resolution":["480p","720p","1080p"]},{"duration":[21],"resolution":["480p","720p","1080p"]},{"duration":[22],"resolution":["480p","720p","1080p"]},{"duration":[23],"resolution":["480p","720p","1080p"]},{"duration":[24],"resolution":["480p","720p","1080p"]},{"duration":[25],"resolution":["480p","720p","1080p"]},{"duration":[26],"resolution":["480p","720p","1080p"]},{"duration":[27],"resolution":["480p","720p","1080p"]},{"duration":[28],"resolution":["480p","720p","1080p"]},{"duration":[29],"resolution":["480p","720p","1080p"]},{"duration":[30],"resolution":["480p","720p","1080p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[16],"resolution":["480p","720p"]},{"duration":[17],"resolution":["480p","720p"]},{"duration":[18],"resolution":["480p","720p"]},{"duration":[19],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[21],"resolution":["480p","720p"]},{"duration":[22],"resolution":["480p","720p"]},{"duration":[23],"resolution":["480p","720p"]},{"duration":[24],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[26],"resolution":["480p","720p"]},{"duration":[27],"resolution":["480p","720p"]},{"duration":[28],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[16],"resolution":["480p","720p"]},{"duration":[17],"resolution":["480p","720p"]},{"duration":[18],"resolution":["480p","720p"]},{"duration":[19],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[21],"resolution":["480p","720p"]},{"duration":[22],"resolution":["480p","720p"]},{"duration":[23],"resolution":["480p","720p"]},{"duration":[24],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[26],"resolution":["480p","720p"]},{"duration":[27],"resolution":["480p","720p"]},{"duration":[28],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[16],"resolution":["480p","720p"]},{"duration":[17],"resolution":["480p","720p"]},{"duration":[18],"resolution":["480p","720p"]},{"duration":[19],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[21],"resolution":["480p","720p"]},{"duration":[22],"resolution":["480p","720p"]},{"duration":[23],"resolution":["480p","720p"]},{"duration":[24],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[26],"resolution":["480p","720p"]},{"duration":[27],"resolution":["480p","720p"]},{"duration":[28],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[16],"resolution":["480p","720p"]},{"duration":[17],"resolution":["480p","720p"]},{"duration":[18],"resolution":["480p","720p"]},{"duration":[19],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[21],"resolution":["480p","720p"]},{"duration":[22],"resolution":["480p","720p"]},{"duration":[23],"resolution":["480p","720p"]},{"duration":[24],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[26],"resolution":["480p","720p"]},{"duration":[27],"resolution":["480p","720p"]},{"duration":[28],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[16],"resolution":["480p","720p"]},{"duration":[17],"resolution":["480p","720p"]},{"duration":[18],"resolution":["480p","720p"]},{"duration":[19],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[21],"resolution":["480p","720p"]},{"duration":[22],"resolution":["480p","720p"]},{"duration":[23],"resolution":["480p","720p"]},{"duration":[24],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[26],"resolution":["480p","720p"]},{"duration":[27],"resolution":["480p","720p"]},{"duration":[28],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[16],"resolution":["480p","720p"]},{"duration":[17],"resolution":["480p","720p"]},{"duration":[18],"resolution":["480p","720p"]},{"duration":[19],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[21],"resolution":["480p","720p"]},{"duration":[22],"resolution":["480p","720p"]},{"duration":[23],"resolution":["480p","720p"]},{"duration":[24],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[26],"resolution":["480p","720p"]},{"duration":[27],"resolution":["480p","720p"]},{"duration":[28],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]}],"maxPromptLength":30000,"promptOptional":false,"videoVariants":[{"quality":"标准","operation":"reference","mode":"text","imageRatios":["16:9","9:16","21:9","3:4","1:1","4:3"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p"]},{"duration":[5],"resolution":["480p","720p","1080p"]},{"duration":[6],"resolution":["480p","720p","1080p"]},{"duration":[7],"resolution":["480p","720p","1080p"]},{"duration":[8],"resolution":["480p","720p","1080p"]},{"duration":[9],"resolution":["480p","720p","1080p"]},{"duration":[10],"resolution":["480p","720p","1080p"]},{"duration":[11],"resolution":["480p","720p","1080p"]},{"duration":[12],"resolution":["480p","720p","1080p"]},{"duration":[13],"resolution":["480p","720p","1080p"]},{"duration":[14],"resolution":["480p","720p","1080p"]},{"duration":[15],"resolution":["480p","720p","1080p"]},{"duration":[16],"resolution":["480p","720p","1080p"]},{"duration":[17],"resolution":["480p","720p","1080p"]},{"duration":[18],"resolution":["480p","720p","1080p"]},{"duration":[19],"resolution":["480p","720p","1080p"]},{"duration":[20],"resolution":["480p","720p","1080p"]},{"duration":[21],"resolution":["480p","720p","1080p"]},{"duration":[22],"resolution":["480p","720p","1080p"]},{"duration":[23],"resolution":["480p","720p","1080p"]},{"duration":[24],"resolution":["480p","720p","1080p"]},{"duration":[25],"resolution":["480p","720p","1080p"]},{"duration":[26],"resolution":["480p","720p","1080p"]},{"duration":[27],"resolution":["480p","720p","1080p"]},{"duration":[28],"resolution":["480p","720p","1080p"]},{"duration":[29],"resolution":["480p","720p","1080p"]},{"duration":[30],"resolution":["480p","720p","1080p"]}]},{"quality":"标准","operation":"reference","mode":"singleImage","imageRatios":[],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p"]},{"duration":[5],"resolution":["480p","720p","1080p"]},{"duration":[6],"resolution":["480p","720p","1080p"]},{"duration":[7],"resolution":["480p","720p","1080p"]},{"duration":[8],"resolution":["480p","720p","1080p"]},{"duration":[9],"resolution":["480p","720p","1080p"]},{"duration":[10],"resolution":["480p","720p","1080p"]},{"duration":[11],"resolution":["480p","720p","1080p"]},{"duration":[12],"resolution":["480p","720p","1080p"]},{"duration":[13],"resolution":["480p","720p","1080p"]},{"duration":[14],"resolution":["480p","720p","1080p"]},{"duration":[15],"resolution":["480p","720p","1080p"]},{"duration":[16],"resolution":["480p","720p","1080p"]},{"duration":[17],"resolution":["480p","720p","1080p"]},{"duration":[18],"resolution":["480p","720p","1080p"]},{"duration":[19],"resolution":["480p","720p","1080p"]},{"duration":[20],"resolution":["480p","720p","1080p"]},{"duration":[21],"resolution":["480p","720p","1080p"]},{"duration":[22],"resolution":["480p","720p","1080p"]},{"duration":[23],"resolution":["480p","720p","1080p"]},{"duration":[24],"resolution":["480p","720p","1080p"]},{"duration":[25],"resolution":["480p","720p","1080p"]},{"duration":[26],"resolution":["480p","720p","1080p"]},{"duration":[27],"resolution":["480p","720p","1080p"]},{"duration":[28],"resolution":["480p","720p","1080p"]},{"duration":[29],"resolution":["480p","720p","1080p"]},{"duration":[30],"resolution":["480p","720p","1080p"]}]},{"quality":"标准","operation":"reference","mode":["imageReference:30","videoReference:10","audioReference:10"],"imageRatios":["16:9","9:16","21:9","3:4","1:1","4:3"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p"]},{"duration":[5],"resolution":["480p","720p","1080p"]},{"duration":[6],"resolution":["480p","720p","1080p"]},{"duration":[7],"resolution":["480p","720p","1080p"]},{"duration":[8],"resolution":["480p","720p","1080p"]},{"duration":[9],"resolution":["480p","720p","1080p"]},{"duration":[10],"resolution":["480p","720p","1080p"]},{"duration":[11],"resolution":["480p","720p","1080p"]},{"duration":[12],"resolution":["480p","720p","1080p"]},{"duration":[13],"resolution":["480p","720p","1080p"]},{"duration":[14],"resolution":["480p","720p","1080p"]},{"duration":[15],"resolution":["480p","720p","1080p"]},{"duration":[16],"resolution":["480p","720p","1080p"]},{"duration":[17],"resolution":["480p","720p","1080p"]},{"duration":[18],"resolution":["480p","720p","1080p"]},{"duration":[19],"resolution":["480p","720p","1080p"]},{"duration":[20],"resolution":["480p","720p","1080p"]},{"duration":[21],"resolution":["480p","720p","1080p"]},{"duration":[22],"resolution":["480p","720p","1080p"]},{"duration":[23],"resolution":["480p","720p","1080p"]},{"duration":[24],"resolution":["480p","720p","1080p"]},{"duration":[25],"resolution":["480p","720p","1080p"]},{"duration":[26],"resolution":["480p","720p","1080p"]},{"duration":[27],"resolution":["480p","720p","1080p"]},{"duration":[28],"resolution":["480p","720p","1080p"]},{"duration":[29],"resolution":["480p","720p","1080p"]},{"duration":[30],"resolution":["480p","720p","1080p"]}]},{"quality":"标准","operation":"reference","mode":"startEndRequired","imageRatios":[],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p"]},{"duration":[5],"resolution":["480p","720p","1080p"]},{"duration":[6],"resolution":["480p","720p","1080p"]},{"duration":[7],"resolution":["480p","720p","1080p"]},{"duration":[8],"resolution":["480p","720p","1080p"]},{"duration":[9],"resolution":["480p","720p","1080p"]},{"duration":[10],"resolution":["480p","720p","1080p"]},{"duration":[11],"resolution":["480p","720p","1080p"]},{"duration":[12],"resolution":["480p","720p","1080p"]},{"duration":[13],"resolution":["480p","720p","1080p"]},{"duration":[14],"resolution":["480p","720p","1080p"]},{"duration":[15],"resolution":["480p","720p","1080p"]},{"duration":[16],"resolution":["480p","720p","1080p"]},{"duration":[17],"resolution":["480p","720p","1080p"]},{"duration":[18],"resolution":["480p","720p","1080p"]},{"duration":[19],"resolution":["480p","720p","1080p"]},{"duration":[20],"resolution":["480p","720p","1080p"]},{"duration":[21],"resolution":["480p","720p","1080p"]},{"duration":[22],"resolution":["480p","720p","1080p"]},{"duration":[23],"resolution":["480p","720p","1080p"]},{"duration":[24],"resolution":["480p","720p","1080p"]},{"duration":[25],"resolution":["480p","720p","1080p"]},{"duration":[26],"resolution":["480p","720p","1080p"]},{"duration":[27],"resolution":["480p","720p","1080p"]},{"duration":[28],"resolution":["480p","720p","1080p"]},{"duration":[29],"resolution":["480p","720p","1080p"]},{"duration":[30],"resolution":["480p","720p","1080p"]}]},{"quality":"标准","operation":"edit","mode":["imageReference:30","videoReference:10","audioReference:10"],"imageRatios":[],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p"]},{"duration":[5],"resolution":["480p","720p","1080p"]},{"duration":[6],"resolution":["480p","720p","1080p"]},{"duration":[7],"resolution":["480p","720p","1080p"]},{"duration":[8],"resolution":["480p","720p","1080p"]},{"duration":[9],"resolution":["480p","720p","1080p"]},{"duration":[10],"resolution":["480p","720p","1080p"]},{"duration":[11],"resolution":["480p","720p","1080p"]},{"duration":[12],"resolution":["480p","720p","1080p"]},{"duration":[13],"resolution":["480p","720p","1080p"]},{"duration":[14],"resolution":["480p","720p","1080p"]},{"duration":[15],"resolution":["480p","720p","1080p"]},{"duration":[16],"resolution":["480p","720p","1080p"]},{"duration":[17],"resolution":["480p","720p","1080p"]},{"duration":[18],"resolution":["480p","720p","1080p"]},{"duration":[19],"resolution":["480p","720p","1080p"]},{"duration":[20],"resolution":["480p","720p","1080p"]},{"duration":[21],"resolution":["480p","720p","1080p"]},{"duration":[22],"resolution":["480p","720p","1080p"]},{"duration":[23],"resolution":["480p","720p","1080p"]},{"duration":[24],"resolution":["480p","720p","1080p"]},{"duration":[25],"resolution":["480p","720p","1080p"]},{"duration":[26],"resolution":["480p","720p","1080p"]},{"duration":[27],"resolution":["480p","720p","1080p"]},{"duration":[28],"resolution":["480p","720p","1080p"]},{"duration":[29],"resolution":["480p","720p","1080p"]},{"duration":[30],"resolution":["480p","720p","1080p"]}]},{"quality":"标准","operation":"extend","mode":["imageReference:30","videoReference:1","audioReference:10"],"imageRatios":[],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p"]},{"duration":[5],"resolution":["480p","720p","1080p"]},{"duration":[6],"resolution":["480p","720p","1080p"]},{"duration":[7],"resolution":["480p","720p","1080p"]},{"duration":[8],"resolution":["480p","720p","1080p"]},{"duration":[9],"resolution":["480p","720p","1080p"]},{"duration":[10],"resolution":["480p","720p","1080p"]},{"duration":[11],"resolution":["480p","720p","1080p"]},{"duration":[12],"resolution":["480p","720p","1080p"]},{"duration":[13],"resolution":["480p","720p","1080p"]},{"duration":[14],"resolution":["480p","720p","1080p"]},{"duration":[15],"resolution":["480p","720p","1080p"]},{"duration":[16],"resolution":["480p","720p","1080p"]},{"duration":[17],"resolution":["480p","720p","1080p"]},{"duration":[18],"resolution":["480p","720p","1080p"]},{"duration":[19],"resolution":["480p","720p","1080p"]},{"duration":[20],"resolution":["480p","720p","1080p"]},{"duration":[21],"resolution":["480p","720p","1080p"]},{"duration":[22],"resolution":["480p","720p","1080p"]},{"duration":[23],"resolution":["480p","720p","1080p"]},{"duration":[24],"resolution":["480p","720p","1080p"]},{"duration":[25],"resolution":["480p","720p","1080p"]},{"duration":[26],"resolution":["480p","720p","1080p"]},{"duration":[27],"resolution":["480p","720p","1080p"]},{"duration":[28],"resolution":["480p","720p","1080p"]},{"duration":[29],"resolution":["480p","720p","1080p"]},{"duration":[30],"resolution":["480p","720p","1080p"]}]},{"quality":"flash","operation":"reference","mode":"text","imageRatios":["16:9","9:16","21:9","3:4","1:1","4:3"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[16],"resolution":["480p","720p"]},{"duration":[17],"resolution":["480p","720p"]},{"duration":[18],"resolution":["480p","720p"]},{"duration":[19],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[21],"resolution":["480p","720p"]},{"duration":[22],"resolution":["480p","720p"]},{"duration":[23],"resolution":["480p","720p"]},{"duration":[24],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[26],"resolution":["480p","720p"]},{"duration":[27],"resolution":["480p","720p"]},{"duration":[28],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]}]},{"quality":"flash","operation":"reference","mode":"singleImage","imageRatios":[],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[16],"resolution":["480p","720p"]},{"duration":[17],"resolution":["480p","720p"]},{"duration":[18],"resolution":["480p","720p"]},{"duration":[19],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[21],"resolution":["480p","720p"]},{"duration":[22],"resolution":["480p","720p"]},{"duration":[23],"resolution":["480p","720p"]},{"duration":[24],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[26],"resolution":["480p","720p"]},{"duration":[27],"resolution":["480p","720p"]},{"duration":[28],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]}]},{"quality":"flash","operation":"reference","mode":["imageReference:10","videoReference:5","audioReference:10"],"imageRatios":["16:9","9:16","21:9","3:4","1:1","4:3"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[16],"resolution":["480p","720p"]},{"duration":[17],"resolution":["480p","720p"]},{"duration":[18],"resolution":["480p","720p"]},{"duration":[19],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[21],"resolution":["480p","720p"]},{"duration":[22],"resolution":["480p","720p"]},{"duration":[23],"resolution":["480p","720p"]},{"duration":[24],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[26],"resolution":["480p","720p"]},{"duration":[27],"resolution":["480p","720p"]},{"duration":[28],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]}]},{"quality":"flash","operation":"reference","mode":"startEndRequired","imageRatios":[],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[16],"resolution":["480p","720p"]},{"duration":[17],"resolution":["480p","720p"]},{"duration":[18],"resolution":["480p","720p"]},{"duration":[19],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[21],"resolution":["480p","720p"]},{"duration":[22],"resolution":["480p","720p"]},{"duration":[23],"resolution":["480p","720p"]},{"duration":[24],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[26],"resolution":["480p","720p"]},{"duration":[27],"resolution":["480p","720p"]},{"duration":[28],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]}]},{"quality":"flash","operation":"edit","mode":["imageReference:10","videoReference:5","audioReference:10"],"imageRatios":[],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[16],"resolution":["480p","720p"]},{"duration":[17],"resolution":["480p","720p"]},{"duration":[18],"resolution":["480p","720p"]},{"duration":[19],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[21],"resolution":["480p","720p"]},{"duration":[22],"resolution":["480p","720p"]},{"duration":[23],"resolution":["480p","720p"]},{"duration":[24],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[26],"resolution":["480p","720p"]},{"duration":[27],"resolution":["480p","720p"]},{"duration":[28],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]}]},{"quality":"flash","operation":"extend","mode":["imageReference:10","videoReference:1","audioReference:10"],"imageRatios":[],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[16],"resolution":["480p","720p"]},{"duration":[17],"resolution":["480p","720p"]},{"duration":[18],"resolution":["480p","720p"]},{"duration":[19],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[21],"resolution":["480p","720p"]},{"duration":[22],"resolution":["480p","720p"]},{"duration":[23],"resolution":["480p","720p"]},{"duration":[24],"resolution":["480p","720p"]},{"duration":[25],"resolution":["480p","720p"]},{"duration":[26],"resolution":["480p","720p"]},{"duration":[27],"resolution":["480p","720p"]},{"duration":[28],"resolution":["480p","720p"]},{"duration":[29],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]}]}],"rules":[{"field":"quality","type":"select","title":"版本档位","value":"标准","options":[{"value":"标准","label":"标准"},{"value":"flash","label":"Flash"}],"props":{"teleported":false}},{"field":"videoOperation","type":"select","title":"视频任务","value":"reference","options":[{"value":"reference","label":"生成视频"},{"value":"edit","label":"编辑参考视频"},{"value":"extend","label":"延长参考视频"}],"props":{"teleported":false}}]},
    {"id":"seedance-2-0-official","label":"Seedance 2.0 · 官方直连","type":"video","mode":["text",["imageReference:9","videoReference:3","audioReference:3"],"singleImage","startEndRequired",["imageReference:9","videoReference:1","audioReference:3"]],"audio":true,"imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}],"maxPromptLength":30000,"promptOptional":false,"videoVariants":[{"quality":"标准","operation":"reference","mode":"text","imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]}]},{"quality":"标准","operation":"reference","mode":["imageReference:9","videoReference:3","audioReference:3"],"imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]}]},{"quality":"标准","operation":"reference","mode":"singleImage","imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]}]},{"quality":"标准","operation":"reference","mode":"startEndRequired","imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]}]},{"quality":"标准","operation":"edit","mode":["imageReference:9","videoReference:3","audioReference:3"],"imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]}]},{"quality":"标准","operation":"extend","mode":["imageReference:9","videoReference:1","audioReference:3"],"imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]}]},{"quality":"fast","operation":"reference","mode":"text","imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]},{"quality":"fast","operation":"reference","mode":["imageReference:9","videoReference:3","audioReference:3"],"imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]},{"quality":"fast","operation":"reference","mode":"singleImage","imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]},{"quality":"fast","operation":"reference","mode":"startEndRequired","imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]},{"quality":"fast","operation":"edit","mode":["imageReference:9","videoReference:3","audioReference:3"],"imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]},{"quality":"fast","operation":"extend","mode":["imageReference:9","videoReference:1","audioReference:3"],"imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]},{"quality":"mini","operation":"reference","mode":"text","imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]},{"quality":"mini","operation":"reference","mode":["imageReference:9","videoReference:3","audioReference:3"],"imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]},{"quality":"mini","operation":"reference","mode":"singleImage","imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]},{"quality":"mini","operation":"reference","mode":"startEndRequired","imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]},{"quality":"mini","operation":"edit","mode":["imageReference:9","videoReference:3","audioReference:3"],"imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]},{"quality":"mini","operation":"extend","mode":["imageReference:9","videoReference:1","audioReference:3"],"imageRatios":["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]}],"rules":[{"field":"quality","type":"select","title":"版本档位","value":"mini","options":[{"value":"标准","label":"标准"},{"value":"fast","label":"Fast"},{"value":"mini","label":"Mini"}],"props":{"teleported":false}},{"field":"videoOperation","type":"select","title":"视频任务","value":"reference","options":[{"value":"reference","label":"生成视频"},{"value":"edit","label":"编辑参考视频"},{"value":"extend","label":"延长参考视频"}],"props":{"teleported":false}}]},
    {"id":"seedance-2-0-special","label":"Seedance 2.0 · 特价按次","type":"video","mode":[["imageReference:9","videoReference:3","audioReference:3"],"startEndRequired","text","singleImage"],"audio":true,"imageRatios":["9:16","16:9","21:9","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[15],"resolution":["720p","480p"]},{"duration":[15],"resolution":["720p","480p"]},{"duration":[15],"resolution":["720p","480p"]},{"duration":[15],"resolution":["720p","480p"]},{"duration":[15],"resolution":["720p","480p"]},{"duration":[15],"resolution":["720p","480p"]},{"duration":[15],"resolution":["720p","480p"]},{"duration":[15],"resolution":["720p","480p"]},{"duration":[15],"resolution":["720p","480p"]},{"duration":[15],"resolution":["720p","480p"]},{"duration":[15],"resolution":["720p","480p"]}],"maxPromptLength":20000,"promptOptional":false,"videoVariants":[{"quality":"高清","operation":"reference","mode":["imageReference:9","videoReference:3","audioReference:3"],"imageRatios":["9:16","16:9","21:9"],"durationResolutionMap":[{"duration":[15],"resolution":["720p","480p"]}]},{"quality":"高清","operation":"reference","mode":"startEndRequired","imageRatios":["9:16","16:9","21:9"],"durationResolutionMap":[{"duration":[15],"resolution":["720p","480p"]}]},{"quality":"高清","operation":"reference","mode":"text","imageRatios":["9:16","16:9","21:9"],"durationResolutionMap":[{"duration":[15],"resolution":["720p","480p"]}]},{"quality":"快速","operation":"reference","mode":["imageReference:9","videoReference:3","audioReference:3"],"imageRatios":["9:16","16:9","21:9","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[15],"resolution":["720p","480p"]}]},{"quality":"快速","operation":"reference","mode":"singleImage","imageRatios":["9:16","16:9","21:9","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[15],"resolution":["720p","480p"]}]},{"quality":"快速","operation":"reference","mode":"startEndRequired","imageRatios":["9:16","16:9","21:9","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[15],"resolution":["720p","480p"]}]},{"quality":"快速","operation":"reference","mode":"text","imageRatios":["9:16","16:9","21:9","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[15],"resolution":["720p","480p"]}]},{"quality":"标准","operation":"reference","mode":["imageReference:9","videoReference:3","audioReference:3"],"imageRatios":["9:16","16:9","21:9","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[15],"resolution":["720p","480p"]}]},{"quality":"标准","operation":"reference","mode":"singleImage","imageRatios":["9:16","16:9","21:9","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[15],"resolution":["720p","480p"]}]},{"quality":"标准","operation":"reference","mode":"startEndRequired","imageRatios":["9:16","16:9","21:9","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[15],"resolution":["720p","480p"]}]},{"quality":"标准","operation":"reference","mode":"text","imageRatios":["9:16","16:9","21:9","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[15],"resolution":["720p","480p"]}]}],"rules":[{"field":"quality","type":"select","title":"版本档位","value":"标准","options":[{"value":"高清","label":"官方满血"},{"value":"快速","label":"Fast"},{"value":"标准","label":"Mini"}],"props":{"teleported":false}}]},
    {"id":"seedance-2-0-manju-special","label":"Seedance 2.0 · 漫剧特价","type":"video","mode":["text","singleImage","startEndRequired",["imageReference:9"]],"audio":true,"imageRatios":["16:9","9:16","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[5],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[15],"resolution":["720p"]},{"duration":[5],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[15],"resolution":["720p"]},{"duration":[5],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[15],"resolution":["720p"]},{"duration":[5],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[15],"resolution":["720p"]}],"maxPromptLength":8000,"promptOptional":false,"videoVariants":[{"operation":"reference","mode":"text","imageRatios":["16:9","9:16","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[5],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[15],"resolution":["720p"]}]},{"operation":"reference","mode":"singleImage","imageRatios":["16:9","9:16","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[5],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[15],"resolution":["720p"]}]},{"operation":"reference","mode":"startEndRequired","imageRatios":["16:9","9:16","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[5],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[15],"resolution":["720p"]}]},{"operation":"reference","mode":["imageReference:9"],"imageRatios":["16:9","9:16","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[5],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[15],"resolution":["720p"]}]}],"rules":[]},
    {"id":"seedance-2-0-promo","label":"Seedance 2.0 · 特价按秒","type":"video","mode":[["imageReference:9","videoReference:3","audioReference:3"],"startEndRequired","text","singleImage"],"audio":true,"imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p","4k"]},{"duration":[5],"resolution":["480p","720p","4k"]},{"duration":[6],"resolution":["480p","720p","4k"]},{"duration":[7],"resolution":["480p","720p","4k"]},{"duration":[8],"resolution":["480p","720p","4k"]},{"duration":[9],"resolution":["480p","720p","4k"]},{"duration":[10],"resolution":["480p","720p","4k"]},{"duration":[12],"resolution":["480p","720p","4k"]},{"duration":[15],"resolution":["480p","720p","4k"]},{"duration":[11],"resolution":["480p","720p","4k"]},{"duration":[13],"resolution":["480p","720p","4k"]},{"duration":[14],"resolution":["480p","720p","4k"]},{"duration":[4],"resolution":["480p","720p","4k"]},{"duration":[5],"resolution":["480p","720p","4k"]},{"duration":[6],"resolution":["480p","720p","4k"]},{"duration":[7],"resolution":["480p","720p","4k"]},{"duration":[8],"resolution":["480p","720p","4k"]},{"duration":[9],"resolution":["480p","720p","4k"]},{"duration":[10],"resolution":["480p","720p","4k"]},{"duration":[12],"resolution":["480p","720p","4k"]},{"duration":[15],"resolution":["480p","720p","4k"]},{"duration":[11],"resolution":["480p","720p","4k"]},{"duration":[13],"resolution":["480p","720p","4k"]},{"duration":[14],"resolution":["480p","720p","4k"]},{"duration":[4],"resolution":["480p","720p","4k"]},{"duration":[5],"resolution":["480p","720p","4k"]},{"duration":[6],"resolution":["480p","720p","4k"]},{"duration":[7],"resolution":["480p","720p","4k"]},{"duration":[8],"resolution":["480p","720p","4k"]},{"duration":[9],"resolution":["480p","720p","4k"]},{"duration":[10],"resolution":["480p","720p","4k"]},{"duration":[12],"resolution":["480p","720p","4k"]},{"duration":[15],"resolution":["480p","720p","4k"]},{"duration":[11],"resolution":["480p","720p","4k"]},{"duration":[13],"resolution":["480p","720p","4k"]},{"duration":[14],"resolution":["480p","720p","4k"]},{"duration":[4],"resolution":["480p","720p","4k"]},{"duration":[5],"resolution":["480p","720p","4k"]},{"duration":[6],"resolution":["480p","720p","4k"]},{"duration":[7],"resolution":["480p","720p","4k"]},{"duration":[8],"resolution":["480p","720p","4k"]},{"duration":[9],"resolution":["480p","720p","4k"]},{"duration":[10],"resolution":["480p","720p","4k"]},{"duration":[12],"resolution":["480p","720p","4k"]},{"duration":[15],"resolution":["480p","720p","4k"]},{"duration":[11],"resolution":["480p","720p","4k"]},{"duration":[13],"resolution":["480p","720p","4k"]},{"duration":[14],"resolution":["480p","720p","4k"]}],"maxPromptLength":60000,"promptOptional":false,"videoVariants":[{"quality":"标准","operation":"reference","mode":["imageReference:9","videoReference:3","audioReference:3"],"imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]}]},{"quality":"标准","operation":"reference","mode":"startEndRequired","imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]}]},{"quality":"标准","operation":"reference","mode":"text","imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]}]},{"quality":"标准","operation":"reference","mode":"singleImage","imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","1080p","4k"]},{"duration":[5],"resolution":["480p","720p","1080p","4k"]},{"duration":[6],"resolution":["480p","720p","1080p","4k"]},{"duration":[7],"resolution":["480p","720p","1080p","4k"]},{"duration":[8],"resolution":["480p","720p","1080p","4k"]},{"duration":[9],"resolution":["480p","720p","1080p","4k"]},{"duration":[10],"resolution":["480p","720p","1080p","4k"]},{"duration":[12],"resolution":["480p","720p","1080p","4k"]},{"duration":[15],"resolution":["480p","720p","1080p","4k"]},{"duration":[11],"resolution":["480p","720p","1080p","4k"]},{"duration":[13],"resolution":["480p","720p","1080p","4k"]},{"duration":[14],"resolution":["480p","720p","1080p","4k"]}]},{"quality":"fast","operation":"reference","mode":["imageReference:9","videoReference:3","audioReference:3"],"imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]}]},{"quality":"fast","operation":"reference","mode":"startEndRequired","imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]}]},{"quality":"fast","operation":"reference","mode":"text","imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]}]},{"quality":"fast","operation":"reference","mode":"singleImage","imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[7],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[9],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[11],"resolution":["480p","720p"]},{"duration":[13],"resolution":["480p","720p"]},{"duration":[14],"resolution":["480p","720p"]}]},{"quality":"mini","operation":"reference","mode":["imageReference:9","videoReference:3","audioReference:3"],"imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","4k"]},{"duration":[5],"resolution":["480p","720p","4k"]},{"duration":[6],"resolution":["480p","720p","4k"]},{"duration":[7],"resolution":["480p","720p","4k"]},{"duration":[8],"resolution":["480p","720p","4k"]},{"duration":[9],"resolution":["480p","720p","4k"]},{"duration":[10],"resolution":["480p","720p","4k"]},{"duration":[12],"resolution":["480p","720p","4k"]},{"duration":[15],"resolution":["480p","720p","4k"]},{"duration":[11],"resolution":["480p","720p","4k"]},{"duration":[13],"resolution":["480p","720p","4k"]},{"duration":[14],"resolution":["480p","720p","4k"]}]},{"quality":"mini","operation":"reference","mode":"startEndRequired","imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","4k"]},{"duration":[5],"resolution":["480p","720p","4k"]},{"duration":[6],"resolution":["480p","720p","4k"]},{"duration":[7],"resolution":["480p","720p","4k"]},{"duration":[8],"resolution":["480p","720p","4k"]},{"duration":[9],"resolution":["480p","720p","4k"]},{"duration":[10],"resolution":["480p","720p","4k"]},{"duration":[12],"resolution":["480p","720p","4k"]},{"duration":[15],"resolution":["480p","720p","4k"]},{"duration":[11],"resolution":["480p","720p","4k"]},{"duration":[13],"resolution":["480p","720p","4k"]},{"duration":[14],"resolution":["480p","720p","4k"]}]},{"quality":"mini","operation":"reference","mode":"text","imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","4k"]},{"duration":[5],"resolution":["480p","720p","4k"]},{"duration":[6],"resolution":["480p","720p","4k"]},{"duration":[7],"resolution":["480p","720p","4k"]},{"duration":[8],"resolution":["480p","720p","4k"]},{"duration":[9],"resolution":["480p","720p","4k"]},{"duration":[10],"resolution":["480p","720p","4k"]},{"duration":[12],"resolution":["480p","720p","4k"]},{"duration":[15],"resolution":["480p","720p","4k"]},{"duration":[11],"resolution":["480p","720p","4k"]},{"duration":[13],"resolution":["480p","720p","4k"]},{"duration":[14],"resolution":["480p","720p","4k"]}]},{"quality":"mini","operation":"reference","mode":"singleImage","imageRatios":["9:16","16:9","1:1","4:3","3:4","21:9","adaptive"],"durationResolutionMap":[{"duration":[4],"resolution":["480p","720p","4k"]},{"duration":[5],"resolution":["480p","720p","4k"]},{"duration":[6],"resolution":["480p","720p","4k"]},{"duration":[7],"resolution":["480p","720p","4k"]},{"duration":[8],"resolution":["480p","720p","4k"]},{"duration":[9],"resolution":["480p","720p","4k"]},{"duration":[10],"resolution":["480p","720p","4k"]},{"duration":[12],"resolution":["480p","720p","4k"]},{"duration":[15],"resolution":["480p","720p","4k"]},{"duration":[11],"resolution":["480p","720p","4k"]},{"duration":[13],"resolution":["480p","720p","4k"]},{"duration":[14],"resolution":["480p","720p","4k"]}]}],"rules":[{"field":"quality","type":"select","title":"版本档位","value":"mini","options":[{"value":"标准","label":"标准"},{"value":"fast","label":"Fast"},{"value":"mini","label":"Mini"}],"props":{"teleported":false}}]},
    {"id":"seedance-2-0-9tu-special","label":"Seedance 2.0 · 九图特价","type":"video","mode":["text","singleImage",["imageReference:9"]],"audio":true,"imageRatios":["9:16","16:9"],"durationResolutionMap":[{"duration":[15],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[15],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[15],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[15],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[5],"resolution":["720p"]},{"duration":[15],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[5],"resolution":["720p"]}],"maxPromptLength":8000,"promptOptional":false,"videoVariants":[{"quality":"Fast","operation":"reference","mode":"text","imageRatios":["9:16","16:9"],"durationResolutionMap":[{"duration":[15],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]}]},{"quality":"Fast","operation":"reference","mode":"singleImage","imageRatios":["9:16","16:9"],"durationResolutionMap":[{"duration":[15],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]}]},{"quality":"Fast","operation":"reference","mode":["imageReference:9"],"imageRatios":["9:16","16:9"],"durationResolutionMap":[{"duration":[15],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]}]},{"quality":"标准","operation":"reference","mode":"text","imageRatios":["9:16","16:9"],"durationResolutionMap":[{"duration":[15],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[5],"resolution":["720p"]}]},{"quality":"标准","operation":"reference","mode":["imageReference:9"],"imageRatios":["9:16","16:9"],"durationResolutionMap":[{"duration":[15],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[5],"resolution":["720p"]}]}],"rules":[{"field":"quality","type":"select","title":"版本档位","value":"Fast","options":[{"value":"Fast","label":"Fast"},{"value":"标准","label":"标准"}],"props":{"teleported":false}}]},
    {"id":"seedance-2-0-ecom-special","label":"Seedance 2.0 · 电商特价","type":"video","mode":[["imageReference:9"],"text"],"audio":true,"imageRatios":["9:16","16:9","1:1"],"durationResolutionMap":[{"duration":[5],"resolution":[]},{"duration":[10],"resolution":[]},{"duration":[15],"resolution":[]},{"duration":[5],"resolution":[]},{"duration":[10],"resolution":[]},{"duration":[15],"resolution":[]},{"duration":[5],"resolution":[]},{"duration":[10],"resolution":[]},{"duration":[15],"resolution":[]},{"duration":[5],"resolution":[]},{"duration":[10],"resolution":[]},{"duration":[15],"resolution":[]},{"duration":[10],"resolution":[]},{"duration":[15],"resolution":[]},{"duration":[10],"resolution":[]},{"duration":[15],"resolution":[]}],"maxPromptLength":24400,"promptOptional":false,"videoVariants":[{"quality":"标准","operation":"reference","mode":["imageReference:9"],"imageRatios":["9:16","16:9","1:1"],"durationResolutionMap":[{"duration":[5],"resolution":[]},{"duration":[10],"resolution":[]},{"duration":[15],"resolution":[]}]},{"quality":"标准","operation":"reference","mode":"text","imageRatios":["9:16","16:9","1:1"],"durationResolutionMap":[{"duration":[5],"resolution":[]},{"duration":[10],"resolution":[]},{"duration":[15],"resolution":[]}]},{"quality":"真人模特","operation":"reference","mode":["imageReference:9"],"imageRatios":["9:16","16:9","1:1"],"durationResolutionMap":[{"duration":[5],"resolution":[]},{"duration":[10],"resolution":[]},{"duration":[15],"resolution":[]}]},{"quality":"真人模特","operation":"reference","mode":"text","imageRatios":["9:16","16:9","1:1"],"durationResolutionMap":[{"duration":[5],"resolution":[]},{"duration":[10],"resolution":[]},{"duration":[15],"resolution":[]}]},{"quality":"满血9图","operation":"reference","mode":["imageReference:9"],"imageRatios":["9:16","16:9"],"durationResolutionMap":[{"duration":[10],"resolution":[]},{"duration":[15],"resolution":[]}]},{"quality":"满血9图","operation":"reference","mode":"text","imageRatios":["9:16","16:9"],"durationResolutionMap":[{"duration":[10],"resolution":[]},{"duration":[15],"resolution":[]}]}],"rules":[{"field":"quality","type":"select","title":"版本档位","value":"满血9图","options":[{"value":"标准","label":"标准"},{"value":"真人模特","label":"真人模特"},{"value":"满血9图","label":"满血9图"}],"props":{"teleported":false}}]},
    {"id":"gk-imagine-1-5-7tu-special","label":"GK Imagine 1.5 Pro","type":"video","mode":["text","singleImage",["imageReference:14"],"startEndRequired"],"audio":true,"imageRatios":["16:9","9:16","1:1","4:3","3:4","3:2","2:3"],"durationResolutionMap":[{"duration":[3],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[3],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[3],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[3],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}],"maxPromptLength":8000,"promptOptional":false,"videoVariants":[{"operation":"reference","mode":"text","imageRatios":["16:9","9:16","1:1","4:3","3:4","3:2","2:3"],"durationResolutionMap":[{"duration":[3],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]},{"operation":"reference","mode":"singleImage","imageRatios":["16:9","9:16","1:1","4:3","3:4","3:2","2:3"],"durationResolutionMap":[{"duration":[3],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]},{"operation":"reference","mode":["imageReference:14"],"imageRatios":["16:9","9:16","1:1","4:3","3:4","3:2","2:3"],"durationResolutionMap":[{"duration":[3],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]},{"operation":"reference","mode":"startEndRequired","imageRatios":["16:9","9:16","1:1","4:3","3:4","3:2","2:3"],"durationResolutionMap":[{"duration":[3],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]}]}],"rules":[{"field":"voices","type":"select","title":"配音音色","value":[],"options":[{"value":"eve","label":"Eve"},{"value":"ara","label":"Ara"},{"value":"luna","label":"Luna"},{"value":"ursa","label":"Ursa"},{"value":"celeste","label":"Celeste"},{"value":"iris","label":"Iris"},{"value":"carina","label":"Carina"},{"value":"rex","label":"Rex"},{"value":"leo","label":"Leo"},{"value":"sal","label":"Sal"},{"value":"zagan","label":"Zagan"},{"value":"helix","label":"Helix"},{"value":"orion","label":"Orion"},{"value":"altair","label":"Altair"},{"value":"zenith","label":"Zenith"},{"value":"perseus","label":"Perseus"},{"value":"helios","label":"Helios"},{"value":"lux","label":"Lux"},{"value":"kepler","label":"Kepler"},{"value":"rigel","label":"Rigel"},{"value":"cosmo","label":"Cosmo"},{"value":"sirius","label":"Sirius"},{"value":"lumen","label":"Lumen"},{"value":"castor","label":"Castor"},{"value":"naksh","label":"Naksh"},{"value":"atlas","label":"Atlas"}],"props":{"multiple":true,"multipleLimit":3,"teleported":false,"clearable":true}}]},
    {"id":"gk-imagine-1.5","label":"GK Imagine 1.5","type":"video","mode":["text","singleImage",["imageReference:14"],"startEndRequired"],"audio":true,"imageRatios":["16:9","9:16","1:1"],"durationResolutionMap":[{"duration":[6],"resolution":["720p","480p","1080p"]},{"duration":[10],"resolution":["720p","480p","1080p"]},{"duration":[15],"resolution":["720p","480p","1080p"]},{"duration":[20],"resolution":["720p","480p"]},{"duration":[30],"resolution":["720p","480p"]},{"duration":[4],"resolution":["720p","480p","1080p"]},{"duration":[8],"resolution":["720p","480p","1080p"]},{"duration":[12],"resolution":["720p","480p","1080p"]},{"duration":[6],"resolution":["720p","480p","1080p"]},{"duration":[10],"resolution":["720p","480p","1080p"]},{"duration":[15],"resolution":["720p","480p","1080p"]},{"duration":[20],"resolution":["720p","480p"]},{"duration":[30],"resolution":["720p","480p"]},{"duration":[4],"resolution":["720p","480p","1080p"]},{"duration":[8],"resolution":["720p","480p","1080p"]},{"duration":[12],"resolution":["720p","480p","1080p"]},{"duration":[6],"resolution":["720p","480p"]},{"duration":[10],"resolution":["720p","480p"]},{"duration":[15],"resolution":["720p","480p"]},{"duration":[20],"resolution":["720p","480p"]},{"duration":[30],"resolution":["720p","480p"]},{"duration":[4],"resolution":["720p","480p"]},{"duration":[8],"resolution":["720p","480p"]},{"duration":[12],"resolution":["720p","480p"]},{"duration":[6],"resolution":["720p","480p"]},{"duration":[10],"resolution":["720p","480p"]},{"duration":[15],"resolution":["720p","480p"]},{"duration":[20],"resolution":["720p","480p"]},{"duration":[30],"resolution":["720p","480p"]},{"duration":[4],"resolution":["720p","480p"]},{"duration":[8],"resolution":["720p","480p"]},{"duration":[12],"resolution":["720p","480p"]}],"maxPromptLength":4096,"promptOptional":false,"videoVariants":[{"operation":"reference","mode":"text","imageRatios":["16:9","9:16","1:1"],"durationResolutionMap":[{"duration":[6],"resolution":["720p","480p","1080p"]},{"duration":[10],"resolution":["720p","480p","1080p"]},{"duration":[15],"resolution":["720p","480p","1080p"]},{"duration":[20],"resolution":["720p","480p"]},{"duration":[30],"resolution":["720p","480p"]},{"duration":[4],"resolution":["720p","480p","1080p"]},{"duration":[8],"resolution":["720p","480p","1080p"]},{"duration":[12],"resolution":["720p","480p","1080p"]}]},{"operation":"reference","mode":"singleImage","imageRatios":["16:9","9:16","1:1"],"durationResolutionMap":[{"duration":[6],"resolution":["720p","480p","1080p"]},{"duration":[10],"resolution":["720p","480p","1080p"]},{"duration":[15],"resolution":["720p","480p","1080p"]},{"duration":[20],"resolution":["720p","480p"]},{"duration":[30],"resolution":["720p","480p"]},{"duration":[4],"resolution":["720p","480p","1080p"]},{"duration":[8],"resolution":["720p","480p","1080p"]},{"duration":[12],"resolution":["720p","480p","1080p"]}]},{"operation":"reference","mode":["imageReference:14"],"imageRatios":["16:9","9:16","1:1"],"durationResolutionMap":[{"duration":[6],"resolution":["720p","480p"]},{"duration":[10],"resolution":["720p","480p"]},{"duration":[15],"resolution":["720p","480p"]},{"duration":[20],"resolution":["720p","480p"]},{"duration":[30],"resolution":["720p","480p"]},{"duration":[4],"resolution":["720p","480p"]},{"duration":[8],"resolution":["720p","480p"]},{"duration":[12],"resolution":["720p","480p"]}]},{"operation":"reference","mode":"startEndRequired","imageRatios":["16:9","9:16","1:1"],"durationResolutionMap":[{"duration":[6],"resolution":["720p","480p"]},{"duration":[10],"resolution":["720p","480p"]},{"duration":[15],"resolution":["720p","480p"]},{"duration":[20],"resolution":["720p","480p"]},{"duration":[30],"resolution":["720p","480p"]},{"duration":[4],"resolution":["720p","480p"]},{"duration":[8],"resolution":["720p","480p"]},{"duration":[12],"resolution":["720p","480p"]}]}],"rules":[{"field":"voices","type":"select","title":"配音音色","value":[],"options":[{"value":"eve","label":"Eve"},{"value":"ara","label":"Ara"},{"value":"luna","label":"Luna"},{"value":"ursa","label":"Ursa"},{"value":"celeste","label":"Celeste"},{"value":"iris","label":"Iris"},{"value":"carina","label":"Carina"},{"value":"rex","label":"Rex"},{"value":"leo","label":"Leo"},{"value":"sal","label":"Sal"},{"value":"zagan","label":"Zagan"},{"value":"helix","label":"Helix"},{"value":"orion","label":"Orion"},{"value":"altair","label":"Altair"},{"value":"zenith","label":"Zenith"},{"value":"perseus","label":"Perseus"},{"value":"helios","label":"Helios"},{"value":"lux","label":"Lux"},{"value":"kepler","label":"Kepler"},{"value":"rigel","label":"Rigel"},{"value":"cosmo","label":"Cosmo"},{"value":"sirius","label":"Sirius"},{"value":"lumen","label":"Lumen"},{"value":"castor","label":"Castor"},{"value":"naksh","label":"Naksh"},{"value":"atlas","label":"Atlas"}],"props":{"multiple":true,"multipleLimit":3,"teleported":false,"clearable":true}}]},
    {"id":"gk-imagine-video","label":"GK Imagine 1.0","type":"video","mode":["text","singleImage",["imageReference:7"],["videoReference:1"]],"audio":true,"imageRatios":["16:9","9:16","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[6],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]},{"duration":[3],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]},{"duration":[3],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[6],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]},{"duration":[3],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]},{"duration":[6],"resolution":[]},{"duration":[10],"resolution":[]},{"duration":[3],"resolution":[]},{"duration":[4],"resolution":[]},{"duration":[5],"resolution":[]},{"duration":[8],"resolution":[]}],"maxPromptLength":4096,"promptOptional":false,"videoVariants":[{"operation":"reference","mode":"text","imageRatios":["16:9","9:16","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[6],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]},{"duration":[3],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]}]},{"operation":"reference","mode":"singleImage","imageRatios":["16:9","9:16","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[6],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]},{"duration":[3],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]}]},{"operation":"reference","mode":["imageReference:7"],"imageRatios":["16:9","9:16","1:1","4:3","3:4"],"durationResolutionMap":[{"duration":[6],"resolution":["480p","720p"]},{"duration":[10],"resolution":["480p","720p"]},{"duration":[15],"resolution":["480p","720p"]},{"duration":[20],"resolution":["480p","720p"]},{"duration":[30],"resolution":["480p","720p"]},{"duration":[3],"resolution":["480p","720p"]},{"duration":[4],"resolution":["480p","720p"]},{"duration":[5],"resolution":["480p","720p"]},{"duration":[8],"resolution":["480p","720p"]},{"duration":[12],"resolution":["480p","720p"]}]},{"operation":"extend","mode":["videoReference:1"],"imageRatios":[],"durationResolutionMap":[{"duration":[6],"resolution":[]},{"duration":[10],"resolution":[]},{"duration":[3],"resolution":[]},{"duration":[4],"resolution":[]},{"duration":[5],"resolution":[]},{"duration":[8],"resolution":[]}]}],"rules":[{"field":"videoOperation","type":"select","title":"视频任务","value":"reference","options":[{"value":"reference","label":"生成视频"},{"value":"extend","label":"延长参考视频"}],"props":{"teleported":false}}]},
    {"id":"gk-imagine-video-special","label":"GK-1.0 多图 · 特价","type":"video","mode":["text","singleImage",["imageReference:7"]],"audio":true,"imageRatios":["16:9","9:16"],"durationResolutionMap":[{"duration":[6],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[6],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]},{"duration":[6],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]}],"maxPromptLength":8000,"promptOptional":false,"videoVariants":[{"operation":"reference","mode":"text","imageRatios":["16:9","9:16"],"durationResolutionMap":[{"duration":[6],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]}]},{"operation":"reference","mode":"singleImage","imageRatios":["16:9","9:16"],"durationResolutionMap":[{"duration":[6],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]}]},{"operation":"reference","mode":["imageReference:7"],"imageRatios":["16:9","9:16"],"durationResolutionMap":[{"duration":[6],"resolution":["720p"]},{"duration":[10],"resolution":["720p"]}]}],"rules":[]},
    {"id":"gk-imagine-1.5-special","label":"GK-1.5 图生 · 特价","type":"video","mode":["singleImage"],"audio":true,"imageRatios":["16:9","9:16"],"durationResolutionMap":[{"duration":[6],"resolution":["720p"]},{"duration":[15],"resolution":["720p"]}],"maxPromptLength":8000,"promptOptional":false,"videoVariants":[{"operation":"reference","mode":"singleImage","imageRatios":["16:9","9:16"],"durationResolutionMap":[{"duration":[6],"resolution":["720p"]},{"duration":[15],"resolution":["720p"]}]}],"rules":[]},
    {"id":"minimax-h3","label":"MiniMax H3","type":"video","mode":["text","singleImage","startEndRequired",["imageReference:9","videoReference:3","audioReference:3"]],"audio":true,"imageRatios":["16:9","9:16","21:9","4:3","1:1","3:4"],"durationResolutionMap":[{"duration":[4],"resolution":["768p","2k"]},{"duration":[5],"resolution":["768p","2k"]},{"duration":[6],"resolution":["768p","2k"]},{"duration":[7],"resolution":["768p","2k"]},{"duration":[8],"resolution":["768p","2k"]},{"duration":[9],"resolution":["768p","2k"]},{"duration":[10],"resolution":["768p","2k"]},{"duration":[11],"resolution":["768p","2k"]},{"duration":[12],"resolution":["768p","2k"]},{"duration":[13],"resolution":["768p","2k"]},{"duration":[14],"resolution":["768p","2k"]},{"duration":[15],"resolution":["768p","2k"]},{"duration":[4],"resolution":["768p","2k"]},{"duration":[5],"resolution":["768p","2k"]},{"duration":[6],"resolution":["768p","2k"]},{"duration":[7],"resolution":["768p","2k"]},{"duration":[8],"resolution":["768p","2k"]},{"duration":[9],"resolution":["768p","2k"]},{"duration":[10],"resolution":["768p","2k"]},{"duration":[11],"resolution":["768p","2k"]},{"duration":[12],"resolution":["768p","2k"]},{"duration":[13],"resolution":["768p","2k"]},{"duration":[14],"resolution":["768p","2k"]},{"duration":[15],"resolution":["768p","2k"]},{"duration":[4],"resolution":["768p","2k"]},{"duration":[5],"resolution":["768p","2k"]},{"duration":[6],"resolution":["768p","2k"]},{"duration":[7],"resolution":["768p","2k"]},{"duration":[8],"resolution":["768p","2k"]},{"duration":[9],"resolution":["768p","2k"]},{"duration":[10],"resolution":["768p","2k"]},{"duration":[11],"resolution":["768p","2k"]},{"duration":[12],"resolution":["768p","2k"]},{"duration":[13],"resolution":["768p","2k"]},{"duration":[14],"resolution":["768p","2k"]},{"duration":[15],"resolution":["768p","2k"]},{"duration":[4],"resolution":["768p","2k"]},{"duration":[5],"resolution":["768p","2k"]},{"duration":[6],"resolution":["768p","2k"]},{"duration":[7],"resolution":["768p","2k"]},{"duration":[8],"resolution":["768p","2k"]},{"duration":[9],"resolution":["768p","2k"]},{"duration":[10],"resolution":["768p","2k"]},{"duration":[11],"resolution":["768p","2k"]},{"duration":[12],"resolution":["768p","2k"]},{"duration":[13],"resolution":["768p","2k"]},{"duration":[14],"resolution":["768p","2k"]},{"duration":[15],"resolution":["768p","2k"]}],"maxPromptLength":20000,"promptOptional":false,"videoVariants":[{"operation":"reference","mode":"text","imageRatios":["16:9","9:16","21:9","4:3","1:1","3:4"],"durationResolutionMap":[{"duration":[4],"resolution":["768p","2k"]},{"duration":[5],"resolution":["768p","2k"]},{"duration":[6],"resolution":["768p","2k"]},{"duration":[7],"resolution":["768p","2k"]},{"duration":[8],"resolution":["768p","2k"]},{"duration":[9],"resolution":["768p","2k"]},{"duration":[10],"resolution":["768p","2k"]},{"duration":[11],"resolution":["768p","2k"]},{"duration":[12],"resolution":["768p","2k"]},{"duration":[13],"resolution":["768p","2k"]},{"duration":[14],"resolution":["768p","2k"]},{"duration":[15],"resolution":["768p","2k"]}]},{"operation":"reference","mode":"singleImage","imageRatios":[],"durationResolutionMap":[{"duration":[4],"resolution":["768p","2k"]},{"duration":[5],"resolution":["768p","2k"]},{"duration":[6],"resolution":["768p","2k"]},{"duration":[7],"resolution":["768p","2k"]},{"duration":[8],"resolution":["768p","2k"]},{"duration":[9],"resolution":["768p","2k"]},{"duration":[10],"resolution":["768p","2k"]},{"duration":[11],"resolution":["768p","2k"]},{"duration":[12],"resolution":["768p","2k"]},{"duration":[13],"resolution":["768p","2k"]},{"duration":[14],"resolution":["768p","2k"]},{"duration":[15],"resolution":["768p","2k"]}]},{"operation":"reference","mode":"startEndRequired","imageRatios":[],"durationResolutionMap":[{"duration":[4],"resolution":["768p","2k"]},{"duration":[5],"resolution":["768p","2k"]},{"duration":[6],"resolution":["768p","2k"]},{"duration":[7],"resolution":["768p","2k"]},{"duration":[8],"resolution":["768p","2k"]},{"duration":[9],"resolution":["768p","2k"]},{"duration":[10],"resolution":["768p","2k"]},{"duration":[11],"resolution":["768p","2k"]},{"duration":[12],"resolution":["768p","2k"]},{"duration":[13],"resolution":["768p","2k"]},{"duration":[14],"resolution":["768p","2k"]},{"duration":[15],"resolution":["768p","2k"]}]},{"operation":"reference","mode":["imageReference:9","videoReference:3","audioReference:3"],"imageRatios":["16:9","9:16","21:9","4:3","1:1","3:4"],"durationResolutionMap":[{"duration":[4],"resolution":["768p","2k"]},{"duration":[5],"resolution":["768p","2k"]},{"duration":[6],"resolution":["768p","2k"]},{"duration":[7],"resolution":["768p","2k"]},{"duration":[8],"resolution":["768p","2k"]},{"duration":[9],"resolution":["768p","2k"]},{"duration":[10],"resolution":["768p","2k"]},{"duration":[11],"resolution":["768p","2k"]},{"duration":[12],"resolution":["768p","2k"]},{"duration":[13],"resolution":["768p","2k"]},{"duration":[14],"resolution":["768p","2k"]},{"duration":[15],"resolution":["768p","2k"]}]}],"rules":[]},
    {"id":"minimax-hailuo-2-3","label":"MiniMax 海螺 2.3","type":"video","mode":["text","singleImage"],"audio":false,"imageRatios":[],"durationResolutionMap":[{"duration":[6],"resolution":["768p","1080p"]},{"duration":[10],"resolution":["768p"]},{"duration":[6],"resolution":["768p","1080p"]},{"duration":[10],"resolution":["768p"]}],"maxPromptLength":2000,"promptOptional":false,"videoVariants":[{"operation":"reference","mode":"text","imageRatios":[],"durationResolutionMap":[{"duration":[6],"resolution":["768p","1080p"]},{"duration":[10],"resolution":["768p"]}]},{"operation":"reference","mode":"singleImage","imageRatios":[],"durationResolutionMap":[{"duration":[6],"resolution":["768p","1080p"]},{"duration":[10],"resolution":["768p"]}]}],"rules":[]},
    {"id":"minimax-h3-lipsync","label":"MiniMax H3 · 对口型 / 数字人口播","type":"video","mode":[["imageReference:1","audioReference:1"]],"audio":true,"imageRatios":["9:16","16:9"],"durationResolutionMap":[],"promptOptional":true,"videoVariants":[{"operation":"avatar","mode":["imageReference:1","audioReference:1"],"imageRatios":["9:16","16:9"],"durationResolutionMap":[]}],"rules":[]},
  ],
  async generateImage(this: Context, request: ImageRequest) {
    const additional = additionalImageDefinitions.find(model => model.id === request.model);
    if (additional) return generateAdditionalImage(this, request, additional);
    if (request.model !== flareId && request.model !== seedreamId) throw new Error("未知的见白 AI 图片模型");
    if (request.mask) throw new Error("当前见白 AI 图片适配暂未开放蒙版编辑");
    const isFlare = request.model === flareId;
    const outputFormat = request.outputFormat ?? request.other?.outputFormat;
    const background = request.other?.background;
    const quality = request.quality ?? request.other?.quality;
    if (background !== undefined && (!isFlare || !["opaque", "transparent"].includes(String(background)))) throw new Error("当前模型不支持此背景选项");
    if (quality !== undefined && (!isFlare || !["low", "medium", "high", "xhigh", "max"].includes(String(quality)))) throw new Error("当前模型不支持此图片质量");
    if (outputFormat !== undefined && (!isFlare || (outputFormat !== "png" && outputFormat !== "jpeg"))) {
      throw new Error("当前模型不支持此输出格式");
    }
    const imageCount = request.images?.length ?? 0;
    const layerDecomposition = request.other?.layerDecomposition === true;
    if (layerDecomposition && (isFlare || imageCount !== 1)) throw new Error("图层分离仅支持 Seedream 5.5 单张参考图");
    const maxPromptLength = isFlare ? 32000 : 100000;
    if (request.prompt.length > maxPromptLength) throw new Error(`提示词最多支持 ${maxPromptLength} 个字符，当前 ${request.prompt.length} 个，请缩短后重试`);
    const maxImages = isFlare ? 17 : 10;
    if (imageCount > maxImages) throw new Error(`此模型最多支持 ${maxImages} 张参考图`);
    if (!isFlare && request.ratio && !imageRatios.includes(request.ratio)) throw new Error("Seedream 5.5 不支持此宽高比");
    const images = await references(this, request.images);
    if (layerDecomposition) {
      if (!request.ratio) throw new Error("图层分离需要指定参考图比例");
      // 分层走带参考图的 generate；n 是生成次数，图层数量由模型决定。
      return generate(this, request.model, "image", {
        prompt: request.prompt,
        mode: "layer-decompose",
        size: request.ratio,
        n: 1,
      }, "generate", images);
    }
    return generate(this, request.model, "image", {
      prompt: request.prompt,
      count: request.n ?? 1,
      mode: images.length > 1 ? "multi-reference" : images.length ? "image-edit" : "text-to-image",
      images,
      ...(isFlare ? {
        aspect_ratio: request.ratio,
        resolution: request.size,
        quality,
        background,
        output_format: background === "transparent" ? "png" : outputFormat,
      } : {
        size: request.ratio,
      }),
    }, images.length ? "edit" : "generate");
  },
  async generateVideo(this: Context, request: VideoRequest) {
    return generateCatalogVideo(this, request);
  },
  async generateAudio(this: Context, request: AudioRequest) {
    return generateCatalogAudio(this, request);
  },
  async resumeTask(this: Context, data: ProviderTaskData) {
    if (typeof data.taskId !== "string" || !["image", "video", "audio"].includes(String(data.mediaType))) {
      throw new Error("见白 AI 任务恢复数据无效");
    }
    return waitForTask(this, data.taskId, data.mediaType as TaskType);
  },
} satisfies ProviderDefinition;
