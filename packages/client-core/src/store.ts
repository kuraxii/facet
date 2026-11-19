/**
 * 通道状态的持有者。
 *
 * 只做三件事:按通道保存视图、按序号去重与察觉缺口、在视图变化后通知订阅者。
 * 序号缺口意味着主机侧的缓冲已经丢掉更早的动作,调用方需要重新拉取快照与历史。
 */
import type {
	Action,
	ActionFrame,
	Channel,
	Entry,
	Message,
	ProviderLoginState,
	SessionListItem,
	SessionSnapshot,
	SessionStatus,
} from "@facet/protocol";
import { makeChannel, parseChannel } from "@facet/protocol";
import { historyMessageId, isHistoryMessageId } from "./message-id.ts";
import { reduceChat, reduceSession } from "./reduce.ts";
import {
	appendNotice,
	type ChatView,
	createChatView,
	createSessionView,
	type EntryView,
	type NoticeView,
	type SessionView,
} from "./state.ts";

/** 清单里没有的会话按这份空闲态算，省得每处都写一遍字面量。 */
const IDLE_SESSION_STATUS: SessionStatus = {
	activity: "idle",
	settle: undefined,
	pendingInput: 0,
	seenAt: 0,
};

/** 两份状态是否一样。settle 是对象，得逐字段比，否则每次都判不等、每次都通知一遍。 */
function sameStatus(left: SessionStatus, right: SessionStatus): boolean {
	if (
		left.activity !== right.activity ||
		left.pendingInput !== right.pendingInput ||
		left.seenAt !== right.seenAt
	) {
		return false;
	}
	if (left.settle === undefined || right.settle === undefined) {
		return left.settle === right.settle;
	}
	return (
		left.settle.at === right.settle.at &&
		left.settle.outcome === right.settle.outcome &&
		left.settle.message === right.settle.message
	);
}

/** 通道上出现序号缺口。 */
export interface ChannelGap {
	channel: Channel;
	/** 按已应用的序号推断出的下一条序号 */
	expected: number;
	/** 实际收到的序号 */
	received: number;
}

interface SessionSlot {
	view: SessionView;
	lastSeq: number;
}

interface ChatSlot {
	view: ChatView;
	lastSeq: number;
}

/** 广播调度：把一次通知交给调用方安排，何时真正通知订阅者由它决定。 */
export type NotifyScheduler = (flush: () => void) => void;

/**
 * 缺省的广播调度。
 *
 * 有 requestAnimationFrame 时把通知排到下一帧：界面按帧重绘，同一帧内处理的多条动作
 * 合起来只触发一次重绘，通知频率以帧频率为上限而不是以动作频率为上限。没有它（Node、
 * 测试）时同步通知，行为与逐条通知一致。
 */
const scheduleOnFrame: NotifyScheduler = (() => {
	const frame = (globalThis as { requestAnimationFrame?: (callback: () => void) => unknown })
		.requestAnimationFrame;
	if (typeof frame !== "function") {
		return (flush) => flush();
	}
	// 浏览器里 requestAnimationFrame 依赖 this 为 window，取出后要显式绑回去
	return (flush) => {
		void frame.call(globalThis, flush);
	};
})();

export class SessionStore {
	private readonly sessions = new Map<Channel, SessionSlot>();
	private readonly chats = new Map<Channel, ChatSlot>();
	/** 会话清单，按会话文件路径索引；多个端拿到的是主机推的同一份 */
	private readonly sessionIndex = new Map<string, SessionListItem>();
	/** 进行中与刚结束的登录，按 loginId 索引 */
	private readonly providerLogins = new Map<string, ProviderLoginState>();
	/** 模型通道已应用到的序号，重连时据此续订 */
	private modelLogSeq = 0;
	/** 清单通道已应用的序号 */
	private sessionIndexSeq = 0;
	private readonly listeners = new Set<(version: number) => void>();
	private readonly gapListeners = new Set<(gap: ChannelGap) => void>();
	/** 通知订阅者的调度方式 */
	private readonly schedule: NotifyScheduler;
	/** 有视图变化尚未通知 */
	private isPending = false;
	/** 已排上一次通知，期间再来的变化并到那一次里 */
	private isScheduled = false;
	private version = 0;

	constructor(options: { schedule?: NotifyScheduler } = {}) {
		this.schedule = options.schedule ?? scheduleOnFrame;
	}

	/** 版本号,每次通知时递增,供界面判断是否需要重绘。 */
	getVersion(): number {
		return this.version;
	}

