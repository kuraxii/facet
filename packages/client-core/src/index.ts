/**
 * 对外出口。
 *
 * 状态由纯归约函数推进，store 只负责按通道保存与去重；界面层不直接解析动作。
 */

export type { DeviceHandshake, OpenedSession, SessionClientOptions, SessionTransport } from "./client.ts";
export { SessionClient } from "./client.ts";
export { reduceChat, reduceSession } from "./reduce.ts";
export type {
	ChatView,
	CompactionView,
	MessageView,
	NoticeView,
	SessionView,
	ToolCallView,
} from "./state.ts";
export { appendNotice, createChatView, createSessionView } from "./state.ts";
export type { ChannelGap } from "./store.ts";
export {
	historyEntryId,
	isHistoryMessageId,
	messageDisplayText,
	messageText,
	SessionStore,
} from "./store.ts";
