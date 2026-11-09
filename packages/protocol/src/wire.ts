/**
 * 线格式。
 *
 * 连接建立后设备先发 hello(带本次连接分配的端标识与协议版本),之后端点发请求、设备回响应。
 * 状态变更一律走 action 帧,按通道定序并可回放;请求只用于查询与生命周期,写操作没有响应,
 * 被拒时以带 rejectionReason 的 action 帧回给发起方。
 */
import type { Action, ActionOrigin } from "./action.ts";
import type { Channel } from "./channel.ts";
import type { ModelInfo, ModelRef, ProviderInfo, ThinkingLevel } from "./model.ts";
import type { Entry, SessionSnapshot, SessionSummary } from "./session.ts";

/** 线格式版本。不兼容的改动递增此值,端点据此拒绝握手。 */
export const PROTOCOL_VERSION = 1;

/** 设备上报的能力标记,端点据此隐藏不可用的入口。 */
export type Capability = "dispatch" | "tools" | "compaction" | "export";

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
	/** 设备侧拒绝执行,例如会话正在运行而动作未指定投递方式 */
	| "rejected"
	/** 设备侧内部错误 */
	| "internal";

/** 失败详情。 */
export interface ProtocolError {
	code: ErrorCode;
	message: string;
}

/** 连接建立后设备立即发出的首帧。 */
export interface HelloFrame {
	type: "hello";
	protocolVersion: number;
	/** 设备标识,同一次进程运行内保持不变 */
	hostId: string;
	/** 设备展示名 */
	hostName: string;
	/** 本次连接分配的端标识,派发动作时设备把它回填到 origin */
	clientId: string;
	capabilities: Capability[];
}

/** 端点发出的请求。id 由端点生成,响应原样带回。 */
export interface RequestFrame {
	type: "request";
	/** 请求 id,同一连接内唯一 */
	id: string;
	method: RequestMethod;
	params?: unknown;
}

/** 设备对请求的应答。ok 为 false 时带错误详情。 */
export type ResponseFrame =
	| { type: "response"; id: string; ok: true; data: unknown }
	| { type: "response"; id: string; ok: false; error: ProtocolError };

/**
 * 端点派发的动作。
 *
 * clientSeq 由端点自己递增,设备把它连同 clientId 写进回放的 origin,
 * 端点重连后据此对账,避免同一条动作生效两次。
 */
export interface DispatchFrame {
	type: "dispatch";
	channel: Channel;
	clientSeq: number;
	action: Action;
}

/** 设备推送的动作帧。 */
export interface ActionFrame {
	type: "action";
	channel: Channel;
	action: Action;
	/** 通道内的递增序号,从 1 开始 */
	serverSeq: number;
	/** 动作来源,缺省表示设备侧产生 */
	origin: ActionOrigin | undefined;
	/** 设备拒绝该动作时的说明;出现即表示该动作未被应用 */
	rejectionReason?: string;
}

/** 设备发往端点的帧。 */
export type ServerFrame = HelloFrame | ResponseFrame | ActionFrame;

/** 端点发往设备的帧。 */
export type ClientFrame = RequestFrame | DispatchFrame;

/** 订阅结果。 */
export interface SubscribeResult {
	/** 订阅完成时的通道序号 */
	seq: number;
	/** 为真表示 since 之后的部分动作已不在缓冲内,端点需要重新读取快照与历史 */
	resync: boolean;
	/** 订阅会话通道时返回会话快照;对话通道不返回,历史经 entries 分页取得 */
	session?: SessionSnapshot;
}

/** 每条请求的参数。 */
export interface RequestParams {
	/** 列出会话。指定 cwd 时只列该目录。 */
	listSessions: { cwd?: string };
	/** 新建会话并返回初始快照。 */
	createSession: {
		cwd?: string;
		model?: ModelRef;
		thinkingLevel?: ThinkingLevel;
		tools?: string[];
		excludeTools?: string[];
		name?: string;
	};
	/** 打开已有会话并返回初始快照。 */
	openSession: { sessionFile: string; cwd?: string };
	/**
	 * 从会话的某条消息分叉出新会话，返回新会话的初始快照。
	 *
	 * 历史消息用 entryId 定位；本次连接产生的消息用 messageId，由设备在写盘之后换算成条目。
	 */
	forkSession: { sessionFile: string; entryId?: string; messageId?: string; cwd?: string };
	/** 取会话当前状态。 */
	snapshot: { sessionId: string };
	/**
	 * 分页读取历史,从 cursor 指向的条目往更早取 limit 条。
	 *
	 * 点对点请求,不广播:一个端点拉历史不影响到其他端点,设备侧也不必为此增长状态。
	 * nextCursor 缺省表示已经到最早。limit 缺省由设备决定。
	 */
	entries: { sessionId: string; cursor?: string; limit?: number };
	/** 订阅通道。since 为该通道上一条已收到的序号。 */
	subscribe: { channel: Channel; since?: number };
	/** 取消订阅。 */
	unsubscribe: { channel: Channel };
	/** 列出模型。 */
	models: { providerId?: string };
	/** 列出提供方及其凭证状态。 */
	providers: Record<string, never>;
}

/** 每条请求的应答数据。 */
export interface RequestResults {
	listSessions: { sessions: SessionSummary[] };
	createSession: SessionSnapshot;
	openSession: SessionSnapshot;
	forkSession: SessionSnapshot;
	snapshot: SessionSnapshot;
	entries: { entries: Entry[]; nextCursor: string | undefined };
	subscribe: SubscribeResult;
	unsubscribe: Record<string, never>;
	models: { models: ModelInfo[] };
	providers: { providers: ProviderInfo[] };
}

/** 请求方法名。 */
export type RequestMethod = keyof RequestParams;
