# facet

在桌面应用里用 pi 的 agent 干活：会话、工具调用、模型切换都在图形界面里完成，主机侧是一个独立的服务进程，界面通过 WebSocket 连它。

## 环境要求

- Node.js 26（当前 LTS，版本写在 `.node-version`），npm（仓库用 npm workspaces）；server 产物打包的是同一个版本
- Electron 由 `postinstall` 脚本准备；Linux 上如果 `node-pty` 需要现编，系统要装有编译工具链（`gcc`、`make`、`python3`）
- 发行包支持 Linux 与 Windows x64：Windows 上用 `node-pty` 自带的预编译产物，不需要编译工具链

## 安装

**在仓库根目录装一次**，不要在 `apps/desktop` 里单独装：

```bash
git clone <repo> facet
cd facet
npm install
```

依赖关系是 workspaces 提升到根的 `node_modules`，界面包 `@facet/ui` 的依赖（`shiki`、`markstream-react`、`@fontsource/*`、`mermaid`、`katex`）也装在这一层。只装某个子包的依赖时，开发服务器会报 `Failed to resolve import "shiki"`、`Unable to resolve "@import "@fontsource/inter/400.css""` 这类错误。

## 打包

```bash
npm run dist            # 先打独立主机产物，再按宿主平台出安装包（Linux rpm/deb/tar.gz，Windows NSIS）
npm run build:server    # 只打独立 server 产物
```

server 是一个自带运行时的独立产物（用户看到的「主机」是抽象，落地的进程是 server）：

```
apps/desktop/dist-server/
  bin/node            官方 Node（scripts/build-server.mjs 里固定版本，缓存在 ~/.cache/facet-node）；Windows 上是 bin/node.exe
  lib/server.mjs      server 入口，esbuild 打成单个 ES 模块
  lib/pty-server.mjs  终端子进程入口
  lib/node_modules/node-pty/   唯一的原生模块
```

打包时整个目录进 `resources/server`，桌面启动 server 用的就是
`resources/server/bin/node resources/server/lib/server.mjs`，与桌面那份 Electron 运行时互不相干。

开发态跑的是同一份产物（`apps/desktop/dist-server`），也用自带的 Node 启动，所以原生模块
（`node-pty`）只需要针对 Node ABI 构建一次，不必再为 Electron 的 ABI 编一遍。
`npm run dev` 会先打一次产物再起两边，产物不在时由它现打，不用单独 `npm run build:server`。

远程那台机器装上包（rpm/deb 都装到 `/opt/Facet`），桌面通过 SSH 就能把它拉起来，不需要拷贝目录。

## 运行

本机的主机只开一个本地 socket：Linux 上是 `$XDG_RUNTIME_DIR/facet-dev.sock`，没有运行目录时是
`~/.local/share/facet-dev/facet.sock`；Windows 上没有 unix socket，改用命名管道
`\\.\pipe\facet-<数据目录摘要>`（开发态的数据目录是 `%LOCALAPPDATA%\facet-dev`）。桌面按同一套
规则拼出地址直接连，两边都不用填端口：

```bash
npm run dev            # 打产物 → 起 server → 起桌面；桌面退出时 server 一起收掉
npm run dev:host       # 只起 server，桌面起来后自己连上它
npm run dev:split      # 与 dev 相同，保留这个更明确的名字
```

Linux 与 Windows 上都是上面这三条命令：脚本按平台取 `npm.cmd`、产物里的 `node.exe`，收进程树
走 `taskkill /T`，Windows 上没有的 unix 信号不用。

`dev` 的编排在 `scripts/dev-split.mjs`：两边输出各加前缀，桌面退出（或 Ctrl+C）时把 server
一起收掉。要分开看两边日志时用 `npm run dev:host` 加 `npm run dev -w @facet/desktop` 各起一个
终端。不另设只起桌面的脚本：桌面在开发态找不到主机时会自己去拉一个，而它拉起来的主机按发布
版的数据目录算，会把正在跑的安装版 `facet.sock` 抢走；先 `dev:host` 起来再连就没有这一步。

