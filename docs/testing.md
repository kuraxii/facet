# 测试与自检

本文件说明仓库里有哪些检查、每条查什么、改到什么该跑哪几条，以及失败时从哪儿看。它只是
操作说明：要不要跑、跑到什么程度由改动范围与当时的判断决定。

## 五条命令

都在仓库根目录跑，`npm run <名字>`：

| 命令 | 查什么 | 本机耗时 |
| :--- | :--- | ---: |
| `mock:check` | 协议一致性冒烟：起一个假主机，走握手、读取、订阅、发送与停止，确认帧与动作没有偏离契约 | ~30s |
| `typecheck` | 全仓 workspace 与 `tools/mock-server` 的静态类型（含独立 TS 项目） | ~5s |
| `lint` | `biome check`：格式、明显错误、React Hooks 依赖规则 | ~0.2s |
| `test` | 各包单元测试：协议类型等价、纯函数归约、混沌集成（假主机上的迟到回执、重复投递、被拒发送） | ~15s |
| `build` | 全仓生产构建：renderer、main、preload 与各包产物 | ~30s |

`npm run test -w <包名>` 只跑一个包，例如 `npm run test -w @facet/ui`；vitest 支持
`npm run test -w @facet/ui -- -t "关键词"` 只跑某几条用例。

## 改到什么跑什么

- **只改文档**（`docs/`、`README.md`、`AGENTS.md`）：不用跑任何一条，扫一眼渲染即可。
- **改 `packages/protocol`**：`mock:check` + `typecheck`。改了 `schema/contracts.ts` 或
  `wire.ts` 之后要先 `npm run gen:checks -w @facet/protocol` 重新生成守卫，`parity.test.ts`
  会核对生成物与契约是否一致。
- **改界面或交互**（`packages/ui*`、`apps/desktop/src/renderer`）：`typecheck` + `lint` +
  `test`，必要时 `npm run dev` 手动看效果。
- **改状态机或客户端核销**（`packages/agent`、`packages/client-core`、`apps/server`）：
  带上 `test`；改动涉及跨端异步确认时，先在 `tools/mock-server` 里补故障场景再写用例。
- **改构建、打包或依赖**：`build` 必跑；动了原生模块或打包配置时实际出一个包看结果。
- 拿不准就整套跑一遍，五分钟内能跑完。

## 提交与合入

日常提交不要求全部跑完，按上表挑相关的几条。合回 `main` 之前把相关的都跑一遍，红了先修。

## 流水线

`.github/workflows/build.yml` 在推 `v*` 标签（或手动 dispatch）时触发：

1. `gates`：在 `ubuntu-24.04` 上按顺序跑上面五条；
2. `linux x64` / `linux arm64`：`npm ci` 放进 `rockylinux:8` 容器（原生模块按 glibc 2.28 编），
   其余在 runner 上，出 rpm / deb / tar.gz，并核对产物的 glibc 底线不超过 2.31；
3. `windows x64`：核对自带 Node 运行时后出 NSIS 安装包。

## 几个坑

- **`test` 里会建临时 git 仓库**：用例自己屏蔽全局与系统配置、钉死提交身份，本机没配
  `user.name` 也能跑；反过来，本机的 `commit.gpgsign` 之类也不会影响用例。
- **`mock:check` 占端口**：冒烟会起假主机，端口被占时会直接失败，先看有没有残留进程。
- **界面单测默认没有 DOM**：绝大多数用例用 `react-dom/server` 只验标记。要真的点击、按键的用例（例如 `workspace-tab-bar.test.tsx`）在文件头用 `// @vitest-environment jsdom` 切环境；`jsdom` 是 `packages/ui` 的 devDependency，浏览器 API（`ResizeObserver` 等）由用例自己补桩。
- **CI 与本机的 glibc 不一样**：本机产物只能在本机这类新系统上跑，能给老系统的包从 CI 取
  （判据是 `node scripts/check-glibc.mjs --max 2.31`）。
- **`npm run dev` 的界面点不动，先看根节点有没有套 StrictMode**：开发态双挂载之后这棵树的
  更新进不了根队列，界面停在第一次提交的画面上——看着正常，按钮与快捷键全没反应，控制台却
  一条报错都没有。渲染层的入口因此不套 StrictMode；`npm run dev` 与打包产物的差别只在渲染层
  是否走 vite dev server，要判断是不是同一类问题，用 `electron apps/desktop/out/main/index.js`
  跑打包后的渲染层对照一下。
