# 开发与提交规范

- 分支模型：`main` 为可运行主线；`dev` 承载最终态的文档与基础架构，定稿后合入 `main`，此后开发从 `main` 切出；`feature-<name>` 与 `fix-<name>` 均从 `main` 切出并合回 `main`。
- 交付到 `main` 的是最终态的文档与可运行的基础架构，中间态与草稿不进入 `main`。
- `dev` 上的提交不受校验约束，可直接提交；合入 `main` 前 MUST 通过 `npm run typecheck`、`npm run lint`、`npm run test`（无测试文件的包自动跳过）。
- 新功能 MUST 在 `feature-<name>` 分支开发，完成后合入 `main`；合入用 squash，使 `main` 上一个功能对应一条提交。
- 缺陷修复用 `fix-<name>`，文档与规范改动提交到 `dev`。
- 一个分支 SHOULD 只动一个模块（`packages/` 下的一个包或 `apps/` 下的一个应用）的代码，遵循最小改动原则。
- 跨模块改动只允许依赖声明、导入路径、类型定义、构建与配置文件这类使改动生效所必需的部分，且 MUST 在提交说明正文点名涉及的其他模块。
- 依赖方向单向，禁止反向引用：`protocol ← services / agent / client-core / transport ← ui ← apps`。
- `protocol` MUST 保持零运行时依赖。`client-core` 与 `ui` MUST NOT 引入 `electron`、`node:*`。`services` MUST NOT 引入 `electron` 与 React。
- `apps/server` MUST NOT 依赖 `electron`：主机与它起的子进程一律按 Node 运行，桌面只负责用 `process.execPath` 加 `ELECTRON_RUN_AS_NODE=1` 把它拉起来，并把环境原样传给它的子进程。
- 提交说明用中文，格式 `<type>(<scope>): <结果>`，`type` 取 `feat` / `fix` / `docs` / `chore` / `refactor` / `perf` / `test`，`scope` 为包名或应用名。
- 提交说明只描述改动完成后的状态与原因，不记录被放弃的做法。
- 不提交 `node_modules/`、`out/`、`dist/`、编辑器临时文件与本地数据目录。
- 需求与设计变更同步更新 `docs/` 下对应文档，并与代码在同一分支提交。

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
