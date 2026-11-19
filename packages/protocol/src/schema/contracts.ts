/**
 * 构建期契约：请求参数与派发动作的 Schema。
 *
 * 这张表只在构建期使用：`typebox` 是本包的 devDependency，任何运行时产物里都不能出现它。
 * `scripts/gen-checks.mjs` 读这张表，用 TypeBox 的代码生成器把每个 Schema 编译成自包含的
 * 校验函数，写进 `src/generated/checks.ts`；运行时的网关只看生成物与 `contract.ts` 的类型。
 *
 * 约定：
 *
 * - 不写 `pattern` 与 `format`：TypeBox 会把它们编译成外部变量（`External[i].test`），摘不掉，
 *   通道格式这类约束交给处理器用 `parseChannel` 这一类函数判断。
 * - 不关 `additionalProperties`：端点历来忽略多余字段，收紧会拒掉老端点发来的未知键。
 * - 深层的领域结构用 `Unsafe<T>` 包住：这些类型本身由产出方保证，端点只做浅层形状检查，
 *   与重构前的手工校验一致。
 */

import type { TSchema } from "typebox";
import { Type, Unsafe } from "typebox";
import type { Channel } from "../channel.ts";
import type { AuthTier } from "../contract.ts";
import type { FacetSettings } from "../settings.ts";

/** 一条请求方法的构建期描述。 */
export interface RequestSchemaEntry {
	/** 调用这个方法需要的权限档 */
	readonly auth: AuthTier;
	/** 参数的 Schema */
	readonly params: TSchema;
	/** 这些顶层字段必须是非空字符串；重构前由 `requiredString` 把关 */
	readonly nonEmpty?: readonly string[];
}

/** 一条客户端可派发动作的构建期描述。 */
export interface DispatchSchemaEntry {
	/** 需要的权限档 */
	readonly auth: AuthTier;
	/** 整条动作的 Schema，含 `type` 字段 */
	readonly action: TSchema;
}

/** 标识类字段：重构前的 `requiredString` 拒绝空串，这里保持一致。 */
const Id = Type.String();
const SessionFile = Id;
const SessionId = Id;
const Cwd = Id;
const Path = Id;

/** 思考档位，与 `ThinkingLevel` 同一组取值。 */
const ThinkingLevel = Type.Union([
	Type.Literal("off"),
	Type.Literal("minimal"),
	Type.Literal("low"),
	Type.Literal("medium"),
	Type.Literal("high"),
	Type.Literal("xhigh"),
	Type.Literal("max"),
]);

/** 运行中投递方式，与 `StreamingBehavior` 同一组取值。 */
const StreamingBehaviorSchema = Type.Union([Type.Literal("steer"), Type.Literal("followUp")]);

/** 模型定位键。 */
const ModelRef = Type.Object({ provider: Id, id: Id });

/** 会话里的定位参数，五个会话命令共用同一组字段。 */
/**
 * 没有参数的方法。
 *
 * `Type.Record(String, Never)` 会编译成外部变量，`Type.Object({})` 的静态类型又不是
 * `Record<string, never>`，所以用 `Unsafe` 把两者对齐：运行时只认「是个对象」。
 */
const NoParams = Unsafe<Record<string, never>>(Type.Object({}));

/**
 * 方法名到参数 Schema 与权限档的表。
 *
 * 权限档沿用端点一直以来的三档：`public` 谁都能调，`write` 只读连接不能调，`admin` 只有能改
 * 主机配置的连接能调。这里不再另设一层「浏览器入口」判断，那一条由网关按 `canManage` 决定。
 */
