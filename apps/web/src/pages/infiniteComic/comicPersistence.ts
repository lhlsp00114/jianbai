import axios from "axios";
import useWorkspaceFiles, { type TextSnapshot } from "@/lib/workspaceFiles";
import { comicFileName, readComicProject, type ComicProject } from "./comicProject";

export const comicBackupName = "comicProjectBackup.json";
export const comicFolderRoot = "toonflowComics";
type Files = ReturnType<typeof useWorkspaceFiles>;
const comicFilePattern = /^comicProject(?:[2-9]|[1-9]\d+)?\.json$/;
const comicStoragePattern = /^(?:comicProject(?:[2-9]|[1-9]\d+)?(?:Backup)?|comicdamaged[0-9a-f]{32})\.json$/i;

function comicStorageName(path: string) {
  const parts = path.split("/");
  const name = parts.pop() ?? "";
  if (!parts.length) return name;
  return parts[0] === comicFolderRoot && parts.every(part => part && part !== "." && part !== ".." && !/[\\:\x00-\x1f]/.test(part)) ? name : "";
}

export function isComicFile(path: unknown): path is string {
  return typeof path === "string" && comicFilePattern.test(comicStorageName(path));
}

export function isComicStoragePath(path: string) {
  return path === comicFolderRoot || path.startsWith(`${comicFolderRoot}/`) || comicStoragePattern.test(comicStorageName(path));
}

function backupPath(path: string) {
  return path === comicFileName ? comicBackupName : `${path.slice(0, -5)}Backup.json`;
}

export async function readComicSnapshot(files: Files, path = comicFileName) {
  let snapshot: TextSnapshot | undefined;
  let invalid = "主文件不存在";
  try { snapshot = await files.readTextSnapshot(path); }
  catch (error) { if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error; }
  if (snapshot) {
    let value: unknown;
    try { value = JSON.parse(snapshot.text); }
    catch { invalid = "主文件 JSON 格式无效"; }
    if (value && typeof value === "object") {
      if ("toonflowCanvas" in value && value.toonflowCanvas === true) throw new Error("该文件是画布文件，未用漫画备份覆盖");
      if ("toonflowComic" in value && value.toonflowComic === true && "schemaVersion" in value
        && typeof value.schemaVersion === "number" && value.schemaVersion > 1) throw new Error("该漫画文件版本较新，请升级 Toonflow 后打开；原文件未覆盖");
    }
    try { return { project: readComicProject(value), snapshot, recovered: false }; }
    catch (error) { invalid = error instanceof Error ? error.message : "主文件格式无效"; }
  }
  let backup: TextSnapshot;
  try { backup = await files.readTextSnapshot(backupPath(path)); }
  catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error;
    throw new Error(`${invalid}，且没有可读取的有效备份；原文件未覆盖`);
  }
  try { return { project: readComicProject(JSON.parse(backup.text)), snapshot, recovered: true }; }
  catch { throw new Error(`${invalid}，且备份文件格式无效；原文件未覆盖`); }
}

export async function writeComicBackup(files: Files, text: string, path: string) {
  readComicProject(JSON.parse(text));
  const backup = backupPath(path);
  let snapshot: TextSnapshot;
  try { snapshot = await files.readTextSnapshot(backup); }
  catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error;
    await files.write(backup, text, true);
    return;
  }
  await files.writeTextSnapshot(backup, text, snapshot);
}

export async function restoreComicSnapshot(files: Files, state: { project: ComicProject; snapshot?: TextSnapshot }, path: string) {
  for (const page of [...state.project.pages, ...state.project.creation.draftPages]) {
    if (!page.task) continue;
    page.task.submitted = undefined;
    page.task.cancelled = true;
    page.task.remaining = 1;
    page.error = "此任务来自历史备份，提交状态可能已变化；仅查询当前任务，不自动补提剩余请求。";
  }
  const text = JSON.stringify(state.project, null, 2) + "\n";
  if (state.snapshot) {
    const folderPrefix = path.slice(0, path.lastIndexOf("/") + 1);
    await files.write(`${folderPrefix}comicDamaged${crypto.randomUUID().replaceAll("-", "")}.json`, state.snapshot.text, true);
    const revision = await files.writeTextSnapshot(path, text, state.snapshot);
    return { ...state.snapshot, text, revision };
  }
  await files.write(path, text, true);
  return files.readTextSnapshot(path);
}
