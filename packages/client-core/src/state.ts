/**
 * 客户端状态。
 *
 * 每个通道一份视图:会话通道只承载元信息与阻塞项,对话通道承载消息与轮次进度。
 * 视图是纯数据,由动作归约出新值,界面按需订阅。
 */

import type {
	Channel,
	CompactionReason,
	DeltaKind,
	Entry,
	Message,
	ModelInfo,
	NoticeLevel,
	QueuedInput,
	SessionSnapshot,
	SessionStatus,
	ThinkingLevel,
	ToolOutput,
} from "@facet/protocol";

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

/** 流式期累积出来的一段内容。 */
export interface StreamedPart {
	/** 增量的种类,决定渲染成正文、思考还是工具参数 */
	kind: DeltaKind;
	/** 已经累积到的文本 */
	text: string;
}

/**
 * 对话视图里的一项。
 *
 * 视图接收全部类型的会话条目，目前只有带 message 的条目参与渲染；其余条目保留在视图里，
 * 供以后扩展事件展示。实时消息在提升为历史消息之前没有 entry，只有 message。
 */
export interface EntryView {
	/** 视图标识;历史与提升后的消息用条目 id 加前缀,实时消息用设备分配的标识 */
	id: string;
	/** 会话条目;实时消息在本轮 settled 之后由设备补上 */
	entry: Entry | undefined;
	/** 消息内容;usage、session_info 这类条目没有 */
	message: Message | undefined;
	/** 按内容块下标累积的流式片段,收到完整消息后清空 */
	streaming: Readonly<Record<number, StreamedPart>>;
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
	readonly compaction: CompactionView | undefined;
}

/** 对话通道的客户端状态。 */
export interface ChatView {
	readonly channel: Channel;
	readonly items: readonly EntryView[];
	readonly toolCalls: Readonly<Record<string, ToolCallView>>;
	readonly queue: QueuedInput;
	/** 已请求中止本轮,等 chat/settled 收尾 */
	readonly stopping: boolean;
	/** 本轮结束后会自动重试 */
	readonly willRetry: boolean;
	/** 正在进行的一次自动重试 */
	readonly retry: { attempt: number; maxAttempts: number } | undefined;
	readonly notices: readonly NoticeView[];
	/** 提升为历史消息时的标识迁移:旧视图标识到新标识,界面据此搬动按行保存的状态 */
	readonly renames: Readonly<Record<string, string>>;
}

/** 提示条保留的条数 */
const MAX_NOTICES = 50;

/**
 * 对话此刻的状态。
 *
 * 取值穷尽,界面据此决定发送按钮与输入是否可用,不再各自拼布尔量。
 * stopping 表示已请求中止、等这一轮收尾。
 */
export type ChatActivity = "idle" | "running" | "compacting" | "stopping";

/**
 * 合并两条通道得出对话此刻的状态。
 *
 * 中止请求优先:一旦请求中止,界面只等这一轮收尾,不再区分此前是运行还是压缩。
 */
export function chatActivity(session: SessionView | undefined, chat: ChatView | undefined): ChatActivity {
	if (chat?.stopping === true) {
		return "stopping";
	}
	const status = session?.status ?? "idle";
	return status === "idle" ? "idle" : status;
}

/** 由会话快照建出会话视图。快照缺省时使用空状态。 */
export function createSessionView(channel: Channel, snapshot?: SessionSnapshot): SessionView {
	return {
		channel,
		snapshot,
		status: snapshot?.status ?? "idle",
		model: snapshot?.model,
		thinkingLevel: snapshot?.thinkingLevel,
		title: snapshot?.name,
		compaction: undefined,
	};
}

/** 建出空的对话视图。 */
export function createChatView(channel: Channel): ChatView {
	return {
		channel,
		items: [],
		toolCalls: {},
		queue: { steering: [], followUp: [] },
		stopping: false,
		willRetry: false,
		retry: undefined,
		notices: [],
		renames: {},
	};
}

/** 追加一条提示并保留最近若干条。 */
export function appendNotice(notices: readonly NoticeView[], notice: NoticeView): readonly NoticeView[] {
	const next = [...notices, notice];
	return next.length > MAX_NOTICES ? next.slice(next.length - MAX_NOTICES) : next;
}
