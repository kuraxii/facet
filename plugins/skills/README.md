# skill

每个子目录是一个 pi skill，入口是 `SKILL.md`，frontmatter 至少包含 `name` 与 `description`。

```text
skills/
  example/
    SKILL.md
    references/   可选，放较长资料
```

安装方式与扩展相同，链接到 agent 目录的 `skills` 下：

```sh
ln -s "$PWD/plugins/skills/example" "$HOME/.pi/agent-dev/skills/example"
```

skill 面向模型的判断流程，不承载界面或运行时逻辑；需要工具、命令或界面时做成 `plugins/extensions` 下的扩展，再在 skill 里引用工具名。

当前还没有收录 skill。
