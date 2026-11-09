# DragonAPI 适配器检查记录

检查日期：2026-11-07（北京时间）。

检查对象：`C:/Users/Administrator/Downloads/dragonapi.ts`，版本 2.0.0，1497 行。
SHA-256：`29E06F50A2C3114DC4CBE3F04E50A921E1E9FCCB3C0F11BBB6E8A787EB0C227A`。
本次只审查，没有改写上传的文件或软件中已安装的适配器，没有提交图片或视频生成任务。

## 结论与更正

图片和视频可以放在一个供应商文件中。该文件分别实现 generateImage 和 generateVideo，声明了 20 个图片模型、22 个视频模型；同文件不是故障原因。

前面将“图片调用 /v1/videos”直接判断为路径错误不准确。此次通过 HTTPS 实际读取的 DragonAPI 图片说明和 GPT-Image-2 模型页面，明确使用 POST /v1/videos 创建异步图片任务。路径名称不能单独决定媒体类型。

此前实测 POST /v1/images/generations 能返回图片，说明存在一条已验证的同步调用方式；这不能证明所有图片模型都应切换到同步接口，也不能证明异步接口在当前密钥和渠道下可用。

## 已确认的问题

### 1. 画布参考素材与供应商输入格式不匹配

原文件 608–618 行 requireHttpUrl 只接受 type=url；1307–1312 行对图片参考素材一律使用它，1401–1412 行的部分视频型号也这样处理。

Toonflow 的 apps/server/src/utils/media/generation.ts 中，readReference 会把工作区素材转成 type=base64，再交给适配器。因此虽然模型声明支持单图、多图参考，普通画布参考图会在发请求前被拒绝。部分使用 urlLists 分支的视频参考也受影响。

DragonAPI 的异步图片文档确实要求公开可访问的图片 URL，所以不能简单去掉校验或把 Base64 当成 URL。需依据实际接口增加素材上传流程，或选择明确支持文件输入的接口；不能默认把私人素材上传到公网。

### 2. 视频完成后的下载流程不完整

原文件 735–763 行 collectResult 只读取 result.data 中的 URL 或 result.url；若不存在就报错。没有实现文档明确列出的 GET /v1/videos/{task_id}/content，并携带 Bearer 凭据下载视频。

MiniMax H3、Seedance 2.5 的模型页均说明完成后走 content 下载。因此不能保证已完成的视频会被取回；若平台恰好额外返回 URL，现有分支可能可用。本次未付费实测视频，不能宣称所有视频型号均失败。

### 3. 提交拒绝与任务中断没有区分

原文件 530–547 行把所有非成功 HTTP 响应转成普通 Error；只有轮询到失败终态时，766–770 行才设置 MEDIA_TASK_FAILED。

Toonflow 的 tasks.ts 将未标记的生成异常保留为 interrupted。此前 HTTP 400 因此保留为结果未知，节点再次点击生成或重新挂载时会优先恢复它。这是错误处理协议不完整，不是浏览器缓存。

修正时须在提交阶段识别有明确拒单证据的错误。不能把所有 HTTP 400、查询失败、下载失败、超时或 5xx 都标成未接单，以免误导用户重复付费。

### 4. 模型参数表存在与当前文档不一致的限制

原文件 61、124–130、1265–1267 行限制 GPT-Image-2 的 4K 只允许部分长宽比；当前模型页面的尺寸表还列出了 1:1、3:2 等比例。这会在本地提前拒绝这些设置。

分辨率档位在文件中以 1K/2K/4K 传出，文档为 1k/2k/4k；需按目标协议规范化，但没有实测证据证明大小写就是本次 HTTP 400 的原因。

## 仍未确定的事项

- `plugin usage enum is not an allowed value` 的平台内部根因尚未确定。源文件没有发送名为 plugin usage 的字段；可能涉及网关路由或上游校验，需要供应商日志确认，不能把推测当结论。
- 模型声明列表不是密钥权限列表。文档说明密钥所属分组影响模型可用性；图片和视频可能需要不同分组配置，不能仅凭一个文件列出模型就认为一把 Key 全能调用。
- 软件里的 data/providers/dragonapi.ts 是另一个版本 2.0.1，仅对 gpt-image-2 无参考图路径增加了同步调用。下载目录的原文件没有这项修复，重新导入它会失去这段修改。
- 之前同步补丁将 1K/2K/4K 按长边计算像素，不等于文档中异步模型的尺寸对照表，例如异步文档的 16:9、1k 为 1536x864。同步接口各档位仍需自己的协议证据；不能把那个补丁称为完整适配。

## 验证范围

- Toonflow 自带供应商校验接口通过，识别出 20 个图片模型和 22 个视频模型。
- 使用项目现有 TypeScript 编译器及 Bun 类型做独立 noEmit 检查，通过。
- 文件中未发现 sk- 格式的硬编码密钥。
- 没有新增测试模块，没有发送付费生成请求。语法和结构校验通过不代表接口可用。

## 本次实际读取的供应商资料

以下公开页面通过 HTTPS 读取正文，未携带密钥：

```text
https://docs.dragon3api.com/images
https://docs.dragon3api.com/model/image-gpt-image-2-generation
https://docs.dragon3api.com/videos
https://docs.dragon3api.com/tasks
https://docs.dragon3api.com/video-references
https://docs.dragon3api.com/model/video-minimax-h3-generation
https://docs.dragon3api.com/model/video-seedance-2-5-generation
https://docs.dragon3api.com/groups
```

后续修正应保留一个供应商文件，分别处理同步图片、异步图片和异步视频协议；先修复下载和失败状态，再按已确认的模型能力补齐参考素材与参数映射。
