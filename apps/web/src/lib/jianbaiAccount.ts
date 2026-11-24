import { computed } from "vue";
import { settings, saveSettings, multiTenantEnabled, type CustomProvider } from "@/stores/settings";

import http from "@/lib/http";
import { jianbaiId, jianbaiTextModels, getJianbaiRoutes, type JianbaiRouteId, jianbaiOrigin, getJianbaiApiKey, getJianbaiTextProvider } from "@toonflow/providers/jianbai";
export { jianbaiId, jianbaiOrigin, jianbaiTextModels } from "@toonflow/providers/jianbai";
export const jianbaiDashboard = jianbaiOrigin + "/zh-CN/dashboard";
export const jianbaiTextProvider = computed(() => getJianbaiTextProvider(settings.value));
export const jianbaiTextConnected = computed(() => !!jianbaiMediaKey.value);
export const jianbaiMediaKey = computed(() => getJianbaiApiKey(settings.value));
export type JianbaiBalance = { balance: number; unit: string };
export type JianbaiUsage = {
  entries: { date: string; type: string; item?: string | null; credits: number }[];
  nextCursor: string | null;
};

export { jianbaiRoutes, type JianbaiRouteId } from "@toonflow/providers/jianbai";
export const jianbaiRouteConfig = computed(() => getJianbaiRoutes(settings.value));
export async function saveJianbaiRoute(routeId: JianbaiRouteId, apiKey: string, activate = false) {
  if (multiTenantEnabled.value) throw new Error("当前模式不支持配置个人密钥");
  const key = apiKey.trim().replace(/^Bearer\s+/i, "").trim();
  if (!key) throw new Error("请先填写该线路的 API 密钥");
  await http({ method: "POST", url: "/api/ai/jianbaiAccount", data: { apiKey: key } });
  return saveSettings(currentSettings => {
    if (multiTenantEnabled.value) throw new Error("当前模式不支持配置个人密钥");
    const routes = getJianbaiRoutes(currentSettings);
    if (activate && routes.routeKeys[routeId] !== key) throw new Error("线路密钥已变更，请重新启用");
    const routeKeys = { ...routes.routeKeys, [routeId]: key };
    const activeRoute = activate || !routes.routeKeys[routes.activeRoute] ? routeId : routes.activeRoute;
    const activeKey = routeKeys[activeRoute];
    const providers: CustomProvider[] = Array.isArray(currentSettings.customProviders) ? currentSettings.customProviders : [];
    const current = providers.find(item => item.id === jianbaiId);
    const provider: CustomProvider = { ...current, id: jianbaiId, label: "见白 AI", apiUrl: jianbaiOrigin + "/v1",
      apiKey: activeKey, protocol: "openai-responses", models: getJianbaiTextProvider(currentSettings)?.models ?? jianbaiTextModels };
    const configs = currentSettings.mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
    return {
      customProviders: current ? providers.map(item => item === current ? provider : item) : [...providers, provider],
      mediaProviderConfigs: { ...configs, [jianbaiId]: { ...configs?.[jianbaiId], apiKey: activeKey, routeKeys, activeRoute } },
    };
  });
}
