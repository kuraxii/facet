/**
 * 线格式。
 *
 * 连接建立后主机先发 hello(带本次连接分配的端标识与协议版本),之后端点发请求、主机回响应。
 * 状态变更一律走 action 帧,按通道定序并可回放;请求只用于查询与生命周期,写操作没有响应,
 * 被拒时以带 rejectionReason 的 action 帧回给发起方。
 */

import type { Static, TSchema } from "typebox";
import type { Action, ActionOrigin } from "./action.ts";
import type { AcpAgentProfile, AgentAvailability } from "./agent.ts";
import type { Channel } from "./channel.ts";
import type { SlashCommand } from "./command.ts";
import type { FileContent, FileEntry, FileWriteResult } from "./file.ts";
import type { GitCommitDetail, GitCommits, GitDiff, GitStatus } from "./git.ts";
import type { AgentDefaults, CustomProviderInfo, ModelInfo, ProviderInfo, UpstreamModel } from "./model.ts";
import type { ProjectInfo } from "./project.ts";
import type { REQUEST_SCHEMAS } from "./schema/contracts.ts";
import type { ContextBreakdown, Entry, SessionListItem, SessionSnapshot } from "./session.ts";
import type { FacetSettings } from "./settings.ts";
import type { TerminalInfo, TerminalProfileInfo } from "./terminal.ts";

/** 线格式版本。不兼容的改动递增此值,端点据此拒绝握手。 */
export const PROTOCOL_VERSION = 3;

/** 主机上报的能力标记,端点据此隐藏不可用的入口。 */
export type Capability = "dispatch" | "tools" | "compaction" | "terminal" | "extensionUi";

/**
 * 这条连接的权限档。
 *
 * admin 是本机连接，能改设置与凭证、增删项目、结束主机；operator 是允许操作项目的远程
 * 连接，能发消息、停止与应答交互；viewer 是只读的远程连接，只能看。
 */
export type ClientRole = "admin" | "operator" | "viewer";

/**
 * 连接从哪一端发起。
 *
 * desktop 是桌面主进程打开的通道，可能是本机 socket，也可能是 SSH 隧道；web 是浏览器页面里
 * 直接连的 WebSocket。凭证、设置与项目清单只在 desktop 入口放行：SSH 已经是一道认证，浏览器
 * 只有一个令牌。
 */
export type ClientEntry = "desktop" | "web";

/** 请求失败的分类。端点按 code 决定提示方式,message 仅用于展示与日志。 */
export type ErrorCode =
	/** 方法名未知或该版本不支持 */
	| "unknown_method"
	/** 参数缺失或结构不符 */
	| "bad_params"
	/** 通道 URI 无法解析或该通道未实现 */
	| "unknown_channel"
	/** 会话不存在或已被释放 */
	| "unknown_session"
	/** 主机侧拒绝执行,例如会话正在运行而动作未指定投递方式 */
	| "rejected"
	/** 文件或目录不存在 */
	| "file_not_found"
	/** 路径不在项目根内，含符号链接指到根外 */
	| "outside_project"
	/** 目标不是文件 */
	| "not_a_file"
	/** 目标不是目录 */
	| "not_a_directory"
	/** 文件超过读写上限 */
	| "file_too_large"
	/** 文件在磁盘上已被改动，与预期版本不一致 */
	| "file_conflict"
	/** 主机侧内部错误 */
	| "internal";

/** 失败详情。 */
export interface ProtocolError {
	code: ErrorCode;
	message: string;
}

/** 连接建立后主机立即发出的首帧。 */
export interface HelloFrame {
	type: "hello";
	protocolVersion: number;
	/** 主机标识,同一次进程运行内保持不变 */
	hostId: string;
	/** 主机展示名 */
	hostName: string;
	/** 本次连接分配的端标识,派发动作时主机把它回填到 origin */
	clientId: string;
	/** 这条连接能做什么 */
	role: ClientRole;
	/** 这条连接能不能改设置、凭证与项目清单这类主机配置 */
	canManage: boolean;
	/** 主机实际生效的 pi 数据目录，远端排查时看它 */
	agentDir: string;
	capabilities: Capability[];
}

