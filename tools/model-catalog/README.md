# 模型信息库

facet 认识的模型目录，来源固定为 **[models.dev](https://models.dev)** 的
`https://models.dev/api.json`。

这份数据只用来回答「这个模型是什么」——名字、上下文与输出上限、能不能看图、支不支持
reasoning 与工具调用、**思考深度能开到哪几档**、每百万 token 多少钱，以及这个 provider 的
端点和环境变量名。真正发请求用的 provider 与凭证仍由 pi SDK 的模型层管：内置目录 +
`~/.pi/agent/models.json`，这里不参与请求，也不改变 pi 的行为。

## 为什么用 api.json 而不是 models.json

| | `models.json` | `api.json` |
| :--- | :--- | :--- |
| 结构 | 扁平，键是 `provider/model` | 以 provider 分组，模型挂在 provider 下 |
| 条数 | 636 个 canonical 模型 | 324 个 provider / 9996 条（含聚合商重复） |
| 思考深度 | **没有** | `reasoning_options`：`effort` / `budget_tokens` / `toggle` |
| 价格 | **没有** | `cost`，含分档与超长上下文价 |
| provider 端点 | 没有 | `api`、`env`、`doc` |

思考深度是选模型时的硬信息，`models.json` 里完全没有，所以数据源换成 `api.json`。

## 只留 pi 内置的 provider

上游有 324 个 provider，大半是网关与转售——同一个模型换家再列一遍。这里只留**pi SDK 内置的
provider**：从运行时的 `ModelRuntime`（`modelsPath: null`、禁网络刷新）取 id，不写死列表，
pi 升级后名单自然跟上。provider 名下的模型全部保留，不再按 canonical 归属做二次过滤——`azure`、
`amazon-bedrock`、`google-vertex` 卖的虽然是别人的模型，但部署参数与价格确实不同，丢掉就看不
到区域价。

- 结果：**30 个 provider / 1520 个模型 / 1.0 MiB / 1811 行**（上游 324 个 provider）
- 因为 pi 自己也支持 `openrouter`、`opencode` 这类网关，它们会留在库里
- 模型条目本身不改，字段原样保留，只统一成两格缩进

pi 认识、但上游没收录的 provider 不会报错，脚本更新时会列出来：
`ant-ling`、`fireworks`、`kimi-coding`、`openai-codex`、`qwen-token-plan`（含 `-cn` /
`-individual`）、`radius`、`together`、`typesafe`、`vercel-ai-gateway`、`zai-coding-cn`。
上游把这些服务叫别的名字（`fireworks-ai`、`togetherai`、`vercel`），这里不做别名映射——
库的键与 pi 的 provider id 一一对应，对不上就是不收录。

## 更新

人工更新，上游改动不会自动进来：

```bash
npm run catalog:update   # 抓一次，覆盖 models.json
npm run catalog:check    # 只比较，有差异时退出码 1
```

`catalog:check` 按 provider 与模型两级列出新增、删除与改动，够判断这次更新值不值得提交。它
不写文件，流水线里也没有这一步——目录的时效性由维护者判断，不该由构建时间决定。

## 文件

| 文件 | 内容 |
| :--- | :--- |
| `packages/agent/data/models.json` | 从 `api.json` 过滤出的 pi 内置 provider 目录（数据归 agent 层所有） |
| `fetch-models.mjs` | 抓取脚本：下载、校验、过滤、序列化、写盘；带 `--check` 只比较不写 |
| `packages/agent/src/model-catalog.ts` | 给数据套类型、按 provider 与模型 id 取值的入口 |

数据不放在这个目录里：消费它的是 `packages/agent`（模型知识的归属层），脚本只是抓取工具。
文件由 `packages/agent` 的模块 import，打包时被 esbuild 内联进 server 产物，不需要运行时再找
路径。

排版是「provider 元数据逐行、每个模型一行紧凑 JSON」：上游字段又多又深（`modalities.input`
三个模态就能撑出五行），全量缩进会有近七万行，上游每次更新都变成一整片 diff；一个模型一行
之后改哪个模型就只那一行变色。写盘前脚本会把序列化结果读回来比一遍条目数，形状不对就不落盘。

`models.json` 由脚本生成，不进 biome 的格式化（列在 `biome.json` 的 `files.includes` 否定项里），
否则格式化器会把它展开成缩进版、又回到七万行。

## 字段

provider：

| 字段 | 含义 |
| :--- | :--- |
| `id` / `name` | provider 标识与展示名 |
| `api` | API 端点，可直接当 pi `models.json` 里的 `baseUrl`（104/117 有） |
| `env` | 存 key 的环境变量名，如 `["ANTHROPIC_API_KEY"]` |
| `doc` | 官方文档地址 |
| `npm` | 上游 AI SDK 包名，facet 用不到，保留只为对照 |
| `models` | 模型表，键是模型 id |

模型（常用字段）：

| 字段 | 含义 |
| :--- | :--- |
| `id` / `name` | 与键一致；展示名 |
| `reasoning` | 是不是思考模型 |
| `reasoning_options` | **思考深度**：`effort`（`values` 列出可开的档位）、`budget_tokens`（`min`/`max` token 预算）、`toggle`（只有开关） |
| `tool_call` / `structured_output` | 是否支持工具调用 / 结构化输出 |
| `attachment` | 是否支持附件输入 |
| `modalities.input` / `.output` | 模态：`text`、`image`、`audio`、`video`、`pdf` |
| `limit.context` / `.output` | 上下文窗口与单次输出上限（token） |
| `cost` | 每百万 token 单价：`input`、`output`、`cache_read`、`cache_write`，可能带 `tiers` 分档 |
| `canonical_model_id` | 官方条目的规范名，过滤与去重都靠它 |
| `knowledge` / `release_date` / `last_updated` | 知识截止与发布/更新时间 |
| `open_weights` / `family` / `description` | 是否开放权重、家族、说明 |

`effort` 的取值是 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max` 的子集。
pi 的思考档位（`ThinkingLevelMap`）用 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、
`max`——`none` 对应 `off`，其余同名。库里有 833 个模型的 `reasoning_options` 为空，就是没有
档位可调。

## 校验

脚本写盘前会检查：响应是合法 JSON、顶层是对象、provider 不少于 100 个、每个 provider 有
`id`/`name`/`models`、每个模型的 `id` 与键一致；过滤后 provider 不少于 20 个、模型不少于
500 个。三个下限分工不同：第一个挡住「拿到错误页或半截数据」，后两个挡住「pi 的名单取不到
或过滤规则失效把库抽空」。
