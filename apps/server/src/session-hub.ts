/**
 * 会话登记、通道与动作扇出。
 *
 * 一个会话对应一个 PiAgent、一条会话通道与一条对话通道。通道各自定序、各自订阅,
 * 因此只渲染侧栏的端可以只订阅会话通道。多个端可以同时订阅同一通道,
 * 会话释放时统一回收 agent、审批中转与订阅。
 */
import { resolve } from "node:path";
import type { PiAgent } from "@facet/agent";
import type { Action, ActionFrame, Channel, SessionSnapshot } from "@facet/protocol";
import { makeChannel, parseChannel } from "@facet/protocol";
import { ActionProjector } from "./action-projector.ts";
import type { ApprovalBroker } from "./approval-broker.ts";
import { EventLog } from "./event-log.ts";

/** 会话登记表用到的 agent 能力,收窄成结构类型以便测试注入假实现。 */
export type HubAgent = Pick<
	PiAgent,
	"id" | "file" | "isStreaming" | "isCompacting" | "subscribe" | "entries" | "snapshot" | "dispose"
>;

/** 动作接收方,通常是某个连接上的转发函数。 */
export type ActionSink = (frame: ActionFrame) => void;

/** 订阅结果。resync 为真时端点需要重新读取快照与历史。 */
export interface Subscription {
	/** 订阅完成时的通道序号 */
	seq: number;
	/** 缺口标记,为真表示部分历史动作已不在缓冲内 */
	resync: boolean;
	/** 订阅会话通道时返回会话快照 */
	session?: SessionSnapshot;
}

/** 会话不存在或已释放。端点收到后应停止对该会话的操作。 */
export class SessionNotFoundError extends Error {
	readonly sessionId: string;

	constructor(sessionId: string) {
		super(`unknown session: ${sessionId}`);
		this.sessionId = sessionId;
	}
}

/** 通道 URI 无法解析或该通道尚未实现。 */
export class ChannelNotFoundError extends Error {
	readonly channel: string;

	constructor(channel: string) {
		super(`unsupported channel: ${channel}`);
		this.channel = channel;
	}
}

interface ChannelState {
	log: EventLog;
	sinks: Set<ActionSink>;
}

interface SessionState<A extends HubAgent> {
	readonly agent: A;
	readonly approvals: ApprovalBroker;
	readonly projector: ActionProjector;
	readonly channels: Map<Channel, ChannelState>;
	unsubscribe: () => void;
}

export interface SessionHubOptions {
	/** 每个通道保留的动作条数 */
	replayLimit: number;
	/** entries 未指定条数时的默认页大小 */
	defaultPageSize: number;
	/** entries 允许的最大页大小 */
	maxPageSize: number;
}