/**
 * 连接建立后的第一帧。
 *
 * 主机校验通过才发 hello；令牌不对直接断开，端点拿不到 hello 也就无法发请求。
 * 不设令牌的主机用 `withoutToken` 显式声明，用来隔离本地调试环境。
 */
export interface AuthFrame {
	type: "auth";
	token: string;
	/**
	 * 请求的权限档。
	 *
	 * 缺省按管理档处理（本机连接）；远程端自己声明要只读还是操作档，主机会按自己的配置
	 * 收窄。能拿到令牌就等于能用这台主机，所以这里限制的是操作习惯，不是安全边界。
	 */
	role?: "operator" | "viewer";
	/**
	 * 连接来源，缺省按 desktop 算。
	 *
	 * 浏览器里那套界面自己声明 web；桌面主进程与它的 SSH 通道不声明。
	 */
	entry?: ClientEntry;
}

/** 端点发出的请求。id 由端点生成,响应原样带回。 */
export interface RequestFrame {
	type: "request";
	/** 请求 id,同一连接内唯一 */
	id: string;
	method: RequestMethod;
	params?: unknown;
}

/** 主机对请求的应答。ok 为 false 时带错误详情。 */
export type ResponseFrame =
	| { type: "response"; id: string; ok: true; data: unknown }
	| { type: "response"; id: string; ok: false; error: ProtocolError };

/**
 * 端点派发的动作。
 *
 * clientSeq 由端点自己递增,主机把它连同 clientId 写进回放的 origin,
 * 端点重连后据此对账,避免同一条动作生效两次。
 */
export interface DispatchFrame {
	type: "dispatch";
	channel: Channel;
	clientSeq: number;
	action: Action;
}

/** 主机推送的动作帧。 */
export interface ActionFrame {
	type: "action";
	channel: Channel;
	action: Action;
	/** 通道内的递增序号,从 1 开始 */
	serverSeq: number;
	/** 动作来源,缺省表示主机侧产生 */
	origin: ActionOrigin | undefined;
	/** 主机拒绝该动作时的说明;出现即表示该动作未被应用 */
	rejectionReason?: string;
}

/** 主机发往端点的帧。 */
export type ServerFrame = HelloFrame | ResponseFrame | ActionFrame;

/**
 * 被拒动作的回显。
 *
 * 主机拒绝一条派发时把客户端发来的动作原样带回，端点只读 `type` 认出是哪一类动作、
 * 并按 `origin` 核销自己的发送。被拒的动作不保证符合契约，因此这里只声明它是一个
 * 带 `type` 的对象。
 */
export interface ActionEcho {
	/** 动作种类，原样回显 */
	type: string;
}

/** 主机发出的一条被拒动作帧：动作原样回显，`rejectionReason` 一定在。 */
export interface RejectedActionFrame {
	type: "action";
	channel: Channel;
	action: ActionEcho;
	/** 通道内的序号，取该通道当前已发的最后一个 */
	serverSeq: number;
	/** 动作来源，缺省表示主机侧产生 */
	origin: ActionOrigin | undefined;
	/** 拒绝原因 */
	rejectionReason: string;
}

/** 一条动作帧：正常动作，或被拒时回显动作的那一种。 */
export type ServerActionFrame = ActionFrame | RejectedActionFrame;

/** 主机写出的帧：正常帧，加上拒绝时回显动作的那一种。 */
export type OutboundFrame = ServerFrame | RejectedActionFrame;

/** 端点发往主机的帧。 */
export type ClientFrame = AuthFrame | RequestFrame | DispatchFrame;

/** 订阅结果。 */
export interface SubscribeResult {
	/** 订阅完成时的通道序号 */
	seq: number;
	/** 为真表示 since 之后的部分动作已不在缓冲内,端点需要重新读取快照与历史 */
	resync: boolean;
	/** 订阅会话通道时返回会话快照;对话通道不返回,历史经 entries 分页取得 */
	session?: SessionSnapshot;
}

/** 一条参数 Schema 推导出来的静态类型。 */
type ParamsOf<Entry> = Entry extends { params: infer Schema extends TSchema } ? Static<Schema> : never;

/**
 * 每条请求的参数。
 *
 * 形状来自 `schema/contracts.ts` 里的参数 Schema：同一个定义既是运行时的校验（经
 * `generated/checks.ts`），也是这里的类型。手写一份平行声明会和校验漂开。
 */
