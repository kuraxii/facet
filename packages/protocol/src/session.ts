/**
 * 会话状态、历史条目与统计。
 */
import type { AcpConfigOption, AcpModeState, AgentCapabilities } from "./backend.ts";
import type { ExtensionUiState, SessionInitialization } from "./extension-ui.ts";
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

/**
 * 上下文拆解的分类标识，粒度与 pi-context-view 的 Usage 分类一致。
 */
export type ContextCategoryId =
	| "system-prompt"
	| "context-files"
	| "skills"
	| "built-in-tools"
	| "custom-tools"
	| "mcp-tools"
	| "user-messages"
	| "assistant-messages"
	| "assistant-thinking"
	| "tool-calls"
	| "tool-output"
	| "extensions"
	| "compacted-data";

/** 某个分类下的单条子项明细，如单个指令文件、Skill、工具定义或某类工具输出。 */
export interface ContextBreakdownItem {
	/** 分类内稳定标识 */
	id: string;
	/** 展示名称，如段名、文件路径、Skill 名或工具名 */
	label: string;
	/** 估算的 token 数 */
	tokens: number;
	/** 聚合的条目数（消息或工具结果类目使用） */
	count?: number;
	/** 补充说明，如工具来源或文件路径 */
	detail?: string;
}

/** 上下文拆解中的一级分类。 */
export interface ContextBreakdownCategory {
	/** 分类标识 */
	id: ContextCategoryId;
	/** 该分类占用的估算 token 数 */
	tokens: number;
	/** 子项明细，按 token 降序排列 */
	items?: ContextBreakdownItem[];
}

/** 最近一次有效助手响应回报的请求输入/输出用量，用于展示缓存复用情况。 */
export interface ContextRequestCacheUsage {
	/** 非缓存新增输入 token */
	input: number;
	/** 输出 token */
	output: number;
	/** 命中缓存读取 token */
	cacheRead: number;
	/** 写入缓存 token */
	cacheWrite: number;
	/** 推理 token */
	reasoning: number;
}

/** 当前活动分支的上下文窗口分项拆解。 */
export interface ContextBreakdown {
	/** 当前模型的上下文窗口上限；未知模型时为 0 */
	contextWindow: number;
	/** pi 回报的上下文基准 token 数；刚压缩完等未知阶段为空 */
	reportedTokens: number | null;
	/** pi 回报的上下文占用百分比；未知时为空 */
	reportedPercent: number | null;
	/** 全部可见分类的估算 token 总和 */
	estimatedTokens: number;
	/** 非空的一级分类列表，按请求结构顺序排列 */
	categories: ContextBreakdownCategory[];
	/** 当前通过 codemode 或 deferred 隐藏声明的工具名列表 */
	hiddenTools: string[];
	/** 当前活动分支上的压缩次数 */
	compactions: number;
	/** 本轮是否由扩展通过 forceSystemPrompt 整段覆写了系统提示词 */
	forcedPrompt?: boolean;
	/** 开启自动压缩时的预留 token 阈值 */
	autoCompactReserveTokens?: number;
	/** 最近一次有效助手响应的缓存命中拆解 */
	latestRequestUsage?: ContextRequestCacheUsage;
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
	/** 所属代理后端标识；缺省按 "pi" 处理 */
	backendId?: string;
	/** 会话定位符（Pi 为文件路径，ACP 为 acp:// 定位符） */
	path: string;
	/** 会话创建时的工作目录，之后不再变化 */
	cwd: string;
	name: string | undefined;
	/** 分叉来源的会话文件路径 */
	parentSessionPath: string | undefined;
	/** Unix 毫秒时间戳 */
	created: number;
	modified: number;
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

/**
 * 会话此刻在主机上的活动状态。
 *
 * 与界面的 ChatActivity 对齐，只少了客户端才有的 stopping：主机侧收到停止请求之后、
 * 一轮真正结束之前，它对其它端仍然是运行中。
 */
export type SessionActivity = "idle" | "running" | "compacting";

/**
 * 最近一轮的结束结果。
 *
 * 用户中止的一轮既不算完成也不算失败，主机不为它记收尾，所以这里没有对应取值。
 */
export type TurnOutcome = "completed" | "failed";

/**
 * 最近一轮收尾的事实。
 *
 * 只在活动状态回到 idle 之后才有值；新一轮开始时清掉，否则会话重新跑起来之后还会带着
 * 上一次的收尾去提示用户。
 */
export interface SessionSettle {
	/** 收尾时刻，Unix 毫秒 */
	at: number;
	/** 这一轮的结果 */
	outcome: TurnOutcome;
	/** 结果为 failed 时的原因，取自 pi 的 errorMessage */
	message: string | undefined;
}

/**
 * 会话此刻的状态，清单项与状态推送共用这一份。
 *
 * 它只陈述主机看到的事实：在不在忙、最近一轮怎么收的尾、有几个交互在等人。
 * 「用户看过没有」不在其中，由 seenAt 与 settle.at 比出来，界面据此推分档。
 */
export interface SessionStatus {
	/** 主机上此刻的活动状态 */
	activity: SessionActivity;
	/** 最近一轮的收尾；没跑完过、正在跑或用户中止时为空 */
	settle: SessionSettle | undefined;
	/** 待答的扩展交互数，大于零表示这一轮在等人 */
	pendingInput: number;
	/** 这一条被标记已读的时刻，Unix 毫秒；零表示从未标记 */
	seenAt: number;
}

/**
 * 清单里的一条：会话摘要加上它此刻的状态。
 *
 * 状态跟摘要分开，是因为两者的变化频率不同：状态一轮里要变好几次，摘要却很少动。
 */
export interface SessionListItem {
	/** 会话摘要，字段与会话文件一致 */
	summary: SessionSummary;
	/** 主机上此刻的状态 */
	status: SessionStatus;
}

/** 接入方一次拿到的完整会话状态，用于对齐界面。消息体与历史走条目读取。 */
export interface SessionSnapshot {
	id: string;
	/** 所属代理后端标识；缺省按 "pi" 处理 */
	backendId?: string;
	/** 该会话支持的能力集合；缺省按 Pi 完整能力处理 */
	capabilities?: AgentCapabilities;
	/** ACP 会话模式状态（仅 configStyle === "acp" 时存在） */
	acpMode?: AcpModeState;
	/** ACP 动态配置项列表（仅 configStyle === "acp" 时存在） */
	acpConfigOptions?: AcpConfigOption[];
	/** 扩展初始化状态；旧 server 缺省时按 ready 处理。 */
	initialization?: SessionInitialization;
	/** 待答请求、通知与输入草稿更新。 */
	extensionUi?: ExtensionUiState;
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
