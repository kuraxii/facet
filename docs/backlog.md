# 待办

本文件是还没做完的能力与验证项的清单。已完成的能力见 `README.md`。

已经接上的有:会话创建与分叉、`subscribe` 全量事件、`steer` / `followUp` 排队、`compact` 与按需压缩、模型与思考档位、扩展命令与提示词模板与技能（`commands()`）、项目信任、`navigateTree`（回退即挪分支指针）、`getContextUsage`、`setActiveToolsByName`、`bindExtensions({ uiContext })` 的选择与确认与输入与多行编辑、通知与输入框写入、图片附件（`prompt` 的 `images` 一路到输入区的添加图片）。

## 一、与 pi SDK 的对接缺口

以下按 `@earendil-works/pi-coding-agent` **1.5.0** 核对；升级 SDK 之后这一节要重新过一遍。

### 1.1 SDK 有能力，界面没有入口

| 项 | SDK 侧 | 现状 |
|---|---|---|
| 工具集合开关 | `setActiveToolsByName`、动作 `session/configChanged.activeToolNames`、`PiAgent.tools()` 给「全部工具 + 是否激活」 | 分层看：服务端处理器已经接了（`chat-handlers.ts` 收到 `session/configChanged` 就调 `agent.setActiveTools`），缺的是 `client-core` 的派发方法与界面入口；`PiAgent.tools()` 只有测试在用，MCP 注册进来的工具只能全开 |

### 1.2 只接了一部分或完全没接

| 项 | 说明 |
|---|---|
| 扩展的命令上下文 | `commandContextActions`（`waitForIdle` / `newSession` / `fork` / `navigateTree` / `reload`）与 `shutdownHandler` 都没提供,扩展发不起这些动作 |
| 扩展导入 pi SDK | server 把 pi SDK 打进单文件后，加载器把别名算成 `path.resolve(__dirname, "../..", "index.js")`，打包后 `__dirname` 就是 `lib/`，于是指向 `<产物>/index.js`；实测 `apps/desktop/dist-server/` 下只有 `bin/`、`dist/`、`lib/`、`package.json`，没有这个文件。导入 SDK 运行值的扩展（例如 `pi-web-access`）会在加载时报 `Cannot find module` |
| 扩展界面只接了一部分 | facet 只替换了 8 个方法：`select`、`confirm`、`input`、`editor`、`askForm`、`notify`、`setEditorText`、`pasteToEditor`（`packages/agent/src/extension-ui.ts`）。`ExtensionUIContext` 其余方法沿用 SDK 基座的实现，界面上一概看不到：`setStatus`、`setWorkingMessage`、`setWorkingVisible`、`setWorkingIndicator`、`setHiddenThinkingLabel`、`setWidget`、`setTitle`、`setHeader`、`setFooter`、`custom`、`onTerminalInput`、`addAutocompleteProvider`、`setEditorComponent`、`getAllThemes`；其中组件式 `setWidget` 与 `setHeader` / `setFooter` 还需要 TUI 组件 |
| 扩展与 MCP 的加载错误 | `PiAgent.issues` 收着 `extensionsResult.errors/warnings`，但没有任何消费者：`apps/server` 里既不进会话快照也不打日志（那个 getter 没人调）。MCP 服务器起不来时界面同样看不出异常 |
| OAuth 登录 | `credential-store` 认识 `type: "oauth"`,但唯一写入路径固定写 `{ type: "api_key" }`;`resetApiProviders` 未用。界面侧要补浏览器授权、回调输入与多步提示，允许取消，失败时说明原因并可重试 |
| MCP 配置管理 | 只从 agent 目录的 `mcp.json` 读,没有界面,也没有服务器与工具状态 |
| `@` 文件引用 | 输入区没有补全入口与引用胶囊;数据侧 `listDirectory` / `readFile` 现成 |
| 会话重载 | `session.reload()` 未用,改完扩展或 pi 设置后不能热重载;只有建会话时跑 `resourceLoader.reload` |

### 1.3 留了入口、没有调用方

| 入口 | 位置 | 说明 |
|---|---|---|
| `exportToHtml` / `exportToJsonl` | `pi-agent.ts` | 会话导出已移除,这两个方法成了死代码,要么删要么接回界面 |
| `summarizeForBugReport` | SDK | 未使用 |
| `getLastAssistantText` | SDK | 未使用 |
| `setScopedModels` | SDK | 未使用,模型选择器直接列全部 |
| `setSteeringMode` / `setFollowUpMode` | SDK | 未使用,排队行为固定 |
| `executeBash` / `recordBashResult` | SDK | 未使用,终端跑在 facet 自己的 pty 里 |
| `getCallableToolNames` / `getToolDefinition` | SDK | 未使用,工具清单本该走这对接口 |

