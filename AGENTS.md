# 开发与提交规范

- 分支模型：`main` 为可运行主线；`dev` 只承载前期设计（`docs/` 与规范文件），设计定稿后合入 `main`，此后开发从 `main` 切出；`feature-<name>` 与 `fix-<name>` 均从 `main` 切出并合回 `main`。
- 新功能 MUST 在 `feature-<name>` 分支开发，完成后合入 `main`；合入用 squash，使 `main` 上一个功能对应一条提交。
- 缺陷修复用 `fix-<name>`，文档与规范改动提交到 `dev`。
- 一个分支 SHOULD 只动一个模块（`packages/` 下的一个包或 `apps/` 下的一个应用）的代码，遵循最小改动原则。
- 跨模块改动只允许依赖声明、导入路径、类型定义、构建与配置文件这类使改动生效所必需的部分，且 MUST 在提交说明正文点名涉及的其他模块。
- 依赖方向单向，禁止反向引用：`protocol ← services / agent / client-core / transport ← ui ← apps`。
- `protocol` MUST 保持零运行时依赖。`client-core` 与 `ui` MUST NOT 引入 `electron`、`node:*`。`services` MUST NOT 引入 `electron` 与 React。
- 提交说明用中文，格式 `<type>(<scope>): <结果>`，`type` 取 `feat` / `fix` / `docs` / `chore` / `refactor` / `perf` / `test`，`scope` 为包名或应用名。
- 提交说明只描述改动完成后的状态与原因，不记录被放弃的做法。
- 提交前 MUST 通过 `npm run typecheck`、`npm run lint`、`npm run test`（无测试文件的包自动跳过）。
- 不提交 `node_modules/`、`out/`、`dist/`、编辑器临时文件与本地数据目录。
- 需求与设计变更同步更新 `docs/` 下对应文档，并与代码在同一分支提交。
