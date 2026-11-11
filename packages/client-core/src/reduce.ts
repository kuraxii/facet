/**
 * 动作归约。
 *
 * 纯函数:输入当前视图与一条动作,输出新视图,不改动入参。界面据此增量重绘,
 * 测试不需要窗口也不需要网络。
 */
import type { Action, Message } from "@facet/protocol";
import type { ChatView, EntryView, SessionView } from "./state.ts";
import { appendNotice } from "./state.ts";

/** 消息是否还在流式写入。设备只在 message_end 时发 messageUpdated,中途的增量走 chat/delta。 */
function isStreamingMessage(message: Message): boolean {
	return message.role === "assistant" && message.stopReason === "pending";
}

/** 同标识的条目替换,否则追加到末尾。 */
function upsertMessage(items: readonly EntryView[], next: EntryView): readonly EntryView[] {
	const index = items.findIndex((item) => item.id === next.id);
	if (index < 0) {
		return [...items, next];
	}
	const copy = [...items];
	copy[index] = next;
	return copy;
}

/** 覆写一条消息。消息不在列表里时原样返回。 */
function patchMessage(
	items: readonly EntryView[],
	id: string,
	patch: (view: EntryView) => EntryView,
): readonly EntryView[] {
	const index = items.findIndex((item) => item.id === id);
	const current = items[index];
	if (!current) {
		return items;
	}
	const copy = [...items];
	copy[index] = patch(current);
	return copy;
}

/** 列出某个动作类型没被处理的情况,由类型系统保证穷尽。 */
function unhandled(value: never): never {
	throw new Error(`未处理的动作:${JSON.stringify(value)}`);
}

/** 归约一条会话通道动作。对话动作原样返回。 */
export function reduceSession(view: SessionView, action: Action): SessionView {
	switch (action.type) {
		case "session/phase":
			return { ...view, state: { ...view.state, phase: action.phase, maintenance: action.maintenance } };
		case "session/modelChanged":
			return { ...view, state: { ...view.state, model: action.model } };
		case "session/thinkingLevelChanged":
			return { ...view, state: { ...view.state, thinkingLevel: action.level } };
		case "session/queueChanged":
			return {
				...view,
				state: { ...view.state, queued: { steering: action.steering, followUp: action.followUp } },
			};
		case "session/titleChanged":
			return { ...view, state: { ...view.state, title: action.title } };
		case "session/configChanged":
			return action.thinkingLevel === undefined
				? view
				: { ...view, state: { ...view.state, thinkingLevel: action.thinkingLevel } };
		case "session/pendingMessageSet":
		case "session/queueCleared":
			return view;
		case "chat/messageAppended":
		case "chat/messageUpdated":
		case "chat/delta":
		case "chat/toolCallStarted":
		case "chat/toolCallUpdated":
		case "chat/toolCallEnded":
		case "chat/settled":
		case "chat/notice":
		case "chat/turnStarted":
		case "chat/turnCancelled":
			return view;
		default:
			return unhandled(action);
	}
}

/** 归约一条对话通道动作。会话动作原样返回。 */
export function reduceChat(view: ChatView, action: Action): ChatView {
	switch (action.type) {
		case "chat/messageAppended": {
			const existing = view.items.find((item) => item.id === action.messageId);
			const next: EntryView = {
				id: action.messageId,
				entry: existing?.entry,
				message: action.message,
				streaming: existing?.streaming ?? {},
				isStreaming: isStreamingMessage(action.message),
			};
			return { ...view, items: upsertMessage(view.items, next) };
		}
		case "chat/messageUpdated": {
			const existing = view.items.find((item) => item.id === action.messageId);
			const next: EntryView = {
				id: action.messageId,
				entry: existing?.entry,
				message: action.message,
				streaming: {},
				isStreaming: isStreamingMessage(action.message),
			};
			return { ...view, items: upsertMessage(view.items, next) };
		}
		case "chat/delta": {
			const items = patchMessage(view.items, action.messageId, (current) => {
				const previous = current.streaming[action.partIndex];
				return {
					...current,
					streaming: {
						...current.streaming,
						[action.partIndex]: { kind: action.kind, text: `${previous?.text ?? ""}${action.delta}` },
					},
					isStreaming: true,
				};
			});
			return items === view.items ? view : { ...view, items };
		}
		case "chat/toolCallStarted": {
			const existing = view.toolCalls[action.callId];
			return {
				...view,
				toolCalls: {
					...view.toolCalls,
					[action.callId]: {
						callId: action.callId,
						toolName: action.toolName,
						input: action.input,
						parentCallId: action.parentCallId ?? existing?.parentCallId,
						output: existing?.output,
						isError: false,
						isRunning: true,
						durationMs: undefined,
					},
				},
			};
		}
		case "chat/toolCallUpdated": {
			const existing = view.toolCalls[action.callId];
			if (!existing) {
				return view;
			}
			return {
				...view,
				toolCalls: { ...view.toolCalls, [action.callId]: { ...existing, output: action.output } },
			};
		}
		case "chat/toolCallEnded": {
			const existing = view.toolCalls[action.callId];
			if (!existing) {
				return view;
			}
			return {
				...view,
				toolCalls: {
					...view.toolCalls,
					[action.callId]: {
						...existing,
						output: action.output,
						isError: action.isError,
						isRunning: false,
						durationMs: action.durationMs,
					},
				},
			};
		}
		case "chat/notice":
			return {
				...view,
				notices: appendNotice(view.notices, { level: action.level, message: action.message }),
			};
		case "chat/settled":
			return view;
		// 发出消息与中止请求都由设备回过来,这里不需要改视图
		case "chat/turnStarted":
		case "chat/turnCancelled":
			return view;
		case "session/phase":
		case "session/modelChanged":
		case "session/thinkingLevelChanged":
		case "session/queueChanged":
		case "session/titleChanged":
		case "session/configChanged":
		case "session/pendingMessageSet":
		case "session/queueCleared":
			return view;
		default:
			return unhandled(action);
	}
}
