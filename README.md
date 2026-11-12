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
npm run dev:host       # 只起主机，固定 4319 端口（FACET_PORT 可换）
npm run dev            # 只起桌面，连 4319
npm run dev:client     # 同上，给需要并排调试时用
npm run dev:split      # 主机与桌面一起起，各自热重启
```

主机端口由 `FACET_PORT` 决定，缺省 4319；桌面端点由 `FACET_ENDPOINT` 决定，开发时缺省是 `ws://127.0.0.1:4319/endpoint`。要连别处的主机：

```bash
FACET_ENDPOINT=ws://192.168.1.20:4319/endpoint npm run dev:client
```

开发时想跑打包那样的本机模式（桌面自己拉起主机）用 `FACET_EMBEDDED=1 npm run dev`；打包运行不带 `FACET_ENDPOINT` 时本来就是本机模式。

## 连接方式与令牌

主机只跑一套按行编码的协议，跑在哪条字节流上都一样：

- **本机**：缺省监听 TCP 回环地址；用 `FACET_SOCKET=/run/user/1000/facet.sock` 之类给出路径时改成监听 unix socket（Windows 上是命名管道），不再开 TCP 端口。
- **远程**：协议本身不依赖 WebSocket，后续接 SSH 通道或中继时不用改协议层。
- **令牌**：主机会生成一个随机令牌写进发现文件（`FACET_TOKEN` 可指定，`FACET_NO_TOKEN=1` 关闭校验）。连接的第一帧是 `{type:"auth",token}`，不匹配直接断开，拿不到 hello。发现文件权限 `0600`、所在目录 `0700`，socket 本身也是 `0600`。
- **桌面不直连主机**：渲染进程在沙箱里，连接由主进程按目标建通道（本机按发现文件，远程按 `host:port`），界面只搬运帧。

## 主机与桌面分开运行

主机是独立的进程，桌面只是它的一个端：

- 主机就绪后把端点写进 `$FACET_DATA_DIR/endpoint.json`（Linux 缺省 `~/.local/share/facet`），日志写进同目录的 `host.log`。
- 桌面拉起主机时让它自成一组，应用退出后主机留在后台；下次启动读到发现文件并与主机握上手，就直接接上，会话与运行中的任务都还在。
- 关掉窗口后是否继续在主机清单里切换：「关掉窗口后继续运行」勾上时应用退出不动主机，取消勾选则应用退出会连主机一起结束。
- 主机清单里的「结束主机」需要再点一次确认，结束后停在「连不上主机」，可以直接重启应用或用 `npm run dev:host` 再起一台。

首次启动会读取 `~/.pi/agent-dev` 下的凭证与模型配置；没有凭证时先在设置页的提供方里配好密钥，或改用自定义提供方。

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

设置页的外观分类可以把这两项改成别的字体，留空即回到上面两个默认值。

配色是一套浅色加五套深色（`zinc` 为缺省），代码高亮另有八套可选，浅深跟随界面主题。全部取值在 `packages/ui/src/styles/theme.css`。

## 数据放在哪

| 路径 | 内容 | 覆盖方式 |
|---|---|---|
| `~/.pi/agent-dev` | 凭证 `auth.json`、模型 `models.json`、设置、会话目录 | `FACET_AGENT_DIR` |
| `$XDG_DATA_HOME/facet`（缺省 `~/.local/share/facet`） | 主机身份 `host.json`、项目清单 `projects.json`、界面设置 `settings.json`；独立启动时还有发现文件 `endpoint.json` | `FACET_DATA_DIR` |
| `$XDG_CONFIG_HOME/facet`（缺省 `~/.config/facet`） | 桌面本地记录 `desktop.json`：窗口位置与尺寸 | — |

用 `agent-dev` 而不是 `~/.pi/agent`，是为了和 pi 命令行共用凭证与模型配置，同时不把开发期的会话混进真实目录。

主机标识在首次启动时生成并写入 `host.json`：取 `/etc/machine-id` 拼上数据目录做 SHA-256，取前 20 位；读不到 machine-id 时改用时间戳加随机串。同一台机器跑多份（不同数据目录）各有各的标识，删掉 `host.json` 即可换一个。

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
