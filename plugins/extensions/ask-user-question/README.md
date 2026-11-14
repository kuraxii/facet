# ask-user-question

facet 适配的结构化提问扩展，工具名 `ask_user_question`。参数 schema、工具描述、prompt guidelines、校验和模型可见结果取自 [`@juicesharp/rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question)，界面换成 facet 输入区上方的结构化卡片。

## 用法

扩展随 server 打包，在 `packages/agent/src/runtime.ts` 的 `BUILTIN_EXTENSIONS` 中登记，创建会话时作为内联扩展注入。它不会写进 pi 的 agent 目录，pi CLI/TUI 的扩展列表不受影响。

如果用户自己在 facet 的 agent 目录里装了同名工具的扩展，内置版本优先；用户扩展的其它工具仍然保留。

模型调用 `ask_user_question({ questions: [...] })`，一次最多 4 题，每题 2–4 个选项：

```ts
{
  questions: [{
    question: "选择项目模板？",
    header: "模板",
    options: [
      { label: "空白项目", description: "只建目录与配置", preview: "…" },
      { label: "示例项目", description: "带示例代码" }
    ],
    multiSelect: false
  }]
}
```

## facet 里的呈现

- 每题一个标签页，标签显示 `header`；已作答的题在标签上打勾。
- 选项用单选圆圈或多选方框，选项说明在标签下方，预览内容是选项列表下方的一块等宽文本。
- 每题的最后一行是 `Type something.`，选中后原地展开输入框；多选题的勾选与自定义文本一起提交。
- 每题有备注框；备注和选择一起进入结果的 `notes`。
- 取消、Esc 返回 rpiv 的 `User declined to answer questions`。

## 与 rpiv 的差异

| 能力 | rpiv | 这里 |
| --- | --- | --- |
| 终端 TUI（标签页、Submit review、折叠、滚轮） | 有 | 不包含；由 facet 卡片承担 |
| 题干、`header`、选项、`description`、`preview`、`multiSelect` | 有 | 有 |
| `Type something.` 自定义答案 | 有 | 有 |
| 每题备注 | 有 | 有，作为 `notes` |
| Submit 页全局备注 `globalNote` | 有 | 暂未实现 |
| 部分提交与 `unanswered` | 有 | 有，卡片允许留空提交 |
| RPC 原生弹窗降级 | 有 | 没有 `askForm` 时返回 `no_custom_ui`，让模型改用聊天文字 |
| 无 UI 时摘掉工具 | 有 | 暂未实现；没有 UI 时调用返回 `no_ui` |
| 配置、i18n、BEL、OSC 状态 | 有 | 不包含 |

## 来源与许可

- schema 与 prompt：`@juicesharp/rpiv-ask-user-question` 的 `tool/types.ts`、`ask-user-question.ts` 中的 `DEFAULT_*` 常量与 `tool/normalize-params.ts`、`tool/validate-questionnaire.ts`、`tool/format-answer.ts`、`tool/response-envelope.ts`。
- 原项目许可证：MIT，Copyright (c) 2026 juicesharp，见 `LICENSE.rpiv`。
- 打包：`packages/agent/src/runtime.ts` 把本目录的默认导出加入 `BUILTIN_EXTENSIONS`，server 构建时由 esbuild 内联。
- 本目录新增的文件：`facet.ts`、`index.ts`、`index.test.ts` 与本文档。
