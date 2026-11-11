/**
 * 通道状态的持有者。
 *
 * 只做三件事:按通道保存视图、按序号去重与察觉缺口、在视图变化后通知订阅者。
 * 序号缺口意味着设备侧的缓冲已经丢掉更早的动作,调用方需要重新拉取快照与历史。
 */
import type { ActionFrame, Channel, Entry, Message, SessionSnapshot } from "@facet/protocol";
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

export class SessionStore {
	private readonly sessions = new Map<Channel, SessionSlot>();
	private readonly chats = new Map<Channel, ChatSlot>();
	private readonly listeners = new Set<(version: number) => void>();
	private readonly gapListeners = new Set<(gap: ChannelGap) => void>();
	private version = 0;

	/** 版本号,每次视图变化递增,供界面判断是否需要重绘。 */
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
		if (parsed.kind === "session") {
			const slot = this.sessions.get(frame.channel) ?? this.createSessionSlot(frame.channel);
			if (this.isDuplicate(frame, slot.lastSeq)) {
				return;
			}
			this.reportGap(frame, slot.lastSeq);
			slot.view = reduceSession(slot.view, frame.action);
			slot.lastSeq = Math.max(slot.lastSeq, frame.serverSeq);
			this.markChanged();
			return;
		}
		if (parsed.kind === "chat") {
			const slot = this.chats.get(frame.channel) ?? this.createChatSlot(frame.channel);
			if (this.isDuplicate(frame, slot.lastSeq)) {
				return;
			}
			this.reportGap(frame, slot.lastSeq);
			slot.view = reduceChat(slot.view, frame.action);
			slot.lastSeq = Math.max(slot.lastSeq, frame.serverSeq);
			this.markChanged();
		}
	}

	/**
	 * 用历史条目替换对话内容。
	 *
	 * 条目按时间升序传入，全部类型都进视图；目前只有带 message 的条目参与渲染，其余留给
	 * 以后的事件展示。历史条目的标识用条目 id 加前缀，与设备实时分配的标识不相撞。
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
	 * 设备拒绝一条动作时回的是带原因的动作帧,它不占通道序号,不能进归约,由调用方转成提示。
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
	 * entries 是设备返回的、本轮新写入的条目，按从早到晚排列。实时消息都是带 message 的
	 * 条目，与其中的消息条目一一对应、顺序相同，因此按位置配对；非消息条目没有实时对应物，
	 * 只留在视图里供以后扩展展示。整段实时视图换成这一段条目，消息内容用写盘后的版本。
	 * 消息条目数与实时消息数对不上说明漏了事件，返回 false，调用方重新装载历史。
	 */
	promote(channel: Channel, entries: readonly Entry[]): boolean {
		const slot = this.chats.get(channel);
		if (!slot) {
			return false;
		}
		const live = slot.view.items.filter((item) => !isHistoryMessageId(item.id));
		const committed = entries.filter((entry) => entry.kind === "message" && entry.message !== undefined);
		if (live.length !== committed.length) {
			return false;
		}
		const renames: Record<string, string> = { ...slot.view.renames };
		const promoted = entries.map(toEntryView);
		let liveIndex = 0;
		for (const view of promoted) {
			if (view.message === undefined) {
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
			items: [...slot.view.items.slice(0, slot.view.items.length - live.length), ...promoted],
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

	private markChanged(): void {
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
