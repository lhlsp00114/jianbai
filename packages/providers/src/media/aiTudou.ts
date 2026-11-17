type MediaInput =
  | { type: "url"; url: string; mimeType?: string; name?: string }
  | { type: "base64"; data: string; mimeType: string; name?: string }
  | { type: "binary"; data: Uint8Array; mimeType: string; name?: string };

type MediaAsset = MediaInput & { mediaType: "image" };

type ProviderTaskValue = null | boolean | number | string | ProviderTaskValue[] | { [key: string]: ProviderTaskValue };
type ProviderTaskData = { [key: string]: ProviderTaskValue };

interface ImageRequest {
  model: string;
  prompt: string;
  images?: MediaInput[];
  mask?: MediaInput;
  n?: number;
  ratio?: string;
  size?: string;
  quality?: string;
  outputFormat?: string;
  other?: Record<string, unknown>;
}

interface Context {
  config: { apiKey?: string };
  signal?: AbortSignal;
  saveTaskData?: (data: ProviderTaskData) => Promise<void>;
  tool: {
    fetch: typeof fetch;
    errorMessage(value: unknown): string;
  };
}

type FetchOptions = { method: string; headers: Record<string, string>; body?: string | Blob };

const apiBase = "https://api.ai-tudou.net";
// ACT: 旧内部 ID 仅作同型号别名，不把已下架型号静默改派到其他付费模型。
const taskModels: Record<string, string> = {
  "gpt-image-2-all": "gpt-image-2-all",
  "gpt-image-2.5-flare-async": "gpt-image-2.5-flare-async",
  "gpt-image-2.5-sunburst-async": "gpt-image-2.5-sunburst-async",
  "gpt-image-2.6-async": "gpt-image-2.6-async",
  "gpt-image-2.6-flare": "gpt-image-2.6-flare",
  "gpt-image-2.6-flare-async": "gpt-image-2.6-flare-async",
  "gpt-image-2.6-sunburst": "gpt-image-2.6-sunburst",
  "gpt-image-2.6-sunburst-async": "gpt-image-2.6-sunburst-async",
  "grok-image-2-async": "grok-image-2-async",
  "seedream-5.0-pro-async": "seedream-5.0-pro-async",
  "seedream-5.5-async": "seedream-5.5-async",
  "gptImage2All": "gpt-image-2-all"
};
const gptRatios = ["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21"];
const nanoRatios = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const geminiModels: Record<string, string> = {
  "gemini-3-pro-image-preview": "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview": "gemini-3.1-flash-image-preview",
  "gemini-nano-banana-2.1": "gemini-nano-banana-2.1",
  "nanoBananaPro": "gemini-3-pro-image-preview",
  "nanoBanana2": "gemini-3.1-flash-image-preview"
};
const maxNanoImages = 14;
const pollDeadlineMs = 12 * 60 * 1000;

function modelLimits(model: string) {
  const sizes = model.startsWith("gpt-image-2.6-") && /(?:flare|sunburst)-async$/.test(model) ? ["1K", "2K"] : ["1K", "2K", "4K"];
  const ratios = model.startsWith("gemini") ? nanoRatios
    : model.startsWith("grok") ? ["1:1","4:3","3:4","3:2","2:3","16:9","9:16","2:1","1:2","19.5:9","9:19.5","20:9","9:20"]
    : model === "seedream-5.0-pro-async" ? ["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9","9:21"]
    : model === "seedream-5.5-async" ? ["1:1","21:9","16:9","3:2","5:4","4:5","2:3","9:16","9:21"]
    : gptRatios;
  return { sizes, ratios };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function describeError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return String(error);
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { name?: unknown }).name === "TimeoutError";
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = Array.from(bytes.subarray(index, index + chunkSize));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function splitDataUrl(value: string): { mimeType: string; data: string } {
  const text = typeof value === "string" ? value.trim() : "";
  const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(text);
  if (match) return { mimeType: match[1].toLowerCase(), data: match[2].replace(/\s+/g, "") };
  return { mimeType: "", data: text.replace(/\s+/g, "") };
}

