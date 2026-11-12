/**
 * 客户端状态。
 *
 * 每个通道一份视图:会话通道只承载元信息与阻塞项,对话通道承载消息与轮次进度。
 * 视图是纯数据,由动作归约出新值,界面按需订阅。
 */

import type {
	Channel,
	ContextUsage,
	DeltaKind,
	Entry,
	Maintenance,
	Message,
	ModelInfo,
	NoticeLevel,
	QueuedInput,
	SessionSnapshot,
	ThinkingLevel,
	ToolOutput,
	TurnPhase,
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
	/** 视图标识;历史与提升后的消息用条目 id 加前缀,实时消息用主机分配的标识 */
	id: string;
	/** 会话条目;实时消息在本轮 settled 之后由主机补上 */
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

/**
 * 会话状态。
 *
 * 订阅时由主机快照建立,之后由会话通道的动作就地更新;同一个字段只有这一个来源。
 */
export interface SessionState {
	/** 会话文件路径,内存会话为空 */
	readonly file: string | undefined;
	/** 会话的工作目录 */
	readonly cwd: string;
	readonly title: string | undefined;
	readonly model: ModelInfo | undefined;
	readonly thinkingLevel: ThinkingLevel;
	/** 当前模型可选的思考档位，换模型时随 session/modelChanged 一起更新 */
	readonly availableThinkingLevels: ThinkingLevel[];
	/** 本轮的生命周期 */
	readonly phase: TurnPhase;
	/** 与本轮并行的维护动作 */
	readonly maintenance: Maintenance | undefined;
	/** 上下文用量，刚压缩完或估算不出来时为空 */
	readonly contextUsage: ContextUsage | undefined;
	readonly queued: QueuedInput;
}

/** 会话通道的客户端状态。 */
export interface SessionView {
	readonly channel: Channel;
	readonly state: SessionState;
}

/** 对话通道的客户端状态:只有内容,回合进度在会话通道上。 */
export interface ChatView {
	readonly channel: Channel;
	readonly items: readonly EntryView[];
	readonly toolCalls: Readonly<Record<string, ToolCallView>>;
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
 */
export type ChatActivity = "idle" | "running" | "compacting" | "stopping";

/**
 * 由会话状态得出对话此刻的状态。
 *
 * 优先看中止请求,其次看维护动作,最后看本轮阶段。等重试期间也算 running:这一轮还没结束,
 * 发送会打断等待。
 */
export function chatActivity(session: SessionView | undefined): ChatActivity {
	const state = session?.state;
	if (state === undefined) {
		return "idle";
	}
	if (state.phase === "stopping") {
		return "stopping";
	}
	if (state.maintenance?.kind === "compaction") {
		return "compacting";
	}
	if (state.maintenance?.kind === "retry") {
		return "running";
	}
	return state.phase === "idle" ? "idle" : "running";
}

/** 由会话快照建出会话视图。快照缺省时使用空状态。 */
export function createSessionView(channel: Channel, snapshot?: SessionSnapshot): SessionView {
	return {
		channel,
		state: {
			file: snapshot?.file,
			cwd: snapshot?.cwd ?? "",
			title: snapshot?.name,
			model: snapshot?.model,
			thinkingLevel: snapshot?.thinkingLevel ?? "off",
			availableThinkingLevels: snapshot?.availableThinkingLevels ?? [],
			phase: snapshot?.phase ?? "idle",
			maintenance: snapshot?.maintenance,
			contextUsage: snapshot?.contextUsage,
			queued: snapshot?.queued ?? { steering: [], followUp: [] },
		},
	};
}

/** 建出空的对话视图。 */
export function createChatView(channel: Channel): ChatView {
	return {
		channel,
		items: [],
		toolCalls: {},
		notices: [],
		renames: {},
	};
}

/** 追加一条提示并保留最近若干条。 */
export function appendNotice(notices: readonly NoticeView[], notice: NoticeView): readonly NoticeView[] {
	const next = [...notices, notice];
	return next.length > MAX_NOTICES ? next.slice(next.length - MAX_NOTICES) : next;
}
