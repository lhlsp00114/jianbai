import { randomUUID } from "node:crypto";
import { copyFileSync, rmSync, writeAtomicSync } from "@toonflow/file";
import { file } from "@toonflow/file/bun";
import { basename, isAbsolute, join } from "node:path";

const [installDirectory, desktopDirectory, programsDirectory, shortcutName] = process.argv.slice(2);
const directories = [installDirectory, desktopDirectory, programsDirectory];
if (directories.some(directory => !directory || !isAbsolute(directory)) ||
    !shortcutName || /[\\/:*?"<>|]/.test(shortcutName)) {
  throw new Error("需要安装目录、桌面目录和开始菜单目录的绝对路径，以及有效的快捷方式名称。");
}
const resourcesDirectory = join(installDirectory, "app", "Resources");
const { identifier, name, channel } = await file(join(resourcesDirectory, "version.json")).json();
if (typeof identifier !== "string" || typeof name !== "string" || channel !== "stable") {
  throw new Error("应用安装信息无效，请重新构建安装包。");
}

// ACT: 系统注册由 NSIS 负责；补齐 Electrobun 的记录，避免首次启动再次调用 PowerShell。
// 保留真实更新助手和完整 manifest，不用占位文件跳过 SDK 检查。
copyFileSync(join(resourcesDirectory, "uninstall"), join(installDirectory, "uninstall.exe"));
writeAtomicSync(join(installDirectory, ".electrobun-uninstall.json"), JSON.stringify({
  schema_version: 1,
  install_nonce: randomUUID().replaceAll("-", ""),
  identifier,
  name,
  channel,
  desktop_shortcut: join(desktopDirectory, `${shortcutName}.lnk`),
  start_menu_shortcut: join(programsDirectory, `${shortcutName}.lnk`),
  install_root_name: basename(installDirectory),
  data_path_versions: [1],
}, null, 2));

writeAtomicSync(join(installDirectory, "闪退请双击我兼容运行.bat"), [
  "@echo off",
  "setlocal DisableDelayedExpansion",
  "start \"\" \"%~dp0app\\Resources\\app\\startupLauncher.exe\" --compatibility",
  "",
].join("\r\n"));

// 重装同一构建也重新同步内置节点和工具；技能沿用首次初始化，保留用户修改。
for (const directory of ["nodes", "tools"]) {
  rmSync(join(installDirectory, "data", directory, "initialized"), { force: true });
}