function makeSignal(parent?: AbortSignal, timeoutMs?: number): AbortSignal {
  const signals: AbortSignal[] = [];
  if (parent) signals.push(parent);
  if (typeof timeoutMs === "number" && timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
  if (signals.length === 0) return new AbortController().signal;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error("请求已取消");
  error.name = "AbortError";
  return error;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer);
      reject(signal ? abortReason(signal) : new Error("请求已取消"));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function requireApiKey(ctx: Context): string {
  const apiKey = typeof ctx.config.apiKey === "string" ? ctx.config.apiKey.trim() : "";
  if (!apiKey) throw new Error("请先在供应商配置中填写 API Key");
  return apiKey;
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" };
}

async function requestJson(ctx: Context, url: string, options: FetchOptions, timeoutMs: number, action: string): Promise<unknown> {
  const signal = makeSignal(ctx.signal, timeoutMs);
  let response: Response;
  try {
    response = await ctx.tool.fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal,
    });
  } catch (error) {
    if (ctx.signal?.aborted) ctx.signal.throwIfAborted();
    if (isTimeoutError(error)) throw Object.assign(new Error(action + "超时，请先核对平台记录，不要重复提交"), { transientQuery: true });
    throw Object.assign(new Error(action + "失败：" + describeError(error)), { transientQuery: true });
  }
  let text = "";
  try {
    text = await response.text();
  } catch (error) {
    if (ctx.signal?.aborted) ctx.signal.throwIfAborted();
    if (isTimeoutError(error)) throw Object.assign(new Error(action + "超时，请先核对平台记录，不要重复提交"), { transientQuery: true });
    throw Object.assign(new Error(action + "读取返回内容失败：" + describeError(error)), { transientQuery: true });
  }
  if (!response.ok) {
    const detail = text.trim() ? ctx.tool.errorMessage(text) : "";
    throw Object.assign(new Error(action + "失败（HTTP " + response.status + "）" + (detail ? "：" + detail : "")), { transientQuery: [408, 429, 500, 502, 503, 504].includes(response.status) });
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(action + "返回的内容不是有效的 JSON");
  }
}

function errorText(ctx: Context, json: unknown): string {
  const root = asObject(json);
  if (!root) return "";
  const errorObj = asObject(root.error);
  if (errorObj && typeof errorObj.message === "string" && errorObj.message.trim()) return ctx.tool.errorMessage(errorObj.message);
  if (typeof root.message === "string" && root.message.trim()) return ctx.tool.errorMessage(root.message);
  return "";
}

function normalizeResolution(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (text === "1k" || text === "2k" || text === "4k") return text;
  return null;
}

function gptResolution(size: unknown): string {
  const resolution = normalizeResolution(size);
  if (resolution) return resolution;
  return "2k";
}

function gptQuality(quality: unknown, model: string): string {
  const allowed = model.startsWith("gpt-image-2.5-") ? ["low", "medium", "high", "xhigh", "max"] : ["low", "medium", "high"];
  const value = quality === undefined ? "medium" : typeof quality === "string" ? quality.trim().toLowerCase() : "";
  if (!allowed.includes(value)) throw new Error("该模型质量档位只支持：" + allowed.join("、"));
  return value;
}

function gptSizeRatio(request: ImageRequest): string {
  if (typeof request.ratio === "string" && request.ratio.trim()) {
    const ratio = request.ratio.trim();
    if (gptRatios.indexOf(ratio) === -1) {
      throw new Error("GPT Image 2 不支持比例 " + ratio + "，可用：" + gptRatios.join("、"));
    }
    return ratio;
  }
  if (typeof request.size === "string" && request.size.trim()) {
    const size = request.size.trim().toLowerCase().replace("×", "x");
    if (/^\d{3,5}x\d{3,5}$/.test(size)) return size;
    if (!normalizeResolution(size)) {
      throw new Error("无法识别的尺寸：" + request.size + "，请填写比例（如 16:9）或 1K/2K/4K");
    }
  }
  return "1:1";
}

async function uploadReferenceImage(ctx: Context, apiKey: string, input: MediaInput): Promise<string> {
  if (input.type === "url") {
    if (!isHttpUrl(input.url)) throw new Error("参考图链接无效");
    return input.url.trim();
  }
  const inline = await toInlineData(ctx, input);
  if (!/^image\/[a-z0-9.+-]+$/i.test(inline.mimeType) || !/^[a-zA-Z0-9+/]+={0,2}$/.test(inline.data)) throw new Error("参考图内容无效");
  if (inline.data.length > Math.ceil(15 * 1024 * 1024 / 3) * 4) throw new Error("异步参考图单张不能超过 15 MB");
  const bytes = new Uint8Array(Buffer.from(inline.data, "base64"));
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error("异步参考图不能为空且不能超过 15 MB");
  const json = await requestJson(ctx, "https://uploads.ai-tudou.net/upload", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": inline.mimeType },
    body: new Blob([bytes], { type: inline.mimeType }),
  }, 120000, "上传参考图");
  const url = asObject(json)?.url;
  if (!isHttpUrl(url)) throw new Error("参考图上传未返回有效 URL");
  return url.trim();
}