开发与打包走同一条路：不给 `FACET_ENDPOINT` 就是本机主机，差别只在开发实例的数据目录带
`-dev` 后缀（socket 也就叫 `facet-dev.sock`）。要连别处的主机（TCP 端点，或 `ssh://` 远程主机）用 `FACET_ENDPOINT`：

```bash
FACET_ENDPOINT=ws://192.168.1.20:4319/endpoint npm run dev -w @facet/desktop
```

## 连接方式与身份

主机只跑一套按行编码的协议，跑在哪条字节流上都一样：

- **本机**：连接位置是固定契约——优先 `$XDG_RUNTIME_DIR/facet.sock`（开发实例 `facet-dev.sock`），没有运行目录时退回 `<数据目录>/facet.sock`。只监听这个 unix socket，不开任何端口；`FACET_PORT` 或 `FACET_HOST` 给出时改成监听 TCP，`FACET_SOCKET` 可以换路径（换了两端得自己对齐）。数据目录里的 `endpoint.json` 只留作排障，不参与连接。
- **远程**：主机清单里填 `user@host`（或 `ssh://user@host:端口`），桌面用进程内的 SSH 库连过去，远端先跑一小段脚本找出实际在跑的 socket（顺序：`/run/user/<uid>/facet.sock`、`facet-dev.sock`、`~/.local/share/facet/facet.sock`、`~/.local/share/facet-dev/facet.sock`），再在那个 socket 上开一条通道。没在跑就再跑一段脚本把它拉起来：脚本只在**已经装了 facet** 的机器上成立，位置就认包安装目录 `/opt/Facet/resources/server`（rpm 与 deb 都装在这里），找不到就直接报「没有安装 facet」，不上传、不安装。脚本作为文本流从标准输入喂给 `/bin/sh`（只用 POSIX 语法，极简容器里也能跑），命令行里只有解释器本身，不拼引号也不受行长限制；远端不开端口、本地也不开端口，也不在远端跑任何命令。认证先用 `~/.ssh/config` 里的私钥、`~/.ssh` 下的私钥与 ssh-agent；没有可用的私钥、或服务器拒绝这把密钥时问一次登录密码，密码留在桌面主进程内存里供重连使用，不写进清单。主机公钥不做校验，`known_hosts` 不参与：能连上那台机器就已经拿到那台机器的账户权限。Windows 远端只监听命名管道时无法用 SSH 通道，退回走远端的 TCP 回环地址。
- **远程端不需要开关**：能拿到这台机器的 SSH 登录权，就等于那台机器的使用者，SSH 通道送进来的连接按本机档处理（管理档），不受 `FACET_REMOTE_PERMISSION` 约束。那条开关收窄的是会自己声明权限档的远程端：Web 端声明操作档，主机缺省把它收成只读，`FACET_REMOTE_PERMISSION=operate` 才放行。
- **权限档**：本机连接与 SSH 通道是管理档；自己声明档位的远程连接（Web）按 `FACET_REMOTE_PERMISSION` 给操作档或只读档。设置与凭证、提供方、项目增删与信任、诊断按入口放行：桌面设备开的通道可以（本机 socket 与 SSH 隧道都算），浏览器入口不行；只读档连会话与文件都不能改，输入区只是发送按钮不可用。远程的写操作记进 `$FACET_DATA_DIR/audit.log`（时间、连接标识、权限档、操作与结果，不含参数与内容）。
- **身份**：unix socket 是 `0600`、所在目录 `0700`，能连上的只可能是同一个用户（和 root），所以本机与 SSH 通道**不再校验应用层令牌**，连上就是自己人。TCP 与 Web 入口拿不到对端身份，仍然要令牌：主机会生成一个随机令牌写进发现文件（`FACET_TOKEN` 可指定，`FACET_NO_TOKEN=1` 关闭校验），连接第一帧是 `{type:"auth",token}`，不匹配直接断开。
- **桌面不直连主机**：渲染进程在沙箱里，连接由主进程按目标建通道（本机走固定 socket，远程按 `host:port`），界面只搬运帧。

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

