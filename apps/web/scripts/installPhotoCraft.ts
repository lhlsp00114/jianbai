import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lstat, mkdir, readFile, rename, writeFile } from "@toonflow/file";
import { unzipSync } from "fflate";
import release from "../photoCraftRelease.json";

// 单独执行安装；开发和构建命令不会联网下载或自动升级编辑器。
const { version, sha256 } = release;
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("PhotoCraft 版本或校验值无效");
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const resources = resolve(webRoot, "public/photoCraft");
const target = resolve(resources, `v${version.replaceAll(".", "p")}`);
const source = `https://github.com/storytold/photocraft/releases/download/v${version}/photocraft-web-${version}.zip`;
const response = await fetch(source, { signal: AbortSignal.timeout(180000) });
if (!response.ok) throw new Error(`PhotoCraft 下载失败：HTTP ${response.status}`);
const archive = new Uint8Array(await response.arrayBuffer());
if (createHash("sha256").update(archive).digest("hex") !== sha256) throw new Error("PhotoCraft SHA-256 不匹配，未安装");
const entries = unzipSync(archive);
const prefix = `photocraft-web-${version}/`;
const files = new Map<string, Uint8Array>();
let totalSize = 0;
for (const [name, bytes] of Object.entries(entries)) {
  if (!name.startsWith(prefix)) throw new Error(`发行包包含非预期路径：${name}`);
  const path = name.slice(prefix.length);
  if (!path || path.endsWith("/")) continue;
  if (path.includes("\\") || path.includes(":") || path.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(`发行包包含非法路径：${name}`);
  }
  totalSize += bytes.length;
  if (totalSize > 300 * 1024 * 1024 || files.size >= 5000) throw new Error("发行包超过安装大小限制");
  files.set(path, bytes);
}
for (const path of ["index.html", "app/parts.txt", "app/photocraft-web.js", "LICENSE-MIT", "LICENSE-APACHE", "NOTICE"]) {
  if (!files.has(path)) throw new Error(`发行包缺少文件：${path}`);
}
const parts = new TextDecoder().decode(files.get("app/parts.txt")).trim().split(/\r?\n/);
if (parts.shift() !== "photocraft-parts 1" || !parts.length) throw new Error("PhotoCraft 分片清单格式已变化，请核对新版部署说明");
for (const part of parts) {
  if (!files.has(`app/${part}`)) throw new Error(`发行包缺少 WebAssembly 分片：${part}`);
}
// 0.22.0 的 app JS 引用 ./snippets，但发行包只放在根目录；只补部署路径，不改官方文件。
const compatibilityFiles = new Map<string, Uint8Array>();
if (version === "0.22.0") {
  for (const [path, bytes] of files) {
    if (path.startsWith("snippets/") && !files.has(`app/${path}`)) compatibilityFiles.set(`app/${path}`, bytes);
  }
}
await mkdir(resources, { recursive: true });
if ((await lstat(resources)).isSymbolicLink()) throw new Error("PhotoCraft 资源目录不能是符号链接");
const installed = await lstat(target).catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});
if (installed) {
  if (!installed.isDirectory() || installed.isSymbolicLink()) throw new Error("PhotoCraft 版本目录无效");
  for (const [path, bytes] of files) {
    const current = await readFile(resolve(target, path));
    if (!current.equals(Buffer.from(bytes))) throw new Error(`已安装文件被修改：${path}。请保留现有目录后重新安装，禁止混用版本。`);
  }
  for (const [path, bytes] of compatibilityFiles) {
    const destination = resolve(target, path);
    const current = await readFile(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (current && !current.equals(Buffer.from(bytes))) throw new Error(`兼容资源已被修改：${path}`);
    if (!current) {
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: "wx" });
    }
  }
  console.log(`PhotoCraft ${version} 已安装，文件与官方发行包一致。`);
} else {
  // 先完整写入独立目录，成功后才发布；旧版本始终保留，便于切回。
  const staging = resolve(resources, `pending${randomUUID().replaceAll("-", "")}`);
  await mkdir(staging);
  for (const [path, bytes] of [...files, ...compatibilityFiles]) {
    const destination = resolve(staging, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
  }
  await rename(staging, target);
  console.log(`已安装 PhotoCraft ${version}：${target}`);
}