async function fetchImageAsInlineData(ctx: Context, url: string): Promise<{ mimeType: string; data: string }> {
  if (!isHttpUrl(url)) throw new Error("参考图链接无效，只支持公网 HTTP/HTTPS 地址");
  const signal = makeSignal(ctx.signal, 120000);
  let response: Response;
  let buffer: Uint8Array;
  try {
    response = await ctx.tool.fetch(url.trim(), { method: "GET", signal });
    if (!response.ok) throw new Error("下载参考图失败，HTTP " + response.status);
    buffer = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (ctx.signal?.aborted) ctx.signal.throwIfAborted();
    if (error instanceof Error && error.message.indexOf("下载参考图失败") === 0) throw error;
    if (isTimeoutError(error)) throw new Error("下载参考图超时，请检查图片链接是否可公网访问");
    throw new Error("下载参考图失败：" + describeError(error));
  }
  if (buffer.length === 0) throw new Error("参考图内容为空");
  const contentType = response.headers.get("content-type");
  let mimeType = "image/png";
  if (contentType && /^image\//i.test(contentType.trim())) mimeType = contentType.split(";")[0].trim().toLowerCase();
  return { mimeType, data: bytesToBase64(buffer) };
}

async function toInlineData(ctx: Context, input: MediaInput): Promise<{ mimeType: string; data: string }> {
  if (!input || typeof input !== "object") throw new Error("参考图格式无效");
  if (input.type === "url") return await fetchImageAsInlineData(ctx, input.url);
  if (input.type === "base64") {
    const parsed = splitDataUrl(input.data);
    if (!parsed.data) throw new Error("参考图内容为空");
    return { mimeType: parsed.mimeType || input.mimeType || "image/png", data: parsed.data };
  }
  if (input.type === "binary") {
    if (!(input.data instanceof Uint8Array) || input.data.length === 0) throw new Error("参考图内容为空");
    return { mimeType: input.mimeType || "image/png", data: bytesToBase64(input.data) };
  }
  throw new Error("参考图格式无效");
}

function nanoRatio(ratio: unknown): string | null {
  if (typeof ratio !== "string" || !ratio.trim()) return null;
  const text = ratio.trim();
  if (nanoRatios.indexOf(text) === -1) {
    throw new Error("Nano Banana 不支持比例 " + text + "，可用：" + nanoRatios.join("、"));
  }
  return text;
}

function nanoImageSize(size: unknown): string | null {
  const resolution = normalizeResolution(size);
  if (resolution) return resolution.toUpperCase();
  if (typeof size === "string" && size.trim()) {
    throw new Error("Nano Banana 请用 1K/2K/4K 选择清晰度，不支持像素尺寸 " + size.trim());
  }
  return null;
}

function extractGptImages(data: Record<string, unknown>): MediaAsset[] {
  const assets: MediaAsset[] = [];
  const result = asObject(data.result);
  if (!result) return assets;
  const images = result.images;
  if (!Array.isArray(images)) return assets;
  for (const item of images) {
    const entry = asObject(item);
    if (!entry) continue;
    const urls = entry.url;
    const list = Array.isArray(urls) ? urls : typeof urls === "string" ? [urls] : [];
    for (const candidate of list) {
      if (isHttpUrl(candidate)) assets.push({ mediaType: "image", type: "url", url: candidate.trim() });
    }
  }
  return assets;
}

function extractNanoImages(json: unknown): MediaAsset[] {
  const assets: MediaAsset[] = [];
  const root = asObject(json);
  if (!root) return assets;
  const candidates = root.candidates;
  if (!Array.isArray(candidates)) return assets;
  for (const candidate of candidates) {
    const content = asObject(asObject(candidate)?.content);
    const parts = content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const entry = asObject(part);
      if (!entry) continue;
      if (entry.thought === true) continue;
      const inline = asObject(entry.inlineData) ?? asObject(entry.inline_data);
      if (inline && typeof inline.data === "string" && inline.data.trim()) {
        const inlineMimeType = typeof inline.mimeType === "string" ? inline.mimeType : typeof inline.mime_type === "string" ? inline.mime_type : "image/png";
        assets.push({ mediaType: "image", type: "base64", mimeType: inlineMimeType, data: inline.data.trim() });
        continue;
      }
      if (typeof entry.text === "string") {
        const pattern = /!\[[^\]]*\]\(data:(image\/[^;,]+);base64,([^)]+)\)/g;
        let match: RegExpExecArray | null = pattern.exec(entry.text);
        while (match !== null) {
          assets.push({ mediaType: "image", type: "base64", mimeType: match[1], data: match[2].replace(/\s+/g, "") });
          match = pattern.exec(entry.text);
        }
      }
    }
  }
  return assets;
}

