/**
 * 对外的数据类型定义。
 *
 * 这里只放 facet 自有类型，pi SDK 的类型不出包。所有结构可直接 JSON 序列化，
 * 供端点层编码上线路、界面层直接渲染。
 */

/** 模型的思考档位，由低到高。模型不支持的高档位会被夹紧到它支持的上限。 */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * 会话的对外状态，由内部状态派生。
 *
 * 判定顺序为 awaiting_approval > compacting > running > idle：等待审批时运行仍在进行，
 * 压缩时则不处于流式输出。
 */
export type AgentStatus = "idle" | "running" | "awaiting_approval" | "compacting";

/** 压缩的触发来源。manual 为手动触发，threshold 为达到阈值，overflow 为上下文溢出。 */
export type CompactionReason = "manual" | "threshold" | "overflow";

/** 一次 prompt 的去向。handled 表示被扩展命令消费、未产生运行，queued 表示排队，started 表示开启运行。 */
export type PromptDisposition = "handled" | "queued" | "started";

/** 排队输入的接受结果。 */
export type QueueDisposition = "handled" | "queued";

/** 提示级别，用于扩展发出的通知。 */
export type NoticeLevel = "info" | "warning" | "error";

/** 模型支持的输入模态。 */
export type InputModality = "text" | "image";

/** 按百万 token 计价的分项成本，单位为美元。 */
export interface AgentCostBreakdown {
	/** 输入 token 单价 */
	input: number;
	/** 输出 token 单价 */
	output: number;
	/** 命中缓存读取的单价 */
	cacheRead: number;
	/** 写入缓存的单价 */
	cacheWrite: number;
}

/** 一次请求的总成本，在分项之外另计合计值。 */
export interface AgentCost extends AgentCostBreakdown {
	total: number;
}

/** 模型的定位键，跨进程与跨语言都能直接使用。 */
export interface AgentModelRef {
	/** 提供方 id，例如 anthropic */
	provider: string;
	/** 提供方内的模型 id */
	id: string;
}

/** 模型的可展示信息，用于模型选择器与设置面板。 */
export interface AgentModelInfo extends AgentModelRef {
	/** 展示名 */
	name: string;
	/** 接口协议，例如 anthropic-messages、openai-responses */
	api: string;
	/** 是否支持 thinking */
	reasoning: boolean;
	/** 上下文窗口，单位 token */
	contextWindow: number;
	/** 单次响应的最大输出 token */
	maxTokens: number;
	/** 支持的输入模态 */
	input: InputModality[];
	/** 分项单价 */
	cost: AgentCostBreakdown;
}

/** 提供方及其凭证状态。 */
export interface AgentProviderInfo {
	/** 提供方 id */
	id: string;
	/** 展示名 */
	name: string;
	/** 是否已配置凭证 */
	authenticated: boolean;
	/** 目录内的模型数量 */
	modelCount: number;
}

/** 文本内容块。 */
export interface AgentTextBlock {
	type: "text";
	text: string;
}

/** 图片内容块，data 为 base64 编码。 */
export interface AgentImageBlock {
	type: "image";
	/** base64 编码的图片数据 */
	data: string;
	/** 媒体类型，例如 image/png */
	mimeType: string;
}

/** 思考内容块。redacted 为真时 thinking 可能为空，内容放在提供方不透明字段里。 */
export interface AgentThinkingBlock {
	type: "thinking";
	thinking: string;
	/** 是否被提供方隐藏 */
	redacted: boolean;
}

/** 助手发出的工具调用块。 */
export interface AgentToolCallBlock {
	type: "toolCall";
	/** 调用 id，与工具结果和工具执行事件对应 */
	id: string;
	/** 工具名 */
	name: string;
	/** 调用参数，结构由工具的 schema 决定 */
	arguments: Record<string, unknown>;
}

/** 消息内容块的全集，用于助手消息。 */
export type AgentContentBlock = AgentTextBlock | AgentImageBlock | AgentThinkingBlock | AgentToolCallBlock;