### 1.4 pi 的设置文件不读不写

facet 只读写自己的 `~/.local/share/facet-dev/settings.json`,从不碰 pi 的 `settings.json`。因此落在 pi 侧、只有 pi 会读的开关都够不着:`images.blockImages`、`followUpMode`、`steeringMode`、`terminal.*`、`defaultProjectTrust`。要么由 facet 写进去,要么给一份映射。

## 二、界面与服务侧还没做的能力

| 项 | 说明 |
|---|---|
| 差异侧栏与轮次收尾行 | 按轮次归集改动文件，给出新增、删除与差异；轮次结束显示耗时与文件统计，点击定位到对应差异 |
| 路径动作与 Git 分支 | 路径的复制与打开已经通了；还缺打开链接，以及项目菜单里的 Git 分支展示与切换前的工作区检查 |
| 消息引用与撤回 | 撤回已接通；还缺选中文字后的引用，以及撤回时图片与引用块的恢复 |
| 任务工具与任务面板 | agent 可维护的任务清单与实时进度，会话任务状态随会话保存，压缩后恢复 |
| 多终端与分屏 | 终端分组、横向与纵向分屏，字体、光标与回滚设置随终端保存 |
| UI 插件 | 工具卡、子代理卡与任务面板的槽位与宿主 API；插件的构建、启用、配置保存、错误隔离与示例 |
| 日常空间 | 固定的草稿目录与入口，独立会话，在项目过滤与时间分组里应用对应规则 |
| 频道协作 | 会话间的发布、订阅、唤醒与防循环，界面展示订阅的频道 |
| 扩展包管理与网页工具 | 扩展包的搜索、安装、卸载与资源诊断；网页抓取限制地址范围、响应大小与返回长度 |
| 提交历史的上限与虚拟化 | `gitCommits()` 按「当前分支的全部提交」跑 `git log`，`MAX_LOG_BYTES` 只是 64MB 兜底，端上又把每条都建成 DOM 节点、无上限也无虚拟化，窗口每次获得焦点还会整份重取。本地实测：vscode 分支 170 602 条提交 → 21.6MB stdout、`git log` 1.15s；kitty 19 639 条 → 2.4MB；同一命令加 `-n 301` 后分别降到 44KB 与 38KB、耗时近零。现在展示口径写的是「当前分支的全部提交」，改上限时这个描述要一起改 |

## 三、验证与验收项

| 项 | 覆盖目标 | 现状 |
|---|---|---|
| 项目管理回归 | 多项目列表、保存失败、清单刷新失败，以及对话框关闭重开之后才回来的异步结果 | 无自动化用例 |
| 设置功能验证 | 凭证的保存与删除、OAuth 的取消与失败、自定义提供方、模型可见性、默认值生效、主题切换与快捷键冲突；保存失败可重试，诊断导出不含凭证 | 部分能力随 OAuth 一起待补 |
| 会话操作集成 | 打开历史期间的实时事件、快速切换、新建与分叉失败、排队发送、撤回与删除 | 无自动化用例 |
| 连接与权限 | 断线重连、序号缺口、多端同时操作、只读档与路径越界 | 混沌用例已覆盖迟到回执、重复回执、被拒发送、缺口与乱序；只读档与路径越界仍缺 |
| 依赖边界 | 自动检查包依赖与 import 方向，保持 protocol 零运行时依赖，限制浏览器侧使用 Node 与 Electron API | 目前靠 `npm run lint` 与 `npm run typecheck` 拦截，没有 import 方向的自动检查 |
| 性能与界面验收 | 2000 条消息的切换耗时、高速流式输出、长时间运行的内存与冷启动；提交历史在大仓库里的展开与刷新耗时（取数体积、首屏行数、焦点重取）；深浅主题、中文输入法、键盘操作与不同窗口尺寸 | 无自动化用例 |

## 建议顺序

1. **加载错误与工具清单**：把 `issues` 与 `tools()` 挂进会话快照，出错时在会话里给一行事实内容，设置里给工具清单与开关。
2. **`@` 文件引用与消息引用**：输入侧只差补全与引用块，数据侧现成。
3. **OAuth** 与 **MCP 配置管理**：体量较大，排在后面。
4. **依赖边界的自动检查**：把包依赖与 import 方向落成一条可跑的命令，并在门禁里执行。
5. **提交历史的上限与渲染**：主机侧 `git log -n` 限流并在结果里标记是否截断；界面一屏只画一批、其余按批展开或改虚拟列表；行尾相对时间改跟一分钟时钟走，别在每次重绘时重算；刷新只取状态、提交历史按需或增量拉。改之前先同步展示口径那处说明。
