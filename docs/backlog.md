# 进度与待办

PoC 阶段结束。本文件记录 PoC 覆盖到的范围、已知的打磨项与已知缺陷;功能推进顺序见 `todo.md`。

## 一、PoC 覆盖范围

一条完整的链路已经跑通:桌面端连上设备、打开历史会话、看到历史与流式内容、发消息、工具调用、分叉。数据层与协议层是最终形态,界面层是首个可用版本。

能跑的部分:

- **协议**(`packages/protocol`):会话与对话两条通道(另声明 `diff` 与 `terminal`,设备端未实现)、23 个动作、14 个请求,`hello` 握手、序号流、缺口检测
- **设备**(`apps/server`):端点分发、会话表(一文件一份运行态、单飞、同 id 冲突检测)、按订阅持有与空闲回收、事件回放缓冲
- **agent 封装**(`packages/agent`):会话工厂、事件与消息的类型转换、工作目录隔离
- **客户端**(`packages/client-core`):状态归约、去重与缺口补齐、统一投影、全量历史装载、按轮分叉
- **传输**(`packages/transport`):WebSocket,重新握手后可续订并对齐;自动重连尚未接通
- **界面**(`packages/ui` + `apps/desktop`):侧栏(项目分组、远程主机、最近会话、搜索)、新建会话、对话面板(六种行、收起、Markdown、代码块、文件改动、耗时)、贴底跟随与回底按钮、输入区、通知

PoC 时的测量:855 条消息、2.6 MB 的会话,投影 + 分行约 3 毫秒;全量装载后滚动高度约 6 万像素。

## 二、待打磨

PoC 不做,记在这里,按「影响基本使用」到「结构」排序。

### 档一:输入区与回合信息

| # | 项 | 需求 | 说明 |
|---|---|---|---|
| 1 | 模型与思考档位选择 | FR-COMPOSE-06/07 | 两个 chip 现在只显示;`client.setModel` 可用,思考档位缺客户端方法与界面 |
| 2 | 排队消息 | FR-COMPOSE-02 | 协议里 `queue.steering` / `followUp` 已有,界面没接 |
| 3 | 按会话保存草稿 | FR-COMPOSE-03 | 切换会话不丢输入 |
| 4 | 错误卡片的动作 | FR-CHAT-13 | 错误行现在只有一行红字,没有重试 |
| 5 | 轮次收尾行 | FR-CHAT-08 | 「本轮 N 分 M 秒 · K 个文件 · 查看差异」,现在时长在过程行、文件在改动行 |
| 6 | 消息操作 | FR-CHAT-10/12 | 复制、选中文本菜单、撤回 |
| 7 | 附件与 @ 补全 | FR-COMPOSE-04 | 两个按钮置灰 |

### 档二:结构与多端

| # | 项 | 需求 | 说明 |
|---|---|---|---|
| 8 | 依赖边界检查 | — | 遍历 import 与 `package.json` 校验方向,挂进 `npm run lint`;现在只靠人守 |
| 9 | 浅色主题验证 | FR-SET | 变量已写,没跑过;界面里还没有设置 `data-theme` 的入口,markstream 主题名、代码块、diff 颜色都要看 |
| 10 | mermaid 与公式 | FR-CHAT-05 | mermaid 只在 `package.json` 里,代码没有引用;KaTeX 样式已随正文引入,两者都缺容器规格与失败降级 |
| 11 | 代码块按设计稿调色 | FR-CHAT-04 | 现在用 shiki 的 vitesse 主题,未按设计稿配色 |
| 12 | Web 端与远端接入 | FR-XDEV | `apps/web` 复用 `packages/ui`;鉴权与 SSH 隧道 |

## 三、已知取舍