export const REQUEST_SCHEMAS = {
	respondUi: {
		auth: "write",
		params: Type.Object({
			sessionId: SessionId,
			requestId: Id,
			response: Type.Union([
				Type.Object({ kind: Type.Literal("cancel") }),
				Type.Object({ kind: Type.Literal("select"), value: Type.String() }),
				Type.Object({ kind: Type.Literal("confirm"), confirmed: Type.Boolean() }),
				Type.Object({ kind: Type.Literal("input"), value: Type.String() }),
				Type.Object({ kind: Type.Literal("editor"), value: Type.String() }),
				Type.Object({
					kind: Type.Literal("form"),
					answers: Type.Array(
						Type.Object({
							id: Id,
							selections: Type.Array(Type.String()),
							custom: Type.Optional(Type.String()),
							comment: Type.Optional(Type.String()),
						}),
					),
				}),
			]),
		}),
		nonEmpty: ["sessionId", "requestId"],
	},
	listSessions: {
		auth: "public",
		params: Type.Object({ cwd: Type.Optional(Cwd) }),
	},
	listCommands: {
		auth: "public",
		params: Type.Object({ sessionId: SessionId }),
		nonEmpty: ["sessionId"],
	},
	busySessions: { auth: "public", params: NoParams },
	createSession: {
		auth: "write",
		params: Type.Object({
			cwd: Type.Optional(Cwd),
			model: Type.Optional(ModelRef),
			thinkingLevel: Type.Optional(ThinkingLevel),
			tools: Type.Optional(Type.Array(Type.String())),
			excludeTools: Type.Optional(Type.Array(Type.String())),
			name: Type.Optional(Type.String()),
		}),
	},
	openSession: {
		auth: "public",
		params: Type.Object({ sessionFile: SessionFile, cwd: Type.Optional(Cwd) }),
		nonEmpty: ["sessionFile"],
	},
	forkSession: {
		auth: "write",
		params: Type.Object({
			sessionFile: SessionFile,
			beforeEntryId: Type.Optional(Type.String()),
			cwd: Type.Optional(Cwd),
		}),
		nonEmpty: ["sessionFile"],
	},
	snapshot: {
		auth: "public",
		params: Type.Object({ sessionId: SessionId }),
		nonEmpty: ["sessionId"],
	},
	entries: {
		auth: "public",
		params: Type.Object({
			sessionId: SessionId,
			cursor: Type.Optional(Type.String()),
			limit: Type.Optional(Type.Number()),
		}),
		nonEmpty: ["sessionId"],
	},
	entriesAfter: {
		auth: "public",
		params: Type.Object({ sessionId: SessionId, afterEntryId: Type.Optional(Type.String()) }),
		nonEmpty: ["sessionId"],
	},
	subscribe: {
		auth: "public",
		params: Type.Object({ channel: Unsafe<Channel>(Type.String()), since: Type.Optional(Type.Number()) }),
	},
	unsubscribe: {
		auth: "public",
		params: Type.Object({ channel: Unsafe<Channel>(Type.String()) }),
	},
	models: {
		auth: "public",
		params: Type.Object({ providerId: Type.Optional(Type.String()) }),
	},
	availableModels: { auth: "public", params: NoParams },
	providers: { auth: "public", params: NoParams },
	listDirectory: {
		auth: "public",
		params: Type.Object({ cwd: Cwd, path: Path }),
		nonEmpty: ["cwd"],
	},
	readFile: {
		auth: "public",
		params: Type.Object({ cwd: Cwd, path: Path }),
		nonEmpty: ["cwd", "path"],
	},
	writeFile: {
		auth: "write",
		params: Type.Object({
			cwd: Cwd,
			path: Path,
			content: Type.String(),
			expectedRevision: Id,
		}),
		nonEmpty: ["cwd", "path", "expectedRevision"],
	},
	gitStatus: {
		auth: "public",
		params: Type.Object({ cwd: Cwd }),
		nonEmpty: ["cwd"],
	},
	gitDiff: {
		auth: "public",
		params: Type.Object({ cwd: Cwd, path: Path, untracked: Type.Optional(Type.Boolean()) }),
		nonEmpty: ["cwd", "path"],
	},
	gitCommits: {
		auth: "public",
		params: Type.Object({ cwd: Cwd }),
		nonEmpty: ["cwd"],
	},
	gitCommit: { auth: "public", params: Type.Object({ cwd: Cwd, sha: Id }) },
	gitCommitDiff: {
		auth: "public",
		params: Type.Object({ cwd: Cwd, sha: Id, path: Path, oldPath: Type.Optional(Path) }),
		nonEmpty: ["cwd", "sha", "path"],
	},
	listProjects: { auth: "public", params: NoParams },
	addProject: {
		auth: "admin",
		params: Type.Object({ cwd: Cwd, name: Type.Optional(Type.String()) }),
		nonEmpty: ["cwd"],
	},
	renameProject: {
		auth: "admin",
		params: Type.Object({ id: Id, name: Type.Optional(Type.String()) }),
		nonEmpty: ["id"],
	},
	removeProject: {
		auth: "admin",
		params: Type.Object({ id: Id }),
		nonEmpty: ["id"],
	},
	projectTrust: { auth: "public", params: Type.Object({ cwd: Cwd }) },
	setProjectTrust: {
		auth: "admin",
		params: Type.Object({ cwd: Cwd, trusted: Type.Boolean() }),
		nonEmpty: ["cwd"],
	},
	revealProject: {
		auth: "admin",
		params: Type.Object({ id: Id }),
		nonEmpty: ["id"],
	},
	revealPath: {
		auth: "admin",
		params: Type.Object({ path: Path }),
		nonEmpty: ["path"],
	},
	renameSession: {
		auth: "write",
		params: Type.Object({ sessionFile: SessionFile, name: Type.Optional(Type.String()) }),
		nonEmpty: ["sessionFile"],
	},
	deleteSession: {
		auth: "write",
		params: Type.Object({ sessionFile: SessionFile }),
		nonEmpty: ["sessionFile"],
	},
	markSessionsSeen: {
		auth: "public",
		params: Type.Object({ sessionFiles: Type.Array(SessionFile) }),
	},
	getSettings: { auth: "public", params: NoParams },
	updateSettings: {
		auth: "admin",
		params: Unsafe<{ settings: FacetSettings }>(Type.Object({ settings: Type.Object({}) })),
	},
	getAgentDefaults: { auth: "public", params: NoParams },
	setAgentDefaults: {
		auth: "admin",
		// thinkingLevel 传 null 表示清掉这一项，交回模型自己决定；不传则不动
		params: Type.Object({
			model: Type.Optional(ModelRef),
			thinkingLevel: Type.Optional(Type.Union([ThinkingLevel, Type.Null()])),
		}),
	},
	saveCredential: {
		auth: "admin",
		params: Type.Object({ providerId: Id, apiKey: Id }),
		nonEmpty: ["providerId", "apiKey"],
	},
	deleteCredential: {
		auth: "admin",
		params: Type.Object({ providerId: Id }),
		nonEmpty: ["providerId"],
	},
	// 登录用宿主进程发起：浏览器回调要监听回环地址，而且凭证与刷新都由 pi 在宿主里管
	providerLoginStart: {
		auth: "admin",
		params: Type.Object({
			providerId: Id,
			// 走账号登录还是填 API key；不给按 API key 处理
			authType: Type.Optional(Type.Union([Type.Literal("oauth"), Type.Literal("api_key")])),
		}),
		nonEmpty: ["providerId"],
	},
	// value 为 null 表示这一步不要了（界面上的取消），会连带把整条登录中止
	providerLoginRespond: {
		auth: "admin",
		params: Type.Object({
			loginId: Id,
			promptId: Id,
			value: Type.Union([Type.String(), Type.Null()]),
		}),
		nonEmpty: ["loginId"],
	},
	providerLoginCancel: {
		auth: "admin",
		params: Type.Object({ loginId: Id }),
		nonEmpty: ["loginId"],
	},
	diagnostics: { auth: "admin", params: NoParams },
	testModel: {
		auth: "admin",
		params: Type.Object({ provider: Id, id: Id }),
		nonEmpty: ["provider", "id"],
	},
	listCustomProviders: { auth: "public", params: NoParams },
	// 从上游的 /v1/models 拉一份模型清单，填自定义提供方的模型表；
	// 没带 apiKey 时用该提供方已经存下的密钥，新建的提供方还没存，就靠界面把输入框里的值带过来
	fetchProviderModels: {
		auth: "admin",
		params: Type.Object({
			baseUrl: Type.String(),
			providerId: Type.Optional(Id),
			apiKey: Type.Optional(Type.String()),
			api: Type.Optional(Id),
		}),
		nonEmpty: ["baseUrl"],
	},
	saveCustomProvider: {
		auth: "admin",
		params: Type.Object({
			provider: Type.Object({
				id: Id,
				name: Id,
				baseUrl: Id,
				api: Id,
				models: Type.Array(
					Type.Object({
						id: Id,
						name: Type.Optional(Type.String()),
						reasoning: Type.Optional(Type.Boolean()),
						contextWindow: Type.Optional(Type.Number()),
						maxTokens: Type.Optional(Type.Number()),
					}),
				),
			}),
		}),
	},
	removeCustomProvider: {
		auth: "admin",
		params: Type.Object({ providerId: Id }),
		nonEmpty: ["providerId"],
	},
	listTerminals: { auth: "public", params: NoParams },
	createTerminal: {
		auth: "write",
		params: Type.Object({
			cwd: Cwd,
			cols: Type.Number(),
			rows: Type.Number(),
			shell: Type.Optional(Type.String()),
		}),
	},
	writeTerminal: {
		auth: "write",
		params: Type.Object({ id: Id, data: Type.String() }),
		nonEmpty: ["id"],
	},
	resizeTerminal: {
		auth: "write",
		params: Type.Object({ id: Id, cols: Type.Number(), rows: Type.Number() }),
		nonEmpty: ["id"],
	},
	killTerminal: { auth: "write", params: Type.Object({ id: Id }) },
	ackTerminal: {
		auth: "public",
		params: Type.Object({ id: Id, seq: Type.Number() }),
		nonEmpty: ["id"],
	},
	serializeTerminal: { auth: "public", params: Type.Object({ id: Id }) },
} satisfies Readonly<Record<string, RequestSchemaEntry | undefined>>;