- **pty 子进程**：`node-pty` 在 server 再往下起的 `pty-server` 子进程里加载，崩溃与突发输出都关在这个进程里，会话与推理轮次不受影响
- **通道**：每个终端一条 `terminal:/<id>`，输出带通道序号，多个端同时看同一个 shell
- **流控**：未确认字符数超过 100_000 让 pty 暂停读，端确认回来降到 5_000 以下再恢复；单帧上限 64KB 字符
- **回滚**：每个终端保留最近 200_000 字符，端挂载或断线重连时先取这份再收增量
- **登记**：`$FACET_DATA_DIR/terminals.json` 记下开过的终端，主机重启后把它们列成已结束，进程已经不在
- **运行时**：`node-pty` 是 N-API 模块，一份构建在 Node 与 Electron 自带的 Node 里都能用，不需要 `electron-rebuild`；打包时把 `pty-server.js` 作为独立入口产物，`.node` 文件放在 asar 外
- **不可用时**：原生模块加载不起来（版本不匹配、缺编译产物）主机在握手里不报 `terminal` 能力，界面隐藏终端入口

界面这边（`packages/ui-terminal`）：

- 底部停靠面板，上缘拖动改高度，高度与展开状态记在本机；`Ctrl + \`` 开关面板
- 每个终端一个标签，标签名取启动目录的最后一段，进程结束后在标签上显示退出码；点标签右边的叉挂断
- 只挂当前标签的 xterm：切标签时卸载并重新挂载，回滚由主机重新给一份，因此标签多了也不会堆实例
- 外观跟着界面配色与等宽字体走：主题一换，背景、前景、光标与选区立刻更新

## 主机与桌面分开运行

主机是独立的进程，桌面只是它的一个端：

- 主机就绪后把端点写进 `$FACET_DATA_DIR/endpoint.json`（Linux 缺省 `~/.local/share/facet`，Windows 缺省 `%LOCALAPPDATA%\facet`），日志写进同目录的 `host.log`。
- 桌面拉起主机时让它自成一组，应用退出后主机留在后台；下次启动读到发现文件并与主机握上手，就直接接上，会话与运行中的任务都还在。
- 关掉窗口后主机一律留在后台：应用里没有「退出时结束主机」的开关，也没有结束主机的按钮。要停就按数据目录里的 `endpoint.json` 找进程号自行结束，开发时在起主机的终端里 Ctrl+C。

安装版启动会读取 `~/.pi/agent` 下的凭证与模型配置；开发态读取 `~/.pi/agent-dev`。没有凭证时先在设置页的「模型」里点「添加提供商」配好密钥，或改用自定义提供方。

## 右侧栏

主界面右侧是可折叠的两页栏，宽度可拖（260–480）：

- **文件**：惰性目录树，点文件在栏内用 CodeMirror 6 打开；只读查看，切到编辑后 `Mod+S` 保存，写入前比对 revision，磁盘上被改过时提示冲突
- **变更**：工作树相对 `HEAD` 的改动，分支与上下游、每个文件的状态与增删行数，点开就地看 unified diff

## 校验

```bash
npm run typecheck   # 并行检查全部工作区，各包增量复用 tsbuildinfo
npm run lint        # biome
npm run test        # vitest，所有工作区
```

模型信息库是人工维护的数据快照，不参与上述检查：

```bash
npm run catalog:update  # 从 models.dev/api.json 抓一次，覆盖 tools/model-catalog/models.json
npm run catalog:check   # 只比较，库落后于上游时退出码 1
```

口径见 `tools/model-catalog/README.md`。

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
| `tools/model-catalog` | 模型信息库的抓取脚本与说明；数据落在 `packages/agent/data/models.json`，人工更新 |

依赖方向单向：`protocol ← services / agent / client-core / transport ← ui ← apps`。

## 字体