- **分叉点在每一轮结束处**:取下一轮开始条目的前一条作为分叉点,这一轮之后追加的用量、改名、压缩条目一并保留;最后一轮分叉取会话末尾
- **过程行摘要**只说这一轮的工作时长,思考段数与工具次数只在展开后可见
- **代码块**是自绘卡片。库自带的代码块把正文渲染在 shadow root 里,样式与折行都无法控制
- **工具卡的成败**只靠颜色区分,不写「完成」「失败」;执行中仍写「执行中」
- **历史工具耗时**靠协议补的 `durationMs`;更早的会话文件里没有该字段时,工具卡不显示时间
- **历史分页**只映射窗口内的条目,并且只取活动分支;游标用条目 id,跨进程重启仍然有效
- **回合状态**由设备的 `session/phase` 给出,取值 `idle`、`starting`、`running`、`stopping`;压缩与自动重试记在 `maintenance` 上,两者都由 `session/phase` 一条动作推送
- **两条通道各放一类数据**:会话通道只放状态(`SessionState`:阶段、维护动作、模型、思考档位、标题、队列),对话通道只放内容(`ChatView`:条目、工具调用、提示、标识迁移)
- **界面读一个状态**`chatActivity(session)` 把阶段与维护动作合成 `idle`、`running`、`compacting`、`stopping` 四值,发送与停止按钮按它决定形态;被中止的助手消息按 `stopReason` 在行末标「已停止」
- **动作的持有**`hub.withSession()` 在调用时同步登记持有,归还之前会话不会被空闲回收;显式 `release()` 遇到持有会挂起,等最后一个归还再执行
- **同一会话的动作串行执行**,后到的动作看到前一个动作完成后的状态;`PiAgent.prompt` 在运行开始后即返回,不再等整轮结束,停止请求不会被整轮阻塞

## 四、已知缺陷

记录已经定位、尚未修复的问题。每条给出触发条件与修改方向,修复顺序见本节末尾。

### 4.1 运行状态与动作回执

| # | 现象 | 原因 |
|---|---|---|
| D2 | 运行期再发一条消息,消息消失且没有提示 | 端点 guard 抛「session is running, streamingBehavior is required」(串行队列保证这是确定行为);草稿在 `send()` 里已经清空 |
| D3 | 压缩期间发送,消息消失 | pi 抛「Cannot submit a prompt while compaction is in progress」;压缩进度条可见时用户仍可发送 |
| D4 | 切到没有凭证的模型,芯片仍显示旧模型 | `AgentSession.setModel` 抛「No API key for p/i」,回执是带 `rejectionReason` 的动作帧,客户端不读 |
| D7 | 排队消息没有支撑 | `session/pendingMessageSet` 与 `session/queueCleared` 只有设备侧的受理,客户端没有对应方法,界面也没有展示 |

### 4.2 `rejectionReason` 的接收路径全部失效

帧由 `endpoint.ts` 在 `applyAction` 抛错时发出,`serverSeq` 取 `hub.lastSeq(channel)`,刻意不占新序号。客户端 `SessionStore.apply` 先按序号判重,而 `packages/client-core` 与 `packages/transport` 都没有读取 `rejectionReason` 的地方:

| 通道状态 | 结果 |
|---|---|
| 通道上已有动作(`lastSeq > 0`) | 帧的 `serverSeq` 等于当前最后序号,判为重复,整帧丢弃 |
| 通道上还没有动作(`lastSeq === 0`) | 判重不成立,被拒绝的动作被当成真实动作归约一遍。当前 `chat/turnStarted` 的归约是空操作,所以症状不明显;换成带状态的动作用同样的条件就会写进视图 |
| 通道未订阅 | `apply` 里的 `?? createChatSlot(...)` 新建空槽,帧进入没人看的视图 |

同步阶段抛的错走另一条路:`requiredChannel` 失败、动作缺 `type` 时直接 `ws.close(1008)`,不产生 `rejectionReason`。设备侧也没有按 `clientSeq` 去重。

### 4.3 中止时的界面表现

| 现象 | 位置 |
|---|---|
| 助手消息里没有对应视图的 toolCall 块固定按 `status: "done"` 渲染,中止时必然命中,显示成「已完成、无输出」 | `packages/client-core/src/transcript.ts` |
| 流刚开始就被打断的中止消息 `content` 为空,归入过程行 | `packages/client-core/src/transcript.ts`、`packages/ui/src/transcript/group.ts` |
| `chat/settled` 带的 `aborted` 在客户端没有消费方,中止与正常结束只靠各条消息的 `stopReason` 区分 | 全包 |
| 未被执行的工具调用只有消息内容里的块,没有事件与结果,界面无法与「执行完但没输出」区分 | 协议边界 |

### 修复顺序

1. D2/D3/D4 的可见性:`rejectionReason` 转成 `chat/notice` 且不进归约。
2. 4.3 的两条:未执行工具的状态、空内容中止消息的呈现。
3. D7 随排队功能一起做。
