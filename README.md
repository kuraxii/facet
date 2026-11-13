# facet

在桌面应用里用 pi 的 agent 干活：会话、工具调用、模型切换都在图形界面里完成，主机侧是一个独立的服务进程，界面通过 WebSocket 连它。

## 环境要求

- Node.js ≥ 22.19，npm（仓库用 npm workspaces）
- Electron 由 `postinstall` 脚本准备；Linux 上如果 `node-pty` 需要现编，系统要装有编译工具链（`gcc`、`make`、`python3`）

## 安装

**在仓库根目录装一次**，不要在 `apps/desktop` 里单独装：

```bash
git clone <repo> facet
cd facet
npm install
```

依赖关系是 workspaces 提升到根的 `node_modules`，界面包 `@facet/ui` 的依赖（`shiki`、`markstream-react`、`@fontsource/*`、`mermaid`、`katex`）也装在这一层。只装某个子包的依赖时，开发服务器会报 `Failed to resolve import "shiki"`、`Unable to resolve "@import "@fontsource/inter/400.css""` 这类错误。

## 运行

开发时主机固定跑在 `ws://127.0.0.1:4319/endpoint`，桌面缺省连这个地址：

```bash
npm run dev            # 主机与桌面一起起，各自热重启
npm run dev:desktop    # 只起桌面，连 4319
npm run dev:host       # 只起主机，固定 4319 端口（FACET_PORT 可换）
npm run dev:split      # 与 dev 相同，保留这个更明确的名字
```

要分开看两边日志时用 `npm run dev:host` 加 `npm run dev:desktop` 各起一个终端。

主机端口由 `FACET_PORT` 决定，缺省 4319；桌面端点由 `FACET_ENDPOINT` 决定，开发时缺省是 `ws://127.0.0.1:4319/endpoint`。要连别处的主机：

```bash
FACET_ENDPOINT=ws://192.168.1.20:4319/endpoint npm run dev:desktop
```

开发时想跑打包那样的本机模式（桌面自己拉起主机）用 `FACET_EMBEDDED=1 npm run dev:desktop`；打包运行不带 `FACET_ENDPOINT` 时本来就是本机模式。

## 连接方式与令牌

主机只跑一套按行编码的协议，跑在哪条字节流上都一样：

- **本机**：缺省监听 TCP 回环地址；用 `FACET_SOCKET=/run/user/1000/facet.sock` 之类给出路径时改成监听 unix socket（Windows 上是命名管道），不再开 TCP 端口。
- **远程**：主机清单里填 `user@host`（或 `ssh://user@host:端口`），桌面用进程内的 SSH 库连过去，读远端的发现文件拿到 socket 路径与令牌，再在远端 socket 上开一条通道；远端不开端口、本地也不开端口，协议层一行不用改。认证复用 `~/.ssh/config`、ssh-agent 与私钥；主机密钥按 `known_hosts` 校验（支持哈希条目），未知或变更的密钥直接拒绝。Windows 远端只监听命名管道时无法用 SSH 通道，退回走远端的 TCP 回环地址。
- **远程端不需要开关**：SSH 与主机密钥就是信任边界，远程端连的是同一个 socket，认证帧里声明自己要只读还是操作档，主机按 `FACET_REMOTE_PERMISSION` 收窄。只有以后的 Web 端才需要单独的接入开关与端点。
- **权限档**：本机连接是管理档；远程连接按 `FACET_REMOTE_PERMISSION` 给操作档或只读档。设置与凭证、提供方、项目增删与信任、诊断按入口放行：桌面设备开的通道可以（本机 socket 与 SSH 隧道都算），浏览器入口不行；只读档连会话与文件都不能改，输入区写明原因。远程的写操作记进 `$FACET_DATA_DIR/audit.log`（时间、连接标识、权限档、操作与结果，不含参数与内容）。
- **令牌**：主机会生成一个随机令牌写进发现文件（`FACET_TOKEN` 可指定，`FACET_NO_TOKEN=1` 关闭校验）。连接的第一帧是 `{type:"auth",token}`，不匹配直接断开，拿不到 hello。发现文件权限 `0600`、所在目录 `0700`，socket 本身也是 `0600`。
- **桌面不直连主机**：渲染进程在沙箱里，连接由主进程按目标建通道（本机按发现文件，远程按 `host:port`），界面只搬运帧。

