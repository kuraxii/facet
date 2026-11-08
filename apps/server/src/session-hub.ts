/**
 * 会话登记、通道与动作扇出。
 *
 * 一个会话对应一行登记、一个 PiAgent、一条会话通道与一条对话通道,这里是进程内唯一的
 * 会话登记处:建、开、复用、释放都由它决定。通道各自定序、各自订阅,因此只渲染侧栏的端
 * 可以只订阅会话通道;多个端可以同时订阅同一通道。
 *
 * 一行的寿命由持有者与运行状态共同决定:没人订阅且不在运行时进入待关闭,倒计时结束才回收;
 * 还在推进就等它停下。运行状态本身只由 PiAgent 维护,这里不复制。
 */
import { resolve } from "node:path";
import type { ForkPiAgentOptions, OpenPiAgentOptions, PiAgent, PiAgentLaunchOptions } from "@facet/agent";
import type { Action, ActionFrame, Channel, SessionSnapshot } from "@facet/protocol";
import { makeChannel, parseChannel } from "@facet/protocol";
import { ActionProjector } from "./action-projector.ts";
import { ApprovalBroker } from "./approval-broker.ts";
import { EventLog } from "./event-log.ts";

/** 会话登记表用到的 agent 能力,收窄成结构类型以便测试注入假实现。 */
export type HubAgent = Pick<
	PiAgent,
	"id" | "file" | "isBusy" | "subscribe" | "entries" | "snapshot" | "dispose"
>;

/** 建会话用的工厂,收窄成登记表需要的三个入口,便于测试注入假实现。 */
export interface AgentFactory<A extends HubAgent> {
	create(options?: PiAgentLaunchOptions): Promise<A>;
	open(options: OpenPiAgentOptions): Promise<A>;
	fork(options: ForkPiAgentOptions): Promise<A>;
	/** 只读会话文件头部,取出会话 id */
	peekSessionId(file: string): Promise<string>;
}

/** 动作接收方。id 标识持有者,同一个连接的订阅共用一个 id。 */
export interface ActionSink {
	readonly id: string;
	send(frame: ActionFrame): void;
}

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

/** 分叉时给定的消息找不到对应的会话条目。 */
export class SessionEntryNotFoundError extends Error {
	readonly messageId: string;

	constructor(messageId: string) {
		super(`找不到消息对应的会话条目:${messageId}`);
		this.messageId = messageId;
	}
}

/** 会话正在运行,此时不允许分叉。 */
export class SessionBusyError extends Error {
	readonly sessionId: string;

	constructor(sessionId: string) {
		super(`会话正在运行,不能分叉:${sessionId}`);
		this.sessionId = sessionId;
	}
}

/** 同一会话 id 出现在两个文件上,通常是复制了会话文件。 */
export class SessionConflictError extends Error {
	readonly requested: string;
	readonly opened: string;

	constructor(requested: string, opened: string) {
		super(`会话文件与已打开的会话 id 相同但路径不同:${requested}`);
		this.requested = requested;
		this.opened = opened;
	}
}

interface ChannelState {
	log: EventLog;
	sinks: Set<ActionSink>;
}

/** 会话的寿命阶段。opening 表示正在建立,此时还没有 agent。 */
type SessionPhase = "opening" | "open" | "draining";

interface SessionState<A extends HubAgent> {
	/** 主键,来自会话文件头部 */
	readonly sessionId: string;
	/** 归一化后的会话文件,内存会话为空 */
	readonly file: string | undefined;
	agent: A | undefined;
	unsubscribe: (() => void) | undefined;
	/** 正在看这个会话的端 */
	readonly holders: Set<string>;
	phase: SessionPhase;
	/** 建立中的单飞句柄,建立结束即清空 */
	opening: Promise<void> | undefined;
	/** 待关闭的倒计时 */
	closeTimer: ReturnType<typeof setTimeout> | undefined;
	readonly channels: Map<Channel, ChannelState>;
	readonly approvals: ApprovalBroker;
	readonly projector: ActionProjector;
}

export interface SessionHubOptions<A extends HubAgent> {
	/** 建会话用的工厂 */
	readonly factory: AgentFactory<A>;
	/** 每个通道保留的动作条数 */
	readonly replayLimit?: number;
	/** entries 未指定条数时的默认页大小 */
	readonly defaultPageSize?: number;
	/** entries 允许的最大页大小 */
	readonly maxPageSize?: number;
	/** 没人订阅且不在运行后,等多久回收,毫秒 */
	readonly idleCloseMs?: number;
}

