# session-names

Automatically names a new session after its first assistant reply. The name is a concise summary of the first user message in that branch.

For forks, only messages written after the fork point belong to the child. Inherited messages and the parent's name are ignored.

## 配置

配置在 `getAgentDir()/session-names.json`：

```json
{
  "model": "provider/model-id",
  "autoNameNewSessions": true,
  "summaryPrompt": "Generate a concise, natural one-sentence session name in the same language as the first user message. Summarize the user's core intent. Return only the name, without quotes, punctuation, or explanation.",
  "maxNameLength": 30
}
```

- `model` 为空时，第一次需要命名会弹出模型选择；选择结果会写回配置。
- `autoNameNewSessions` 为 `false` 时停止自动命名。
- 旧版的 `"overwrite"` 值按开启处理。
- `summaryPrompt` 控制名字使用的语言和风格。
- `maxNameLength` 上限截断到 100 个字符。

## 行为

- 只处理还没有自己的名字的会话。
- 普通会话取第一条用户消息。
- fork 子会话取分叉后第一条用户消息。
- 生成名字期间用户手动改过名字时，不会覆盖用户的选择。
- 生成失败、没有模型或发生异常时保持原样，不影响对话。

## 来源与许可

从 `kuraxii-pi/packages/pi-session-names` 迁移，移除了全量 backfill、`overwrite` 模式和 `/name-sessions` 命令，只保留新会话首轮自动命名。原项目使用 MIT 许可，见 `LICENSE`。