## Web 端

同一份界面也能在浏览器里跑：

```bash
FACET_TOKEN=<令牌> \
FACET_WEB_PORT=7801 \
FACET_WEB_ROOT=apps/desktop/out/renderer \
  npm start -w @facet/server
```

浏览器打开 `http://<主机>:7801/?tkn=<令牌>`。页面与连接同源同端口：静态产物由主机直接发，连接走同一个端口的 WebSocket，帧格式与 unix socket 那条完全一样。

- **接入开关就是这个端口**：不给 `FACET_WEB_PORT` 就没有 Web 入口
- **令牌**：地址栏给的会记进 localStorage，之后的连接直接用它
- **权限档**：Web 是远程入口，缺省只读（认证帧可以申请操作档，主机按 `FACET_REMOTE_PERMISSION` 收窄）
- **设置只读**：凭证、设置与项目清单只在桌面入口放行，Web 端打开设置能看到内容，控件禁用并有一句说明，也不会触发自动保存
- 桌面与 Web 共用 `apps/desktop/src/renderer` 这一份界面：桌面用 preload 注入的桥，浏览器用 `web-bridge.ts` 补一个同样的桥
- 窄屏（880px 以下）侧栏收成抽屉，左上角按钮展开、点遮罩或选中会话收起，右侧栏改成覆盖式

## 正文里的图表与公式

代码块、流程图与公式都由 `markstream-react` 渲染，`packages/ui` 装齐了它的可选依赖（`mermaid`、`katex`、`stream-diffs`），装哪个就渲染哪个。

- 流程图跟着界面深浅色：库会在 mermaid 源码前注入 `%%{init: {"theme": "dark"|"default"}}%%`
- 图表高度封顶 420 像素，宽图在块内滚动，不把整段对话顶走；公式块也能横向滚动
- 渲染失败时块内留一行说明，标题栏的「源码」切换能看到原始定义；坏的公式或流程图不影响其余正文

## 斜杠命令

在输入框里打 `/` 会列出可用的命令，列表贴在输入框上方：上下键选、回车或 Tab 选中、Esc 收起。列表来自当前会话，换会话会重取。

- **界面自带**：`/model <提供方>/<模型>`、`/thinking <档位>`、`/compact`、`/name <名字>`，选中就地执行，不会当成消息发出去
- **交给 pi**：扩展注册的命令、`.pi/prompts` 里的模板、技能（`skill:名字`），选中后填进输入框，补完参数发出去，由 pi 分发或展开
- 列表只有名字命中了才显示，名字一条都没中时才会去说明里找，避免打两个字母翻出一堆不相干的技能

## 上下文用量与压缩

输入区动作行的右边、发送按钮左边是一个用量环：占用越高弧越长，70% 起转提醒色、90% 以上转错误色。点开是浮层，三行依次是「上下文窗口」「已使用 37%」「393k / 1m tokens」，下面一个「压缩上下文」按钮；估不出来时环只剩底环，浮层第二行写「暂无数据」。

压缩走会话通道的 `session/compact`，这一轮在跑或正在压缩时按钮不可点。压缩结束后主机重算用量推给所有端（`session/usageChanged`），对话里留一条「上下文已压缩」的分隔行。

## 终端

终端跑在主机上，桌面与 Web 都只是它的端：界面里敲的字经通道送到主机，主机再把输出按帧推回来。本机与远程走的是同一条路径，桌面自己不起任何 shell。

