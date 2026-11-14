/**
 * 对外出口。
 *
 * 状态由纯归约函数推进，store 只负责按通道保存与去重；渲染单元由 transcript 投影，
 * 界面层不直接解析动作，也不区分历史与实时两条来源。
 */
export type { HostHandshake, OpenedSession, SessionClientOptions, SessionTransport } from "./client.ts";
export { SessionClient } from "./client.ts";
export { historyMessageId, isHistoryMessageId } from "./message-id.ts";
export { reduceChat, reduceSession } from "./reduce.ts";
export type {
	ChatActivity,
	ChatView,
	EntryView,
	NoticeView,
	SessionState,
	SessionView,
	StreamedPart,
	ToolCallView,
} from "./state.ts";
export { appendNotice, chatActivity, createChatView, createSessionView } from "./state.ts";
export type { ChannelGap, SessionListEntry } from "./store.ts";
export { messageDisplayText, messageText, SessionStore } from "./store.ts";
export type { AttachedTerminal, TerminalListener } from "./terminal-client.ts";
export { TerminalClient } from "./terminal-client.ts";
export type {
	Part,
	TextPart,
	ThinkingPart,
	ToolCallPart,
	ToolImage,
	ToolPartStatus,
	TranscriptItem,
} from "./transcript.ts";
export { toolOutputText, toTranscript } from "./transcript.ts";