/**
 * 主机推给端点的动作帧。
 *
 * 只校验信封：`action` 的具体形状由各动作自己的类型定义，端点的 store 按 `type` 分支处理。
 * 补这一层是为了让传输层不再用 `as unknown as ActionFrame` 硬转。
 */
export const SERVER_FRAME_SCHEMAS = {
	actionFrame: Type.Object({
		type: Type.Literal("action"),
		channel: Type.String(),
		action: Type.Object({ type: Type.String() }),
		serverSeq: Type.Number(),
		origin: Type.Optional(
			Type.Union([Type.Object({ clientId: Type.String(), clientSeq: Type.Number() }), Type.Null()]),
		),
		rejectionReason: Type.Optional(Type.String()),
	}),
} satisfies Readonly<Record<string, TSchema>>;

/** 活动通道的 `type` 到动作 Schema 的表。 */
export const DISPATCH_SCHEMAS = {
	"chat/turnStarted": {
		auth: "write",
		action: Type.Object({
			type: Type.Literal("chat/turnStarted"),
			text: Type.String(),
			images: Type.Optional(
				Type.Array(
					Type.Object({
						type: Type.Literal("image"),
						data: Type.String(),
						mimeType: Type.String(),
					}),
				),
			),
			streamingBehavior: Type.Optional(StreamingBehaviorSchema),
		}),
	},
	"chat/turnCancelled": {
		auth: "write",
		action: Type.Object({ type: Type.Literal("chat/turnCancelled") }),
	},
	"chat/revertTo": {
		auth: "write",
		action: Type.Object({ type: Type.Literal("chat/revertTo"), entryId: Id }),
	},
	"session/titleChanged": {
		auth: "write",
		action: Type.Object({ type: Type.Literal("session/titleChanged"), title: Type.String() }),
	},
	"session/pendingMessageSet": {
		auth: "write",
		action: Type.Object({
			type: Type.Literal("session/pendingMessageSet"),
			kind: Type.Union([Type.Literal("steering"), Type.Literal("queued")]),
			text: Type.String(),
		}),
	},
	"session/queueCleared": {
		auth: "write",
		action: Type.Object({ type: Type.Literal("session/queueCleared") }),
	},
	"session/compact": {
		auth: "write",
		action: Type.Object({ type: Type.Literal("session/compact") }),
	},
	"session/configChanged": {
		auth: "write",
		action: Type.Object({
			type: Type.Literal("session/configChanged"),
			model: Type.Optional(ModelRef),
			thinkingLevel: Type.Optional(ThinkingLevel),
			activeToolNames: Type.Optional(Type.Array(Type.String())),
			persist: Type.Optional(Type.Boolean()),
		}),
	},
} satisfies Readonly<Record<string, DispatchSchemaEntry | undefined>>;