/** 会话文件路径归一化,同一文件的不同写法落到同一个键。 */
function normalizeFile(file: string): string {
	return resolve(file);
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;
const DEFAULT_IDLE_CLOSE_MS = 3000;

export class SessionHub<A extends HubAgent = PiAgent> {
	private readonly factory: AgentFactory<A>;
	private readonly replayLimit: number;
	private readonly pageSize: { default: number; max: number };
	private readonly idleCloseMs: number;
	private readonly table = new Map<string, SessionState<A>>();

	constructor(options: SessionHubOptions<A>) {
		this.factory = options.factory;
		this.replayLimit = options.replayLimit ?? 512;
		this.pageSize = {
			default: options.defaultPageSize ?? DEFAULT_PAGE_SIZE,
			max: options.maxPageSize ?? MAX_PAGE_SIZE,
		};
		this.idleCloseMs = options.idleCloseMs ?? DEFAULT_IDLE_CLOSE_MS;
	}

	/** 建一个新会话并登记。会话文件立即建立,之后每条完成的消息追加写盘。 */
	async createSession(options: PiAgentLaunchOptions = {}): Promise<SessionSnapshot> {
		const approvals = new ApprovalBroker();
		const agent = await this.factory.create({ ...options, approvalHandler: approvals.handler });
		this.attach(agent, approvals);
		return this.snapshotRow(this.requireRow(agent.id));
	}

	/**
	 * 按会话文件取会话,已登记时复用。
	 *
	 * 一个会话文件在设备上只能有一份运行态:两份会写同一个文件、各自维护条目树,
	 * 而登记表按会话 id 索引,后来者会覆盖先到的订阅者。并发打开同一文件共用一次建立。
	 */
	async openSession(file: string, cwd?: string): Promise<SessionSnapshot> {
		const key = normalizeFile(file);
		const sessionId = await this.factory.peekSessionId(key);
		const existing = this.table.get(sessionId);
		if (existing) {
			if (existing.file !== undefined && existing.file !== key) {
				throw new SessionConflictError(key, existing.file);
			}
			if (existing.opening !== undefined) {
				await existing.opening;
			}
			return this.snapshotRow(this.requireRow(sessionId));
		}

		const row: SessionState<A> = {
			sessionId,
			file: key,
			agent: undefined,
			unsubscribe: undefined,
			holders: new Set(),
			phase: "opening",
			opening: undefined,
			closeTimer: undefined,
			channels: new Map(),
			approvals: new ApprovalBroker(),
			projector: new ActionProjector(sessionId),
		};
		row.opening = this.buildOpen(row, cwd);
		this.table.set(sessionId, row);
		try {
			await row.opening;
		} catch (error) {
			this.table.delete(sessionId);
			throw error;
		} finally {
			row.opening = undefined;
		}
		return this.snapshotRow(row);
	}

	/**
	 * 从会话的某条消息分叉出新会话并登记。原会话不受影响。
	 *
	 * 运行中的会话不允许分叉:这一轮还没写盘,分叉点可能找不到对应的条目。
	 * 历史消息用 entryId 定位;本次连接产生的消息用 messageId,按角色与时间戳在条目里回查。
	 */
	async forkSession(options: {
		sessionFile: string;
		entryId?: string;
		messageId?: string;
		cwd?: string;
	}): Promise<SessionSnapshot> {
		const opened = this.sessionIdByFile(options.sessionFile);
		const source = opened === undefined ? undefined : this.table.get(opened);
		if (source?.agent?.isBusy === true) {
			throw new SessionBusyError(source.sessionId);
		}
		const entryId = options.entryId ?? this.resolveEntryId(source, options.messageId);
		if (entryId === undefined) {
			throw new SessionEntryNotFoundError(options.messageId ?? "");
		}
		const approvals = new ApprovalBroker();
		const agent = await this.factory.fork({
			sessionFile: options.sessionFile,
			entryId,
			...(options.cwd === undefined ? {} : { cwd: options.cwd }),
			approvalHandler: approvals.handler,
		});
		this.attach(agent, approvals);
		return this.snapshotRow(this.requireRow(agent.id));
	}

	/**
	 * 把实时消息换算成会话条目 id。
	 *
	 * 消息写盘晚于事件,所以要按角色与时间戳在条目里从尾部往前找,时间戳是消息自带的,不靠猜。
	 */
	private resolveEntryId(
		source: SessionState<A> | undefined,
		messageId: string | undefined,
	): string | undefined {
		if (!source?.agent || messageId === undefined) {
			return undefined;
		}
		const stamp = source.projector.messageStamp(messageId);
		if (!stamp) {
			return undefined;
		}
		const entries = source.agent.entries().entries;
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			const entry = entries[index];
			if (entry?.kind !== "message" || entry.message === undefined) {
				continue;
			}
			if (entry.message.role !== stamp.role || entry.message.timestamp !== stamp.timestamp) {
				continue;
			}
			return entry.id;
		}
		return undefined;
	}

	/** 登记一个已建好的会话。同一会话已有另一份状态时保留先登记的,丢弃新的。 */
	attach(agent: A, approvals: ApprovalBroker): void {
		const sessionId = agent.id;
		const existing = this.table.get(sessionId);
		if (existing) {
			if (existing.agent !== agent) {
				agent.dispose();
			}
			return;
		}
		const row: SessionState<A> = {
			sessionId,
			file: agent.file === undefined ? undefined : normalizeFile(agent.file),
			agent,
			unsubscribe: undefined,
			holders: new Set(),
			phase: "open",
			opening: undefined,
			closeTimer: undefined,
			channels: new Map(),
			approvals,
			projector: new ActionProjector(sessionId),
		};
		this.ensureChannel(row, makeChannel("session", sessionId));
		this.ensureChannel(row, makeChannel("chat", sessionId));
		row.unsubscribe = agent.subscribe((event) => this.onAgentEvent(row, event));
		this.table.set(sessionId, row);
		this.settle(row);
	}

	has(sessionId: string): boolean {
		return this.table.has(sessionId);
	}

	sessionIds(): string[] {
		return [...this.table.keys()];
	}

	/** 会话文件对应的会话 id,未登记时为空。 */
	sessionIdByFile(file: string): string | undefined {
		const key = normalizeFile(file);
		for (const row of this.table.values()) {
			if (row.file === key) {
				return row.sessionId;
			}
		}
		return undefined;
	}

	/** 取会话的 agent,供端点执行发消息、中止与读取条目。 */
	agent(sessionId: string): A {
		const agent = this.requireRow(sessionId).agent;
		if (!agent) {
			throw new SessionNotFoundError(sessionId);
		}
		return agent;
	}

	/** 取会话的对外状态。会话正在建立时等它建好。 */
	async snapshot(sessionId: string): Promise<SessionSnapshot> {
		const row = await this.requireReady(sessionId);
		this.touch(row);
		return this.snapshotRow(row);
	}

	/** 通道当前序号,通道不存在时为 0。 */
	lastSeq(channel: Channel): number {
		const parsed = parseChannel(channel);
		if (!parsed) {
			return 0;
		}
		return this.table.get(parsed.id)?.channels.get(channel)?.log.lastSeq ?? 0;
	}

	/**
	 * 分页读取历史,从 cursor 指向的条目往更早取。
	 *
	 * 点对点返回,不广播,也不改变设备侧保留的状态。读的时候顺带续期:只翻历史不订阅的端
	 * 不该在翻页途中被回收。
	 */
	async entries(
		sessionId: string,
		cursor: string | undefined,
		limit: number | undefined,
	): Promise<{ entries: ReturnType<A["entries"]>["entries"]; nextCursor: string | undefined }> {
		const row = await this.requireReady(sessionId);
		this.touch(row);
		const all = row.agent?.entries().entries ?? [];
		const size = Math.min(Math.max(limit ?? this.pageSize.default, 1), this.pageSize.max);
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
	async subscribe(channel: Channel, since: number | undefined, sink: ActionSink): Promise<Subscription> {
		const parsed = this.requireChannel(channel);
		const row = await this.requireReady(parsed.id);
		const target = this.ensureChannel(row, channel);
		const { actions, resync } = target.log.replay(since ?? target.log.lastSeq);
		target.sinks.add(sink);
		row.holders.add(sink.id);
		this.settle(row);
		for (const item of actions) {
			sink.send(this.toFrame(channel, item.action, item.seq));
		}
		return {
			seq: target.log.lastSeq,
			resync,
			session: parsed.kind === "session" ? row.agent?.snapshot() : undefined,
		};
	}

	/** 取消订阅。sink 不存在时无副作用。 */
	unsubscribe(channel: Channel, sink: ActionSink): void {
		const parsed = parseChannel(channel);
		if (!parsed) {
			return;
		}
		const row = this.table.get(parsed.id);
		const target = row?.channels.get(channel);
		if (!row || !target) {
			return;
		}
		target.sinks.delete(sink);
		if (!this.isWatching(row, sink.id)) {
			row.holders.delete(sink.id);
		}
		this.settle(row);
	}

	/** 回填一条工具确认的决定。请求不存在时返回假。 */
	async respondApproval(
		sessionId: string,
		requestId: string,
		decision: Parameters<ApprovalBroker["respond"]>[1],
	): Promise<boolean> {
		const row = await this.requireReady(sessionId);
		return row.approvals.respond(requestId, decision);
	}

	/** 释放会话:停止记录、拒绝未应答的审批、销毁 agent。 */
	release(sessionId: string): void {
		const row = this.table.get(sessionId);
		if (!row) {
			return;
		}
		this.table.delete(sessionId);
		this.clearCloseTimer(row);
		row.unsubscribe?.();
		row.holders.clear();
		for (const channel of row.channels.values()) {
			channel.sinks.clear();
		}
		row.approvals.release("会话已释放");
		row.agent?.dispose();
	}

	/** 释放全部会话,可重复调用。 */
	dispose(): void {
		for (const sessionId of [...this.table.keys()]) {
			this.release(sessionId);
		}
	}

	/** 建立会话并填进行里。字段先就位再让 promise 兑现,等待者醒来即可用。 */
	private async buildOpen(row: SessionState<A>, cwd: string | undefined): Promise<void> {
		const agent = await this.factory.open({
			sessionFile: row.file as string,
			...(cwd === undefined ? {} : { cwd }),
			approvalHandler: row.approvals.handler,
		});
		row.agent = agent;
		row.phase = "open";
		row.unsubscribe = agent.subscribe((event) => this.onAgentEvent(row, event));
		this.settle(row);
	}

	/** 把 pi 事件转成动作推给订阅者,并按事件重新判断寿命。 */
	private onAgentEvent(row: SessionState<A>, event: Parameters<Parameters<A["subscribe"]>[0]>[0]): void {
		for (const projected of row.projector.project(event)) {
			this.publish(row, projected.channel, projected.action);
		}
		this.settle(row);
	}

	/**
	 * 按持有者与运行状态重判寿命。
	 *
	 * 运行状态读 agent,这里不保留副本。建立期间不做判断。
	 */
	private settle(row: SessionState<A>): void {
		if (row.phase === "opening") {
			return;
		}
		const isBusy = row.agent?.isBusy ?? true;
		if (row.holders.size === 0 && !isBusy) {
			if (row.phase !== "draining") {
				row.phase = "draining";
				this.scheduleClose(row);
			}
			return;
		}
		if (row.phase === "draining") {
			row.phase = "open";
			this.clearCloseTimer(row);
		}
	}

	/** 读一次会话内容即续期,避免只翻历史不订阅的端在途中被回收。 */
	private touch(row: SessionState<A>): void {
		if (row.phase === "draining") {
			this.clearCloseTimer(row);
			this.scheduleClose(row);
		}
	}

	private scheduleClose(row: SessionState<A>): void {
		if (row.closeTimer !== undefined) {
			return;
		}
		row.closeTimer = setTimeout(() => {
			row.closeTimer = undefined;
			if (row.holders.size === 0 && row.agent?.isBusy !== true) {
				this.release(row.sessionId);
				return;
			}
			this.settle(row);
		}, this.idleCloseMs);
		row.closeTimer.unref?.();
	}

	private clearCloseTimer(row: SessionState<A>): void {
		if (row.closeTimer === undefined) {
			return;
		}
		clearTimeout(row.closeTimer);
		row.closeTimer = undefined;
	}

	/** 该持有者是否还订着这一行的其它通道。 */
	private isWatching(row: SessionState<A>, holderId: string): boolean {
		for (const channel of row.channels.values()) {
			for (const sink of channel.sinks) {
				if (sink.id === holderId) {
					return true;
				}
			}
		}
		return false;
	}

	private publish(row: SessionState<A>, channel: Channel, action: Action): void {
		const target = this.ensureChannel(row, channel);
		const sequenced = target.log.append(action);
		const frame = this.toFrame(channel, sequenced.action, sequenced.seq);
		for (const sink of [...target.sinks]) {
			sink.send(frame);
		}
	}

	private ensureChannel(row: SessionState<A>, channel: Channel): ChannelState {
		const existing = row.channels.get(channel);
		if (existing) {
			return existing;
		}
		const created: ChannelState = { log: new EventLog(this.replayLimit), sinks: new Set() };
		row.channels.set(channel, created);
		return created;
	}

	private requireChannel(channel: Channel): { kind: string; id: string } {
		const parsed = parseChannel(channel);
		if (!parsed || (parsed.kind !== "session" && parsed.kind !== "chat")) {
			throw new ChannelNotFoundError(channel);
		}
		return parsed;
	}

	private requireRow(sessionId: string): SessionState<A> {
		const row = this.table.get(sessionId);
		if (!row) {
			throw new SessionNotFoundError(sessionId);
		}
		return row;
	}

	/** 取已就绪的行。正在建立的等它建好。 */
	private async requireReady(sessionId: string): Promise<SessionState<A>> {
		const row = this.requireRow(sessionId);
		if (row.opening !== undefined) {
			await row.opening;
		}
		if (!row.agent) {
			throw new SessionNotFoundError(sessionId);
		}
		return row;
	}

	private snapshotRow(row: SessionState<A>): SessionSnapshot {
		if (!row.agent) {
			throw new SessionNotFoundError(row.sessionId);
		}
		return row.agent.snapshot();
	}

	private toFrame(channel: Channel, action: Action, seq: number): ActionFrame {
		return { type: "action", channel, action, serverSeq: seq, origin: undefined };
	}
}