界面字体与代码字体都打进构建产物，不依赖系统装没装：

| 用途 | 字体 | 字重 | 来源 |
|---|---|---|---|
| 界面 Latin 与数字 | Inter | 400 / 500 / 600 | `@fontsource/inter` |
| 界面汉字与中文标点 | Noto Sans SC Variable | 100–900（可变字体） | `@fontsource-variable/noto-sans-sc`，按 unicode-range 分片，OFL-1.1 |
| 代码字体 | Maple Mono NF | 400 / 600 | `packages/ui/src/assets/fonts/` 下的 woff2，只含 Latin、符号、制表符与 Nerd Font 图标，OFL-1.1，许可文本同目录 |

两段汉字都由 `packages/ui/src/styles/fonts.css` 引入。Noto Sans SC 那一段是可变字体，4.3 MB 分 101 片，字重 100–900 共用同一批文件，覆盖 GB2312 全部汉字的 99.5%、中文标点全中；缺的字由系统字体补上。Maple Mono NF 是两个约 0.5 MB 的子集 woff2（400 / 600），只有 Latin、符号、制表符与 Nerd Font 图标，不含汉字；等宽语境里的汉字由 `--font-mono` 栈第二位的 Noto Sans SC 接手，所以代码块与终端里的中文按比例宽排，不再凑整两个等宽字符。

代码字体取自本机的 Maple Mono NL NF CN v7.9（汉字与全角标点在那一步就去掉了，所以族名只叫 Maple Mono NF），要重新生成：

```bash
scripts/build-fonts.sh            # 缺省读 ~/.fonts
scripts/build-fonts.sh <字体目录>
```

设置页的外观按「本机 / 通用 / 字体 / 代码配色」分成几组卡片，字体那组列出代码、编辑器、终端三处可换的字体：

| 设置项 | 作用范围 | 留空或默认时 |
|---|---|---|
| 界面缩放 | 整个界面 | 100%，可选 80–150 |
| 代码字体 | 聊天里的代码块与补丁 | Maple Mono NF |
| 编辑器字体 | 右栏打开的文件 | 代码字体那一行填的值，没填就是 Maple Mono NF |
| 终端字体 | 底部终端 | 代码字体那一行填的值，没填就是 Maple Mono NF |

界面字体固定为 Inter 与 Noto Sans SC Variable，正文字号固定为 15px；代码块字号固定为 12.5px。整体大小由界面缩放控制，编辑器字号与终端字号各自可调。

配色是一套浅色加五套深色（`dark` 为缺省，强调色钴蓝 `#60a5fa`），代码高亮另有八套可选，浅深跟随界面主题。全部取值在 `packages/ui/src/styles/theme.css`。

## 数据放在哪

| 路径 | 内容 | 覆盖方式 |
|---|---|---|
| `~/.pi/agent`（开发态 `~/.pi/agent-dev`） | 凭证 `auth.json`、模型 `models.json`、设置、会话目录 | `FACET_AGENT_DIR`（开发态 `FACET_DEV_AGENT_DIR`） |
| `$XDG_DATA_HOME/facet`（缺省 `~/.local/share/facet`，Windows 上是 `%LOCALAPPDATA%\facet`） | 主机身份 `host.json`、项目清单 `projects.json`、界面设置 `settings.json`、终端登记 `terminals.json`、审计 `audit.log`；独立启动时还有发现文件 `endpoint.json` | `FACET_DATA_DIR` |
| `$XDG_CONFIG_HOME/facet`（缺省 `~/.config/facet`） | 桌面本地记录 `desktop.json`：窗口位置与尺寸 | — |

开发实例的三处目录都带 `-dev` 后缀：数据目录是 `~/.local/share/facet-dev`（Windows 上是 `%LOCALAPPDATA%\facet-dev`），配置目录是 `~/.config/facet-dev`，pi 数据目录是 `~/.pi/agent-dev`。`npm run dev`（即 `dev:split`）与 `dev:host` 都用这一套，因此开发时跑的东西与装好的包互不影响，`projects.json`、主机身份与 pi 会话各有一份。

