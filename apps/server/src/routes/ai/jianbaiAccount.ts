import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { getJianbaiAccountKey, getJianbaiBalance, requestJianbai } from "@/utils/ai/jianbaiAccount";
import u from "@/utils";

const modelSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

export default Router().post("/", validateFields({
  apiKey: z.string().trim().min(1).max(16384).optional(),
  scope: z.enum(["text", "media"]).optional(),
}), async (req, res) => {
  u.multiTenant.requireDirectModelAccess();
  u.mcpControl.assertAppRequest(req);
  res.set("Cache-Control", "no-store");
  const apiKey = req.body.apiKey ?? getJianbaiAccountKey();
  if (req.body.scope === "text") {
    const catalog = modelSchema.parse(await requestJianbai("/v1/models", apiKey));
    if (!catalog.data.some(model => model.id === "gpt-5.6-sol")) {
      throw Object.assign(new Error("此密钥的模型目录未包含 GT-5.6 Sol"), { status: 403 });
    }
    return res.json(success(null));
  }
  res.json(success(await getJianbaiBalance(apiKey)));
});
