/**
 * 动作归约。
 *
 * 纯函数:输入当前视图与一条动作,输出新视图,不改动入参。界面据此增量重绘,
 * 测试不需要窗口也不需要网络。
 */
import type { Action, Message } from "@facet/protocol";
import { historyMessageId } from "./message-id.ts";
import type { ChatView, EntryView, SessionView } from "./state.ts";
import { appendNotice } from "./state.ts";

/** 消息是否还在流式写入。主机只在 message_end 时发 messageUpdated,中途的增量走 chat/delta。 */
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

/**
 * 两份纯数据是否等价。
 *
 * 动作里带的都是字段不多的纯数据，序列化比较比逐字段写一遍更不容易漏掉新加的字段。
 */
function same(left: unknown, right: unknown): boolean {
	return left === right || JSON.stringify(left) === JSON.stringify(right);
}

/** 列出某个动作类型没被处理的情况,由类型系统保证穷尽。 */
function unhandled(value: never): never {
	throw new Error(`Unhandled action: ${JSON.stringify(value)}`);
}

/** 归约一条会话通道动作。对话动作原样返回。 */
export function reduceSession(view: SessionView, action: Action): SessionView {
	switch (action.type) {
		case "session/initialized":
			if (same(view.state.initialization, action.initialization)) {
				return view;
			}
			return { ...view, state: { ...view.state, initialization: action.initialization } };
		case "session/uiChanged":
			if (same(view.state.extensionUi, action.ui)) {
				return view;
			}
			return { ...view, state: { ...view.state, extensionUi: action.ui } };
		case "session/phase":
			// 阶段帧每轮都会来几条，值没变就不换引用，界面因此不必重绘
			if (view.state.phase === action.phase && same(view.state.maintenance, action.maintenance)) {
				return view;
			}
			return { ...view, state: { ...view.state, phase: action.phase, maintenance: action.maintenance } };
		case "session/usageChanged": {
			const nextStats = action.stats === undefined ? view.state.stats : action.stats;
			if (same(view.state.contextUsage, action.usage) && same(view.state.stats, nextStats)) {
				return view;
			}
			return { ...view, state: { ...view.state, contextUsage: action.usage, stats: nextStats } };
		}
		case "session/modelChanged":
			if (
				same(view.state.model, action.model) &&
				same(view.state.availableThinkingLevels, action.availableThinkingLevels)
			) {
				return view;
			}
			return {
				...view,
				state: {
					...view.state,
					model: action.model,
					availableThinkingLevels: action.availableThinkingLevels,
				},
			};
		case "session/thinkingLevelChanged":
			if (view.state.thinkingLevel === action.level) {
				return view;
			}
			return { ...view, state: { ...view.state, thinkingLevel: action.level } };
		case "session/queueChanged":
			if (
				same(view.state.queued.steering, action.steering) &&
				same(view.state.queued.followUp, action.followUp)
			) {
				return view;
			}
			return {
				...view,
				state: { ...view.state, queued: { steering: action.steering, followUp: action.followUp } },
			};
		case "session/titleChanged":
			if (view.state.title === action.title) {
				return view;
			}
			return { ...view, state: { ...view.state, title: action.title } };
		case "session/configChanged":
			return action.thinkingLevel === undefined || view.state.thinkingLevel === action.thinkingLevel
				? view
				: { ...view, state: { ...view.state, thinkingLevel: action.thinkingLevel } };
		case "session/pendingMessageSet":
		case "session/queueCleared":
		case "session/followUpPromoted":
		case "session/followUpRemoved":
		case "session/steeringDemoted":
		case "session/compact":
			return view;
		case "chat/inputHandled":
		case "chat/queueReclaimed":
		case "chat/messageAppended":
		case "chat/messageUpdated":
		case "chat/entryCommitted":
		case "chat/delta":
		case "chat/toolCallStarted":
		case "chat/toolCallUpdated":
		case "chat/toolCallEnded":
		case "chat/settled":
		case "chat/notice":
		case "chat/turnStarted":
		case "chat/turnCancelled":
		// 回退由主机改分支指针，历史在收到 chat/branchMoved 后重新装载
		case "chat/revertTo":
		case "chat/branchMoved":
		// 会话清单动作走 SessionStore 的清单表，模型通道动作走登录状态表，终端动作走终端客户端，
		// 工作树动作只推进工作树的版本号，都不进单个会话的视图
		case "models/loginEvent":
		case "sessions/changed":
		case "sessions/status":
		case "sessions/removed":
		case "terminal/data":
		case "terminal/exit":
		case "terminal/closed":
		case "terminal/resized":
		case "workspace/changed":
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
			if (existing?.message === action.message) {
				// 同一条消息又推了一遍：内容还是那一份，视图不必动
				return view;
			}
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
			if (existing?.message === action.message) {
				return view;
			}
			const next: EntryView = {
				id: action.messageId,
				entry: existing?.entry,
				message: action.message,
				streaming: {},
				isStreaming: isStreamingMessage(action.message),
			};
			return { ...view, items: upsertMessage(view.items, next) };
		}
		case "chat/entryCommitted": {
			const entry = action.entry;
			if (action.messageId !== undefined) {
				const existing = view.items.find((item) => item.id === action.messageId);
				if (existing !== undefined) {
					if (
						existing.entry?.id === entry.id &&
						same(existing.message, entry.message ?? existing.message) &&
						!existing.isStreaming
					) {
						return view;
					}
					return {
						...view,
						items: patchMessage(view.items, action.messageId, (current) => ({
							...current,
							entry,
							message: entry.message ?? current.message,
							streaming: {},
							isStreaming: false,
						})),
					};
				}
				return {
					...view,
					items: upsertMessage(view.items, {
						id: action.messageId,
						entry,
						message: entry.message,
						streaming: {},
						isStreaming: false,
					}),
				};
			}
			const existingByEntry = view.items.find((item) => item.entry?.id === entry.id);
			if (existingByEntry !== undefined) {
				return view;
			}
			return {
				...view,
				items: upsertMessage(view.items, {
					id: historyMessageId(entry.id),
					entry,
					message: entry.message,
					streaming: {},
					isStreaming: false,
				}),
			};
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
			if (existing?.isRunning === true && same(existing.input, action.input)) {
				return view;
			}
			return {
				...view,
				toolCalls: {
					...view.toolCalls,
					[action.callId]: {
						callId: action.callId,
						toolName: action.toolName,
						input: action.input,
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
			if (!view.items.some((item) => item.isStreaming)) {
				return view;
			}
			return {
				...view,
				items: view.items.map((item) => (item.isStreaming ? { ...item, isStreaming: false } : item)),
			};
		case "chat/revertTo":
		case "chat/branchMoved":
			return view;
		// 发出消息与中止请求都由主机回过来,这里不需要改视图
		case "chat/inputHandled":
		case "chat/turnStarted":
		case "chat/turnCancelled":
		case "chat/queueReclaimed":
			return view;
		case "session/initialized":
		case "session/uiChanged":
		case "session/phase":
		case "session/modelChanged":
		case "session/thinkingLevelChanged":
		case "session/queueChanged":
		case "session/titleChanged":
		case "session/configChanged":
		case "session/pendingMessageSet":
		case "session/queueCleared":
		case "session/followUpPromoted":
		case "session/followUpRemoved":
		case "session/steeringDemoted":
		case "session/compact":
		case "session/usageChanged":
		case "models/loginEvent":
		case "sessions/changed":
		case "sessions/status":
		case "sessions/removed":
		case "terminal/data":
		case "terminal/exit":
		case "terminal/closed":
		case "terminal/resized":
		case "workspace/changed":
			return view;
		default:
			return unhandled(action);
	}
}
