import axios from "axios";
import useWorkspaceFiles, { type TextSnapshot } from "@/lib/workspaceFiles";
import { comicFileName, readComicProject, type ComicProject } from "./comicProject";

export const comicBackupName = "comicProjectBackup.json";
type Files = ReturnType<typeof useWorkspaceFiles>;

export async function readComicSnapshot(files: Files) {
  let snapshot: TextSnapshot | undefined;
  let invalid = "主文件不存在";
  try { snapshot = await files.readTextSnapshot(comicFileName); }
  catch (error) { if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error; }
  if (snapshot) {
    try { return { project: readComicProject(JSON.parse(snapshot.text)), snapshot, recovered: false }; }
    catch (error) { invalid = error instanceof Error ? error.message : "主文件格式无效"; }
  }
  try {
    const backup = await files.readTextSnapshot(comicBackupName);
    return { project: readComicProject(JSON.parse(backup.text)), snapshot, recovered: true };
  } catch { throw new Error(`${invalid}，且没有可读取的有效备份；原文件未覆盖`); }
}

export async function writeComicBackup(files: Files, text: string) {
  readComicProject(JSON.parse(text));
  let snapshot: TextSnapshot;
  try { snapshot = await files.readTextSnapshot(comicBackupName); }
  catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error;
    await files.write(comicBackupName, text, true);
    return;
  }
  await files.writeTextSnapshot(comicBackupName, text, snapshot);
}

export async function restoreComicSnapshot(files: Files, state: { project: ComicProject; snapshot?: TextSnapshot }) {
  for (const page of [...state.project.pages, ...state.project.creation.draftPages]) {
    if (!page.task) continue;
    page.task.submitted = undefined;
    page.task.cancelled = true;
    page.task.remaining = 1;
    page.error = "此任务来自历史备份，提交状态可能已变化；仅查询当前任务，不自动补提剩余请求。";
  }
  const text = JSON.stringify(state.project, null, 2) + "\n";
  if (state.snapshot) {
    await files.write(`comicDamaged${crypto.randomUUID().replaceAll("-", "")}.json`, state.snapshot.text, true);
    const revision = await files.writeTextSnapshot(comicFileName, text, state.snapshot);
    return { ...state.snapshot, text, revision };
  }
  await files.write(comicFileName, text, true);
  return files.readTextSnapshot(comicFileName);
}
