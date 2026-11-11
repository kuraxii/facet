/**
 * 对外出口。
 *
 * 状态由纯归约函数推进，store 只负责按通道保存与去重；渲染单元由 transcript 投影，
 * 界面层不直接解析动作，也不区分历史与实时两条来源。
 */
export type { DeviceHandshake, OpenedSession, SessionClientOptions, SessionTransport } from "./client.ts";
export { SessionClient } from "./client.ts";
export { historyMessageId, isHistoryMessageId } from "./message-id.ts";
export { reduceChat, reduceSession } from "./reduce.ts";
export type {
	ChatView,
	CompactionView,
	EntryView,
	NoticeView,
	SessionView,
	StreamedPart,
	ToolCallView,
} from "./state.ts";
export { appendNotice, createChatView, createSessionView } from "./state.ts";
export type { ChannelGap } from "./store.ts";
export { messageDisplayText, messageText, SessionStore } from "./store.ts";
export type {
	Part,
	TextPart,
	ThinkingPart,
	ToolCallPart,
	ToolPartStatus,
	TranscriptItem,
} from "./transcript.ts";
export { toolOutputText, toTranscript } from "./transcript.ts";
