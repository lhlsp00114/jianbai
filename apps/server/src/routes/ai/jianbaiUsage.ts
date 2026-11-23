import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { getJianbaiAccountKey, requestJianbai } from "@/utils/ai/jianbaiAccount";
import u from "@/utils";

const usageSchema = z.object({
  data: z.array(z.object({
    created_at: z.string(),
    type: z.string(),
    model: z.string().nullish(),
    feature: z.string().nullish(),
    cost: z.object({ credits: z.number() }),
  })),
  next_cursor: z.string().nullish(),
});

export default Router().get("/", validateFields({ cursor: z.string().max(2048).optional() }, "query"), async (req, res) => {
  u.multiTenant.requireDirectModelAccess();
  u.mcpControl.assertAppRequest(req);
  const params = new URLSearchParams({ size: "20" });
  if (typeof req.query.cursor === "string" && req.query.cursor) params.set("cursor", req.query.cursor);
  const result = usageSchema.parse(await requestJianbai(`/v1/skills/usage?${params}`, getJianbaiAccountKey()));
  res.set("Cache-Control", "no-store").json(success({
    entries: result.data.map(item => ({ date: item.created_at, type: item.type, item: item.model ?? item.feature, credits: item.cost.credits })),
    nextCursor: result.next_cursor ?? null,
  }));
});