开发态取 pi 数据目录时只认 `FACET_DEV_AGENT_DIR`，不认 `FACET_AGENT_DIR` 与 `PI_CODING_AGENT_DIR`：主机在自己进程里把 pi 数据目录写回环境并传给子进程，从 facet 自带的终端、或从 pi 拉起的 shell 里启动开发时，这两个变量已经指向真实目录，跟着走就会把开发期的会话与凭证写进 `~/.pi/agent`。启动日志会打出实际生效的两个目录。

Windows 上没有 XDG 变量，数据目录按约定落在 `%LOCALAPPDATA%`：`%LOCALAPPDATA%\facet`（开发态 `facet-dev`，缺席时用 `%USERPROFILE%\AppData\Local`）；pi 数据目录仍是 `%USERPROFILE%\.pi\agent`，桌面本地记录落在 Electron 的 `%APPDATA%\facet\desktop.json`。主机、桌面与开发脚本用的是同一套推导：数据目录既决定发现文件的位置，也是命名管道名字的摘要来源。

发布版与 pi 命令行共用 `~/.pi/agent` 的凭证与模型配置；开发态用 `agent-dev`，避免开发期的会话混进真实目录。

主机标识在首次启动时生成并写入 `host.json`：取 `/etc/machine-id` 拼上数据目录做 SHA-256，取前 20 位；读不到 machine-id 时改用时间戳加随机串。同一台机器跑多份（不同数据目录）各有各的标识，删掉 `host.json` 即可换一个。

## 打包

Linux 出 rpm、deb 与 tar.gz（x86_64 与 arm64 各一套，共六个），Windows 出 x64 的 NSIS 安装包；
macOS 与 AppImage 不做。

```bash
npm run dist                   # 先打独立主机产物，再按宿主平台出安装包
npm run dist -w @facet/desktop # 只出安装包，要求主机产物已经打好
```

版本号写在仓库里：根 `package.json` 与 `apps/desktop/package.json`（产物名与 `app.getVersion()`
都取自后者）。发版时由维护者指定版本、改好版本号、提交一次发布提交，再在提交上打
`v<版本>` 标签；流水线按仓库里的版本构建，不从标签反填。

```bash
node scripts/sync-version.mjs 0.2.0   # 两处一起改成 0.2.0
git commit -am "chore(release): 0.2.0" # 发布提交
git tag -a v0.2.0 -m "facet 0.2.0" && git push origin main v0.2.0
```

Linux 产物在 `apps/desktop/dist/`，归档名里的架构串随格式变（由 electron-builder 决定，不手写）：

| 格式 | x86_64 | arm64 | 说明 |
|---|---|---|---|
| rpm | `facet-<版本>-x86_64.rpm` | `facet-<版本>-aarch64.rpm` | Fedora、RHEL 系 |
| deb | `facet-<版本>-amd64.deb` | `facet-<版本>-arm64.deb` | Debian、Ubuntu 系 |
| tar.gz | `facet-<版本>-x64.tar.gz` | `facet-<版本>-arm64.tar.gz` | 免安装，解压即用 |

Windows 产物同样在 `apps/desktop/dist/`：

| 产物 | 文件名 | 说明 |
|---|---|---|
| NSIS 安装包 | `facet-<版本>-x64-setup.exe` | 双击安装，可改安装目录，装在当前用户下，不要求管理员 |

两个平台都按宿主平台打，不能交叉编：`node-pty` 是原生模块（N-API，`npm ci` 按当前架构取），
`scripts/build-server.mjs` 也按宿主平台下载自带的 Node 运行时（Linux 上是 `bin/node`，
Windows 上是 `bin/node.exe`）。

