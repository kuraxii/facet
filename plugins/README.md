# facet 插件与 skill

这里放适配 facet 的 pi 扩展与 skill，和 facet 自身代码一起版本管理。

```text
plugins/
  extensions/    pi 扩展；每个子目录一个扩展，入口是 index.ts
  skills/        pi skill；每个子目录一个 skill，入口是 SKILL.md
```

## 加载方式

`plugins/extensions` 下登记过的扩展会随 server 一起打包，创建会话时作为内联扩展注入，不写入 pi 的 agent 目录，也不影响 pi CLI/TUI 自己安装的插件。新增扩展后需要把它加进 `packages/agent/src/runtime.ts` 的 `BUILTIN_EXTENSIONS`。

skill 与尚未内置的扩展走 pi 的常规发现路径，开发时把目标目录链接到 agent 目录：

```sh
ln -s "$PWD/plugins/extensions/ask-user-question" "$HOME/.pi/agent-dev/extensions/ask-user-question"
ln -s "$PWD/plugins/skills/<name>" "$HOME/.pi/agent-dev/skills/<name>"
```

项目级扩展放在项目的 `.pi/extensions` 下，全局扩展放在 agent 目录的 `extensions` 下。链接后重启 server 或开启新会话，扩展才会重新加载。登记为优先的内置扩展（目前是 `ask-user-question`）与用户安装的同名扩展冲突时，内置版本优先；其余内置扩展仍允许用户版本替换。

## 约定

- 扩展只依赖 pi SDK、pi-tui 与 typebox，不引用 facet 的 workspace 包，这样目录可以整体复制到 agent 目录。
- 扩展通过 `ctx.ui.askForm` 使用 facet 的结构化请求；没有这个入口的宿主应当返回明确错误，而不是伪造用户输入。
- 从其他 MIT 项目复制 schema、prompt 或代码时，在目录里保留来源说明和原始许可证。
- 新增扩展或 skill 时，在 `extensions/README.md` 或 `skills/README.md` 补一行用途说明。
