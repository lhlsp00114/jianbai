export const jianbaiId = "tokenGo";
export const jianbaiOrigin = "https://jianbai.token6688.com";
export const jianbaiTextModel = { id: "gt-5.6-sol", label: "GT-5.6 Sol", contextWindow: 400000,
  reasoningEfforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh" } };

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
  return { ...current, id: jianbaiId, label: "见白 AI", apiUrl: jianbaiOrigin + "/v1", apiKey,
    protocol: "openai-responses", models: current?.models ?? [jianbaiTextModel] };
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