/** 可作为用户输入的内容块，只含文本与图片。 */
export type AgentInputBlock = AgentTextBlock | AgentImageBlock;

/** 模型调用的用量。reasoning 已包含在 output 内，不重复累加。 */
export interface AgentUsage {
	input: number;
	output: number;
	/** 命中缓存的输入 token */
	cacheRead: number;
	/** 写入缓存的输入 token */
	cacheWrite: number;
	/** 推理 token，已计入 output */
	reasoning: number;
	/** 全部 token 合计 */
	totalTokens: number;
	/** 本次调用成本 */
	cost: AgentCost;
}

/**
 * 助手回复的终止原因。
 *
 * pending 只出现在流式过程中的部分消息里；deferred 表示提供方要求稍后取回；
 * aborted 与 error 需要界面给出对应提示。
 */
export type AgentStopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

/** 系统消息，承载提示词与工具声明。界面通常不渲染。 */
export interface AgentSystemMessage {
	role: "system";
	/** 纯文本内容，多段文本块按换行拼接 */
	content: string;
	/** Unix 毫秒时间戳 */
	timestamp: number;
}

/** 用户消息。 */
export interface AgentUserMessage {
	role: "user";
	/** 文本与图片内容块 */
	content: AgentInputBlock[];
	timestamp: number;
}

/** 助手消息。 */
export interface AgentAssistantMessage {
	role: "assistant";
	content: AgentContentBlock[];
	/** 实际响应来自的提供方 */
	provider: string;
	/** 实际响应来自的模型，优先使用提供方回报的响应模型名 */
	model: string;
	usage: AgentUsage;
	stopReason: AgentStopReason;
	/** 失败或中止时的错误说明 */
	errorMessage?: string;
	timestamp: number;
}

/** 工具结果消息。 */
export interface AgentToolResultMessage {
	role: "toolResult";
	/** 对应的工具调用 id */
	callId: string;
	/** 产生结果的工具名 */
	toolName: string;
	content: AgentInputBlock[];
	/** 工具专属的结构化数据，供界面渲染使用 */
	details?: unknown;
	/** 结果是否为失败 */
	isError: boolean;
	timestamp: number;
}

/** 直接执行的命令记录，不进入模型上下文时仅作展示。 */
export interface AgentBashMessage {
	role: "bashExecution";
	command: string;
	output: string;
	/** 进程退出码，被取消时可能为空 */
	exitCode: number | undefined;
	/** 是否被用户取消 */
	cancelled: boolean;
	/** 输出是否被截断 */
	truncated: boolean;
	/** 截断时完整输出的文件路径 */
	fullOutputPath?: string;
	timestamp: number;
}

/** 压缩后插入摘要的一条消息，界面据此在历史里划出压缩分界。 */
export interface AgentCompactionSummaryMessage {
	role: "compactionSummary";
	summary: string;
	/** 压缩前的上下文 token 数 */
	tokensBefore: number;
	timestamp: number;
}

/** 离开某个分支时生成的摘要，进入新分支后作为历史的一部分。 */
export interface AgentBranchSummaryMessage {
	role: "branchSummary";
	summary: string;
	/** 被离开的分支起点条目 id，为空表示没有起点 */
	fromId: string | null;
	timestamp: number;
}

/** 扩展注入的自定义消息。 */
export interface AgentCustomMessage {
	role: "custom";
	/** 扩展自定义的类型标记 */
	customType: string;
	/** 纯文本内容 */
	content: string;
	/** 是否在界面上展示 */
	display: boolean;
	/** 扩展私有数据，不发送给模型 */
	details?: unknown;
	timestamp: number;
}

/** 无法识别的消息角色，用于向前兼容扩展新增的角色。 */
export interface AgentUnknownMessage {
	role: "unknown";
	/** 原始角色名 */
	rawRole: string;
	timestamp: number;
}

/** 会话消息的联合类型。 */
export type AgentMessage =
	| AgentSystemMessage
	| AgentUserMessage
	| AgentAssistantMessage
	| AgentToolResultMessage
	| AgentBashMessage
	| AgentCompactionSummaryMessage
	| AgentBranchSummaryMessage
	| AgentCustomMessage
	| AgentUnknownMessage;