- **pty 子进程**：`node-pty` 在主机再往下起的 `pty-host` 子进程里加载，崩溃与突发输出都关在这个进程里，会话与推理轮次不受影响
- **通道**：每个终端一条 `terminal:/<id>`，输出带通道序号，多个端同时看同一个 shell
- **流控**：未确认字符数超过 100_000 让 pty 暂停读，端确认回来降到 5_000 以下再恢复；单帧上限 64KB 字符
- **回滚**：每个终端保留最近 200_000 字符，端挂载或断线重连时先取这份再收增量
- **登记**：`$FACET_DATA_DIR/terminals.json` 记下开过的终端，主机重启后把它们列成已结束，进程已经不在
- **运行时**：`node-pty` 是 N-API 模块，一份构建在 Node 与 Electron 自带的 Node 里都能用，不需要 `electron-rebuild`；打包时把 `pty-host.js` 作为独立入口产物，`.node` 文件放在 asar 外
- **不可用时**：原生模块加载不起来（版本不匹配、缺编译产物）主机在握手里不报 `terminal` 能力，界面隐藏终端入口

界面这边（`packages/ui-terminal`）：

- 底部停靠面板，上缘拖动改高度，高度与展开状态记在本机；`Ctrl + \`` 开关面板
- 每个终端一个标签，标签名取启动目录的最后一段，进程结束后在标签上显示退出码；点标签右边的叉挂断
- 只挂当前标签的 xterm：切标签时卸载并重新挂载，回滚由主机重新给一份，因此标签多了也不会堆实例
- 外观跟着界面配色与等宽字体走：主题一换，背景、前景、光标与选区立刻更新

## 主机与桌面分开运行

主机是独立的进程，桌面只是它的一个端：

- 主机就绪后把端点写进 `$FACET_DATA_DIR/endpoint.json`（Linux 缺省 `~/.local/share/facet`），日志写进同目录的 `host.log`。
- 桌面拉起主机时让它自成一组，应用退出后主机留在后台；下次启动读到发现文件并与主机握上手，就直接接上，会话与运行中的任务都还在。
- 关掉窗口后主机一律留在后台：应用里没有「退出时结束主机」的开关，也没有结束主机的按钮。要停就按数据目录里的 `endpoint.json` 找进程号自行结束，开发时在起主机的终端里 Ctrl+C。

首次启动会读取 `~/.pi/agent-dev` 下的凭证与模型配置；没有凭证时先在设置页的「模型」里点「添加提供商」配好密钥，或改用自定义提供方。

## 右侧栏

主界面右侧是可折叠的两页栏，宽度可拖（260–480）：

- **文件**：惰性目录树，点文件在栏内用 CodeMirror 6 打开；只读查看，切到编辑后 `Mod+S` 保存，写入前比对 revision，磁盘上被改过时提示冲突
- **变更**：工作树相对 `HEAD` 的改动，分支与上下游、每个文件的状态与增删行数，点开就地看 unified diff

## 校验

```bash
npm run typecheck   # 全部工作区的类型检查
npm run lint        # biome
npm run test        # vitest，所有工作区
```

## 打包

```bash
npm run build                  # 全部工作区构建
npm run dist -w @facet/desktop # 出安装包
```

## 目录结构

| 路径 | 内容 |
|---|---|
| `apps/desktop` | Electron 主进程（含拉起主机的子进程管理）、预加载与渲染进程 |
| `apps/server` | 主机侧服务：端点、会话登记、项目与设置存储 |
| `apps/web` | Web 壳 |
| `packages/protocol` | 跨边界的类型与常量，零运行时依赖 |
| `packages/agent` | 包住 pi SDK：会话、模型、凭证、配置 |
| `packages/client-core` | 端点的状态归约与请求封装 |
| `packages/transport` | WebSocket 传输 |
| `packages/ui` | 界面组件，不碰文件系统与 Node |
| `packages/services`、`packages/ui-editor`、`packages/ui-terminal` | 预留的几个包 |

依赖方向单向：`protocol ← services / agent / client-core / transport ← ui ← apps`。

## 字体

界面字体与代码字体都打进构建产物，不依赖系统装没装：