Linux 包的 glibc 底线取决于**编译原生模块那台机器**：`pty.node` 与 `sshcrypto.node` 是现场
编译的，符号版本跟着编译机的 glibc 走（Ubuntu 24.04 上编出来要 2.39）。目标是 Ubuntu 20.04
（glibc 2.31），所以 CI 把 `npm ci` 放进 `rockylinux:8`（glibc 2.28）容器里跑，其余步骤留在
runner 上；`node scripts/check-glibc.mjs --max 2.31` 会把这条底线钉住，超了就构建失败。

Linux：

- 安装到 `/opt/Facet`，可执行文件是 `facet`，桌面项 `facet.desktop` 与 `StartupWMClass` 都是 `facet`；图标按 16/24/32/48/64/128/256/512/1024 九档装进 `/usr/share/icons/hicolor/<size>/apps/`，全部由 `apps/desktop/build/icon.svg` 渲染，16/24/32 那三档用 `icon-small.svg` 的简化版（去掉发光与虚线、线条加粗）
- 依赖走 electron-builder 的缺省清单（deb：`libgtk-3-0`、`libnss3`、`libxss1`、`libxtst6` 等；rpm：`gtk3`、`nss`、`libXScrnSaver` 等），不手写
- `node-pty` 的原生模块与 `spawn-helper` 解包在 `resources/app.asar.unpacked`，打包时只留 linux 的构建产物，源码与其它平台的预编译都剔掉
- 构建 deb/rpm 用的 `fpm` 由 electron-builder 自己下载到 `~/.cache/electron-builder`，不需要系统装 fpm
- 渲染产物约 37 MB，主要是随包打的字体（Inter、Noto Sans SC、Maple Mono NF）；Electron 本身约 100 MB

Windows：

- 图标是 `apps/desktop/build/icon.ico`（16–256 六档，从同目录 `icon.svg` 渲染），NSIS 段配置在 `apps/desktop/electron-builder.yml`
- 本机主机走命名管道，没有 unix socket；管道名取数据目录摘要，开发实例与发布实例各自一份
- 升级与卸载前会跑 `apps/desktop/build/stop-stale-server.ps1`（由 `build/installer.nsh` 挂到 `customUnInstall`）
  停掉旧版本留下的 server：它是独立进程，占着管道，不停会一直连到旧代码
- 不重编原生模块（`npmRebuild: false`）：真正加载 `node-pty` 的是 `resources/server` 里按 Node 构建的那份，
  为 Electron 的 ABI 再编一遍没有必要，Windows 上还会要求装了 Spectre 缓解库的 MSVC
- 安装包未签名：别的机器上首次运行会触发 SmartScreen 提示，正式分发要配代码签名证书
- 数据与配置目录：数据目录是 `%LOCALAPPDATA%\facet`（开发态 `facet-dev`），pi 数据目录是 `%USERPROFILE%\.pi\agent`

开发与打包都用同一份独立产物起主机：桌面拉起 `resources/server/bin/node resources/server/lib/server.mjs`（Windows 上是 `bin\node.exe`），开发态则是 `apps/desktop/dist-server/bin/node dist-server/lib/server.mjs`；`npm run dev`（即 `dev:split`）由脚本先起这份产物，桌面按固定 socket 连过去。原生模块只按 Node ABI 编一次，与桌面那份 Electron 运行时互不相干。

### CI

`.github/workflows/pr.yml`：对进 `main` 的 PR（打开、更新、重开）跑五条门禁，不打包、不建
Release；同一 PR 反复推送只留最新一轮。门禁本身抽成可复用工作流 `.github/workflows/gates.yml`，
`build.yml` 发包前调用的也是同一份，两处口径不会走偏。

`.github/workflows/build.yml`：推 `v*` 标签（或手动 dispatch）时触发——

1. `ubuntu-24.04` 上先跑五条门禁（`mock:check`、`typecheck`、`lint`、`test`、`build`），不过就不往下走；
2. `ubuntu-24.04` 与 `ubuntu-24.04-arm` 两台原生 runner 各打一套 rpm / deb / tar.gz：`npm ci`
   在 `rockylinux:8` 容器里跑（原生模块按 glibc 2.28 编），打包仍在 runner 上做，最后核对
   产物的 glibc 底线不超过 2.31；