async function waitGptImageTask(ctx: Context, apiKey: string, taskId: string): Promise<MediaAsset[]> {
  const deadline = Date.now() + pollDeadlineMs;
  let queryFailures = 0;
  await delay(10000, ctx.signal);
  for (;;) {
    if (Date.now() > deadline) throw new Error("等待图片任务超时，可在平台按任务编号 " + taskId + " 查看结果");
    let json: unknown;
    try {
      json = await requestJson(ctx, apiBase + "/v1/tasks/" + encodeURIComponent(taskId),
        { method: "GET", headers: authHeaders(apiKey) }, Math.min(60000, Math.max(1, deadline - Date.now())), "查询图片任务");
      queryFailures = 0;
    } catch (error) {
      ctx.signal?.throwIfAborted();
      // 只重试已知任务的 GET 查询；POST 提交从不重试。
      if (!(error as { transientQuery?: boolean })?.transientQuery || queryFailures >= 3) throw error;
      const retryDelay = 3000 * 2 ** queryFailures++;
      if (Date.now() + retryDelay >= deadline) throw error;
      await delay(retryDelay, ctx.signal);
      continue;
    }
    const root = asObject(json);
    const data = asObject(root?.data) ?? root;
    if (!data) throw new Error("查询图片任务返回的结构无法识别");
    const status = typeof data.status === "string" ? data.status.toLowerCase() : "";
    if (status === "failed" || status === "error") {
      const errorObj = asObject(data.error);
      const message = errorObj && typeof errorObj.message === "string" && errorObj.message.trim() ? errorObj.message : "平台返回任务失败";
      throw Object.assign(new Error("图片生成失败：" + message), { code: "MEDIA_TASK_FAILED" });
    }
    if (status === "completed" || status === "succeeded" || status === "success") {
      const assets = extractGptImages(data);
      if (!assets.length) {
        const detail = errorText(ctx, json);
        throw new Error("任务已完成但没有返回可用图片" + (detail ? "：" + detail : ""));
      }
      return assets;
    }
    await delay(4000, ctx.signal);
  }
}


function extractDirectImages(json: unknown): MediaAsset[] {
  const root = asObject(json);
  if (!Array.isArray(root?.data)) return [];
  return root.data.flatMap((item: unknown): MediaAsset[] => {
    const image = asObject(item);
    if (isHttpUrl(image?.url)) return [{ mediaType: "image", type: "url", url: (image!.url as string).trim() }];
    if (typeof image?.b64_json === "string" && image.b64_json.trim()) {
      return [{ mediaType: "image", type: "base64", mimeType: "image/png", data: image.b64_json.trim() }];
    }
    return [];
  });
}

// 同步接口使用像素尺寸，档位映射采用供应商文档的尺寸表。
function syncImageSize(request: ImageRequest): string {
  const ratio = gptSizeRatio(request);
  if (/^\d{3,5}x\d{3,5}$/.test(ratio)) return ratio;
  const sizes: Record<string, string[]> = {
    "1:1": ["1024x1024", "2048x2048", "2880x2880"],
    "3:2": ["1536x1024", "2048x1360", "3520x2336"],
    "2:3": ["1024x1536", "1360x2048", "2336x3520"],
    "4:3": ["1024x768", "2048x1536", "3312x2480"],
    "3:4": ["768x1024", "1536x2048", "2480x3312"],
    "5:4": ["1280x1024", "2560x2048", "3216x2576"],
    "4:5": ["1024x1280", "2048x2560", "2576x3216"],
    "16:9": ["1536x864", "2048x1152", "3840x2160"],
    "9:16": ["864x1536", "1152x2048", "2160x3840"],
    "2:1": ["2048x1024", "2688x1344", "3840x1920"],
    "1:2": ["1024x2048", "1344x2688", "1920x3840"],
    "3:1": ["1881x836", "3072x1024", "3840x1280"],
    "1:3": ["887x1774", "1024x3072", "1280x3840"],
    "21:9": ["2016x864", "2688x1152", "3840x1648"],
    "9:21": ["864x2016", "1152x2688", "1648x3840"],
  };
  return sizes[ratio][["1k", "2k", "4k"].indexOf(gptResolution(request.size))];
}


async function syncEditRequest(ctx: Context, apiKey: string, fields: Record<string, unknown>, images: MediaInput[]): Promise<FetchOptions> {
  // ACT: 土豆未提供同步编辑字段示例；按 OpenAI multipart 协议推断，仅提交一次，不自动换接口。
  if (images.length > 16) throw Object.assign(new Error("同步图生图最多传入 16 张参考图"), { code: "MEDIA_TASK_FAILED" });
  const boundary = "toonflowImageEdit" + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const parts: BlobPart[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + String(value) + "\r\n");
  }
  let totalBytes = 0;
  for (const [index, image] of images.entries()) {
    ctx.signal?.throwIfAborted();
    const inline = await toInlineData(ctx, image);
    const mime = inline.mimeType.toLowerCase();
    const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>)[mime];
    if (!extension) throw Object.assign(new Error("同步图生图参考图请使用 PNG、JPEG 或 WebP"), { code: "MEDIA_TASK_FAILED" });
    if (inline.data.length > Math.ceil(50 * 1024 * 1024 / 3) * 4 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(inline.data)) {
      throw Object.assign(new Error("参考图内容无效或超过 50 MB"), { code: "MEDIA_TASK_FAILED" });
    }
    const bytes = new Uint8Array(Buffer.from(inline.data, "base64"));
    totalBytes += bytes.byteLength;
    if (!bytes.byteLength || bytes.byteLength > 50 * 1024 * 1024 || totalBytes > 100 * 1024 * 1024) {
      throw Object.assign(new Error("参考图不能为空，单图最多 50 MB，合计最多 100 MB"), { code: "MEDIA_TASK_FAILED" });
    }
    parts.push("--" + boundary + "\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"reference" + (index + 1) + "." + extension + "\"\r\nContent-Type: " + mime + "\r\n\r\n");
    parts.push(bytes, "\r\n");
  }
  parts.push("--" + boundary + "--\r\n");
  return {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "multipart/form-data; boundary=" + boundary },
    body: new Blob(parts),
  };
}