/** 工具流式输出的中间结果。 */
export interface AgentToolOutput {
	content: AgentInputBlock[];
	/** 工具专属的结构化数据 */
	details?: unknown;
	/** 是否为失败结果 */
	isError?: boolean;
}

/** 会话条目的类型标记，与持久化文件中的条目类型一致。 */
export type AgentEntryKind =
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
 * id 稳定且条目只追加，因此 id 可以作为客户端读取历史的游标。
 */
export interface AgentEntry {
	/** 条目 id，可用作游标 */
	id: string;
	/** 父条目 id，为空表示分支起点 */
	parentId: string | null;
	kind: AgentEntryKind;
	/** ISO 8601 时间戳，与消息上的 Unix 毫秒时间戳不同 */
	timestamp: string;
	/** kind 为 message 时的消息内容 */
	message?: AgentMessage;
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
export interface AgentContextUsage {
	/** 估算的上下文 token 数 */
	tokens: number | null;
	/** 当前模型的上下文窗口 */
	contextWindow: number;
	/** 占用百分比 */
	percent: number | null;
}

/** 全会话累计的 token 用量，包含已被压缩掉的历史。 */
export interface AgentTokenTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

/** 会话统计，用于会话行信息与详情面板。 */
export interface AgentStats {
	sessionId: string;
	/** 会话文件路径，内存会话为空 */
	sessionFile: string | undefined;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	/** 全部消息条数，含工具结果与自定义消息 */
	totalMessages: number;
	tokens: AgentTokenTotals;
	/** 全会话累计成本，单位美元 */
	cost: number;
	/** 当前上下文用量，模型未确定时为空 */
	contextUsage: AgentContextUsage | undefined;
}

/** 工具清单项。 */
export interface AgentToolInfo {
	name: string;
	description: string;
	/** 是否处于激活状态，即是否已声明给模型 */
	active: boolean;
}

/** 排队中的输入。 */
export interface AgentQueuedInput {
	/** 会在当前助手回合结束后插入的消息 */
	steering: string[];
	/** 会在本轮全部工作完成后插入的消息 */
	followUp: string[];
}

/** 会话索引项，用于会话列表与最近会话。 */
export interface AgentSessionSummary {
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

/** 一次待应答的工具审批请求。 */
export interface AgentApprovalRequest {
	/** 请求 id，与工具调用 id 区分，一次调用被重新请求时也不复用 */
	id: string;
	/** 对应的工具调用 id */
	callId: string;
	toolName: string;
	/** 调用参数，供审批界面展示影响范围 */
	input: unknown;
	/** 会话所在工作目录 */
	cwd: string;
	/** 由其他工具发起的嵌套调用时，指向外层调用 id */
	parentCallId?: string;
}

/** 审批结果。除 allow 之外的取值一律按拒绝处理。 */
export interface AgentApprovalDecision {
	action: "allow" | "deny";
	/** 拒绝原因，会作为工具结果返回给模型 */
	reason?: string;
}

/**
 * 审批处理函数。
 *
 * 返回拒绝或抛出错误都会拦截工具执行；等待远端应答时在此处挂起。
 */
export type AgentApprovalHandler = (
	request: AgentApprovalRequest,
	signal?: AbortSignal,
) => Promise<AgentApprovalDecision> | AgentApprovalDecision;

/** prompt 的可选参数。 */
export interface AgentPromptOptions {
	/** 随消息发送的图片附件 */
	images?: AgentImageBlock[];
	/** 会话正在运行时的投递方式：steer 插入当前回合之后，followUp 等本轮结束 */
	streamingBehavior?: "steer" | "followUp";
}

/** 模型与思考档位变更的可选参数。 */
export interface AgentModelMutationOptions {
	/** 是否同时写入全局默认值，缺省只影响当前会话 */
	persist?: boolean;
}

/**
 * 会话事件。
 *
 * 事件都是可序列化的纯数据，供端点层直接转发。run_end 之后仍可能有重试与排队工作，
 * 需要等待 settled 才能判定会话不再自动继续。
 */
export type AgentEvent =
	/** 派生状态发生变化 */
	| { type: "status"; status: AgentStatus }
	/** 一次底层运行开始 */
	| { type: "run_start" }
	/** 一次底层运行结束，willRetry 为真时后续还有重试 */
	| { type: "run_end"; willRetry: boolean }
	/** 会话不会再自动继续，唯一的终局信号 */
	| { type: "settled"; aborted: boolean }
	| { type: "turn_start" }
	/** 一轮结束，带该轮的工具结果 */
	| { type: "turn_end"; message: AgentMessage; toolResults: AgentMessage[] }
	/** 消息开始生成 */
	| { type: "message_start"; message: AgentMessage }
	/** 流式增量，contentIndex 对应消息内容块的下标 */
	| { type: "message_delta"; contentIndex: number; kind: "text" | "thinking" | "toolCall"; delta: string }
	/** 消息完成，这里是权威内容，写盘发生在这一步 */
	| { type: "message_end"; message: AgentMessage }
	| { type: "tool_start"; callId: string; toolName: string; input: unknown; parentCallId?: string }
	/** 工具的流式中间输出 */
	| { type: "tool_update"; callId: string; toolName: string; output: AgentToolOutput; parentCallId?: string }
	| {
			type: "tool_end";
			callId: string;
			toolName: string;
			output: AgentToolOutput;
			isError: boolean;
			/** 单调时钟测得的执行耗时 */
			durationMs?: number;
			parentCallId?: string;
	  }
	/** 队列内容变化，用于界面展示排队条 */
	| { type: "queue"; steering: string[]; followUp: string[] }
	| { type: "compaction_start"; reason: CompactionReason }
	| {
			type: "compaction_end";
			reason: CompactionReason;
			tokensBefore: number | undefined;
			/** 压缩后的估算值，压缩被取消时为空 */
			estimatedTokensAfter: number | undefined;
			aborted: boolean;
			willRetry: boolean;
			error: string | undefined;
	  }
	/** 自动重试开始，界面可据此展示尝试次数与倒计时 */
	| { type: "retry_start"; attempt: number; maxAttempts: number; delayMs: number; error: string }
	| { type: "retry_end"; success: boolean; attempt: number; error: string | undefined }
	/** 追加了一个持久化条目，entryId 可作为读取游标 */
	| { type: "entry"; entryId: string; parentId: string | null; kind: AgentEntryKind }
	| { type: "name"; name: string | undefined }
	| { type: "model"; model: AgentModelInfo | undefined }
	| { type: "thinking_level"; level: ThinkingLevel }
	/** 直接执行的命令的流式输出 */
	| { type: "bash_output"; id: string | undefined; delta: string }
	/** 扩展发出的通知 */
	| { type: "notice"; level: NoticeLevel; message: string }
	| { type: "approval_request"; request: AgentApprovalRequest }
	| { type: "approval_resolved"; requestId: string; decision: AgentApprovalDecision };

/** 事件监听器。抛出的错误不会中断事件分发。 */
export type AgentEventListener = (event: AgentEvent) => void;

/** 新连接方一次拿到的完整会话状态，用于接入时对齐界面。 */
export interface AgentSnapshot {
	id: string;
	file: string | undefined;
	cwd: string;
	name: string | undefined;
	status: AgentStatus;
	model: AgentModelInfo | undefined;
	thinkingLevel: ThinkingLevel;
	/** 当前模型支持的档位，用于禁用不可选的档 */
	availableThinkingLevels: ThinkingLevel[];
	activeToolNames: string[];
	queued: AgentQueuedInput;
	/** 尚未应答的审批请求 */
	pendingApprovals: AgentApprovalRequest[];
	contextUsage: AgentContextUsage | undefined;
	stats: AgentStats;
	/** 恢复会话时模型回退的提示，需要展示给用户 */
	modelFallbackMessage: string | undefined;
}
