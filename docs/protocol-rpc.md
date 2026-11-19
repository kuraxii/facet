# 协议校验与 RPC 分发

请求与动作的形状只声明一次，运行时的校验由构建期生成。链路是：

```
packages/protocol/src/schema/contracts.ts   参数与动作的 Schema（构建期，引 typebox）
        │  npm run gen:checks -w @facet/protocol
        ▼
packages/protocol/src/generated/checks.ts   自包含判断函数 + 权限档表（提交入库，不引 typebox）
        │
        ▼
apps/server/src/rpc/gateway.ts              查契约、判权限档、映射错误
        │
        ▼
apps/server/src/rpc/handlers/*.ts           各领域的具体实现
```

## 契约

`src/schema/contracts.ts` 里有三张表：

- `REQUEST_SCHEMAS`：56 个请求方法的参数 Schema 与权限档。`RequestParams` 由它推导，
  `src/schema/parity.test.ts` 冻结了重构前手写的声明确认两者逐方法完全相同。
- `DISPATCH_SCHEMAS`：8 个客户端可派发动作。表里没有的 `type` 一律按主机内部事件拒绝，
  客户端不能伪造 `sessions/*`、`chat/delta` 这类只由主机产生的动作。
- `SERVER_FRAME_SCHEMAS`：主机推送的帧信封，传输层用它替掉 `as unknown as ActionFrame`。

权限档只有三档：`public` 谁都能调，`write` 只读连接不能调，`admin` 只有能改主机配置的
连接能调（桌面入口，浏览器入口一律不放行）。

## 生成的限制

TypeBox 的 `Code()` 会带三条 `typebox/*` 的 import，还会把 `pattern`、`format`、`minLength`
编译成外部变量。这些都会破坏「运行时不依赖 typebox」，所以 Schema 里：

- 不写 `pattern` 与 `format`：通道格式这类约束交给 `rpc/helpers.ts` 的 `requireChannel`。
- 不写 `minLength`：需要非空的字段在条目上写 `nonEmpty`，生成器把判断拼在外面。
- 不关 `additionalProperties`：端点历来忽略多余字段。

生成脚本落盘前会自检：判断体里没有 `typebox` / `Hashing` / `Format` / `Guard` / `External`
这些外部名字，随后用本包的 `tsconfig.json` 跑一遍 `tsc --noEmit`。生成文件在 biome 里关闭
格式与 lint（`biome.json` 的 overrides），因为它不是手写代码。

## 分发

`rpc/gateway.ts` 两条路：

- `handleRequest`：查 `REQUEST_CONTRACTS`（查不到就是 `unknown_method`）→ 判权限档（被拒的
  记审计）→ 校验参数（`bad_params`）→ 查 `REQUEST_HANDLERS` 调处理器。处理器表按
  `RequestMethod` 映射，漏实现一个方法就编译不过。
- `handleDispatch`：校验帧与通道种类 → 只读连接直接回拒绝帧 → 查 `DISPATCH_CONTRACTS`
  （查不到按主机内部事件拒绝）→ 校验载荷 → 交给 `chatHandlers` 执行。受理后立即返回，
  结果的成败由通道上的动作与拒绝帧反映。

提供方登录不是一次请求能说完的：`providerLoginStart` 起一条登录，`providerLoginRespond` 回
当前这一步，`providerLoginCancel` 中止，三者都是 `admin` 档（写入凭证）。进展走主机级的
`models:/<hostId>` 通道（`models/loginEvent`），要浏览器回调与多步问答的流程因此同样能被
远端界面驱动。

处理器按领域放在 `rpc/handlers/`：`session-handlers.ts`、`chat-handlers.ts`、
`terminal-handlers.ts`、`system-handlers.ts`。每个处理器只拿已经校验过的参数，不再做形状
检查；语义约束（目录必须存在、通道必须可订阅、终端必须登记过）留在处理器与 `rpc/helpers.ts`。

`endpoint.ts` 只负责承载：切帧、认证、监听，以及 Web 入口的 HTTP 升级。Web 静态资源在
`http/static.ts`。