async function generateSyncImage(ctx: Context, apiKey: string, request: ImageRequest, prompt: string, images: MediaInput[]): Promise<MediaAsset[]> {
  const fields: Record<string, unknown> = {
    model: taskModels[request.model], prompt, size: syncImageSize(request),
    quality: gptQuality(request.other?.quality ?? request.quality, taskModels[request.model]), n: 1,
  };
  const options = images.length ? await syncEditRequest(ctx, apiKey, fields, images)
    : { method: "POST", headers: authHeaders(apiKey), body: JSON.stringify(fields) };
  const json = await requestJson(ctx, apiBase + (images.length ? "/v1/images/edits" : "/v1/images/generations"),
    options, pollDeadlineMs, images.length ? "同步图生图" : "同步图片生成");
  const imagesResult = extractDirectImages(json);
  if (!imagesResult.length) throw new Error("同步接口未返回可用图片，请检查平台结果，不要重复提交");
  return imagesResult;
}

async function generateTaskImage(ctx: Context, apiKey: string, request: ImageRequest, prompt: string, images: MediaInput[]): Promise<MediaAsset[]> {
  const body: Record<string, unknown> = {
    model: taskModels[request.model],
    prompt: request.other?.transparentBackground === true
      ? prompt + "\n\n输出要求：主体独立，背景使用真正的 Alpha 透明通道，主体空隙也透明；不要绘制棋盘格、白底或其他背景。"
      : prompt,
    size: request.ratio || "1:1",
    resolution: gptResolution(request.size),
    ...(request.other?.transparentBackground === true ? { background: "transparent" } : {}),
    ...(taskModels[request.model].startsWith("gpt-image-") ? { quality: gptQuality(request.other?.quality ?? request.quality, taskModels[request.model]) } : {}),
  };
  if (images.length > 0) {
    const references: string[] = [];
    for (const image of images) references.push(await uploadReferenceImage(ctx, apiKey, image));
    body.images = references;
  }
  const json = await requestJson(
    ctx,
    apiBase + "/v1/images/generations/async",
    { method: "POST", headers: authHeaders(apiKey), body: JSON.stringify(body) },
    120000,
    "提交图片任务",
  );
  const root = asObject(json);
  const data = asObject(root?.data) ?? root;
  const directImages = extractDirectImages(json);
  if (directImages.length) return directImages;
  const taskId = typeof data?.task_id === "string" ? data.task_id.trim() : typeof data?.id === "string" ? data.id.trim() : "";
  if (!taskId) {
    const detail = errorText(ctx, json);
    throw new Error("提交图片任务失败" + (detail ? "：" + detail : "，平台没有返回任务编号"));
  }
  const taskStatus = data && typeof data.status === "string" ? data.status.toLowerCase() : "";
  if (taskStatus === "failed") {
    const errorObj = data ? asObject(data.error) : null;
    const message = errorObj && typeof errorObj.message === "string" ? errorObj.message : "平台返回任务失败";
    throw Object.assign(new Error("图片生成失败：" + message), { code: "MEDIA_TASK_FAILED" });
  }
  await ctx.saveTaskData?.({ kind: "aiTudouGptImage", taskId });
  return await waitGptImageTask(ctx, apiKey, taskId);
}

async function generateNanoBanana(ctx: Context, apiKey: string, modelId: string, prompt: string, request: ImageRequest, images: MediaInput[]): Promise<MediaAsset[]> {
  const upstreamModel = geminiModels[modelId];
  if (!upstreamModel) throw new Error("不支持的模型：" + modelId);
  if (images.length > maxNanoImages) {
    throw new Error("Nano Banana 最多支持 " + maxNanoImages + " 张参考图，当前传入 " + images.length + " 张");
  }
  const parts: Record<string, unknown>[] = [];
  for (const image of images) {
    const inline = await toInlineData(ctx, image);
    parts.push({ inlineData: { mimeType: inline.mimeType, data: inline.data } });
  }
  parts.push({ text: prompt });
  const imageConfig: Record<string, unknown> = {};
  const ratio = nanoRatio(request.ratio);
  if (ratio) imageConfig.aspectRatio = ratio;
  const imageSize = nanoImageSize(request.size);
  if (imageSize) imageConfig.imageSize = imageSize;
  const generationConfig: Record<string, unknown> = { responseModalities: ["TEXT", "IMAGE"] };
  if (Object.keys(imageConfig).length > 0) generationConfig.imageConfig = imageConfig;
  const payload = { contents: [{ role: "user", parts }], generationConfig };
  const json = await requestJson(
    ctx,
    apiBase + "/v1beta/models/" + upstreamModel + ":generateContent",
    { method: "POST", headers: authHeaders(apiKey), body: JSON.stringify(payload) },
    10 * 60 * 1000,
    "图片生成",
  );
  const assets = extractNanoImages(json);
  if (assets.length === 0) {
    const detail = errorText(ctx, json);
    const feedback = asObject(asObject(json)?.promptFeedback);
    const blocked = feedback && typeof feedback.blockReason === "string" && feedback.blockReason.trim() ? feedback.blockReason : "";
    if (detail) throw new Error("接口没有返回图片：" + detail);
    if (blocked) throw new Error("请求被平台拦截：" + blocked);
    throw new Error("接口没有返回图片，请调整提示词或参考图后重试");
  }
  return assets;
}

