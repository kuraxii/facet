/**
 * pi 的会话事件到 facet 事件的映射。
 *
 * 一个 pi 事件可能对应多条对外事件，也可能只用于驱动内部状态变化而对外无输出。
 * 事件按会话顺序到达，订阅方不需要再排序。
 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { EntryKind, Maintenance, Message, SessionEvent, TurnPhase } from "@facet/protocol";
import { toMessage, toMessages, toToolOutput } from "./convert.ts";

/** 本轮的生命周期与维护动作。 */
export interface TurnState {
	readonly phase: TurnPhase;
	readonly maintenance: Maintenance | undefined;
}

/**
 * 状态转移的输入。
 *
 * pi 的会话事件与命令侧的生命周期节点（开始、中止、收尾）走同一张表：状态只由这里输入，
 * 不在命令实现里各自赋值。
 */
export type TurnInput =
	/** 底层 pi 事件 */
	| { readonly kind: "event"; readonly event: AgentSessionEvent }
	/** 准备开始一轮；streaming 为真表示上一轮还在跑，这一条只是投递 */
	| { readonly kind: "prompt_requested"; readonly streaming: boolean }
	/** 收到停止请求 */
	| { readonly kind: "abort_requested" }
	/** 命令侧收尾；streaming 为真时交给 settled 收尾 */
	| { readonly kind: "command_finally"; readonly streaming: boolean };

/** 两个状态是否相同。外壳据此决定要不要对外发一次 phase 事件。 */
export function sameTurnState(left: TurnState, right: TurnState): boolean {
	return left.phase === right.phase && left.maintenance === right.maintenance;
}

/**
 * 状态转移的唯一实现。
 *
 * 纯函数：同样的当前状态与输入永远得到同样的结果，不读时间、不读会话。pi 事件与命令侧节点
 * 在下面各走一段，但合并成一张表，谁先到、重不重复都只影响落点，不影响合法性：
 *
 * - `agent_start` 进入 running，已经在 running 时原样返回；
 * - `agent_settled` 收回 idle，已经停在 idle 且没有维护动作时原样返回（重复到达不会发事件）；
 * - `prompt_requested` 只在空闲且不在流式时进入 starting；
 * - `abort_requested` 只在 running / starting 时进入 stopping；
 * - `command_finally` 在不再流式时把 starting / stopping 收回 idle；settled 先到时它已经是
 *   idle，原样返回。
 */
export function reduceTurnState(current: TurnState, input: TurnInput): TurnState {
	switch (input.kind) {
		case "prompt_requested":
			return !input.streaming && current.phase === "idle" ? { ...current, phase: "starting" } : current;
		case "abort_requested":
			return current.phase === "running" || current.phase === "starting"
				? { ...current, phase: "stopping" }
				: current;
		case "command_finally":
			if (input.streaming) {
				return current;
			}
			return current.phase === "starting" || current.phase === "stopping"
				? { ...current, phase: "idle" }
				: current;
		case "event":
			return reduceTurnEvent(current, input.event);
	}
}

/** pi 事件这一段转移表：阶段与维护动作。 */
function reduceTurnEvent(current: TurnState, event: AgentSessionEvent): TurnState {
	switch (event.type) {
		case "agent_start":
			return current.phase === "running" ? current : { ...current, phase: "running" };
		case "agent_settled":
			return current.phase === "idle" && current.maintenance === undefined
				? current
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
			return current.maintenance === undefined ? current : { ...current, maintenance: undefined };
		case "auto_retry_start":
			return {
				...current,
				maintenance: {
					kind: "retry",
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					delayMs: event.delayMs,
				},
			};
		case "summarization_retry_scheduled":
			if (current.maintenance?.kind === "compaction") {
				return current;
			}
			return {
				...current,
				maintenance: {
					kind: "retry",
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					delayMs: event.delayMs,
				},
			};
		case "auto_retry_end":
			return current.maintenance === undefined ? current : { ...current, maintenance: undefined };
		case "summarization_retry_finished":
			return current.maintenance?.kind === "retry" ? { ...current, maintenance: undefined } : current;
		default:
			return current;
	}
}

/**
 * 一轮是否以错误收尾。
 *
 * 只看助手消息的 stopReason：工具调用失败但模型接着跑下去属于对话内细节，不该升成会话级的
 * 结果，所以不从 tool_end 的 isError 推。
 */
export function turnFailure(message: Message): string | undefined {
	if (message.role !== "assistant" || message.stopReason !== "error") {
		return undefined;
	}
	return message.errorMessage ?? "模型请求失败";
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
	// 脚本类工具在自己的执行里再调别的工具，这些子调用带 parentToolCallId。
	// 脚本本身与汇总结果都在父调用里，子调用发出去只会在对话里多出几行噪音
	const isNestedToolEvent =
		event.type === "tool_execution_start" ||
		event.type === "tool_execution_update" ||
		event.type === "tool_execution_end";
	if (isNestedToolEvent && event.parentToolCallId !== undefined) {
		return [];
	}
	switch (event.type) {
		case "agent_start":
			return [{ type: "run_start" }];
		case "agent_end":
			return [{ type: "run_end", willRetry: event.willRetry }];
		case "agent_settled":
			// 失败原因不在这里取：turn_end 的助手消息才有 stopReason，由 PiAgent 攒着后补上
			return [{ type: "settled", aborted: event.aborted, failure: undefined }];
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
				},
			];
		case "tool_execution_update":
			return [
				{
					type: "tool_update",
					callId: event.toolCallId,
					toolName: event.toolName,
					output: toToolOutput(event.partialResult),
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
		// 阶段与维护动作由 reduceTurnState 单独推导;其余尚无映射的变体不对外输出
		default:
			return [];
	}
}
