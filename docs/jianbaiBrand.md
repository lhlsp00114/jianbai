# 见白界面品牌替换

本次仅替换网页产品展示，不修改内部标识、项目文件格式、供应商 ID、接口、账号凭据、桌面应用标识和更新源。

## 品牌素材

- `packages/assets/jianbaiLogo.png`：用户提供的透明 PNG 原件，文件内容保持一致。
- `packages/assets/jianbaiLogo.svg`：从 PNG 主体透明轮廓提取的黑色矢量版本，沿用界面已有的深色模式反色样式。
- `packages/assets/jianbaiLogoWhite.svg`：白色矢量版本，透明背景，便于单独使用。
- `packages/assets/jianbaiFavicon.svg`：随浏览器明暗主题切换颜色的标签页图标。

SVG 保留主体和中央开口，去除外围低透明度杂点，并调整图标留白。不使用嵌入位图冒充矢量。

## 修改的界面文件

1. `apps/web/index.html`：浏览器标题和标签页图标。
2. `apps/web/src/pages/home/index.vue`：首页名称、Logo、演示广告中的产品标识。
3. `apps/web/src/pages/hello/index.vue`：欢迎页装饰名称与 Logo。
4. `apps/web/src/components/loadingPage.vue`：加载动画使用新 SVG，保留原动画逻辑。
5. `apps/web/src/pages/workspace/index.vue`：Agent 按钮名称。
6. `apps/web/src/components/agent/conversation/messageList.vue`：助手欢迎语与 Logo。
7. `apps/web/src/components/agent/conversation.vue`：通知标题。
8. `apps/web/src/components/settings/panels/about/index.vue`：产品名称、Logo；原仓库链接明确标为上游项目。
9. `apps/web/src/components/settings/panels/general/ui.vue`：界面设置预览文案。
10. `apps/web/src/components/desktopQuit.vue`：退出确认标题。

原作者的账号、充值广告、官方供应商、社群、版权和上游链接仍保留原名称。原 `packages/assets/logo.svg` 未覆盖。多租户页面和桌面安装包不在本次修改范围。

## 备份与验证

上述 10 个文件修改前的副本保存在 `data/brandBackups/jianbaiInitial/`，按仓库目录结构排列，包含当时已有的用户定制。以后若有新增修改，不应直接整份覆盖回滚。

网页构建通过，已实际查看首页、关于页和 Agent；旧项目的 56 个节点正常加载，加载动画正常结束。浏览器未记录运行错误。未提交新的付费生成任务。

全量 Web 类型检查仍报告已有的 `.hutch/devkit/api/config/ElectrobunConfig` 缺失，不能据此宣称全量类型检查通过。
