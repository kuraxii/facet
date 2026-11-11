/**
 * 会话状态、历史条目与统计。
 */
import type { Message } from "./message.ts";
import type { ModelInfo, ThinkingLevel } from "./model.ts";

/**
 * 本轮的生命周期。同一时刻只有一个阶段。
 *
 * starting 表示动作已受理、运行还没开始;stopping 表示已请求中止,等这一轮收尾。
 */
export type TurnPhase = "idle" | "starting" | "running" | "stopping";

/**
 * 与本轮并行的维护动作,同一时刻最多一个。
 *
 * compaction 期间没有流式输出;retry 表示上一轮失败后正在等下一次尝试。
 */
export type Maintenance =
	| {
			kind: "compaction";
			reason: CompactionReason;
			/** 压缩前的上下文 token 数,开始时为空 */
			tokensBefore: number | undefined;
			/** 压缩后的估算 token 数,结束时才有 */
			estimatedTokensAfter: number | undefined;
	  }
	| {
			kind: "retry";
			attempt: number;
			maxAttempts: number;
			/** 距离下一次尝试还有多久，界面据此显示倒计时 */
			delayMs: number;
	  };

/** 压缩的触发来源。manual 为手动触发，threshold 为达到阈值，overflow 为上下文溢出。 */
export type CompactionReason = "manual" | "threshold" | "overflow";

/** 一次 prompt 的去向。handled 表示被扩展命令消费、未产生运行，queued 表示排队，started 表示开启运行。 */
export type PromptDisposition = "handled" | "queued" | "started";

/** 排队输入的接受结果。 */
export type QueueDisposition = "handled" | "queued";

/** 排队中的输入。 */
export interface QueuedInput {
	/** 会在当前助手回合结束后插入的消息 */
	steering: string[];
	/** 会在本轮全部工作完成后插入的消息 */
	followUp: string[];
}

/** 会话条目的类型标记，与持久化记录中的条目类型一致。 */
export type EntryKind =
	| "message"
	| "thinking_level_change"
	| "model_change"
	| "usage"
	| "compaction"
	| "branch_summary"
	| "custom"
	| "custom_message"
	| "context_edit"
	| "label"
	| "session_info";

/**
 * 会话条目，持久化树的节点。
 *
 * id 稳定且条目只追加，因此 id 可以作为客户端读取历史的游标，跨进程重启仍然有效。
 */
export interface Entry {
	/** 条目 id，可用作游标 */
	id: string;
	/** 父条目 id，为空表示分支起点 */
	parentId: string | null;
	kind: EntryKind;
	/** ISO 8601 时间戳，与消息上的 Unix 毫秒时间戳不同 */
	timestamp: string;
	/** kind 为 message 时的消息内容 */
	message?: Message;
	/** kind 为 compaction 或 branch_summary 时的摘要 */
	summary?: string;
	/** kind 为 session_info 时的会话名 */
	name?: string;
}

/**
 * 当前上下文用量。
 *
 * 压缩刚结束时 tokens 与 percent 为空，要等下一次助手响应回报用量才恢复。
 */
export interface ContextUsage {
	/** 估算的上下文 token 数 */
	tokens: number | null;
	/** 当前模型的上下文窗口 */
	contextWindow: number;
	/** 占用百分比 */
	percent: number | null;
}

/** 全会话累计的 token 用量，包含已被压缩掉的历史。 */
export interface TokenTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

/** 会话统计，用于会话行信息与详情面板。 */
export interface SessionStats {
	sessionId: string;
	/** 会话文件路径，内存会话为空 */
	sessionFile: string | undefined;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	/** 全部消息条数，含工具结果与自定义消息 */
	totalMessages: number;
	tokens: TokenTotals;
	/** 全会话累计成本，单位美元 */
	cost: number;
	/** 当前上下文用量，模型未确定时为空 */
	contextUsage: ContextUsage | undefined;
}

/** 会话索引项，用于侧栏的项目分组与最近会话。 */
export interface SessionSummary {
	id: string;
	/** 会话文件路径 */
	path: string;
	/** 会话创建时的工作目录，之后不再变化 */
	cwd: string;
	name: string | undefined;
	/** 分叉来源的会话文件路径 */
	parentSessionPath: string | undefined;
	/** Unix 毫秒时间戳 */
	created: number;
	modified: number;
	messageCount: number;
	/** 首条用户消息的摘要，用于列表展示 */
	firstMessage: string;
}

/** 工具清单项。 */
export interface ToolInfo {
	name: string;
	description: string;
	/** 是否处于激活状态，即是否已声明给模型 */
	active: boolean;
}

/** 接入方一次拿到的完整会话状态，用于对齐界面。消息体与历史走条目读取。 */
export interface SessionSnapshot {
	id: string;
	/** 会话文件路径，内存会话为空 */
	file: string | undefined;
	/** 会话的工作目录 */
	cwd: string;
	name: string | undefined;
	/** 本轮的生命周期 */
	phase: TurnPhase;
	/** 与本轮并行的维护动作 */
	maintenance: Maintenance | undefined;
	model: ModelInfo | undefined;
	thinkingLevel: ThinkingLevel;
	/** 当前模型支持的档位，用于禁用不可选的档 */
	availableThinkingLevels: ThinkingLevel[];
	/** 已声明给模型的工具名 */
	activeToolNames: string[];
	queued: QueuedInput;
	contextUsage: ContextUsage | undefined;
	stats: SessionStats;
	/** 恢复会话时模型回退的提示，需要展示给用户 */
	modelFallbackMessage: string | undefined;
}