| 用途 | 字体 | 字重 | 来源 |
|---|---|---|---|
| 界面 Latin 与数字 | Inter | 400 / 500 / 600 | `@fontsource/inter` |
| 界面汉字与中文标点 | Noto Sans SC Variable | 100–900（可变字体） | `@fontsource-variable/noto-sans-sc`，按 unicode-range 分片，OFL-1.1 |
| 代码里中文之外的部分 | Maple Mono | 400 / 500 / 600 | `packages/ui/src/assets/fonts/` 下的 woff2，OFL-1.1，许可文本同目录 |
| 代码里的汉字与中文标点 | Maple Mono CN | 400 | `@automann/maple-mono-cn`，按 unicode-range 分片，OFL-1.1 |

两段汉字都由 `packages/ui/src/styles/fonts.css` 顶部的 `@import` 引入，按 unicode-range 分片，渲染到对应字符才加载，界面上没有中文就不下载任何一片。Noto Sans SC 那一段是可变字体，4.3 MB 分 101 片，字重 100–900 共用同一批文件，覆盖 GB2312 全部汉字的 99.5%、中文标点全中；缺的字由系统字体补上。Maple Mono CN 那一段覆盖整个 CJK 基本区（U+4E00–U+9FA5），13px 字号下每个汉字占两格宽；这个包只发布 400 一个字重，代码正文用的就是 400，600 只出现在 `.tool-name` 的英文工具名上，汉字遇到粗体由浏览器合成。

Latin、符号与制表符那三个 woff2 取自本机的 Maple Mono NL NF CN v7.9，要重新生成：

```bash
scripts/build-fonts.sh            # 缺省读 ~/.fonts
scripts/build-fonts.sh <字体目录>
```

设置页的外观按「通用 / 字体 / 代码配色」分成三组卡片，字体那组单独列出四处可换的字体：

| 设置项 | 作用范围 | 留空时 |
|---|---|---|
| 界面字体 | 侧栏、弹窗、控件与聊天正文 | Inter 栈 |
| 代码字体 | 聊天里的代码块与补丁 | Maple Mono |
| 编辑器字体 | 右栏打开的文件 | 跟代码字体 |
| 终端字体 | 底部终端 | 跟代码字体 |

字号同样分开：界面字号作用于聊天正文，编辑器字号与终端字号各管一处。界面字号要不要连带控件尺寸一起缩放还在权衡，目前只影响正文。

配色是一套浅色加五套深色（`zinc` 为缺省），代码高亮另有八套可选，浅深跟随界面主题。全部取值在 `packages/ui/src/styles/theme.css`。

## 数据放在哪

| 路径 | 内容 | 覆盖方式 |
|---|---|---|
| `~/.pi/agent-dev` | 凭证 `auth.json`、模型 `models.json`、设置、会话目录 | `FACET_AGENT_DIR` |
| `$XDG_DATA_HOME/facet`（缺省 `~/.local/share/facet`） | 主机身份 `host.json`、项目清单 `projects.json`、界面设置 `settings.json`、终端登记 `terminals.json`、审计 `audit.log`；独立启动时还有发现文件 `endpoint.json` | `FACET_DATA_DIR` |
| `$XDG_CONFIG_HOME/facet`（缺省 `~/.config/facet`） | 桌面本地记录 `desktop.json`：窗口位置与尺寸 | — |

开发实例的两处目录都带 `-dev` 后缀：数据目录是 `~/.local/share/facet-dev`，配置目录是 `~/.config/facet-dev`。`npm run dev`（即 `dev:split`）、`dev:host`、`dev:desktop` 都用这份，因此开发时跑的东西与装好的包互不影响，`projects.json` 与主机身份各有一份。

用 `agent-dev` 而不是 `~/.pi/agent`，是为了和 pi 命令行共用凭证与模型配置，同时不把开发期的会话混进真实目录。

主机标识在首次启动时生成并写入 `host.json`：取 `/etc/machine-id` 拼上数据目录做 SHA-256，取前 20 位；读不到 machine-id 时改用时间戳加随机串。同一台机器跑多份（不同数据目录）各有各的标识，删掉 `host.json` 即可换一个。

