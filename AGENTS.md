# 开发规范

本文件只写**规则与红线**：依赖禁令、提交与注释规范、界面表达。架构本身——分层拓扑、各层
不变量、扩展步骤——在 `docs/architecture.md`；怎么自检与跑测试在 `docs/testing.md`。

## 文档索引

| 文档 | 内容 |
| :--- | :--- |
| `docs/architecture.md` | 核心原则、Monorepo 拓扑与依赖图、依赖禁令、各层核心不变量、高频场景开发步骤 |
| `docs/layout.md` | 外壳档位、列宽的真值来源、浮层与层级约定 |
| `docs/testing.md` | 五条自检命令各查什么、改到什么跑哪几条、流水线怎么跑、常见的坑 |
| `docs/protocol-rpc.md` | 线格式、帧类型、RPC 方法与单测口径 |
| `docs/ui_design_specification.md` | 界面设计、配色与尺寸规范 |
| `docs/i18n.md` | 界面语言与文案规则 |

## 架构红线

分层细节见 `docs/architecture.md`，下面这几条是必须当场守住的：

- **依赖单向**：`protocol ← agent / client-core / transport ← ui ← apps`，禁止反向引用与循环依赖；允许依赖清单与破例判定看 `docs/architecture.md` 的「依赖禁令」，破例即阻断合并。
- **协议零运行时依赖**：`packages/protocol` 的 `dependencies` 里不放运行时校验库，`typebox` 只进 `devDependencies`。
- **核心是纯函数**：Agent 回合状态与客户端归约不做副作用；网络、进程、定时器与文件操作只出现在边缘外壳层。
- **入站不信任**：网关与传输层收到的原始 JSON 必须先过生成的守卫，处理器里不写零散字段断言，不出现未经校验的 `as Action`。
- **不合并生命周期不同的容器**：会话通道、`session-hub`、终端通道各自回收，不为消除重复抽成带钩子的通用类。

# 开发与提交规范

- 分支名不作规定，开不开分支、叫什么由当时的需要决定。
- 一次提交 SHOULD 只动一个模块（`packages/` 下的一个包或 `apps/` 下的一个应用）的代码，遵循最小改动原则。
- 跨模块改动只允许依赖声明、导入路径、类型定义、构建与配置文件这类使改动生效所必需的部分，且 MUST 在提交说明正文点名涉及的其他模块。
- 依赖方向单向，禁止反向引用：`protocol ← agent / client-core / transport ← ui ← apps`。
- `protocol` MUST 保持零运行时依赖。`client-core` 与 `ui` MUST NOT 引入 `electron`、`node:*`。`services` MUST NOT 引入 `electron` 与 React。
- `plugins/` 下的 pi 扩展与 skill 只依赖 pi SDK、pi-tui 与 typebox，不引用 `@facet/*`；适配 facet 专有能力时做运行时能力检测，缺失时返回明确错误。
- 需要随 facet 分发的扩展加进 `packages/agent/src/runtime.ts` 的 `BUILTIN_EXTENSIONS`，作为内联扩展注入；不得把它写进 pi 的 agent 目录。需要压过用户同名扩展的内置插件，同时加进 `PRIORITY_BUILTIN_PATHS`。
- `apps/server` MUST NOT 依赖 `electron`：主机与它起的子进程一律按 Node 运行，桌面只负责用独立产物里自带的 `bin/node` 跑 `lib/server.mjs`（开发态是 `apps/desktop/dist-server`，打包后是 `resources/server`）把它拉起来，并把环境原样传给它的子进程。
- 提交说明用中文，格式 `<type>(<scope>): <结果>`，`type` 取 `feat` / `fix` / `docs` / `chore` / `refactor` / `perf` / `test`，`scope` 为包名或应用名。
- 提交说明只描述改动完成后的状态与原因，不记录被放弃的做法。
- 不提交 `node_modules/`、`out/`、`dist/`、编辑器临时文件与本地数据目录。
- 需求与设计变更同步更新 `docs/` 下对应文档，并与代码在同一分支提交。
- 不得主动触发 CI。推分支不等于出包：打 `v*` 标签（会触发 `build.yml`）、`workflow_dispatch`、`gh run rerun`、删除重建标签，全部算「触发构建」，只有用户明确要求时才做。日常提交与推送只推分支，不动标签。

# 发版

- 版本号写在仓库文件里：根 `package.json` 与 `apps/desktop/package.json`。产物名与
  `app.getVersion()` 都取自后者，两处 MUST 一致。
- 改版本只用 `node scripts/sync-version.mjs <版本>`，它一次改这两处；不接受只改一处，也不
  接受流水线从标签反填。
- 发版顺序固定：维护者先指定版本 → 改版本号 → 提交一次发布提交（`chore(release): <版本>`）
  → 在这条提交上打 `v<版本>` 标签。标签 MUST 指向带该版本号的提交，否则产物名与源码对不上。
- 推标签会触发发行流水线，属于「不得主动触发 CI」的范围：只在发版时由用户明确要求才做。
- 推标签的那一轮在门禁与两个平台的包都出来之后，会额外建一个同名 GitHub Release 并挂上
  三个平台的产物；手动 dispatch 只验证流水线，不建 Release。
- 进 `main` 的 PR 会跑同一套门禁（`pr.yml` → `gates.yml`），不打包也不建 Release。

# 注释规范

- 本节优先于任何「不写注释」的通用约定；与其他规范冲突时以本节为准。
- 数据结构与字段定义 MUST 有注释：类型、接口、枚举与对象的每个成员，写明含义与取值约束。
- 关键逻辑 MUST 有注释：非显然的判定顺序、失败降级、时序约束、绕过外部限制的处理，都要写明原因。
- 适度：显而易见的代码不写注释，不复述代码本身。
- TypeScript 使用 JSDoc/TSDoc 风格；模块、导出的类型与函数写文档注释，内部实现按第一、二条处理。
- 技术术语保留英文原词，例如 API、JSON、Token、IPC、SSE；解释性文字用简洁中文。
- 注释只描述当前状态与原因，不记录改动历史。
- 加注释 MUST NOT 改动被注释的代码逻辑。

# 样式与尺寸规范

- 位置与间距 MUST 由 `:root` 里的 CSS 变量给出，规则里只引用变量；同一个数值不写在两个选择器里，也不靠多层 padding 叠加凑位置。
- 变量按「一处几何关系一个名字」命名，注释写清它量的是哪两点，例如 `--indent-rail-offset`（竖线到行内容）、`--indent-rail-label`（行内容到短名列）。
- 派生的值用 `calc()` 从变量算，例如 `calc(var(--indent-rail-offset) - 1px)`；一条几何关系里只留一个基准数。
- 新组件需要横向间距时，先看有没有能复用的变量，没有就在 `:root` 里补一个并写清参照物，再在规则里引用。

# 界面表达

- 状态 MUST 由样式本身表达：用颜色、图标、动效区分进行中、完成、失败、未执行，界面里不出现「失败」「未执行」「执行中」这类状态文字。
- 界面文字只描述对象自身——名字、路径、内容、数量；系统状态、行为说明、操作约束都不写成文字。
- 需要解释的地方由控件承担：按钮可用与否、是否灰掉、光标形态，代替写一句话说明为什么不能点。
- 提示信息同样遵守这条：错误、告警只给事实内容，不叠加「出错」之类的标签。
