/**
 * 客户端状态。
 *
 * 每个通道一份视图:会话通道只承载元信息与阻塞项,对话通道承载消息与轮次进度。
 * 视图是纯数据,由动作归约出新值,界面按需订阅。
 */

import type {
	Channel,
	CompactionReason,
	InputRequest,
	Message,
	ModelInfo,
	NoticeLevel,
	QueuedInput,
	SessionSnapshot,
	SessionStatus,
	ThinkingLevel,
	ToolOutput,
} from "@facet/protocol";
import { makeChannel } from "@facet/protocol";

/** 一条工具调用在客户端的呈现状态。 */
export interface ToolCallView {
	/** 调用 id,与消息里的工具调用块、工具结果消息对应 */
	callId: string;
	/** 工具名 */
	toolName: string;
	/** 调用参数 */
	input: unknown;
	/** 父调用 id,子代理或嵌套调用时为上层调用 */
	parentCallId: string | undefined;
	/** 最近一次输出,执行中也可能有中间结果 */
	output: ToolOutput | undefined;
	/** 结果是否为失败 */
	isError: boolean;
	/** 是否仍在执行 */
	isRunning: boolean;
	/** 执行耗时,结束后才有 */
	durationMs: number | undefined;
}

/** 一条消息在客户端的呈现状态。 */
export interface MessageView {
	/** 设备分配的标识;历史投影出来的消息用条目 id 加前缀区分 */
	id: string;
	/** 最近一次收到的完整消息 */
	message: Message;
	/** 按内容块下标累积的流式文本,收到完整消息后清空 */
	streaming: Readonly<Record<number, string>>;
	/** 是否仍在流式写入 */
	isStreaming: boolean;
}

/** 一条提示。 */
export interface NoticeView {
	level: NoticeLevel;
	message: string;
}

/** 压缩进度。 */
export interface CompactionView {
	reason: CompactionReason;
	isRunning: boolean;
	tokensBefore: number | undefined;
	estimatedTokensAfter: number | undefined;
	aborted: boolean;
	willRetry: boolean;
	error: string | undefined;
}

/** 会话通道的客户端状态。 */
export interface SessionView {
	readonly channel: Channel;
	/** 设备给出的会话快照,订阅成功或重新同步后更新 */
	readonly snapshot: SessionSnapshot | undefined;
	readonly status: SessionStatus;
	readonly model: ModelInfo | undefined;
	readonly thinkingLevel: ThinkingLevel | undefined;
	readonly title: string | undefined;
	/** 待应答的阻塞项,例如工具确认 */
	readonly inputNeeded: readonly InputRequest[];
	readonly compaction: CompactionView | undefined;
}

/** 对话通道的客户端状态。 */
export interface ChatView {
	readonly channel: Channel;
	readonly messages: readonly MessageView[];
	readonly toolCalls: Readonly<Record<string, ToolCallView>>;
	readonly queue: QueuedInput;
	/** 是否有运行中的回合 */
	readonly isRunning: boolean;
	/** 本轮结束后会自动重试 */
	readonly willRetry: boolean;
	/** 正在进行的一次自动重试 */
	readonly retry: { attempt: number; maxAttempts: number } | undefined;
	readonly notices: readonly NoticeView[];
}

/** 提示条保留的条数 */
const MAX_NOTICES = 50;

/** 由会话快照建出会话视图。快照缺省时使用空状态。 */
export function createSessionView(channel: Channel, snapshot?: SessionSnapshot): SessionView {
	return {
		channel,
		snapshot,
		status: snapshot?.status ?? "idle",
		model: snapshot?.model,
		thinkingLevel: snapshot?.thinkingLevel,
		title: snapshot?.name,
		inputNeeded: snapshot ? pendingToInputNeeded(snapshot) : [],
		compaction: undefined,
	};
}

/** 建出空的对话视图。 */
export function createChatView(channel: Channel): ChatView {
	return {
		channel,
		messages: [],
		toolCalls: {},
		queue: { steering: [], followUp: [] },
		isRunning: false,
		willRetry: false,
		retry: undefined,
		notices: [],
	};
}

/** 追加一条提示并保留最近若干条。 */
export function appendNotice(notices: readonly NoticeView[], notice: NoticeView): readonly NoticeView[] {
	const next = [...notices, notice];
	return next.length > MAX_NOTICES ? next.slice(next.length - MAX_NOTICES) : next;
}

/** 把快照里尚未应答的审批转成阻塞项,便于只订阅会话通道的端直接应答。 */
function pendingToInputNeeded(snapshot: SessionSnapshot): readonly InputRequest[] {
	const chatChannel = makeChannel("chat", snapshot.id);
	return snapshot.pendingApprovals.map((request) => ({
		id: request.id,
		kind: "toolConfirmation",
		channel: chatChannel,
		sessionId: snapshot.id,
		callId: request.callId,
		toolName: request.toolName,
		input: request.input,
		cwd: request.cwd,
	}));
}