	/** 建出或重置会话通道视图。给出快照时整体替换。 */
	ensureSession(channel: Channel, snapshot?: SessionSnapshot): SessionView {
		const slot = this.sessions.get(channel);
		if (!slot) {
			const view = createSessionView(channel, snapshot);
			this.sessions.set(channel, { view, lastSeq: 0 });
			this.markChanged();
			return view;
		}
		if (snapshot !== undefined) {
			const view = createSessionView(channel, snapshot);
			this.sessions.set(channel, { view, lastSeq: slot.lastSeq });
			this.markChanged();
			return view;
		}
		return slot.view;
	}

	/** 建出对话通道视图。 */
	ensureChat(channel: Channel): ChatView {
		const slot = this.chats.get(channel);
		if (slot) {
			return slot.view;
		}
		const view = createChatView(channel);
		this.chats.set(channel, { view, lastSeq: 0 });
		this.markChanged();
		return view;
	}

	/**
	 * 清单里的全部会话，按修改时间从新到旧。
	 *
	 * 界面直接用它渲染侧栏，不再自己扫盘：主机推什么就是什么，多个端因此一致。
	 */
	sessionList(): readonly SessionListItem[] {
		return [...this.sessionIndex.values()].sort(
			(left, right) => right.summary.modified - left.summary.modified,
		);
	}

	/** 清单通道已应用到的序号，重连时据此续订。 */
	get sessionListSeq(): number {
		return this.sessionIndexSeq;
	}

	/** 记录清单通道订阅返回的序号。 */
	markSessionListSeq(seq: number): void {
		this.sessionIndexSeq = seq;
	}

	/** 用一份完整清单替换本地这份，重连或补齐缺口之后用。 */
	replaceSessionList(entries: readonly SessionListItem[]): void {
		this.sessionIndex.clear();
		for (const entry of entries) {
			this.sessionIndex.set(entry.summary.path, entry);
		}
		this.markChanged();
	}

	/**
	 * 某个提供方此刻的登录状态。
	 *
	 * 同一提供方同时只允许一条登录，所以按提供方取就够；取最后插进来的那一条，旧的那次已经
	 * 收尾的登录留着不影响这里。
	 */
	providerLogin(providerId: string): ProviderLoginState | undefined {
		let found: ProviderLoginState | undefined;
		for (const state of this.providerLogins.values()) {
			if (state.providerId === providerId) {
				found = state;
			}
		}
		return found;
	}

	/** 模型通道已应用到的序号，重连时据此续订。 */
	get providerLoginSeq(): number {
		return this.modelLogSeq;
	}

	/** 记录模型通道订阅返回的序号。 */
	markProviderLoginSeq(seq: number): void {
		this.modelLogSeq = seq;
	}

	/** 清单里某个会话此刻的状态，清单里没有时按空闲算。 */
	sessionStatus(path: string): SessionStatus {
		return this.sessionIndex.get(path)?.status ?? IDLE_SESSION_STATUS;
	}

	sessionView(channel: Channel): SessionView | undefined {
		return this.sessions.get(channel)?.view;
	}

	chatView(channel: Channel): ChatView | undefined {
		return this.chats.get(channel)?.view;
	}

	/** 记录订阅返回的序号,后续动作从它的下一条开始连续。 */
	markSeq(channel: Channel, seq: number): void {
		const kind = parseChannel(channel)?.kind;
		if (kind === "session") {
			this.ensureSession(channel);
			const slot = this.sessions.get(channel);
			if (slot) {
				slot.lastSeq = seq;
			}
			return;
		}
		if (kind === "chat") {
			this.ensureChat(channel);
			const slot = this.chats.get(channel);
			if (slot) {
				slot.lastSeq = seq;
			}
		}
	}

