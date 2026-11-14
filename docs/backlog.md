# 待办：与 pi SDK 的对接缺口

本文件记录 `packages/agent` 与 pi SDK 之间还没接上的部分,逐项的任务口径在 `todo.md`。

已经接上的有:会话创建与分叉、`subscribe` 全量事件、`steer` / `followUp` 排队、`compact` 与按需压缩、模型与思考档位、扩展命令与提示词模板与技能（`commands()`）、项目信任、`navigateTree`（回退即挪分支指针）、`getContextUsage`、`setActiveToolsByName`。

对应关系:扩展交互桥→「pi 扩展交互」,图片附件→「图片附件与预览」,工具清单与加载错误→「工具清单与开关」,OAuth→「OAuth 登录」,MCP 配置管理→同名那条。

## 一、SDK 有能力,界面没有入口

| 项 | SDK 侧 | 现状 | 对应需求 |
|---|---|---|---|
| 图片附件 | `prompt(text, { images })`、协议 `PromptRequest.images` / `QueuePromptRequest.images`、端点原样透传 | 链路全通,输入区的「添加图片」「上传文件」两项是 `disabled` + `title="尚未接入"` | FR-COMPOSE-09 |
| 工具集合开关 | `setActiveToolsByName`、动作 `session/configChanged.activeToolNames`、`PiAgent.tools()` 给「全部工具 + 是否激活」 | 只有端点与测试在用,界面没有入口,`tools()` 没有消费者;MCP 注册进来的工具只能全开 | FR-EXT-14 |

## 二、完全没接

| 项 | 说明 | 对应需求 |
|---|---|---|
| 扩展交互桥 | `bindExtensions({ uiContext })` 的 `uiContext` 全仓库没有一处赋值,SDK 回落到 `noOpUIContext`,扩展调 `ctx.ui.select / confirm / input / editor / custom` 静默拿到空值。SDK 已经抛出 `ui_prompt_start` / `ui_prompt_end` 扩展事件,接上就能做浮层 | FR-EXT-01、FR-EXT-04 |
| 扩展的命令上下文 | `commandContextActions`（`waitForIdle` / `newSession` / `fork` / `navigateTree` / `reload`）与 `shutdownHandler` 都没提供,扩展发不起这些动作 | FR-EXT-01 |
| 扩展与 MCP 的加载错误 | `PiAgent.issues` 收集 `extensionsResult.errors/warnings`,没有任何消费者,只进服务器日志;MCP 服务器起不来时界面看不出异常 | FR-EXT-16、FR-EXT-17 |
| OAuth 登录 | `credential-store` 认识 `type: "oauth"`,但唯一写入路径固定写 `{ type: "api_key" }`;`resetApiProviders` 未用 | FR-SET-03 |
| MCP 配置管理 | 只从 `~/.pi/agent-dev/mcp.json` 读,没有界面,也没有服务器与工具状态 | FR-EXT-14 |
| `@` 文件引用 | 输入区没有补全入口;数据侧 `listDirectory` / `readFile` 现成 | FR-COMPOSE-04 |
| 会话重载 | `session.reload()` 未用,改完扩展或 pi 设置后不能热重载;只有建会话时跑 `resourceLoader.reload` | FR-EXT-16 |

## 三、留了入口、没有调用方

| 入口 | 位置 | 说明 |
|---|---|---|
| `exportToHtml` / `exportToJsonl` | `pi-agent.ts` | 会话导出已移除,这两个方法成了死代码,要么删要么接回界面 |
| `summarizeForBugReport` | SDK | 未使用 |
| `getLastAssistantText` | SDK | 未使用 |
| `setScopedModels` | SDK | 未使用,模型选择器直接列全部 |
| `setSteeringMode` / `setFollowUpMode` | SDK | 未使用,排队行为固定 |
| `executeBash` / `recordBashResult` | SDK | 未使用,终端跑在 facet 自己的 pty 里 |
| `getCallableToolNames` / `getToolDefinition` | SDK | 未使用,工具清单本该走这对接口 |

## 四、pi 的设置文件不读不写

facet 只读写自己的 `~/.local/share/facet-dev/settings.json`,从不碰 `~/.pi/agent-dev/settings.json`。因此落在 pi 侧、只有 pi 会读的开关都够不着:`images.blockImages`、`followUpMode`、`steeringMode`、`terminal.*`、`defaultProjectTrust`。要么由 facet 写进去,要么给一份映射。

## 建议顺序

1. **扩展交互桥**(FR-EXT-01):`uiContext` 接上选择、输入、多行编辑与确认,支持取消与中止;`ui_prompt_start/end` 事件已经现成。
2. **图片附件**(FR-COMPOSE-09):协议与 agent 都通,只差输入区的读文件、转 base64、带上 `images`。
3. **加载错误与工具清单**(FR-EXT-16、FR-EXT-17):把 `issues` 与 `tools()` 挂进会话快照,出错时在会话里给一行事实内容,设置里给工具清单与开关。
4. **OAuth**(FR-SET-03)与 **MCP 配置管理**(FR-EXT-14):体量较大,排在后面。
