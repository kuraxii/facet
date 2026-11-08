export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type AgentStatus = "idle" | "running" | "awaiting_approval" | "compacting";

export type CompactionReason = "manual" | "threshold" | "overflow";

export type PromptDisposition = "handled" | "queued" | "started";

export type QueueDisposition = "handled" | "queued";

export type NoticeLevel = "info" | "warning" | "error";

export type InputModality = "text" | "image";

export interface AgentCostBreakdown {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface AgentCost extends AgentCostBreakdown {
	total: number;
}

export interface AgentModelRef {
	provider: string;
	id: string;
}

export interface AgentModelInfo extends AgentModelRef {
	name: string;
	api: string;
	reasoning: boolean;
	contextWindow: number;
	maxTokens: number;
	input: InputModality[];
	cost: AgentCostBreakdown;
}

export interface AgentProviderInfo {
	id: string;
	name: string;
	authenticated: boolean;
	modelCount: number;
}

export interface AgentTextBlock {
	type: "text";
	text: string;
}

export interface AgentImageBlock {
	type: "image";
	data: string;
	mimeType: string;
}

export interface AgentThinkingBlock {
	type: "thinking";
	thinking: string;
	redacted: boolean;
}

export interface AgentToolCallBlock {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export type AgentContentBlock = AgentTextBlock | AgentImageBlock | AgentThinkingBlock | AgentToolCallBlock;

export type AgentInputBlock = AgentTextBlock | AgentImageBlock;

export interface AgentUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning: number;
	totalTokens: number;
	cost: AgentCost;
}

export type AgentStopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

export interface AgentSystemMessage {
	role: "system";
	content: string;
	timestamp: number;
}

export interface AgentUserMessage {
	role: "user";
	content: AgentInputBlock[];
	timestamp: number;
}

export interface AgentAssistantMessage {
	role: "assistant";
	content: AgentContentBlock[];
	provider: string;
	model: string;
	usage: AgentUsage;
	stopReason: AgentStopReason;
	errorMessage?: string;
	timestamp: number;
}

export interface AgentToolResultMessage {
	role: "toolResult";
	callId: string;
	toolName: string;
	content: AgentInputBlock[];
	details?: unknown;
	isError: boolean;
	timestamp: number;
}

export interface AgentBashMessage {
	role: "bashExecution";
	command: string;
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	fullOutputPath?: string;
	timestamp: number;
}

export interface AgentCompactionSummaryMessage {
	role: "compactionSummary";
	summary: string;
	tokensBefore: number;
	timestamp: number;
}

export interface AgentBranchSummaryMessage {
	role: "branchSummary";
	summary: string;
	fromId: string | null;
	timestamp: number;
}

export interface AgentCustomMessage {
	role: "custom";
	customType: string;
	content: string;
	display: boolean;
	details?: unknown;
	timestamp: number;
}

export interface AgentUnknownMessage {
	role: "unknown";
	rawRole: string;
	timestamp: number;
}

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

export interface AgentToolOutput {
	content: AgentInputBlock[];
	details?: unknown;
	isError?: boolean;
}

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

export interface AgentEntry {
	id: string;
	parentId: string | null;
	kind: AgentEntryKind;
	timestamp: string;
	message?: AgentMessage;
	summary?: string;
	name?: string;
}

export interface AgentContextUsage {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export interface AgentTokenTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

export interface AgentStats {
	sessionId: string;
	sessionFile: string | undefined;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: AgentTokenTotals;
	cost: number;
	contextUsage: AgentContextUsage | undefined;
}

export interface AgentToolInfo {
	name: string;
	description: string;
	active: boolean;
}

export interface AgentQueuedInput {
	steering: string[];
	followUp: string[];
}

export interface AgentSessionSummary {
	id: string;
	path: string;
	cwd: string;
	name: string | undefined;
	parentSessionPath: string | undefined;
	created: number;
	modified: number;
	messageCount: number;
	firstMessage: string;
}

export interface AgentApprovalRequest {
	id: string;
	callId: string;
	toolName: string;
	input: unknown;
	cwd: string;
	parentCallId?: string;
}

export interface AgentApprovalDecision {
	action: "allow" | "deny";
	reason?: string;
}

export type AgentApprovalHandler = (
	request: AgentApprovalRequest,
	signal?: AbortSignal,
) => Promise<AgentApprovalDecision> | AgentApprovalDecision;

export interface AgentPromptOptions {
	images?: AgentImageBlock[];
	streamingBehavior?: "steer" | "followUp";
}

export interface AgentModelMutationOptions {
	persist?: boolean;
}

export type AgentEvent =
	| { type: "status"; status: AgentStatus }
	| { type: "run_start" }
	| { type: "run_end"; willRetry: boolean }
	| { type: "settled"; aborted: boolean }
	| { type: "turn_start" }
	| { type: "turn_end"; message: AgentMessage; toolResults: AgentMessage[] }
	| { type: "message_start"; message: AgentMessage }
	| { type: "message_delta"; contentIndex: number; kind: "text" | "thinking" | "toolCall"; delta: string }
	| { type: "message_end"; message: AgentMessage }
	| { type: "tool_start"; callId: string; toolName: string; input: unknown; parentCallId?: string }
	| { type: "tool_update"; callId: string; toolName: string; output: AgentToolOutput; parentCallId?: string }
	| {
			type: "tool_end";
			callId: string;
			toolName: string;
			output: AgentToolOutput;
			isError: boolean;
			durationMs?: number;
			parentCallId?: string;
	  }
	| { type: "queue"; steering: string[]; followUp: string[] }
	| { type: "compaction_start"; reason: CompactionReason }
	| {
			type: "compaction_end";
			reason: CompactionReason;
			tokensBefore: number | undefined;
			estimatedTokensAfter: number | undefined;
			aborted: boolean;
			willRetry: boolean;
			error: string | undefined;
	  }
	| { type: "retry_start"; attempt: number; maxAttempts: number; delayMs: number; error: string }
	| { type: "retry_end"; success: boolean; attempt: number; error: string | undefined }
	| { type: "entry"; entryId: string; parentId: string | null; kind: AgentEntryKind }
	| { type: "name"; name: string | undefined }
	| { type: "model"; model: AgentModelInfo | undefined }
	| { type: "thinking_level"; level: ThinkingLevel }
	| { type: "bash_output"; id: string | undefined; delta: string }
	| { type: "notice"; level: NoticeLevel; message: string }
	| { type: "approval_request"; request: AgentApprovalRequest }
	| { type: "approval_resolved"; requestId: string; decision: AgentApprovalDecision };

export type AgentEventListener = (event: AgentEvent) => void;

export interface AgentSnapshot {
	id: string;
	file: string | undefined;
	cwd: string;
	name: string | undefined;
	status: AgentStatus;
	model: AgentModelInfo | undefined;
	thinkingLevel: ThinkingLevel;
	availableThinkingLevels: ThinkingLevel[];
	activeToolNames: string[];
	queued: AgentQueuedInput;
	pendingApprovals: AgentApprovalRequest[];
	contextUsage: AgentContextUsage | undefined;
	stats: AgentStats;
	modelFallbackMessage: string | undefined;
}
