# 3D 导演台

点击节点预览进入导演台。选择文本模型后可用文字搭景，也可以手动调整人物、道具和机位。机位截图可以发送为画布中的图片节点。

场景自动保存在 `assets/<节点ID>/directorTrial.json`。原 Beta 场景继续使用同一文件。旧版 `model.json` 保留在原目录，旧版动画工程不自动转换。

工作台基于 `https://github.com/jiguang132/storyai-3d-director-desk` 的 `8c8bd361790be4d37158a7430365e65546e358fe`，MIT 许可随静态资源分发。本地试用时，将上游 public/models 中的人偶与素材许可说明放在工作台的 models 目录；模型采用独立许可。模型不可用时会回退到程序化人偶。重建时在该版本独立检出中应用同目录的 `storyaiAdapter.patch`，按上游锁文件安装依赖，使用 Vite 的 `base: "./"`、`publicDir: false`、`entryFileNames: "director.js"`、`assetFileNames: "director.[ext]"` 构建到 `apps/web/public/directorTrial`，保留 `license.txt`。
