/**
 * 端点与设备之间的帧格式。
 *
 * 传输是 JSON 文本帧，一条消息一个帧。连接建立后设备先发 hello，之后端点发请求、
 * 设备回响应并把会话事件按序推过来。事件序号由设备生成，端点只负责按序号检测跳号。
 */
import type { ApprovalDecision } from "./approval.ts";
import type { ImageBlock } from "./content.ts";
import type { SessionEvent } from "./event.ts";
import type { ModelInfo, ModelRef, ProviderInfo, ThinkingLevel } from "./model.ts";
import type { StreamingBehavior } from "./request.ts";
import type { Entry, PromptDisposition, SessionSnapshot, SessionSummary } from "./session.ts";

/** 帧格式版本。不兼容的改动递增此值，端点据此拒绝握手。 */
export const PROTOCOL_VERSION = 1;

/** 设备上报的能力标记，端点据此隐藏不可用的入口。 */
export type Capability = "approval" | "tools" | "compaction" | "export" | "files" | "terminal";

/** 请求失败的分类。端点按 code 决定提示方式，message 仅用于展示与日志。 */
export type ErrorCode =
	/** 方法名未知或该版本不支持 */
	| "unknown_method"
	/** 参数缺失或结构不符 */
	| "bad_params"
	/** 会话不存在或已被释放 */
	| "unknown_session"
	/** 设备侧拒绝执行，例如会话正在运行而请求未指定投递方式 */
	| "rejected"
	/** 设备侧内部错误 */
	| "internal";

/** 失败详情。 */
export interface ProtocolError {
	code: ErrorCode;
	message: string;
}

/** 端点发出的请求。id 由端点生成，响应原样带回。 */
export interface RequestFrame {
	type: "request";
	/** 请求 id，同一连接内唯一 */
	id: string;
	method: RequestMethod;
	params?: unknown;
}

/** 设备对请求的应答。ok 为 false 时带错误详情。 */
export type ResponseFrame =
	| { type: "response"; id: string; ok: true; data: unknown }
	| { type: "response"; id: string; ok: false; error: ProtocolError };

/** 一条带序号的会话事件。同一会话的 seq 单调递增，从 1 开始。 */
export interface SequencedEvent {
	/** 会话内的递增序号 */
	seq: number;
	event: SessionEvent;
}

/** 设备推送的会话事件帧。 */
export interface EventFrame extends SequencedEvent {
	type: "event";
	/** 事件所属会话 */
	sessionId: string;
}

/** 连接建立后设备立即发出的首帧。 */
export interface HelloFrame {
	type: "hello";
	protocolVersion: number;
	/** 设备标识，用于区分多台设备；同一次进程运行内保持不变 */
	hostId: string;
	/** 设备展示名 */
	hostName: string;
	capabilities: Capability[];
}

/** 设备发往端点的帧。 */
export type ServerFrame = HelloFrame | ResponseFrame | EventFrame;

/** 端点发往设备的帧。 */
export type ClientFrame = RequestFrame;

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
	/** 订阅会话事件。since 为上一条已收到的序号，用于补齐。 */
	subscribe: { sessionId: string; since?: number };
	/** 取消订阅，停止接收该会话的事件。 */
	unsubscribe: { sessionId: string };
	/** 发送消息。会话正在运行时必须指定投递方式。 */
	prompt: {
		sessionId: string;
		text: string;
		images?: ImageBlock[];
		streamingBehavior?: StreamingBehavior;
	};
	/** 中止当前运行。 */
	abort: { sessionId: string };
	/** 应答一条审批请求。 */
	approve: { sessionId: string; requestId: string; decision: ApprovalDecision };
	/** 取会话当前状态。 */
	snapshot: { sessionId: string };
	/** 增量读取持久化条目，since 为上次见到的条目 id。 */
	entries: { sessionId: string; since?: string };
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
	/** resync 为真表示从 since 到当前的事件已不在设备缓冲内，端点需要重新读取快照与条目 */
	subscribe: { snapshot: SessionSnapshot; seq: number; resync: boolean };
	unsubscribe: Record<string, never>;
	prompt: { disposition: PromptDisposition };
	abort: Record<string, never>;
	/** accepted 为假表示该请求已超时或被释放，应答被丢弃 */
	approve: { accepted: boolean };
	snapshot: SessionSnapshot;
	entries: { entries: Entry[]; leafId: string | null };
	models: { models: ModelInfo[] };
	providers: { providers: ProviderInfo[] };
}

/** 请求方法名。 */
export type RequestMethod = keyof RequestParams;
