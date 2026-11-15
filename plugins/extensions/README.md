# pi 扩展

每个子目录是一个可单独复制到 agent 目录的 pi 扩展。

| 目录 | 工具 | 用途 |
| --- | --- | --- |
| `ask-user-question` | `ask_user_question` | 结构化提问；参数与 prompt 取自 rpiv，界面走 facet 的 `askForm`，随 server 打包并内置到会话 |
| `session-names` | — | 首轮回复后生成会话名；fork 子会话取分叉后的第一条用户消息 |

扩展目录的约定：

- 入口是 `index.ts`，默认导出接收 `ExtensionAPI` 的函数。
- 只依赖 pi SDK 与 typebox；不引用 `@facet/*`，这样目录可以整体复制。
- 需要 facet 专有能力时做能力检测，缺失时返回明确错误。
- 目录内附 `README.md`，写清支持的字段、降级行为与来源许可。
