const apiOrigin = "https://jianbai.token6688.com";
const flareId = "gt-image-2.5-flare";
const seedreamId = "doubao-seedream-5-5";
const seedanceId = "seedance-2-5";
const imagineProId = "gk-imagine-1-5-7tu-special";
const imageRatios = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "5:4", "4:5", "21:9"];

type Context = ProviderContext<{ apiKey?: string }>;
type TaskType = "image" | "video";
type ApiResponse = {
  task_id?: string;
  status?: string;
  is_final?: boolean;
  output_url?: string;
  url?: string;
  data?: { url?: string; original_url?: string }[];
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

async function generate(context: Context, model: string, mediaType: TaskType, params: Record<string, unknown>, operation?: string) {
  const { response, result } = await call(context, "/api/v1/model-runtime/invoke", {
    model_id: model,
    modality: mediaType,
    operation,
    params,
    client_request_id: crypto.randomUUID(),
  });
  if (!response.ok || !result?.task_id) {
    throw new Error("见白 AI 提交失败：" + (result?.error ? context.tool.errorMessage(result.error) : `HTTP ${response.status}，未取得任务号`));
  }
  await context.saveTaskData?.({ taskId: result.task_id, mediaType });
  return waitForTask(context, result.task_id, mediaType);
}

export default {
  id: "tokenGo",
  label: "见白 AI",
  version: "1.2.1",
  readme: "在见白 AI 的 API 密钥页面创建密钥，并为所用模型开启图片、视频权限。使用本地参考素材时还需开启文件权限，素材会上传到见白 AI。",
  rules: [{
    type: "input",
    field: "apiKey",
    title: "API 密钥",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  }],
  models: [
    {
      id: "gt-image-2.5-flare",
      label: "GT Image 2.5 Flare",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageSizes: ["1K", "2K", "4K"],
      imageRatios: ["1:1", "auto", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9", "9:21"],
    },
    {
      id: "doubao-seedream-5-5",
      label: "Seedream 5.5",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageSizes: ["2K"],
      imageRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "5:4", "4:5", "21:9"],
    },
    {
      id: "seedance-2-5",
      label: "Seedance 2.5 · 官方直连",
      type: "video",
      mode: ["text", "singleImage", "startEndRequired", ["imageReference:30", "videoReference:10", "audioReference:10"]],
      durationResolutionMap: [{
        duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
        resolution: ["480p", "720p", "1080p"],
      }],
    },
    {
      id: "gk-imagine-1-5-7tu-special",
      label: "GK Imagine 1.5 Pro",
      type: "video",
      mode: ["text", "singleImage", "startEndRequired", ["imageReference:7"]],
      audio: true,
      imageRatios: ["16:9", "9:16", "1:1"],
      durationResolutionMap: [{
        duration: [3, 4, 5, 6, 8, 10, 12, 15],
        resolution: ["480p", "720p"],
      }],
    },
  ],
  async generateImage(this: Context, request: ImageRequest) {
    if (request.model !== flareId && request.model !== seedreamId) throw new Error("未知的见白 AI 图片模型");
    if (request.mask) throw new Error("当前见白 AI 图片适配暂未开放蒙版编辑");
    const isFlare = request.model === flareId;
    const imageCount = request.images?.length ?? 0;
    const maxImages = isFlare ? 17 : 10;
    if (imageCount > maxImages) throw new Error(`此模型最多支持 ${maxImages} 张参考图`);
    if (!isFlare && request.ratio && !imageRatios.includes(request.ratio)) throw new Error("Seedream 5.5 不支持此宽高比");
    const images = await references(this, request.images);
    return generate(this, request.model, "image", {
      prompt: request.prompt,
      count: request.n ?? 1,
      mode: images.length > 1 ? "multi-reference" : images.length ? "image-edit" : "text-to-image",
      images,
      ...(isFlare ? {
        aspect_ratio: request.ratio,
        resolution: request.size,
        quality: request.quality,
        output_format: request.outputFormat === "png" || request.outputFormat === "jpeg" ? request.outputFormat : undefined,
      } : { size: request.ratio }),
    }, images.length ? "edit" : "generate");
  },
  async generateVideo(this: Context, request: VideoRequest) {
    const isImaginePro = request.model === imagineProId;
    if (!isImaginePro && request.model !== seedanceId) throw new Error("未知的见白 AI 视频模型");
    if (request.lastFrame && !request.firstFrame) throw new Error("首尾帧模式需要首帧");
    const frames = [request.firstFrame, request.lastFrame].filter((frame): frame is MediaInput => Boolean(frame));
    const hasReferences = Boolean(request.images?.length || request.videos?.length || request.audios?.length);
    if (frames.length && hasReferences) throw new Error("首尾帧和参考素材须分别提交");
    if (isImaginePro) {
      if (request.videos?.length || request.audios?.length) throw new Error("GK Imagine 1.5 Pro 仅支持图片参考");
      if ((request.images?.length ?? 0) > 7) throw new Error("GK Imagine 1.5 Pro 目前最多支持 7 张参考图");
    } else if ((request.images?.length ?? 0) > 30 || (request.videos?.length ?? 0) > 10 || (request.audios?.length ?? 0) > 10) {
      throw new Error("Seedance 2.5 最多支持 30 张参考图、10 段参考视频、10 段参考音频");
    }
    const mode = frames.length === 2 ? "first-last" : frames.length ? "first-frame" : hasReferences ? "reference" : "text-to-video";
    return generate(this, request.model, "video", {
      prompt: request.prompt,
      mode,
      duration: request.duration,
      resolution: request.resolution,
      aspect_ratio: request.ratio,
      images: await references(this, frames.length ? frames : request.images),
      videos: isImaginePro ? undefined : await references(this, request.videos),
      audios: isImaginePro ? undefined : await references(this, request.audios),
    });
  },
  async resumeTask(this: Context, data: ProviderTaskData) {
    if (typeof data.taskId !== "string" || (data.mediaType !== "image" && data.mediaType !== "video")) {
      throw new Error("见白 AI 任务恢复数据无效");
    }
    return waitForTask(this, data.taskId, data.mediaType);
  },
} satisfies ProviderDefinition;
