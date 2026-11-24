import { readdir, stat } from "@toonflow/file";
import { join, relative, sep } from "node:path";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", validateFields({ directory: z.string().min(1).max(4096), path: z.string().max(4096).optional(), includeModifiedAt: z.enum(["true"]).optional() }, "query"), async (req, res) => {
  const { directory, path } = await u.workspaceFile.resolveWorkspaceFile(req, req.query.directory as string, (req.query.path as string | undefined) ?? "");
  const entries = await readdir(path, { withFileTypes: true });
  const listedEntries = await Promise.all(entries.filter(entry => entry.isFile() || entry.isDirectory()).map(async entry => {
    const modifiedAt = req.query.includeModifiedAt === "true" && entry.isFile() ? (await stat(join(path, entry.name))).mtimeMs : undefined;
    return {
      name: entry.name,
      path: relative(directory, join(path, entry.name)).split(sep).join("/"),
      type: entry.isDirectory() ? "directory" as const : "file" as const,
      ...(modifiedAt === undefined ? {} : { modifiedAt }),
    };
  }));
  res.set("Cache-Control", "no-store").json(success({
    directory,
    empty: entries.length === 0,
    entries: listedEntries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true })),
  }));
});
