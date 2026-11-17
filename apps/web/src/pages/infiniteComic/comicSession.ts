import { effectScope, reactive, ref } from "vue";
import { useNodeAi, type NodeImageRequest, type NodeMediaResult } from "@toonflow/nodes-scaffold/nodeAi";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { comicFileName, type ComicPage, type ComicRequestRecord } from "./comicProject";
import { readComicSnapshot, restoreComicSnapshot, writeComicBackup } from "./comicPersistence";

const sessions = new Map<string, ReturnType<typeof createSession>>();

if (typeof window !== "undefined") window.addEventListener("beforeunload", event => {
  if (![...sessions.values()].some(session => session.active.size || session.batch.running || session.saveError.value || session.saveStatus.value === "保存中" || session.saveStatus.value === "待保存")) return;
  event.preventDefault(); event.returnValue = "";
});

export function getComicSession(directory: string) {
  let session = sessions.get(directory);
  if (!session) { session = createSession(directory); sessions.set(directory, session); }
  return session;
}

function createSession(directory: string) {
  const files = useWorkspaceFiles(directory);
  const scope = effectScope(true);
  const ai = scope.run(() => useNodeAi())!;
  const active = reactive(new Set<string>());
  const queued = reactive(new Set<string>());
  const cancelling = reactive(new Set<string>());
  const batch = reactive({ running: false, stopped: false, total: 0, completed: 0, failed: 0 });
  const message = ref("");
  const saveError = ref("");
  const saveStatus = ref("读取中");
  let queue = Promise.resolve();
  let savedText = "";
  function readState() {
    return readComicSnapshot(files).then(async state => {
      const snapshot = state.recovered ? await restoreComicSnapshot(files, state) : state.snapshot!;
      if (state.recovered) message.value = "主文件异常，已从上一份备份恢复；原损坏内容已另存保留。";
      const project = ref(state.project);
      savedText = JSON.stringify(project.value, null, 2) + "\n";
      saveStatus.value = "已保存";
      return { project, snapshot };
    });
  }
  let ready = readState();
  let loadFailed = false;
  void ready.catch(() => { loadFailed = true; });

  async function save() {
    const state = await ready;
    const pending = queue.catch(() => {}).then(async () => {
      const text = JSON.stringify(state.project.value, null, 2) + "\n";
      if (text === savedText) { saveError.value = ""; saveStatus.value = "已保存"; return; }
      saveStatus.value = "保存中";
      const disk = await files.readTextSnapshot(comicFileName);
      if (disk.revision !== state.snapshot.revision) throw new Error("项目已被其他窗口修改，当前内容已保留，未覆盖文件与备份");
      await writeComicBackup(files, state.snapshot.text);
      const revision = await files.writeTextSnapshot(comicFileName, text, state.snapshot);
      state.snapshot = { ...state.snapshot, revision, text }; savedText = text;
      saveError.value = ""; saveStatus.value = JSON.stringify(state.project.value, null, 2) + "\n" === savedText ? "已保存" : "待保存";
    }).catch(error => {
      saveStatus.value = "保存失败";
      saveError.value = error instanceof Error ? error.message : "保存失败";
      throw error;
    });
    queue = pending; return pending;
  }
  async function applyResult(page: ComicPage, task: NonNullable<ComicPage["task"]>, results: NodeMediaResult[]) {
    const images = results.filter(item => item.mediaType === "image").map(item => ({ id: crypto.randomUUID(), label: page.title, path: item.path, mimeType: item.mimeType, kind: "result" }));
    if (!images.length) throw new Error("任务未返回图片");
    if (!page.versions.some(version => version.id === task.id)) page.versions.unshift({ id: task.id, createdAt: new Date().toISOString(), images,
      prompt: task.prompt, model: task.input.modelId, ratio: task.input.ratio, size: task.input.size, request: task.request });
    await save();
  }
  async function execute(page: ComicPage, resume: boolean) {
    if (active.has(page.id) || !page.task) return;
    active.add(page.id);
    try {
      while (page.task) {
        const task: NonNullable<ComicPage["task"]> = page.task;
        let failed = false;
        try {
          task.startedAt ??= Date.now();
          await save();
          if (task.cancelled) break;
          const options = { taskId: task.id, nodeId: page.id, canvasPath: comicFileName,
            isCancelled: () => !!task.cancelled, onStatus: (status: { state?: string }) => { failed = status.state === "failed"; } };
          const shouldResume = resume && task.submitted !== false;
          if (!shouldResume) {
            task.submitted = true;
            try { await save(); } catch (error) { task.submitted = false; throw error; }
            if (task.cancelled) break;
          }
          const results = shouldResume ? await ai.resumeMedia(directory, task.id, undefined, { ...options, recoverCancelled: true })
            : await ai.generateImage({ ...task.input, directory }, undefined, options);
          await applyResult(page, task, results);
          if (task.cancelled || page.task?.id !== task.id) break;
          page.task = (task.remaining ?? 1) > 1 ? { ...task, id: crypto.randomUUID(), startedAt: undefined, submitted: false, remaining: task.remaining! - 1 } : null;
          page.error = "";
          try { await save(); } catch (error) { page.task = task; throw error; }
          resume = false;
        } catch (error) {
          if (failed || (error as { mediaTaskRejected?: boolean })?.mediaTaskRejected) {
            if (page.task?.id === task.id) page.task = null;
          }
          if (!task.cancelled) page.error = error instanceof Error ? error.message : "任务中断，请恢复查询";
          await save();
          throw error;
        }
      }
    } finally { active.delete(page.id); }
  }
  async function start(page: ComicPage, input: NodeImageRequest, request: ComicRequestRecord, count: number) {
    const state = await ready;
    if (!state.project.value.pages.includes(page)) throw new Error("页面已移除，未提交生成请求");
    if (page.task || active.has(page.id)) throw new Error("本页已有任务，请先恢复或停止");
    if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error("生成次数必须为 1–4");
    page.task = { id: crypto.randomUUID(), prompt: input.prompt, input: JSON.parse(JSON.stringify(input)), request: JSON.parse(JSON.stringify(request)), remaining: count, submitted: false };
    page.error = "";
    return execute(page, false);
  }
  async function recover(page: ComicPage) {
    if (!page.task || active.has(page.id) || cancelling.has(page.id)) return;
    page.task.cancelled = false;
    return execute(page, true);
  }
  async function cancel(page: ComicPage) {
    if (!page.task || cancelling.has(page.id)) return;
    const task = page.task;
    cancelling.add(page.id);
    try {
      task.cancelled = true;
      await save();
      if (task.submitted === false) { page.error = "未提交的生成已停止，可恢复或结束任务。"; await save(); return; }
      await ai.cancelMedia(directory, task.id);
      const status = await ai.readMediaTask(directory, task.id);
      if (status.state === "succeeded" && status.result?.data) await applyResult(page, task, status.result.data);
      if (!active.has(page.id) && status.state === "succeeded") {
        page.task = null;
        try { await save(); } catch (error) { page.task = task; throw error; }
      }
      page.error = "已停止后续生成，已完成图片保留；可查询恢复当前任务。";
      await save(); await save();
    } finally { cancelling.delete(page.id); }
  }
  async function finish(page: ComicPage) {
    if (!page.task || active.has(page.id) || cancelling.has(page.id)) return;
    const task = page.task;
    cancelling.add(page.id);
    try {
      if (task.submitted !== false) {
        const status = await ai.readMediaTask(directory, task.id);
        if (status.state === "succeeded" && status.result?.data) await applyResult(page, task, status.result.data);
        else if (status.state !== "cancelled" && status.state !== "failed" && status.result?.code !== 404) throw new Error("任务尚未确认结束，请先停止或查询恢复，任务记录已保留");
      }
      page.task = null; page.error = "";
      try { await save(); } catch (error) { page.task = task; throw error; }
    } finally { cancelling.delete(page.id); }
  }
  async function runBatch(jobs: { page: ComicPage; run: () => Promise<void> }[], sequential: boolean) {
    if (batch.running) return;
    Object.assign(batch, { running: true, stopped: false, total: jobs.length, completed: 0, failed: 0 });
    jobs.forEach(job => queued.add(job.page.id));
    const pending = new Set<Promise<void>>();
    let nextSubmission = 0;
    try {
      for (const job of jobs) {
        while (!batch.stopped && Date.now() < nextSubmission) await new Promise(resolve => setTimeout(resolve, Math.min(250, nextSubmission - Date.now())));
        if (batch.stopped) break;
        if (pending.size >= 3) await Promise.race(pending);
        if (batch.stopped) break;
        nextSubmission = Date.now() + 10000;
        const pendingJob = job.run().then(() => { if (job.page.task?.cancelled) batch.failed++; else batch.completed++; }, error => {
          batch.failed++; message.value = error instanceof Error ? error.message : "页面生成失败";
          if (sequential || saveError.value) batch.stopped = true;
        }).finally(() => { pending.delete(pendingJob); queued.delete(job.page.id); });
        pending.add(pendingJob);
        if (sequential) await pendingJob;
      }
      await Promise.all(pending);
      message.value = `批量${batch.stopped ? "已停止" : "已完成"}：完成 ${batch.completed} 页，未完成 ${batch.failed} 页`;
    } finally { queued.clear(); batch.running = false; }
  }
  async function refresh() {
    if (loadFailed) {
      loadFailed = false;
      ready = readState();
      void ready.catch(() => { loadFailed = true; });
    }
    const state = await ready;
    await queue.catch(() => {});
    if (active.size || cancelling.size || batch.running || JSON.stringify(state.project.value, null, 2) + "\n" !== savedText) return state;
    const disk = await readComicSnapshot(files);
    const snapshot = disk.recovered ? await restoreComicSnapshot(files, disk) : disk.snapshot!;
    if (disk.recovered) message.value = "主文件异常，已从备份恢复，原损坏内容已另存。";
    const project = disk.project;
    state.snapshot = snapshot; state.project.value = project;
    savedText = JSON.stringify(project, null, 2) + "\n";
    saveError.value = ""; saveStatus.value = "已保存";
    return state;
  }
  return { refresh, save, active, queued, cancelling, batch, message, saveError, saveStatus, start, recover, cancel, finish, runBatch,
    async dirty() { const state = await ready; return JSON.stringify(state.project.value, null, 2) + "\n" !== savedText; } };
}
