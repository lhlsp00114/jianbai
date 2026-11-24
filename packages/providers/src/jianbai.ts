export const jianbaiId = "tokenGo";
export const jianbaiOrigin = "https://jianbai.token6688.com";
export const jianbaiTextModel = { id: "gt-5.6-sol", label: "GT-5.6 Sol", contextWindow: 400000,
  reasoningEfforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh" } };
export const jianbaiTextModels = [
  jianbaiTextModel,
  { id: "gpt-6.2-astra", label: "GT-6.2 Astra", contextWindow: 1050000 },
  { id: "gpt-6.2-sol", label: "GT-6.2 Sol", contextWindow: 1050000 },
  { id: "gpt-6.1-sol", label: "GT-6.1 Sol", contextWindow: 1050000 },
  { id: "gpt-6.1-terra", label: "GT-6.1 Terra", contextWindow: 1050000 },
  { id: "gpt-6-sol", label: "GT-6 Sol", contextWindow: 1050000 },
  { id: "gpt-6-astra", label: "GT-6 Astra", contextWindow: 1050000 },
  { id: "gpt-6-luna", label: "GT-6 Luna", contextWindow: 1050000 },
  { id: "claude-opus-5-5", label: "CL Opus 5.5", contextWindow: 1000000 },
  { id: "claude-opus-5", label: "CL Opus 5", contextWindow: 1000000 },
  { id: "claude-opus-4-8", label: "CL Opus 4.8", contextWindow: 1000000 },
  { id: "claude-opus-4-7", label: "CL Opus 4.7", contextWindow: 1000000 },
  { id: "claude-opus-4-6", label: "CL Opus 4.6", contextWindow: 1000000 },
  { id: "claude-sonnet-5-5", label: "CL Sonnet 5.5", contextWindow: 1000000 },
  { id: "claude-sonnet-5", label: "CL Sonnet 5", contextWindow: 1000000 },
  { id: "claude-sonnet-4-6", label: "CL Sonnet 4.6", contextWindow: 1000000 },
  { id: "claude-fable-5-2", label: "CL Fable 5.2", contextWindow: 1000000 },
  { id: "claude-fable-5-1", label: "CL Fable 5.1", contextWindow: 1000000 },
  { id: "claude-fable-5", label: "CL Fable 5", contextWindow: 1000000 },
  { id: "claude-haiku-5-5", label: "CL Haiku 5.5", contextWindow: 1000000 },
  { id: "claude-haiku-4-5", label: "CL Haiku 4.5", contextWindow: 200000 },
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", contextWindow: 1048576 },
  { id: "deepseek-v4.1-flash-1017", label: "DeepSeek V4.1 Flash (1017)", contextWindow: 1048576 },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", contextWindow: 1048576 },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", contextWindow: 1048576 },
  { id: "deepseek-v4-pro-0813", label: "DeepSeek V4 Pro (0813)", contextWindow: 1048576 },
];

function getLegacyKey(settings: Record<string, unknown>) {
  const configs = settings.mediaProviderConfigs as Record<string, { apiKey?: unknown }> | undefined;
  const providers = Array.isArray(settings.customProviders) ? settings.customProviders : [];
  const keys = [configs?.[jianbaiId]?.apiKey, providers.find(item => item?.id === jianbaiId)?.apiKey];
  for (const value of keys) {
    if (typeof value !== "string") continue;
    const key = value.trim().replace(/^Bearer\s+/i, "").trim();
    if (key) return key;
  }
  return "";
}

export function getJianbaiTextProvider(settings: Record<string, unknown>): {
  id: string; label: string; apiUrl: string; apiKey: string; protocol: "openai-responses";
  models: { id: string; label: string }[];
} | undefined {
  const apiKey = getJianbaiApiKey(settings);
  if (!apiKey) return undefined;
  const providers = Array.isArray(settings.customProviders) ? settings.customProviders : [];
  const current = providers.find(item => item?.id === jianbaiId);
  const models: { id: string; label: string }[] = Array.isArray(current?.models) ? current.models : [];
  return { ...current, id: jianbaiId, label: "见白 AI", apiUrl: jianbaiOrigin + "/v1", apiKey,
    protocol: "openai-responses", models: [...models, ...jianbaiTextModels.filter(model => !models.some(item => item.id === model.id))] };
}

export const jianbaiRoutes = [
  { id: "smart", label: "智能调度", description: "综合价格、成功率和延迟，自动选择渠道" },
  { id: "price", label: "价格优先", description: "优先选择价格更低的渠道" },
  { id: "stable", label: "稳定优先", description: "优先选择成功率高、稳定的渠道" },
  { id: "speed", label: "速度优先", description: "优先选择响应更快的渠道" },
  { id: "quality", label: "质量优先", description: "优先选择输出质量更好的渠道" },
] as const;
export type JianbaiRouteId = typeof jianbaiRoutes[number]["id"];
export function getJianbaiRoutes(settings: Record<string, unknown>) {
  const configs = settings.mediaProviderConfigs as Record<string, { routeKeys?: Partial<Record<JianbaiRouteId, string>>; activeRoute?: string }> | undefined;
  const config = configs?.[jianbaiId];
  const activeRoute = jianbaiRoutes.find(route => route.id === config?.activeRoute)?.id ?? "smart";
  const routeKeys = Object.fromEntries(jianbaiRoutes.map(route => {
    const value = config?.routeKeys?.[route.id];
    return [route.id, typeof value === "string" ? value.trim().replace(/^Bearer\s+/i, "").trim() : ""];
  })) as Record<JianbaiRouteId, string>;
  if (!config?.routeKeys) routeKeys.smart = getLegacyKey(settings);
  return { activeRoute, routeKeys };
}
export function getJianbaiApiKey(settings: Record<string, unknown>) {
  const { activeRoute, routeKeys } = getJianbaiRoutes(settings);
  return routeKeys[activeRoute];
}