	/**
	 * 应用一条动作帧。
	 *
	 * 序号不大于已应用序号的帧直接丢弃,避免重连补发时同一条生效两次;序号跳跃时不拦,
	 * 照常应用并报出缺口,由调用方决定是否重新拉取。
	 *
	 * 归约之后只有视图换了引用才算变化。回执、轮次起止这类不改变视图的帧因此不会推进
	 * 版本号，界面也就不必为它们重绘；等待确认的发送有自己的通知（`onSent`），被拒的
	 * 发送会落到对话视图的一条提示上，两者都不依赖这里的版本号。
	 */
	apply(frame: ActionFrame): void {
		// 拒绝帧不占通道序号,也没有被应用过,不能进入归约
		if (frame.rejectionReason !== undefined) {
			return;
		}
		const parsed = parseChannel(frame.channel);
		if (!parsed) {
			return;
		}
		if (parsed.kind === "sessions") {
			if (frame.serverSeq <= this.sessionIndexSeq) {
				return;
			}
			this.applySessionList(frame.action);
			this.sessionIndexSeq = Math.max(this.sessionIndexSeq, frame.serverSeq);
			return;
		}
		if (parsed.kind === "models") {
			if (frame.serverSeq <= this.modelLogSeq) {
				return;
			}
			this.applyProviderLogin(frame.action);
			this.modelLogSeq = Math.max(this.modelLogSeq, frame.serverSeq);
			return;
		}
		if (parsed.kind === "session") {
			const slot = this.sessions.get(frame.channel) ?? this.createSessionSlot(frame.channel);
			if (this.isDuplicate(frame, slot.lastSeq)) {
				return;
			}
			this.reportGap(frame, slot.lastSeq);
			const session = reduceSession(slot.view, frame.action);
			slot.lastSeq = Math.max(slot.lastSeq, frame.serverSeq);
			if (session !== slot.view) {
				slot.view = session;
				this.markChanged();
			}
			return;
		}
		if (parsed.kind === "chat") {
			const slot = this.chats.get(frame.channel) ?? this.createChatSlot(frame.channel);
			if (this.isDuplicate(frame, slot.lastSeq)) {
				return;
			}
			this.reportGap(frame, slot.lastSeq);
			const chat = reduceChat(slot.view, frame.action);
			slot.lastSeq = Math.max(slot.lastSeq, frame.serverSeq);
			if (chat !== slot.view) {
				slot.view = chat;
				this.markChanged();
			}
		}
	}

