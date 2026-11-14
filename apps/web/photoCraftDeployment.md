# PhotoCraft 独立集成

宿主入口：`src/pages/home/index.vue` 中“工具”下方的“PS图像编辑”。
嵌入组件：`src/pages/home/photoCraft.vue`。只使用官方 iframe 嵌入方式，不修改编辑器源码、不依赖其 DOM 或内部接口。

## 初次安装与部署

在仓库根目录执行：

```powershell
bun run --filter '@toonflow/web' photoCraft:install
bun run --filter '@toonflow/web' build
```

安装器读取 `apps/web/photoCraftRelease.json` 中的固定版本与 SHA-256，下载官方 Web 发行包并校验，完整保留许可证、NOTICE 和归属说明。第三方发行文件保留上游名称，安装至 Git 忽略的 `apps/web/public/photoCraft/v0p22p0/`。Vite 构建将静态资源复制到 `build/web/photoCraft/`；部署时必须包含此目录。开发服务直接提供 public 中的文件。

安装器是显式操作；启动、构建和运行时都不会自动联网下载或更新。当前固定版本为 0.22.0。

0.22.0 的发行包将 `snippets` 放在根目录，但 app JS 使用相对路径 `./snippets`。安装器对该版本额外复制一份至 `app/snippets`，不修改任何官方文件。新版本不默认沿用此补偿，升级时需验证其相对模块路径。

## 更新与回退

1. 查看官方 `storytold/photocraft` 的 Releases，确认新版本仍包含 Web ZIP。
2. 将配置文件的 `version` 改为目标版本，将 `sha256` 改为该 ZIP 在官方 Release API 的 digest 或 SHA256SUMS 中的值。
3. 显式运行上述安装命令。新版本写入独立目录，校验与完整写入成功后才发布；旧版本不删除，编辑器源码不打补丁。
4. 构建前端，在浏览器验证打开图片、编辑、保存/导出以及切换首页栏目后编辑内容仍保留。
5. 确认后再发布整个 `build/web`。线上替换发布目录前，应让正在编辑的用户先保存或导出。

回退时将版本与 SHA-256 恢复为旧值，再运行安装及构建。旧目录保留时安装器会逐文件核对官方发行包，不覆盖已修改文件。

官网部署说明： https://github.com/storytold/photocraft/blob/v0.22.0/packaging/web/README.md
官方发行页： https://github.com/storytold/photocraft/releases

## 当前边界

- 点击“PS图像编辑”默认进入页面模式。显示模式使用蓝色图文切换按钮，放在编辑器菜单行、外观按钮之前，不单独占一行；页面模式显示“全屏”，全屏模式显示“退出全屏”，点击切换。按钮提示随状态变化，切换始终复用同一个 iframe；切回页面模式后可通过左侧导航返回首页，编辑器隐藏并保留当前会话。
- 顶部显示当前固定的 PhotoCraft 版本；“导出 PSD”按钮向 iframe 发送 PhotoCraft 的 Ctrl/Cmd+Shift+S（另存为）快捷键，格式选择与文件保存由编辑器原有对话框处理。
- 模式按钮由宿主覆盖定位，不修改官方发行文件。0.22.0 的菜单使用 canvas 绘制，定位按该固定版本菜单布局设置；升级时核对与外观、搜索、工作区菜单的间距。
- 全屏模式先铺满宿主视口，再请求 Fullscreen API 和顶层 Keyboard Lock，将 Ctrl+T 等浏览器保留键交给编辑器。打开系统选图窗口、切换应用或浏览器主动退出原生全屏时保留铺满视图，避免选图后突然回到侧栏布局；模式按钮可随时恢复页面模式，再次切入全屏可重新请求原生全屏。不会在文件选择完成后绕过用户手势强制重进原生全屏。
- Escape 不锁定，保留浏览器原生退出操作；原生全屏退出或组件卸载时释放键盘。首次使用时浏览器可能要求键盘锁定权限；不支持或拒绝时保留铺满显示并明确提示快捷键限制，不声称已成功锁定。
- 快捷键在宿主嵌入组件中适配：焦点位于 PhotoCraft iframe 时，取消 Ctrl/Cmd 组合键（含 Shift/Alt 组合）、功能键和 Alt 导航的浏览器默认行为，保留原生文字选择、剪贴板、撤销及光标操作；原始事件继续交给编辑器。编辑器获得焦点时也阻止 Ctrl/Cmd+滚轮缩放整个网页。焦点离开 iframe 后不接管宿主快捷键，iframe 重载会重新绑定，组件卸载会清理。Keyboard Lock 依赖受支持浏览器、localhost/HTTPS 和通过 API 进入的全屏，不能接管操作系统保留键。升级后需在真实 Chrome/Edge 中验证 Ctrl+T、退出全屏及快捷键与编辑器菜单行为一致。
- 默认使用简体中文。宿主在创建 iframe 前，使用 PhotoCraft Web 的 `photocraft.preferences` 配置将未设置或 `auto` 的 `interface.language` 初始化为 `zh-hans`；保留其他偏好及用户显式选择的语言。升级时核对该配置格式。手动入口：编辑 → 首选项 → 界面 → 语言。
- 首页栏目之间切换仅隐藏编辑器，保留同一个 iframe；离开首页、刷新或关闭浏览器会结束编辑会话，需先用 PhotoCraft 自带保存/导出。
- 当前只接入独立编辑器；AI 生成、画布素材导入和编辑结果回传尚未接入。后续桥接放在宿主适配组件中，先核实目标版本的公开接口，不调用上游私有实现。
- 编辑器资源本地托管；首次下载约 15 MB。HTTP localhost 或 HTTPS 可用 WebGPU，浏览器需要支持官方 WebGPU/WebGL2 渲染路径。