export default {
  id: "aiTudou",
  label: "土豆 API（AI-Tudou）",
  version: "2.1.2",
  readme: "## 土豆 API 图片模型\n\n按 2026-11-17 用户指定列表提供 14 个图片模型。Gemini 使用原生 generateContent；gpt-image-2-all 及 -async 型号使用任务提交与查询；无 -async 后缀的 GPT 2.6 flare/sunburst 保留同步 generations/edits 兼容路径，官方图片文档未给出这两个同步型号的完整协议；2026-11-17已实测两个型号1K文生图，图生图未实测。\n\n异步图生图参考图仅传 HTTP(S) URL。本地图片自动上传到土豆官方图床 uploads.ai-tudou.net，单图最多 15 MB；返回链接公开可访问并保留 24 小时。Gemini 仍发送 inlineData，两个同步型号沿用 multipart image[]。不执行远端文件清理，不自动重提生图任务或切换付费模型。\n\nGPT 2.5 支持 low/medium/high/xhigh/max；其他 GPT 保留 low/medium/high。GPT 2.6 flare/sunburst 异步型号按平台 11月12日公告仅开放 1K/2K；无后缀同步型号已实测1K生成、通用2.6-async已实测1K/medium；其他档位未逐一验证。Grok 与 Seedream 使用各自文档比例，不发送 GPT 专属 quality。透明背景仅对 gpt-image-2.6-async 开放，默认开启且可手动关闭，旧节点明确保存的关闭状态仍保留：2026-11-17 实测1K/medium、background=transparent 返回真实RGBA PNG；flare/sunburst四个2.6通道接受background却返回RGB，而且output_format=png会400。不向其他型号宣称透明支持，不自动抠图。\n\n旧 Gemini、GPT Image 2 内部 ID 保留，以兼容原画布。活动价、flash-lite、Ideogram 不再列出或用于新请求；已有任务仍可凭任务 ID 查询恢复。\n\n文档：https://api.ai-tudou.net/docs/gpt-image-2\nhttps://api.ai-tudou.net/docs/gpt-image-2-5-new-docs\nhttps://api.ai-tudou.net/docs/nano-banana\nhttps://api.ai-tudou.net/docs/grok-image-2-async-docs\nhttps://api.ai-tudou.net/docs/seedream-5-0-pro-async-docs\nhttps://api.ai-tudou.net/docs/seedream-5-5-async-docs\nhttps://api.ai-tudou.net/docs/uploads",
  rules: [
    {
      type: "input",
      field: "apiKey",
      title: "API Key",
      value: "",
      props: { type: "password", showPassword: true, autocomplete: "off", placeholder: "在土豆 API 平台生成的访问密钥" },
    },
  ],
  models: [
  {
    "id": "nanoBananaPro",
    "label": "gemini-3-pro-image-preview",
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
      "21:9"
    ],
    "mode": [
      "text",
      "singleImage",
      "multiReference"
    ]
  },
  {
    "id": "nanoBanana2",
    "label": "gemini-3.1-flash-image-preview",
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
      "21:9"
    ],
    "mode": [
      "text",
      "singleImage",
      "multiReference"
    ]
  },
  {
    "id": "gemini-nano-banana-2.1",
    "label": "gemini-nano-banana-2.1",
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
      "21:9"
    ],
    "mode": [
      "text",
      "singleImage",
      "multiReference"
    ]
  },
  {
    "id": "gptImage2All",
    "label": "gpt-image-2-all",
    "type": "image",
    "imageSizes": [
      "1K",
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
        "type": "el-radio-group",
        "field": "quality",
        "title": "质量档位",
        "value": "medium",
        "props": {},
        "children": [
          {
            "type": "el-radio-button",
            "props": {
              "value": "low"
            },
            "children": [
              "低"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "medium"
            },
            "children": [
              "中"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "high"
            },
            "children": [
              "高"
            ]
          }
        ],
        "class": "qualityChoices"
      }
    ]
  },
  {
    "id": "gpt-image-2.5-flare-async",
    "label": "gpt-image-2.5-flare-async",
    "type": "image",
    "imageSizes": [
      "1K",
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
        "type": "el-radio-group",
        "field": "quality",
        "title": "质量档位",
        "value": "medium",
        "props": {},
        "children": [
          {
            "type": "el-radio-button",
            "props": {
              "value": "low"
            },
            "children": [
              "低"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "medium"
            },
            "children": [
              "中"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "high"
            },
            "children": [
              "高"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "xhigh"
            },
            "children": [
              "超高"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "max"
            },
            "children": [
              "最高"
            ]
          }
        ],
        "class": "qualityChoices"
      }
    ]
  },
  {
    "id": "gpt-image-2.5-sunburst-async",
    "label": "gpt-image-2.5-sunburst-async",
    "type": "image",
    "imageSizes": [
      "1K",
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
        "type": "el-radio-group",
        "field": "quality",
        "title": "质量档位",
        "value": "medium",
        "props": {},
        "children": [
          {
            "type": "el-radio-button",
            "props": {
              "value": "low"
            },
            "children": [
              "低"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "medium"
            },
            "children": [
              "中"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "high"
            },
            "children": [
              "高"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "xhigh"
            },
            "children": [
              "超高"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "max"
            },
            "children": [
              "最高"
            ]
          }
        ],
        "class": "qualityChoices"
      }
    ]
  },
  {
    "id": "gpt-image-2.6-async",
    "label": "gpt-image-2.6-async",
    "type": "image",
    "imageSizes": [
      "1K",
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
        "type": "el-radio-group",
        "field": "quality",
        "title": "质量档位",
        "value": "medium",
        "props": {},
        "children": [
          {
            "type": "el-radio-button",
            "props": {
              "value": "low"
            },
            "children": [
              "低"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "medium"
            },
            "children": [
              "中"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "high"
            },
            "children": [
              "高"
            ]
          }
        ],
        "class": "qualityChoices"
      },
      {
        "type": "switch",
        "field": "transparentBackground",
        "title": "透明背景",
        "value": true,
        "props": {
          "activeText": "开启",
          "inactiveText": "关闭"
        },
        "info": "默认开启，可手动关闭。建议先用已实测的 1K、中质量；生成并保存透明背景原图。旧节点若曾关闭此选项，需手动开启。"
      }
    ]
  },
  {
    "id": "gpt-image-2.6-flare",
    "label": "gpt-image-2.6-flare",
    "type": "image",
    "imageSizes": [
      "1K",
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
        "type": "el-radio-group",
        "field": "quality",
        "title": "质量档位",
        "value": "medium",
        "props": {},
        "children": [
          {
            "type": "el-radio-button",
            "props": {
              "value": "low"
            },
            "children": [
              "低"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "medium"
            },
            "children": [
              "中"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "high"
            },
            "children": [
              "高"
            ]
          }
        ],
        "class": "qualityChoices"
      }
    ]
  },
  {
    "id": "gpt-image-2.6-flare-async",
    "label": "gpt-image-2.6-flare-async",
    "type": "image",
    "imageSizes": [
      "1K",
      "2K"
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
        "type": "el-radio-group",
        "field": "quality",
        "title": "质量档位",
        "value": "medium",
        "props": {},
        "children": [
          {
            "type": "el-radio-button",
            "props": {
              "value": "low"
            },
            "children": [
              "低"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "medium"
            },
            "children": [
              "中"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "high"
            },
            "children": [
              "高"
            ]
          }
        ],
        "class": "qualityChoices"
      }
    ]
  },
  {
    "id": "gpt-image-2.6-sunburst",
    "label": "gpt-image-2.6-sunburst",
    "type": "image",
    "imageSizes": [
      "1K",
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
        "type": "el-radio-group",
        "field": "quality",
        "title": "质量档位",
        "value": "medium",
        "props": {},
        "children": [
          {
            "type": "el-radio-button",
            "props": {
              "value": "low"
            },
            "children": [
              "低"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "medium"
            },
            "children": [
              "中"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "high"
            },
            "children": [
              "高"
            ]
          }
        ],
        "class": "qualityChoices"
      }
    ]
  },
  {
    "id": "gpt-image-2.6-sunburst-async",
    "label": "gpt-image-2.6-sunburst-async",
    "type": "image",
    "imageSizes": [
      "1K",
      "2K"
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
        "type": "el-radio-group",
        "field": "quality",
        "title": "质量档位",
        "value": "medium",
        "props": {},
        "children": [
          {
            "type": "el-radio-button",
            "props": {
              "value": "low"
            },
            "children": [
              "低"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "medium"
            },
            "children": [
              "中"
            ]
          },
          {
            "type": "el-radio-button",
            "props": {
              "value": "high"
            },
            "children": [
              "高"
            ]
          }
        ],
        "class": "qualityChoices"
      }
    ]
  },
  {
    "id": "grok-image-2-async",
    "label": "grok-image-2-async",
    "type": "image",
    "imageSizes": [
      "1K",
      "2K",
      "4K"
    ],
    "imageRatios": [
      "1:1",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "16:9",
      "9:16",
      "2:1",
      "1:2",
      "19.5:9",
      "9:19.5",
      "20:9",
      "9:20"
    ],
    "mode": [
      "text",
      "singleImage",
      "multiReference"
    ]
  },
  {
    "id": "seedream-5.0-pro-async",
    "label": "seedream-5.0-pro-async",
    "type": "image",
    "imageSizes": [
      "1K",
      "2K",
      "4K"
    ],
    "imageRatios": [
      "1:1",
      "4:3",
      "3:4",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "21:9",
      "9:21"
    ],
    "mode": [
      "text",
      "singleImage",
      "multiReference"
    ]
  },
  {
    "id": "seedream-5.5-async",
    "label": "seedream-5.5-async",
    "type": "image",
    "imageSizes": [
      "1K",
      "2K",
      "4K"
    ],
    "imageRatios": [
      "1:1",
      "21:9",
      "16:9",
      "3:2",
      "5:4",
      "4:5",
      "2:3",
      "9:16",
      "9:21"
    ],
    "mode": [
      "text",
      "singleImage",
      "multiReference"
    ]
  }
],
  async generateImage(this: Context, request: ImageRequest): Promise<MediaAsset[]> {
    const apiKey = requireApiKey(this);
    const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "";
    if (!prompt) throw new Error("请填写提示词");
    if (request.mask) throw new Error("当前适配器不支持蒙版输入");
    if (request.n !== undefined && request.n !== 1) throw new Error("当前适配器一次只能生成一张图片");
    const model = typeof request.model === "string" ? request.model.trim() : "";
    const upstreamModel = Object.hasOwn(taskModels, model) ? taskModels[model]
      : Object.hasOwn(geminiModels, model) ? geminiModels[model] : undefined;
    if (!upstreamModel) throw new Error("不支持或已下架的模型：" + model + "，请重新选择模型");
    const limits = modelLimits(upstreamModel);
    const size = typeof request.size === "string" && request.size.trim() ? request.size.trim().toUpperCase() : "2K";
    if (!limits.sizes.includes(size)) throw new Error("该模型清晰度只支持：" + limits.sizes.join("、"));
    const ratio = typeof request.ratio === "string" && request.ratio.trim() ? request.ratio.trim() : "1:1";
    if (!limits.ratios.includes(ratio)) throw new Error("该模型比例只支持：" + limits.ratios.join("、"));
    if (request.other !== undefined && (!request.other || typeof request.other !== "object" || Array.isArray(request.other))) throw new Error("图片生成配置格式无效");
    const other: Record<string, unknown> = { ...(upstreamModel === "gpt-image-2.6-async" ? { transparentBackground: true } : {}), ...request.other };
    const isGpt = upstreamModel.startsWith("gpt-image-");
    const unknownFields = Object.keys(other).filter(key => !["quality", "transparentBackground"].includes(key));
    if (unknownFields.length) throw new Error("该模型不支持额外参数：" + unknownFields.join("、"));
    if (other.transparentBackground !== undefined && typeof other.transparentBackground !== "boolean") throw new Error("透明背景开关必须是布尔值");
    if (other.transparentBackground === true && upstreamModel !== "gpt-image-2.6-async") throw new Error("当前仅 gpt-image-2.6-async 已验证透明背景，请选择该型号");
    if (isGpt) gptQuality(other.quality ?? request.quality, upstreamModel);
    else if (other.quality !== undefined || request.quality !== undefined) throw new Error("该模型不支持质量档位参数");
    if (request.outputFormat !== undefined && !(upstreamModel === "gpt-image-2.6-async" && typeof request.outputFormat === "string" && request.outputFormat.toLowerCase() === "png")) throw new Error("该模型不支持此输出格式；透明图片请使用 gpt-image-2.6-async 和 PNG");
    const images = request.images ?? [];
    if (!Array.isArray(images)) throw new Error("参考图必须是数组");
    const normalized = { ...request, model, size, ratio, other };
    if (Object.hasOwn(taskModels, model)) {
      const upstreamModel = taskModels[model];
      const generate = upstreamModel.endsWith("-async") || upstreamModel === "gpt-image-2-all" ? generateTaskImage : generateSyncImage;
      return await generate(this, apiKey, normalized, prompt, images);
    }
    if (Object.hasOwn(geminiModels, model)) {
      return await generateNanoBanana(this, apiKey, model, prompt, normalized, images);
    }
    throw new Error("不支持的模型：" + model);
  },
  async resumeTask(this: Context, data: ProviderTaskData): Promise<MediaAsset[]> {
    const apiKey = requireApiKey(this);
    const kind = data.kind;
    const taskId = data.taskId;
    if (kind !== "aiTudouGptImage") throw new Error("无法恢复该任务：任务类型不匹配");
    if (typeof taskId !== "string" || !taskId.trim()) throw new Error("无法恢复该任务：缺少任务编号");
    return await waitGptImageTask(this, apiKey, taskId.trim());
  },
};
