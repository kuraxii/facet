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

```bash
npm run dev            # 桌面应用，主机作为子进程一起起来
npm run dev:split      # 主机与桌面分开跑，各自热重启
npm run dev:host       # 只起主机，固定 4319 端口
npm run dev:client     # 只起桌面，连 FACET_ENDPOINT 指定的主机
```

`npm run dev` 由桌面主进程拉起主机：主机崩掉会被重启，界面收到新端点后自动重连；关窗口退出时主机一起结束。改主机代码时这条命令会重启整个桌面。

`npm run dev:split` 先起主机（`FACET_PORT`，缺省 4319）再起桌面，改主机代码只重启主机，桌面界面与 Vite 热更新不受影响；两边日志各带 `[host]`、`[desktop]` 前缀。要连别处的主机：

```bash
FACET_ENDPOINT=ws://192.168.1.20:4319/endpoint npm run dev:client
```

首次启动会读取 `~/.pi/agent-dev` 下的凭证与模型配置；没有凭证时先在设置页的提供方里配好密钥，或改用自定义提供方。

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
| `FACET_ENDPOINT` | 桌面连这个主机，不再拉起子进程 |
| `FACET_PARENT_PID` | 主机被桌面拉起时由桌面设置，父进程消失后主机自行结束 |
| `FACET_PROJECT_DIR` | 启动时打开的项目目录 |
| `FACET_SKIP_ELECTRON_DOWNLOAD` | `1` 表示跳过 Electron 二进制检查 |

## 文档

- `docs/requirements.md`：需求与取舍
- `docs/ui_design_specification.md`：界面设计说明
- `docs/backlog.md`：进度、设计取舍与遗留项
- `todo.md`：按优先级排的功能推进顺序
- `AGENTS.md`：分支、提交与注释规范
