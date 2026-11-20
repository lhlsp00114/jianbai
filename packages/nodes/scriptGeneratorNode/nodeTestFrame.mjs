import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/", width: 1600, height: 900 });
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
delete globalThis.IntersectionObserver; if (globalThis.window) delete window.IntersectionObserver;
const { createApp, h, markRaw, defineComponent, nextTick, ref } = await import("vue");
const flowLib = await import("@vue-flow/core");
const { default: frameNode } = await import("/sessions/keen-stoic-pascal/mnt/Toonflow/data/nodes/frameAnalysisNode.umd.js");
const assert = (await import("node:assert/strict")).default;
const wait = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
const errors = [], warnings = [];
globalThis.fetch = async (url, init) => {
  const path = String(url);
  if (path === "/api/ai/models") return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ code: 200, data: [{ providerId: "p1", providerLabel: "测试", modelId: "m1", label: "模型", protocol: "openai-completions" }] }) };
  if (path === "/api/ai/media/models") return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ code: 200, data: [] }) };
  if (/\/api\/workspaces\/files\/write/.test(path)) return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ code: 200, data: { revision: "abc" } }) };
  throw new Error("unexpected fetch " + path);
};
let flow;
const capture = defineComponent({ setup() { flow = flowLib.useVueFlow(); return () => null; } });
const app = createApp({ render: () => h("div", { style: "width:1200px;height:800px" }, h(flowLib.VueFlow, {
  id: "test", nodes: [{ id: "frame", type: "remote-frameAnalysisNode", position: { x: 600, y: 100 }, data: {} }], edges: [],
  nodeTypes: { "remote-frameAnalysisNode": markRaw(frameNode) },
}, { default: () => h(capture) })) });
app.config.errorHandler = (error, _instance, info) => errors.push(info + ": " + (error?.stack ?? error));
app.config.warnHandler = message => warnings.push(message);
const host = document.createElement("div"); document.body.appendChild(host);
const originalWarn = console.warn; console.warn = () => {};
app.mount(host);
await wait(400);
const messages = () => [...document.body.querySelectorAll(".el-message")].map(item => item.textContent.trim());
const doc = () => flow.findNode("frame").data;
let passed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log("ok   " + name); }
  catch (error) { console.log("FAIL " + name + "\n     " + String(error?.message ?? error).slice(0, 600)); process.exitCode = 1; }
}
await test("初始状态：节点宽度 240，底部面板宽度 540", async () => {
  await wait(100);
  const nodeElem = host.querySelector(".vue-flow__node-remote-frameAnalysisNode");
  assert.ok(nodeElem);
  const bottomCard = host.querySelector(".nodeCard.bottom");
  assert.ok(bottomCard);
  assert.equal(Math.round(nodeElem.getBoundingClientRect().width), 240, "节点宽度");
  assert.equal(Math.round(bottomCard.getBoundingClientRect().width), 540, "底部面板宽度");
});
await test("上传超过 100MB 的视频：提前拦截并给出可读提示", async () => {
  const input = host.querySelector("input[type=file]");
  assert.ok(input);
  const file = new File([new ArrayBuffer(101 * 1024 * 1024)], "large.mp4", { type: "video/mp4" });
  Object.defineProperty(input, "files", { value: [file], writable: false });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(300);
  const notice = messages().find(text => text.includes("100 MB"));
  assert.ok(notice && notice.includes("压缩"), "提示信息：" + notice);
  assert.equal(doc().source, undefined, "未上传");
});
await test("上传正常视频但服务端返回 413：给出中文提示", async () => {
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    if (/\/api\/workspaces\/files\/write/.test(path)) return { ok: false, status: 413, headers: { get: () => "application/json" }, json: async () => ({ code: 413, message: "request entity too large", data: null }) };
    return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ code: 200, data: [] }) };
  };
  const input = host.querySelector("input[type=file]");
  const file = new File([new ArrayBuffer(50 * 1024 * 1024)], "normal.mp4", { type: "video/mp4" });
  Object.defineProperty(input, "files", { value: [file], writable: false });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(800);
  const notice = messages().find(text => /服务器限制|100 MB/i.test(text));
  assert.ok(notice && notice.includes("压缩"), "提示信息：" + notice);
  assert.ok(!notice.includes("entity"), "不应出现英文");
});
await test("宽视频时：节点宽度变大，底部面板跟随", async () => {
  doc().metadata = { width: 1920, height: 1080, duration: 60, format: "mp4" };
  await nextTick(); await wait(200);
  const nodeElem = host.querySelector(".vue-flow__node-remote-frameAnalysisNode");
  const bottomCard = host.querySelector(".nodeCard.bottom");
  const nodeW = Math.round(nodeElem.getBoundingClientRect().width);
  const bottomW = Math.round(bottomCard.getBoundingClientRect().width);
  assert.ok(nodeW > 240, `宽视频节点宽度应增大：${nodeW}`);
  assert.ok(bottomW >= nodeW && bottomW >= 540, `底部宽度（${bottomW}）应≥节点宽度（${nodeW}）且≥540`);
});
console.warn = originalWarn;
console.log("\n" + passed + " 项通过；运行时错误 " + errors.length + " 条；Vue 警告 " + new Set(warnings).size + " 种");
for (const item of errors.slice(0, 5)) console.log("ERROR " + item.slice(0, 900));
for (const item of [...new Set(warnings)].slice(0, 8)) console.log("WARN  " + item.slice(0, 260));
if (errors.length) process.exitCode = 1;
setTimeout(() => process.exit(process.exitCode ?? 0), 100);
