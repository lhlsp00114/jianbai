import { Router } from "express";
import { extname } from "node:path";
import { stat } from "@toonflow/file";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({
  directory: z.string().min(1).max(4096), path: z.string().min(1).max(4096),
  name: z.string().trim().min(1).max(256), prompt: z.string().max(100000).optional(), taskId: z.uuid().optional(),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  if (!u.workspace.isLocalHostRequest(req)) throw Object.assign(new Error("发送到 Eagle 仅支持本机访问"), { status: 403 });
  const { directory, path, name, prompt, taskId } = req.body;
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  const file = await u.workspaceFile.resolveWorkspacePath(cwd, path);
  if (!(await stat(file.path)).isFile() || !/\.(png|jpe?g|webp|gif|avif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v)$/i.test(extname(file.path))) {
    throw Object.assign(new Error("请选择工作区中的图片或视频文件"), { status: 400 });
  }
  const annotation = taskId ? await u.mediaTasks.promptForOutput(cwd, taskId, path, u.multiTenant.requestIdentity(req)) : prompt ?? "";
  let response: Response;
  try {
    response = await fetch("http://127.0.0.1:41595/api/item/addFromPath", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: file.path, name, annotation }),
      signal: AbortSignal.timeout(60000), redirect: "error",
    });
  } catch (cause) {
    const code = (cause as { code?: string }).code;
    throw new Error(code === "ECONNREFUSED" ? "请先打开 Eagle 软件，再发送素材" : "未收到 Eagle 的导入确认，请先检查 Eagle 中是否已导入，避免重复发送");
  }
  const result = await response.json() as { status?: string; message?: string; error?: string };
  if (!response.ok || result.status !== "success") throw new Error(result.message || result.error || "Eagle 导入失败，请确认已打开素材库");
  res.json(success());
});