3. `windows-latest` 上先核对 server 产物里是 `bin/node.exe`，再出 x64 的 NSIS 安装包（`--publish never`，只留本机）；
4. 产物按平台作为 workflow artifact 上传（Linux 六个包、Windows 一份 `facet-<版本>-x64-setup.exe`），保留 90 天；
5. 推标签时再跑一个 `release` job：把三份 artifact 解到同一个目录，用 `gh release create` 建同名的
   GitHub Release 并挂上六个 Linux 包与 Windows 安装包（手动 dispatch 不建 Release）；
6. Windows job 缓存 Electron、自带 Node 运行时与 NSIS 工具链，缓存键跟着 `package-lock.json` 与 `.node-version` 走；
7. 版本号取自仓库里的 `package.json`，与打标签前那次发版提交一致，流水线不反填。

macOS 不在流水线里，也没有适配。

## 环境变量

| 变量 | 含义 |
|---|---|
| `FACET_HOST`、`FACET_PORT` | 给出任意一个就改成监听 TCP；缺省只开本地 socket（unix socket 或 Windows 命名管道） |
| `FACET_HOST_NAME` | 主机展示名 |
| `FACET_AGENT_DIR` | pi 数据目录，发布版生效；开发态不读它 |
| `FACET_DEV_AGENT_DIR` | 开发态的 pi 数据目录，缺省 `~/.pi/agent-dev` |
| `FACET_SESSION_DIR` | 会话文件目录，缺省按工作目录分组 |
| `FACET_DATA_DIR` | 应用数据目录 |
| `FACET_REPLAY_LIMIT` | 每个通道保留的动作条数 |
| `FACET_SESSION_IDLE_MS` | 没人订阅且空闲后多久回收会话 |
| `FACET_DEBUG` | 打开主机侧调试日志 |
| `FACET_ENDPOINT` | 桌面连这个主机（`host:port` 或 `ssh://user@host`），不再用本机发现文件 |
| `FACET_SOCKET` | 指定本地 socket 的地址：Linux 上缺省 `$XDG_RUNTIME_DIR/facet.sock`（无运行目录时 `<数据目录>/facet.sock`），Windows 上缺省命名管道 `\\.\pipe\facet-<数据目录摘要>` |
| `FACET_REMOTE_PERMISSION` | 远程连接申请档位的上限：`view`（只读，缺省）或 `operate`（可申请操作档） |
| `FACET_WEB_PORT` | Web 端接入端口，缺省关闭；同一个端口发页面也接 WebSocket |
| `FACET_PTY_SERVER` | pty 子进程入口，缺省与 server 入口同目录（`pty-server.mjs`、`pty-server.js` 或 `pty-server-child.ts`） |
| `FACET_WEB_ROOT` | Web 页面的构建产物目录，缺省不提供页面 |
| `FACET_TOKEN` | 连接令牌，缺省随机生成并写进发现文件 |
| `FACET_NO_TOKEN` | 设为 `1` 时不校验令牌，只用于本机调试 |
| `FACET_PARENT_PID` | 让主机盯着一个进程，那个进程消失后主机自行结束；不再由桌面设置，调试残留进程时用得上 |
| `FACET_PROJECT_DIR` | 启动时打开的项目目录 |
| `FACET_SKIP_ELECTRON_DOWNLOAD` | `1` 表示跳过 Electron 二进制检查 |

## 文档

- `docs/architecture.md`：分层拓扑、依赖禁令、各层不变量与扩展步骤
- `docs/testing.md`：五条自检命令、改到什么跑哪几条、流水线与常见的坑
- `docs/ui_design_specification.md`：界面设计说明
- `docs/i18n.md`：界面语言与文案规则
- `AGENTS.md`：规则与红线（依赖禁令、分支、提交与注释规范）

## 插件与 skill

适配 facet 的 pi 扩展与 skill 放在 `plugins/`，见 [`plugins/README.md`](plugins/README.md)。