	/**
	 * 归约一条登录进展。
	 *
	 * 增量只带最近一步，这里把它合进那次登录的状态：新登录从 running 起，终局之后不再改。
	 */
	private applyProviderLogin(action: Action): void {
		if (action.type !== "models/loginEvent") {
			return;
		}
		const { loginId, providerId, event } = action;
		const previous = this.providerLogins.get(loginId);
		if (previous === undefined) {
			// 新的一条：同一提供方上一次的登录到这里作废，留着只会在日志里越积越多
			for (const [key, state] of this.providerLogins) {
				if (state.providerId === providerId) {
					this.providerLogins.delete(key);
				}
			}
		}
		const base: ProviderLoginState = previous ?? { loginId, providerId, status: "running" };
		// 终局之后再来的动作只可能是迟到的进度，丢掉
		if (previous?.status !== undefined && previous.status !== "running") {
			return;
		}
		let next: ProviderLoginState;
		switch (event.type) {
			case "prompt":
				next = { ...base, prompt: event.prompt };
				break;
			case "promptResolved":
				next = base.prompt?.promptId === event.promptId ? { ...base, prompt: undefined } : base;
				break;
			case "authUrl":
				next = {
					...base,
					authUrl: {
						url: event.url,
						...(event.instructions === undefined ? {} : { instructions: event.instructions }),
					},
				};
				break;
			case "deviceCode":
				next = {
					...base,
					deviceCode: {
						userCode: event.userCode,
						verificationUri: event.verificationUri,
						...(event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds }),
						...(event.expiresInSeconds === undefined ? {} : { expiresInSeconds: event.expiresInSeconds }),
					},
				};
				break;
			case "info":
				next = {
					...base,
					message: event.message,
					...(event.links === undefined ? {} : { links: event.links }),
				};
				break;
			case "progress":
				next = { ...base, message: event.message };
				break;
			case "done":
				next = { ...base, status: "done", prompt: undefined };
				break;
			case "failed":
				next = { ...base, status: "failed", prompt: undefined, message: event.message };
				break;
			case "cancelled":
				next = { ...base, status: "cancelled", prompt: undefined };
				break;
		}
		this.providerLogins.set(loginId, next);
		this.markChanged();
	}

	/** 归约一条清单动作。认不出的动作原样跳过，清单仍然可用。 */
	private applySessionList(action: Action): void {
		if (action.type === "sessions/changed") {
			this.sessionIndex.set(action.summary.path, { summary: action.summary, status: action.status });
			this.markChanged();
			return;
		}
		if (action.type === "sessions/status") {
			// 清单里还没有这条摘要时先忽略：摘要到了会连同当时的状态一起带上
			const current = this.sessionIndex.get(action.path);
			if (current === undefined || sameStatus(current.status, action.status)) {
				return;
			}
			this.sessionIndex.set(action.path, { ...current, status: action.status });
			this.markChanged();
			return;
		}
		if (action.type === "sessions/removed") {
			if (this.sessionIndex.delete(action.path)) {
				this.markChanged();
			}
		}
	}

	/**
	 * 用历史条目替换对话内容。
	 *
	 * 条目按时间升序传入，全部类型都进视图；目前只有带 message 的条目参与渲染，其余留给
	 * 以后的事件展示。历史条目的标识用条目 id 加前缀，与主机实时分配的标识不相撞。
	 */
	replaceChat(channel: Channel, entries: readonly Entry[]): ChatView {
		const slot = this.chats.get(channel) ?? this.createChatSlot(channel);
		const items = entries.map(toEntryView);
		slot.view = { ...slot.view, items };
		this.markChanged();
		return slot.view;
	}

	/**
	 * 往对话视图追加一条提示。
	 *
	 * 主机拒绝一条动作时回的是带原因的动作帧,它不占通道序号,不能进归约,由调用方转成提示。
	 */
	addNotice(channel: Channel, notice: NoticeView): void {
		const slot = this.chats.get(channel);
		if (!slot) {
			return;
		}
		slot.view = { ...slot.view, notices: appendNotice(slot.view.notices, notice) };
		this.markChanged();
	}

	/** 往更早的方向补一页历史,已存在的标识跳过。 */
	prependHistory(channel: Channel, entries: readonly Entry[]): ChatView {
		const slot = this.chats.get(channel) ?? this.createChatSlot(channel);
		const known = new Set(slot.view.items.map((item) => item.id));
		const older: EntryView[] = [];
		for (const entry of entries) {
			const view = toEntryView(entry);
			if (known.has(view.id)) {
				continue;
			}
			older.push(view);
		}
		if (older.length === 0) {
			return slot.view;
		}
		slot.view = { ...slot.view, items: [...older, ...slot.view.items] };
		this.markChanged();
		return slot.view;
	}

	/**
	 * 把实时消息提升为历史消息。
	 *
	 * entries 是主机返回的、本轮新写入的条目，按从早到晚排列。实时消息都是带 message 的
	 * 条目，与其中的消息条目一一对应、顺序相同，因此按位置配对；非消息条目没有实时对应物，
	 * 只留在视图里供以后扩展展示。整段实时视图换成这一段条目，消息内容用写盘后的版本。
	 * 消息条目数与实时消息数对不上说明漏了事件，返回 false，调用方重新装载历史。
	 */
	promote(channel: Channel, entries: readonly Entry[], mode: "settled" | "checkpoint" = "settled"): boolean {
		const slot = this.chats.get(channel);
		if (!slot) {
			return false;
		}
		const live = slot.view.items.filter((item) => !isHistoryMessageId(item.id));
		const committed = entries.filter((entry) => entry.kind === "message" && entry.message !== undefined);
		if (committed.length > live.length || (mode === "settled" && live.length !== committed.length)) {
			return false;
		}
		if (mode === "checkpoint" && live.slice(0, committed.length).some((item) => item.isStreaming)) {
			return false;
		}
		const renames: Record<string, string> = { ...slot.view.renames };
		const promoted = entries.map(toEntryView);
		let liveIndex = 0;
		for (const view of promoted) {
			if (view.entry?.kind !== "message" || view.message === undefined) {
				continue;
			}
			const source = live[liveIndex];
			liveIndex += 1;
			if (source === undefined) {
				return false;
			}
			renames[source.id] = view.id;
		}
		slot.view = {
			...slot.view,
			items: [
				...slot.view.items.slice(0, slot.view.items.length - live.length),
				...promoted,
				...live.slice(committed.length),
			],
			renames,
		};
		this.markChanged();
		return true;
	}

	/** 通道已应用到的序号,从未收到动作时为 0。 */
	lastSeq(channel: Channel): number {
		return this.sessions.get(channel)?.lastSeq ?? this.chats.get(channel)?.lastSeq ?? 0;
	}

	/**
	 * 清空对话通道里的内容，保留序号。
	 *
	 * 分支指针移动之后，已装载的历史属于另一条分支；序号仍然连续，所以只清内容不重置序号，
	 * 免得后续动作被当成缺口。
	 */
	resetChat(channel: Channel): void {
		const slot = this.chats.get(channel);
		if (!slot) {
			return;
		}
		this.chats.set(channel, { view: createChatView(channel), lastSeq: slot.lastSeq });
		this.markChanged();
	}

	/** 丢掉一个通道的状态,用于取消订阅或会话释放。 */
	drop(channel: Channel): void {
		const removed = this.sessions.delete(channel) || this.chats.delete(channel);
		if (removed) {
			this.markChanged();
		}
	}

	/** 丢掉全部状态。 */
	clear(): void {
		const had = this.sessions.size > 0 || this.chats.size > 0;
		this.sessions.clear();
		this.chats.clear();
		if (had) {
			this.markChanged();
		}
	}

	/**
	 * 丢掉属于这台主机的全部状态。
	 *
	 * 与 `clear()` 的区别是会连清单、登录与两条通道的水位一起清：换主机或断开主机之后
	 * 这些都属于上一台，留着会让新主机的清单补不上（水位比它的序号还大），也会让旧主机
	 * 的登录进度接着显示。
	 */
	resetHost(): void {
		const had =
			this.sessions.size > 0 ||
			this.chats.size > 0 ||
			this.sessionIndex.size > 0 ||
			this.providerLogins.size > 0;
		this.sessions.clear();
		this.chats.clear();
		this.sessionIndex.clear();
		this.providerLogins.clear();
		this.sessionIndexSeq = 0;
		this.modelLogSeq = 0;
		if (had) {
			this.markChanged();
		}
	}

	subscribe(listener: (version: number) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	onGap(listener: (gap: ChannelGap) => void): () => void {
		this.gapListeners.add(listener);
		return () => {
			this.gapListeners.delete(listener);
		};
	}

	/** 会话通道与对话通道的成对标识,便于调用方一次订阅两条。 */
	static channelsFor(sessionId: string): { session: Channel; chat: Channel } {
		return { session: makeChannel("session", sessionId), chat: makeChannel("chat", sessionId) };
	}

	private createSessionSlot(channel: Channel): SessionSlot {
		const slot: SessionSlot = { view: createSessionView(channel), lastSeq: 0 };
		this.sessions.set(channel, slot);
		return slot;
	}

	private createChatSlot(channel: Channel): ChatSlot {
		const slot: ChatSlot = { view: createChatView(channel), lastSeq: 0 };
		this.chats.set(channel, slot);
		return slot;
	}

	private isDuplicate(frame: ActionFrame, lastSeq: number): boolean {
		return lastSeq > 0 && frame.serverSeq <= lastSeq;
	}

	private reportGap(frame: ActionFrame, lastSeq: number): void {
		if (lastSeq === 0 || frame.serverSeq <= lastSeq + 1) {
			return;
		}
		const gap: ChannelGap = { channel: frame.channel, expected: lastSeq + 1, received: frame.serverSeq };
		for (const listener of [...this.gapListeners]) {
			listener(gap);
		}
	}

	/** 登记一次视图变化，交给调度决定这次（或与同帧其它变化合并后）何时通知。 */
	private markChanged(): void {
		this.isPending = true;
		if (this.isScheduled) {
			return;
		}
		this.isScheduled = true;
		this.schedule(() => {
			this.isScheduled = false;
			this.flush();
		});
	}

	/**
	 * 立刻通知尚未广播的变化。
	 *
	 * 版本号在这里才递增，同一次调度内到达的多条动作因此只算一次变化。视图本身早就在
	 * 归约时就地改好了，读视图的调用方不必等通知。重复调用没有副作用。
	 */
	flush(): void {
		if (!this.isPending) {
			return;
		}
		this.isPending = false;
		this.version += 1;
		for (const listener of [...this.listeners]) {
			listener(this.version);
		}
	}
}

/** 把一条历史条目转成视图。非消息条目保留在视图里，目前不参与渲染。 */
function toEntryView(entry: Entry): EntryView {
	return {
		id: historyMessageId(entry.id),
		entry,
		message: entry.message,
		streaming: {},
		isStreaming: false,
	};
}

/** 取消息的纯文本,供列表预览与复制使用。 */
export function messageText(message: Message): string {
	switch (message.role) {
		case "user":
		case "assistant":
		case "toolResult":
			return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
		case "system":
		case "custom":
			return message.content;
		case "compactionSummary":
		case "branchSummary":
			return message.summary;
		case "bashExecution":
			return message.output;
		default:
			return "";
	}
}

/** 消息当前的展示文本:流式期间用累积的增量,否则用完整内容。 */
export function messageDisplayText(view: EntryView): string {
	if (view.message === undefined) {
		return "";
	}
	const streamed = Object.keys(view.streaming)
		.map(Number)
		.sort((left, right) => left - right)
		.map((index) => view.streaming[index]?.text ?? "")
		.join("");
	return streamed.length > 0 ? streamed : messageText(view.message);
}