## 打包

只出 Linux 的两种安装包：

```bash
npm run dist -w @facet/desktop
```

产物在 `apps/desktop/dist/`：

| 文件 | 说明 |
|---|---|
| `facet-<版本>-x86_64.rpm` | Fedora、RHEL 系 |
| `facet-<版本>-amd64.deb` | Debian、Ubuntu 系 |

- 安装到 `/opt/Facet`，可执行文件是 `facet`，桌面项 `facet.desktop` 与 `StartupWMClass` 都是 `facet`，图标 512×512
- 依赖走 electron-builder 的缺省清单（deb：`libgtk-3-0`、`libnss3`、`libxss1`、`libxtst6` 等；rpm：`gtk3`、`nss`、`libXScrnSaver` 等），不手写
- `node-pty` 的原生模块与 `spawn-helper` 解包在 `resources/app.asar.unpacked`，打包时只留 linux 的构建产物，源码与其它平台的预编译都剔掉
- 构建 deb/rpm 用的 `fpm` 由 electron-builder 自己下载到 `~/.cache/electron-builder`，不需要系统装 fpm
- 渲染产物约 45 MB，主要是随包打的字体（Inter、Noto Sans SC、Maple Mono）；Electron 本身约 100 MB

包里的主机与开发时是同一个入口：桌面用 `process.execPath` 加 `ELECTRON_RUN_AS_NODE=1` 拉起 `out/main/host.js`，主机再起同目录的 `pty-host.js`。

## 环境变量

| 变量 | 含义 |
|---|---|
| `FACET_HOST`、`FACET_PORT` | 主机端点监听地址与端口，缺省 `127.0.0.1`、系统分配 |
| `FACET_HOST_NAME` | 主机展示名 |
| `FACET_AGENT_DIR` | pi 数据目录 |
| `FACET_SESSION_DIR` | 会话文件目录，缺省按工作目录分组 |
| `FACET_DATA_DIR` | 应用数据目录 |
| `FACET_REPLAY_LIMIT` | 每个通道保留的动作条数 |
| `FACET_SESSION_IDLE_MS` | 没人订阅且空闲后多久回收会话 |
| `FACET_DEBUG` | 打开主机侧调试日志 |
| `FACET_ENDPOINT` | 桌面连这个主机（`host:port`），不再拉起本机主机 |
| `FACET_SOCKET` | 主机监听的 unix socket 路径或命名管道名，给出后不再监听 TCP |
| `FACET_REMOTE_PERMISSION` | 远程连接申请档位的上限：`view`（只读，缺省）或 `operate`（可申请操作档） |
| `FACET_WEB_PORT` | Web 端接入端口，缺省关闭；同一个端口发页面也接 WebSocket |
| `FACET_PTY_HOST` | pty 子进程入口，缺省与主机入口同目录（`pty-host.js` 或 `pty-host-child.ts`） |
| `FACET_WEB_ROOT` | Web 页面的构建产物目录，缺省不提供页面 |
| `FACET_TOKEN` | 连接令牌，缺省随机生成并写进发现文件 |
| `FACET_NO_TOKEN` | 设为 `1` 时不校验令牌，只用于本机调试 |
| `FACET_EMBEDDED` | 开发时设为 `1`，桌面像打包那样自己拉起本机主机 |
| `FACET_PARENT_PID` | 让主机盯着一个进程，那个进程消失后主机自行结束；不再由桌面设置，调试残留进程时用得上 |
| `FACET_PROJECT_DIR` | 启动时打开的项目目录 |
| `FACET_SKIP_ELECTRON_DOWNLOAD` | `1` 表示跳过 Electron 二进制检查 |

## 文档

- `docs/requirements.md`：需求与取舍
- `docs/ui_design_specification.md`：界面设计说明
- `docs/backlog.md`：进度、设计取舍与遗留项
- `todo.md`：按优先级排的功能推进顺序
- `AGENTS.md`：分支、提交与注释规范
