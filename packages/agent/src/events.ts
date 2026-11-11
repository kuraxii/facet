/**
 * pi 的会话事件到 facet 事件的映射。
 *
 * 一个 pi 事件可能对应多条对外事件，也可能只用于驱动内部状态变化而对外无输出。
 * 事件按会话顺序到达，订阅方不需要再排序。
 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { EntryKind, Maintenance, SessionEvent, TurnPhase } from "@facet/protocol";
import { toMessage, toMessages, toToolOutput } from "./convert.ts";

/** 本轮的生命周期与维护动作。 */
export interface TurnState {
	readonly phase: TurnPhase;
	readonly maintenance: Maintenance | undefined;
}

/**
 * 由 pi 事件推出新的阶段与维护动作。
 *
 * 返回 undefined 表示这条事件不改变它们;返回新状态表示需要对外发一次 phase 事件。
 * starting 与 stopping 由 prompt 与 abort 直接设定,不在这里推导。
 */
export function nextTurnState(event: AgentSessionEvent, current: TurnState): TurnState | undefined {
	switch (event.type) {
		case "agent_start":
			return current.phase === "running" ? undefined : { ...current, phase: "running" };
		case "agent_settled":
			return current.phase === "idle" && current.maintenance === undefined
				? undefined
				: { phase: "idle", maintenance: undefined };
		case "compaction_start":
			return {
				...current,
				maintenance: {
					kind: "compaction",
					reason: event.reason,
					tokensBefore: undefined,
					estimatedTokensAfter: undefined,
				},
			};
		case "compaction_end":
			return current.maintenance === undefined ? undefined : { ...current, maintenance: undefined };
		case "auto_retry_start":
		case "summarization_retry_scheduled":
			return {
				...current,
				maintenance: { kind: "retry", attempt: event.attempt, maxAttempts: event.maxAttempts },
			};
		case "auto_retry_end":
		case "summarization_retry_finished":
			return current.maintenance === undefined ? undefined : { ...current, maintenance: undefined };
		default:
			return undefined;
	}
}

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
		// 阶段与维护动作由 nextTurnState 单独推导;其余尚无映射的变体不对外输出
		default:
			return [];
	}
}