/** 会话文件路径归一化,同一文件的不同写法落到同一个键。 */
function normalizeFile(file: string): string {
	return resolve(file);
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

export class SessionHub<A extends HubAgent = PiAgent> {
	private readonly options: SessionHubOptions;
	private readonly sessions = new Map<string, SessionState<A>>();
	/** 会话文件到会话 id 的索引,保证一个文件只有一份运行态 */
	private readonly fileIndex = new Map<string, string>();
	/** 正在建立中的会话,并发打开同一文件时共用一次建立 */
	private readonly opening = new Map<string, Promise<string>>();

	constructor(options: Partial<SessionHubOptions> = {}) {
		this.options = {
			replayLimit: options.replayLimit ?? 512,
			defaultPageSize: options.defaultPageSize ?? DEFAULT_PAGE_SIZE,
			maxPageSize: options.maxPageSize ?? MAX_PAGE_SIZE,
		};
	}

	/** 登记一个已建好的会话并开始记录动作。 */
	attach(agent: A, approvals: ApprovalBroker): void {
		const sessionId = agent.id;
		const existing = this.sessions.get(sessionId);
		if (existing) {
			if (existing.agent === agent) {
				return;
			}
			// 同一会话已经有另一份状态,说明登记表被绕过。保留先登记的订阅者,丢弃新来的。
			agent.dispose();
			return;
		}
		const state: SessionState<A> = {
			agent,
			approvals,
			projector: new ActionProjector(sessionId),
			channels: new Map(),
			unsubscribe: () => {},
		};
		this.ensureChannel(state, makeChannel("session", sessionId));
		this.ensureChannel(state, makeChannel("chat", sessionId));

		state.unsubscribe = agent.subscribe((event) => {
			for (const projected of state.projector.project(event)) {
				this.publish(state, projected.channel, projected.action);
			}
		});
		this.sessions.set(sessionId, state);
		if (agent.file !== undefined) {
			this.fileIndex.set(normalizeFile(agent.file), sessionId);
		}
	}

	/** 会话文件对应的会话 id。 */
	sessionIdByFile(file: string): string | undefined {
		return this.fileIndex.get(normalizeFile(file));
	}

	/**
	 * 按会话文件取会话,已登记时直接复用。
	 *
	 * 一个会话文件在设备上只能有一份运行态:两份会写同一个文件、各自维护条目树,
	 * 而登记表按会话 id 索引,后来者会覆盖先到的订阅者。
	 * 并发打开同一文件时共用同一次建立。
	 */
	async openSession(
		file: string,
		create: () => Promise<{ agent: A; approvals: ApprovalBroker }>,
	): Promise<SessionSnapshot> {
		const key = normalizeFile(file);
		const known = this.fileIndex.get(key);
		if (known !== undefined && this.sessions.has(known)) {
			return this.snapshot(known);
		}
		const pending = this.opening.get(key);
		if (pending !== undefined) {
			return this.snapshot(await pending);
		}
		const opening = create()
			.then(({ agent, approvals }) => {
				this.attach(agent, approvals);
				return agent.id;
			})
			.finally(() => {
				this.opening.delete(key);
			});
		this.opening.set(key, opening);
		return this.snapshot(await opening);
	}

	has(sessionId: string): boolean {
		return this.sessions.has(sessionId);
	}

	sessionIds(): string[] {
		return [...this.sessions.keys()];
	}

	/** 取会话的 agent,供端点执行发消息、中止与读取条目。 */
	agent(sessionId: string): A {
		return this.requireSession(sessionId).agent;
	}

	/** 取会话的对外状态。 */
	snapshot(sessionId: string): SessionSnapshot {
		return this.requireSession(sessionId).agent.snapshot();
	}

	/** 通道当前序号,通道不存在时为 0。 */
	lastSeq(channel: Channel): number {
		const parsed = parseChannel(channel);
		if (!parsed) {
			return 0;
		}
		return this.sessions.get(parsed.id)?.channels.get(channel)?.log.lastSeq ?? 0;
	}

	/**
	 * 分页读取历史,从 cursor 指向的条目往更早取。
	 *
	 * 点对点返回,不广播,也不改变设备侧保留的状态。
	 */
	entries(
		sessionId: string,
		cursor: string | undefined,
		limit: number | undefined,
	): { entries: ReturnType<PiAgent["entries"]>["entries"]; nextCursor: string | undefined } {
		const all = this.requireSession(sessionId).agent.entries().entries;
		const size = Math.min(Math.max(limit ?? this.options.defaultPageSize, 1), this.options.maxPageSize);
		let end = all.length;
		if (cursor !== undefined) {
			const index = all.findIndex((entry) => entry.id === cursor);
			if (index < 0) {
				throw new SessionNotFoundError(sessionId);
			}
			end = index;
		}
		const start = Math.max(0, end - size);
		const window = all.slice(start, end);
		const first = window[0];
		return { entries: window, nextCursor: start > 0 && first ? first.id : undefined };
	}

	/**
	 * 订阅通道。
	 *
	 * since 缺省时只订阅后续动作,历史由端点自己读快照与条目;给出 since 时先补发
	 * 缓冲内的动作,缺口用 resync 标记。补发在返回前同步完成,不会与实时动作交错。
	 */
	subscribe(channel: Channel, since: number | undefined, sink: ActionSink): Subscription {
		const parsed = this.requireChannel(channel);
		const state = this.requireSession(parsed.id);
		const target = this.ensureChannel(state, channel);
		const { actions, resync } = target.log.replay(since ?? target.log.lastSeq);
		target.sinks.add(sink);
		for (const item of actions) {
			sink(this.toFrame(channel, item.action, item.seq));
		}
		return {
			seq: target.log.lastSeq,
			resync,
			session: parsed.kind === "session" ? state.agent.snapshot() : undefined,
		};
	}

	/** 取消订阅。sink 不存在时无副作用。 */
	unsubscribe(channel: Channel, sink: ActionSink): void {
		const parsed = parseChannel(channel);
		if (!parsed) {
			return;
		}
		this.sessions.get(parsed.id)?.channels.get(channel)?.sinks.delete(sink);
	}

	/** 回填一条工具确认的决定。请求不存在时返回假。 */
	respondApproval(
		sessionId: string,
		requestId: string,
		decision: Parameters<ApprovalBroker["respond"]>[1],
	): boolean {
		return this.requireSession(sessionId).approvals.respond(requestId, decision);
	}

	/** 释放会话:停止记录、拒绝未应答的审批、销毁 agent。 */
	release(sessionId: string): void {
		const state = this.sessions.get(sessionId);
		if (!state) {
			return;
		}
		this.sessions.delete(sessionId);
		if (state.agent.file !== undefined) {
			this.fileIndex.delete(normalizeFile(state.agent.file));
		}
		state.unsubscribe();
		for (const channel of state.channels.values()) {
			channel.sinks.clear();
		}
		state.approvals.release("会话已释放");
		state.agent.dispose();
	}

	/** 释放全部会话,可重复调用。 */
	dispose(): void {
		for (const sessionId of [...this.sessions.keys()]) {
			this.release(sessionId);
		}
	}

	private publish(state: SessionState<A>, channel: Channel, action: Action): void {
		const target = this.ensureChannel(state, channel);
		const sequenced = target.log.append(action);
		const frame = this.toFrame(channel, sequenced.action, sequenced.seq);
		for (const sink of [...target.sinks]) {
			sink(frame);
		}
	}

	private ensureChannel(state: SessionState<A>, channel: Channel): ChannelState {
		const existing = state.channels.get(channel);
		if (existing) {
			return existing;
		}
		const created: ChannelState = { log: new EventLog(this.options.replayLimit), sinks: new Set() };
		state.channels.set(channel, created);
		return created;
	}

	private requireChannel(channel: Channel): { kind: string; id: string } {
		const parsed = parseChannel(channel);
		if (!parsed) {
			throw new ChannelNotFoundError(channel);
		}
		if (parsed.kind !== "session" && parsed.kind !== "chat") {
			throw new ChannelNotFoundError(channel);
		}
		return parsed;
	}

	private requireSession(sessionId: string): SessionState<A> {
		const state = this.sessions.get(sessionId);
		if (!state) {
			throw new SessionNotFoundError(sessionId);
		}
		return state;
	}

	private toFrame(channel: Channel, action: Action, seq: number): ActionFrame {
		return { type: "action", channel, action, serverSeq: seq, origin: undefined };
	}
}
