/**
 * 会话事件流。
 *
 * 事件都是可序列化的纯数据，设备侧产生、端点原样转发、界面按 type 分派。
 * run_end 之后仍可能有重试与排队工作，需要等待 settled 才能判定会话不再自动继续。
 */
import type { ApprovalDecision, ApprovalRequest } from "./approval.ts";
import type { ToolOutput } from "./content.ts";
import type { Message } from "./message.ts";
import type { ModelInfo, ThinkingLevel } from "./model.ts";
import type { CompactionReason, EntryKind, SessionStatus } from "./session.ts";

/** 提示级别，用于扩展或设备侧发出的通知。 */
export type NoticeLevel = "info" | "warning" | "error";

/** 流式增量的种类，与消息内容块一一对应。 */
export type DeltaKind = "text" | "thinking" | "toolCall";

/** 会话事件。 */
export type SessionEvent =
	/** 派生状态发生变化 */
	| { type: "status"; status: SessionStatus }
	/** 一次底层运行开始 */
	| { type: "run_start" }
	/** 一次底层运行结束，willRetry 为真时后续还有重试 */
	| { type: "run_end"; willRetry: boolean }
	/** 会话不会再自动继续，唯一的终局信号 */
	| { type: "settled"; aborted: boolean }
	| { type: "turn_start" }
	/** 一轮结束，带该轮的工具结果 */
	| { type: "turn_end"; message: Message; toolResults: Message[] }
	/** 消息开始生成 */
	| { type: "message_start"; message: Message }
	/** 流式增量，contentIndex 对应消息内容块的下标 */
	| { type: "message_delta"; contentIndex: number; kind: DeltaKind; delta: string }
	/** 消息完成，这里是权威内容，写盘发生在这一步 */
	| { type: "message_end"; message: Message }
	/** 工具开始执行 */
	| { type: "tool_start"; callId: string; toolName: string; input: unknown; parentCallId?: string }
	/** 工具的流式中间输出 */
	| { type: "tool_update"; callId: string; toolName: string; output: ToolOutput; parentCallId?: string }
	/** 工具执行结束，durationMs 为单调时钟测得的耗时 */
	| {
			type: "tool_end";
			callId: string;
			toolName: string;
			output: ToolOutput;
			isError: boolean;
			durationMs?: number;
			parentCallId?: string;
	  }
	/** 队列内容变化，用于界面展示排队条 */
	| { type: "queue"; steering: string[]; followUp: string[] }
	| { type: "compaction_start"; reason: CompactionReason }
	/** 压缩结束，被取消时没有结果，两个 token 数值都缺省 */
	| {
			type: "compaction_end";
			reason: CompactionReason;
			tokensBefore: number | undefined;
			estimatedTokensAfter: number | undefined;
			aborted: boolean;
			willRetry: boolean;
			error: string | undefined;
	  }
	/** 自动重试开始，界面可据此展示尝试次数与倒计时 */
	| { type: "retry_start"; attempt: number; maxAttempts: number; delayMs: number; error: string }
	| { type: "retry_end"; success: boolean; attempt: number; error: string | undefined }
	/** 追加了一个持久化条目，entryId 可作为读取游标 */
	| { type: "entry"; entryId: string; parentId: string | null; kind: EntryKind }
	| { type: "name"; name: string | undefined }
	| { type: "model"; model: ModelInfo | undefined }
	| { type: "thinking_level"; level: ThinkingLevel }
	/** 直接执行的命令的流式输出 */
	| { type: "bash_output"; id: string | undefined; delta: string }
	/** 扩展或设备侧发出的通知 */
	| { type: "notice"; level: NoticeLevel; message: string }
	| { type: "approval_request"; request: ApprovalRequest }
	| { type: "approval_resolved"; requestId: string; decision: ApprovalDecision };

/** 事件监听器。抛出的错误由分发方隔离，不影响其他监听器。 */
export type SessionEventListener = (event: SessionEvent) => void;