export type RequestParams = {
	[K in keyof typeof REQUEST_SCHEMAS]: ParamsOf<(typeof REQUEST_SCHEMAS)[K]>;
};

/** 每条请求的应答数据。 */
export interface RequestResults {
	respondUi: { accepted: boolean };
	/** 每条带上主机侧此刻的状态，重连后一次往返就能把本地的状态对齐 */
	listSessions: { sessions: SessionListItem[] };
	listCommands: { commands: SlashCommand[] };
	busySessions: { files: string[] };
	createSession: SessionSnapshot;
	openSession: SessionSnapshot;
	forkSession: SessionSnapshot;
	snapshot: SessionSnapshot;
	contextDetails: ContextBreakdown;
	entries: { entries: Entry[]; nextCursor: string | undefined };
	/** 末端为当前叶子,按从早到晚排列 */
	entriesAfter: { entries: Entry[]; leafId: string | null };
	subscribe: SubscribeResult;
	unsubscribe: Record<string, never>;
	models: { models: ModelInfo[] };
	availableModels: { models: ModelInfo[] };
	providers: { providers: ProviderInfo[] };
	listDirectory: { entries: FileEntry[] };
	readFile: FileContent;
	writeFile: FileWriteResult;
	gitStatus: GitStatus;
	gitDiff: GitDiff;
	gitCommits: GitCommits;
	gitCommit: GitCommitDetail;
	gitCommitDiff: GitDiff;
	listProjects: { projects: ProjectInfo[] };
	addProject: ProjectInfo;
	renameProject: ProjectInfo;
	removeProject: Record<string, never>;
	projectTrust: { hasProjectResources: boolean; trusted: boolean | undefined };
	setProjectTrust: Record<string, never>;
	revealProject: Record<string, never>;
	/** 在主机侧文件管理器打开一个目录，没有返回值 */
	revealPath: Record<string, never>;
	renameSession: Record<string, never>;
	deleteSession: Record<string, never>;
	markSessionsSeen: Record<string, never>;
	getSettings: { settings: FacetSettings };
	updateSettings: { settings: FacetSettings };
	/** pi 自己的默认设置：新建会话时由它开局 */
	getAgentDefaults: AgentDefaults;
	setAgentDefaults: AgentDefaults;
	saveCredential: { providers: ProviderInfo[] };
	deleteCredential: { providers: ProviderInfo[] };
	/** 登录已经开始，后续进展走 `models:/<hostId>` 通道；同一提供方同时只允许一次 */
	providerLoginStart: { loginId: string };
	/** accepted 为假表示这一步已经不需要回答了（回调先回来或整条被取消） */
	providerLoginRespond: { accepted: boolean };
	providerLoginCancel: { cancelled: boolean };
	diagnostics: { text: string };
	testModel: { ok: boolean; latencyMs: number; message?: string };
	listCustomProviders: { providers: CustomProviderInfo[] };
	/** baseUrl 是实际可用的基址：裸站点根补上 /v1 之后与用户填的不同，界面据此回填 */
	fetchProviderModels: { models: UpstreamModel[]; baseUrl: string };
	saveCustomProvider: { providers: CustomProviderInfo[] };
	removeCustomProvider: { providers: CustomProviderInfo[] };
	listAgents: { agents: AgentAvailability[]; profiles: AcpAgentProfile[] };
	probeAgent: { agent: AgentAvailability };
	acpLoginStart: { loginId: string; authUrl?: string };
	acpLoginSubmit: { agent: AgentAvailability };
	acpLoginCancel: Record<string, never>;
	listTerminals: { terminals: TerminalInfo[] };
	/** 主机上可用的终端，顺序即「更可能是用户想要的」顺序 */
	listTerminalProfiles: { profiles: TerminalProfileInfo[] };
	createTerminal: { terminal: TerminalInfo };
	writeTerminal: Record<string, never>;
	resizeTerminal: Record<string, never>;
	killTerminal: Record<string, never>;
	ackTerminal: Record<string, never>;
	/** text 是回滚缓冲里的可见文本，seq 是当前通道序号，端从 seq 之后接着收增量 */
	serializeTerminal: { text: string; seq: number; cols: number; rows: number };
}

/** 请求方法名。 */
export type RequestMethod = keyof RequestParams;
