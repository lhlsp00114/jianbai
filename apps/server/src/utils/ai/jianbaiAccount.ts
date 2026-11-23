import { z } from "zod";
import conf from "@/utils/conf";
import { getJianbaiApiKey } from "@toonflow/providers/jianbai";

const apiOrigin = "https://jianbai.token6688.com";

export function getJianbaiAccountKey() {
  return getJianbaiApiKey(conf.get("settings", {}));
}

export async function requestJianbai(path: string, apiKey: string, fetchRequest = fetch) {
  const key = apiKey.trim().replace(/^Bearer\s+/i, "");
  if (!key) throw Object.assign(new Error("请先配置见白 AI API 密钥"), { status: 400 });
  let response: Response;
  try {
    response = await fetchRequest(apiOrigin + path, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12000),
      redirect: "error",
    });
  } catch {
    throw Object.assign(new Error("无法连接见白 AI，请稍后重试"), { status: 502 });
  }
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403 ? "见白 AI 密钥无效或缺少对应权限" : `见白 AI 请求失败（HTTP ${response.status}）`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return response.json();
}

const balanceSchema = z.object({ balance: z.number(), unit: z.string(), is_active: z.boolean().optional() });
export async function getJianbaiBalance(apiKey: string, fetchRequest = fetch) {
  const result = balanceSchema.parse(await requestJianbai("/v1/user/balance", apiKey, fetchRequest));
  if (result.is_active === false) throw Object.assign(new Error("见白 AI 密钥已停用"), { status: 403 });
  return { balance: result.balance, unit: result.unit };
}
