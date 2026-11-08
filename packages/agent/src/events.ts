/**
 * pi 的会话事件到 facet 事件的映射。
 *
 * 一个 pi 事件可能对应多条对外事件，也可能只用于驱动内部状态变化而对外无输出。
 * 事件按会话顺序到达，订阅方不需要再排序。
 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { EntryKind, SessionEvent } from "@facet/protocol";
import { toMessage, toMessages, toToolOutput } from "./convert.ts";

/** 取出流式增量。pi 的 message_update 还包含 start、end 等非增量变体，那些不对外输出。 */
function deltaFor(
	event: AgentSessionEvent,
): { contentIndex: number; kind: "text" | "thinking" | "toolCall"; delta: string } | undefined {
	if (event.type !== "message_update") {
		return undefined;
	}
	const update = event.assistantMessageEvent;
	switch (update.type) {
		case "text_delta":
			return { contentIndex: update.contentIndex, kind: "text", delta: update.delta };
		case "thinking_delta":
			return { contentIndex: update.contentIndex, kind: "thinking", delta: update.delta };
		case "toolcall_delta":
			return { contentIndex: update.contentIndex, kind: "toolCall", delta: update.delta };
		default:
			return undefined;
	}
}

/** 转换一条会话事件，返回零到多条对外事件。 */
export function toSessionEvents(event: AgentSessionEvent): SessionEvent[] {
	switch (event.type) {
		case "agent_start":
			return [{ type: "run_start" }];
		case "agent_end":
			return [{ type: "run_end", willRetry: event.willRetry }];
		case "agent_settled":
			return [{ type: "settled", aborted: event.aborted }];
		case "turn_start":
			return [{ type: "turn_start" }];
		case "turn_end":
			return [
				{
					type: "turn_end",
					message: toMessage(event.message),
					toolResults: toMessages(event.toolResults),
				},
			];
		case "message_start":
			return [{ type: "message_start", message: toMessage(event.message) }];
		case "message_update": {
			const delta = deltaFor(event);
			if (!delta) {
				return [];
			}
			return [
				{
					type: "message_delta",
					contentIndex: delta.contentIndex,
					kind: delta.kind,
					delta: delta.delta,
				},
			];
		}
		case "message_end":
			return [{ type: "message_end", message: toMessage(event.message) }];
		case "tool_execution_start":
			return [
				{
					type: "tool_start",
					callId: event.toolCallId,
					toolName: event.toolName,
					input: event.args,
					parentCallId: event.parentToolCallId,
				},
			];
		case "tool_execution_update":
			return [
				{
					type: "tool_update",
					callId: event.toolCallId,
					toolName: event.toolName,
					output: toToolOutput(event.partialResult),
					parentCallId: event.parentToolCallId,
				},
			];
		case "tool_execution_end":
			return [
				{
					type: "tool_end",
					callId: event.toolCallId,
					toolName: event.toolName,
					output: toToolOutput(event.result),
					isError: event.isError,
					durationMs: event.durationMs,
					parentCallId: event.parentToolCallId,
				},
			];
		case "queue_update":
			return [{ type: "queue", steering: [...event.steering], followUp: [...event.followUp] }];
		case "compaction_start":
			return [{ type: "compaction_start", reason: event.reason }];
		case "compaction_end":
			return [
				{
					type: "compaction_end",
					reason: event.reason,
					// 压缩被取消时没有结果，两个 token 数值都缺省
					tokensBefore: event.result?.tokensBefore,
					estimatedTokensAfter: event.result?.estimatedTokensAfter,
					aborted: event.aborted,
					willRetry: event.willRetry,
					error: event.errorMessage,
				},
			];
		// 单轮重试与摘要重试对界面是同一件事：尝试次数、上限与等待时间
		case "auto_retry_start":
		case "summarization_retry_scheduled":
			return [
				{
					type: "retry_start",
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					delayMs: event.delayMs,
					error: event.errorMessage,
				},
			];
		case "auto_retry_end":
			return [{ type: "retry_end", success: event.success, attempt: event.attempt, error: event.finalError }];
		// 摘要重试结束不带尝试次数，界面只关心重试已停止
		case "summarization_retry_finished":
			return [{ type: "retry_end", success: true, attempt: 0, error: undefined }];
		case "entry_appended":
			return [
				{
					type: "entry",
					entryId: event.entry.id,
					parentId: event.entry.parentId ?? null,
					kind: event.entry.type as EntryKind,
				},
			];
		case "session_info_changed":
			return [{ type: "name", name: event.name }];
		case "thinking_level_changed":
			return [{ type: "thinking_level", level: event.level }];
		case "bash_execution_update":
			return [{ type: "bash_output", id: event.id, delta: event.delta }];
		// 摘要重试的中间进度与尚无映射的变体不对外输出
		default:
			return [];
	}
}
