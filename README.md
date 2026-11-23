# 见白 · Toonflow

见白是一个面向 AI 内容创作的工作台。它把无限画布、图片与视频生成、素材管理、AI 助手、白模预演和图像编辑放在同一个工作区里。

这是基于 [Toonflow 上游开源项目](https://github.com/HBAI-Ltd/Toonflow-app) 开发的个人版本，当前版本为 `1.0.0`。

<p>
  <a href="https://github.com/lhlsp00114/jianbai">
    <img src="https://img.shields.io/badge/GitHub-lhlsp00114%2Fjianbai-181717?style=flat-square&logo=github&logoColor=white" alt="GitHub" />
  </a>
  <a href="https://github.com/lhlsp00114/jianbai/releases">
    <img src="https://img.shields.io/github/v/release/lhlsp00114/jianbai?style=flat-square" alt="Release" />
  </a>
  <img src="https://img.shields.io/badge/Version-1.0.0-4c8bf5?style=flat-square" alt="Version 1.0.0" />
  <img src="https://img.shields.io/badge/License-MIT-2ea44f?style=flat-square" alt="MIT License" />
</p>

## 当前功能

### 无限画布

- 通过节点组织图片、文字、视频、音频和 AI 生成内容
- 支持节点列表、素材库、缩放菜单、网格吸附和小地图
- 支持选中节点后的整理、复制、素材保存和快捷操作
- 图片节点可以发送到 Agent 或 Eagle

### AI 创作

- 支持图片生成、图片编辑、视频生成和文本创作节点
- 支持多家模型供应商和自定义 API
- 创作广场包含提示词、Skill、风格、配色和构图
- 风格、配色和构图支持官方内容、我的内容、收藏和最近使用
- 选择创作内容后可以直接发送到画布

### 首页与项目

- 首页统一管理项目、无限画布、无限漫画和探索内容
- 工作区文件保存在用户选择的目录中
- 支持项目打开、新建、重命名和导出
- 支持素材库和工作区文件管理

### 图像编辑

- 集成开源 PhotoCraft Web 图像编辑器
- 支持在首页打开图像编辑页面
- 支持导出 PSD
- PhotoCraft 相关代码和许可证以 [上游项目](https://github.com/storytold/photocraft) 为准

### 白模预演

- TrumanMap 支持场景搭建、镜头预演、人物走位和时间轴查看
- 支持从画布和创作流程进入白模预演

## 快速开始

### 开发环境

项目使用 Bun、TypeScript、Vue 3 和 Express。

```bash
bun install
bun run dev:plugins
bun run dev
```

开发服务器启动后访问 `http://localhost:3000`。

### Windows 预览启动

双击项目根目录的 `previewToonflow.bat`。脚本会构建插件和 Web 前端，然后启动本地服务。

### 构建检查

```bash
bun run --filter '@toonflow/web' typecheck
bun run --filter '@toonflow/web' build
bun run --filter '@toonflow/server' typecheck
```

## 项目结构

```text
apps/web                 Web 前端和首页
apps/server              本地服务和 API
packages/nodeShared      节点共享组件和创作数据
packages/nodes            图片、视频、文本等节点
packages/providers        模型供应商适配
packages/tools            画布工具和工作区工具
```

## 更新

项目保留官方源和 GitHub 两种更新来源。正式发布时，个人版本的安装包和版本信息发布到个人 GitHub Releases。

个人仓库地址为 [lhlsp00114/jianbai](https://github.com/lhlsp00114/jianbai)。

## 上游项目与许可

本项目基于 [HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) 开发，保留上游项目的开源说明、第三方依赖许可和版权信息。

项目整体使用 [MIT License](./LICENSE)。PhotoCraft 使用其自身的 MIT / Apache-2.0 双许可证。第三方依赖、图标、图片和模型遵循各自的许可证与使用条款。

## 致谢

- 感谢 Toonflow 上游项目及其贡献者
- 感谢 PhotoCraft 项目及其贡献者
- 感谢所有开源依赖和模型服务提供方
- 感谢使用、反馈和帮助完善见白的用户
