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

import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ForkPiAgentOptions, OpenPiAgentOptions, PiAgent, PiAgentLaunchOptions } from "@facet/agent";
import type { Action, ActionFrame, Channel, SessionSnapshot, SlashCommand } from "@facet/protocol";
import { makeChannel, parseChannel } from "@facet/protocol";
import { ActionProjector } from "./action-projector.ts";
import { EventLog } from "./event-log.ts";
import { debugLog } from "./log.ts";

/** 会话登记表用到的 agent 能力,收窄成结构类型以便测试注入假实现。 */
export type HubAgent = Pick<
	PiAgent,
	| "id"
	| "file"
	| "isBusy"
	| "subscribe"
	| "entryPage"
	| "entriesAfter"
	| "entryBefore"
	| "snapshot"
	| "setName"
	| "compact"
	| "contextUsage"
	| "commands"
	| "revertTo"
	| "leafEntryId"
	| "dispose"
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
		super(`会话不存在:${sessionId}`);
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

/** 提升实时消息时给的边界条目不在活动分支上。 */
export class SessionBoundaryNotFoundError extends Error {
	readonly entryId: string;

	constructor(entryId: string) {
		super(`条目不在活动分支上:${entryId}`);
		this.entryId = entryId;
	}
}

/** 会话正在运行,此时不允许分叉或回退。 */
export class SessionBusyError extends Error {
	readonly sessionId: string;

	constructor(sessionId: string) {
		super(`会话正在运行,不能执行这个操作:${sessionId}`);
		this.sessionId = sessionId;
	}
}

/** 会话文件不在盘上,常见于还没写过任何消息的空会话。 */
export class SessionFileMissingError extends Error {
	readonly file: string;

	constructor(file: string) {
		super(`会话文件不存在:${file}`);
		this.file = file;
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

/** 动作执行期间的持有。取得与登记同步完成,不需要 await。 */
export interface SessionLease {
	/** 归还,可重复调用 */
	release(): void;
}

interface SessionState<A extends HubAgent> {
	/** 主键,来自会话文件头部 */
	readonly sessionId: string;
	/** 归一化后的会话文件,内存会话为空 */
	readonly file: string | undefined;
	agent: A | undefined;
	unsubscribe: (() => void) | undefined;
	/** 正在看这个会话的端 */
	readonly holders: Set<string>;
	/** 在途的动作与请求数。大于零时不会被空闲回收 */
	holds: number;
	/** 持有归零之后再执行释放 */
	pendingRelease: boolean;
	/** 同一会话的动作串行执行 */
	tail: Promise<void>;
	phase: SessionPhase;
	/** 建立中的单飞句柄,建立结束即清空 */
	opening: Promise<void> | undefined;
	/** 待关闭的倒计时 */
	closeTimer: ReturnType<typeof setTimeout> | undefined;
	/** 上一次事件是不是压缩中，压缩结束的那一下要重算用量 */
	wasCompacting: boolean;
	/** 最近一次被用到的时间，按内存水位回收时从最旧的开始 */
	lastUsedAt: number;
	readonly channels: Map<Channel, ChannelState>;
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
	/**
	 * 会话清单有变化。
	 *
	 * 新建、打开、分叉、改名、删除与一轮结束都会通知，端点据此把新的摘要推给所有端；
	 * 会话文件为空的内存会话不通知。
	 */
	readonly onSessionChanged?: (file: string, change: "changed" | "removed") => void;
}

/** 文件是否存在。 */
async function fileExists(file: string): Promise<boolean> {
	try {
		await stat(file);
		return true;
	} catch {
		return false;
	}
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
		this.onSessionChanged = options.onSessionChanged;
	}

	/** 通知清单变化的回调，没有接的时候什么都不做。 */
	private readonly onSessionChanged: ((file: string, change: "changed" | "removed") => void) | undefined;

	/** 会话文件的清单有变化，通知外面。 */
	private noteSessions(file: string | undefined, change: "changed" | "removed"): void {
		if (file !== undefined) {
			this.onSessionChanged?.(file, change);
		}
	}

	/** 建一个新会话并登记。会话文件立即建立,之后每条完成的消息追加写盘。 */
	async createSession(options: PiAgentLaunchOptions = {}): Promise<SessionSnapshot> {
		const agent = await this.factory.create(options);
		this.attach(agent);
		this.noteSessions(agent.file === undefined ? undefined : normalizeFile(agent.file), "changed");
		return this.snapshotRow(this.requireRow(agent.id));
	}

	/**
	 * 按会话文件取会话,已登记时复用。
	 *
	 * 一个会话文件在主机上只能有一份运行态:两份会写同一个文件、各自维护条目树,
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
			this.noteSessions(key, "changed");
			return this.snapshotRow(this.requireRow(sessionId));
		}

		const row: SessionState<A> = {
			sessionId,
			file: key,
			agent: undefined,
			unsubscribe: undefined,
			holders: new Set(),
			holds: 0,
			pendingRelease: false,
			tail: Promise.resolve(),
			phase: "opening",
			opening: undefined,
			closeTimer: undefined,
			wasCompacting: false,
			lastUsedAt: Date.now(),
			channels: new Map(),
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
		this.noteSessions(key, "changed");
		return this.snapshotRow(row);
	}

	/**
	 * 分叉出新会话并登记，原会话不受影响。
	 *
	 * beforeEntryId 给出时复制到它之前的条目为止，界面用它按轮分叉：一轮结束后可能还会
	 * 追加 usage、session_info、compaction 等条目，所以分叉点取下一轮开始处的前一条。
	 * 缺省时复制整条活动分支。运行中的会话不允许分叉：这一轮还没写盘，分叉点对不上。
	 */
	async forkSession(options: {
		sessionFile: string;
		beforeEntryId?: string;
		cwd?: string;
	}): Promise<SessionSnapshot> {
		const opened = this.sessionIdByFile(options.sessionFile);
		const source = opened === undefined ? undefined : this.table.get(opened);
		if (source?.agent?.isBusy === true) {
			throw new SessionBusyError(source.sessionId);
		}
		// 源会话在整个复制期间持有,避免复制到一半被回收
		const lease = source === undefined ? undefined : this.holdRow(source);
		try {
			const entryId = this.forkPoint(source, options.beforeEntryId);
			const agent = await this.factory.fork({
				sessionFile: options.sessionFile,
				...(entryId === undefined ? {} : { entryId }),
				...(options.cwd === undefined ? {} : { cwd: options.cwd }),
			});
			this.attach(agent);
			this.noteSessions(agent.file === undefined ? undefined : normalizeFile(agent.file), "changed");
			return this.snapshotRow(this.requireRow(agent.id));
		} finally {
			lease?.release();
		}
	}

	/**
	 * 分叉点：给出 beforeEntryId 时取它在活动分支上的前一条，缺省留空由工厂取叶子。
	 *
	 * beforeEntryId 需要会话已在主机上打开才能定位；没打开或不在分支上时报错。
	 */
	private forkPoint(
		source: SessionState<A> | undefined,
		beforeEntryId: string | undefined,
	): string | undefined {
		if (beforeEntryId === undefined) {
			return undefined;
		}
		if (!source?.agent) {
			throw new SessionEntryNotFoundError(beforeEntryId);
		}
		const entryId = source.agent.entryBefore(beforeEntryId);
		if (entryId === null) {
			throw new SessionEntryNotFoundError(beforeEntryId);
		}
		return entryId;
	}

	/** 登记一个已建好的会话。同一会话已有另一份状态时保留先登记的,丢弃新的。 */
	attach(agent: A): void {
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
			holds: 0,
			pendingRelease: false,
			tail: Promise.resolve(),
			phase: "open",
			opening: undefined,
			closeTimer: undefined,
			wasCompacting: false,
			lastUsedAt: Date.now(),
			channels: new Map(),
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
	/**
	 * 取运行态,供检查与测试。
	 *
	 * 执行会改变会话的动作要走 withSession:那里才登记持有并串行。
	 */
	agent(sessionId: string): A {
		const agent = this.requireRow(sessionId).agent;
		if (!agent) {
			throw new SessionNotFoundError(sessionId);
		}
		return agent;
	}

	/** 取会话的对外状态。会话正在建立时等它建好。 */
	/** 会话里能用的命令，界面在输入区列出它们。 */
	async commands(sessionId: string): Promise<SlashCommand[]> {
		const row = await this.requireReady(sessionId);
		this.touch(row);
		return row.agent?.commands() ?? [];
	}

	async snapshot(sessionId: string): Promise<SessionSnapshot> {
		const row = await this.requireReady(sessionId);
		this.touch(row);
		return this.snapshotRow(row);
	}

	/**
	 * 改名。
	 *
	 * 会话已经打开时直接改运行态,pi 会追加一条会话信息条目并把变化推给订阅者;没有打开的
	 * 会话按文件离线追加同样的条目,不必为此启动一个会话。
	 */
	async renameSession(file: string, name: string | undefined): Promise<void> {
		const trimmed = name?.trim() ?? "";
		const key = normalizeFile(file);
		if (!(await fileExists(key))) {
			throw new SessionFileMissingError(key);
		}
		const sessionId = await this.factory.peekSessionId(key);
		const row = this.table.get(sessionId);
		if (row !== undefined) {
			if (row.file !== undefined && row.file !== key) {
				throw new SessionConflictError(key, row.file);
			}
			await this.withSession(sessionId, async (agent) => {
				agent.setName(trimmed);
			});
			this.noteSessions(key, "changed");
			return;
		}
		const manager = SessionManager.open(key);
		manager.appendSessionInfo(trimmed);
		this.noteSessions(key, "changed");
	}

	/**
	 * 删除会话。
	 *
	 * 已经打开的会话先释放再删文件,免得运行态继续往已删除的文件里写;还在跑的一轮会随
	 * agent 一并销毁。会话文件之外的产物不动。
	 */
	async deleteSession(file: string): Promise<void> {
		const key = normalizeFile(file);
		if (!(await fileExists(key))) {
			throw new SessionFileMissingError(key);
		}
		const sessionId = await this.factory.peekSessionId(key);
		const row = this.table.get(sessionId);
		if (row !== undefined) {
			row.pendingRelease = false;
			this.drop(row);
		}
		await rm(key, { force: true });
		this.noteSessions(key, "removed");
	}

	/**
	 * 回退到某条用户消息之前。
	 *
	 * 会话文件不动，只挪分支指针；挪完广播一条 chat/branchMoved，客户端据此重新装载历史。
	 * 运行中不允许回退：这一轮还没写盘，挪指针会把在途内容丢掉。
	 */
	async revertTo(sessionId: string, entryId: string): Promise<void> {
		const row = this.requireRow(sessionId);
		if (row.agent?.isBusy === true) {
			throw new SessionBusyError(sessionId);
		}
		await this.withSession(sessionId, async (agent) => {
			await agent.revertTo(entryId);
		});
		const leafId = this.requireRow(sessionId).agent?.leafEntryId() ?? null;
		this.publish(row, row.projector.chatChannelFor(), { type: "chat/branchMoved", leafId });
	}

	/**
	 * 按数量上限回收闲置会话。
	 *
	 * 只回收没有订阅、没有在途动作、也没在跑的那些，从最久没被用过的开始；keep 里的会话
	 * 一律不动（界面正开着的那几个）。运行中的会话本身受保护，数量再多也不回收。
	 */
	enforceLimits(options: { maxSessions: number; keep?: readonly string[] }): string[] {
		const rows = [...this.table.values()];
		if (rows.length <= options.maxSessions) {
			return [];
		}
		const keep = new Set(options.keep ?? []);
		const idle = rows
			.filter((row) => {
				return (
					!keep.has(row.sessionId) &&
					row.phase !== "opening" &&
					row.holders.size === 0 &&
					row.holds === 0 &&
					row.agent?.isBusy !== true
				);
			})
			.sort((left, right) => left.lastUsedAt - right.lastUsedAt);
		const removed: string[] = [];
		let count = rows.length;
		for (const row of idle) {
			if (count <= options.maxSessions) {
				break;
			}
			this.release(row.sessionId);
			removed.push(row.sessionId);
			count -= 1;
		}
		return removed;
	}

	/** 已装载的会话数与其中正在跑的数量，诊断与日志用。 */
	stats(): { loaded: number; busy: number } {
		let busy = 0;
		for (const row of this.table.values()) {
			if (row.agent?.isBusy === true) {
				busy += 1;
			}
		}
		return { loaded: this.table.size, busy };
	}

	/** 还在跑的会话文件。退出应用前用来判断会话会不会被连带终止。 */
	busyFiles(): string[] {
		const files: string[] = [];
		for (const row of this.table.values()) {
			if (row.agent?.isBusy === true && row.file !== undefined) {
				files.push(row.file);
			}
		}
		return files;
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
	 * 点对点返回,不广播,也不改变主机侧保留的状态。读的时候顺带续期:只翻历史不订阅的端
	 * 不该在翻页途中被回收。
	 */
	async entries(
		sessionId: string,
		cursor: string | undefined,
		limit: number | undefined,
	): Promise<{ entries: ReturnType<A["entryPage"]>["entries"]; nextCursor: string | undefined }> {
		const row = await this.requireReady(sessionId);
		this.touch(row);
		const agent = row.agent;
		if (!agent) {
			throw new SessionNotFoundError(sessionId);
		}
		const size = Math.min(Math.max(limit ?? this.pageSize.default, 1), this.pageSize.max);
		try {
			return agent.entryPage(cursor, size);
		} catch {
			throw new SessionEntryNotFoundError(cursor ?? "");
		}
	}

	/**
	 * 取 afterEntryId 之后到叶子的条目，端点在本轮结束后用它把实时消息提升为历史消息。
	 *
	 * 与 entries 一样顺带续期：刚 settle 过的会话仍算在用。
	 */
	async entriesAfter(
		sessionId: string,
		afterEntryId: string | null,
	): Promise<{ entries: ReturnType<A["entriesAfter"]>["entries"]; leafId: string | null }> {
		const row = await this.requireReady(sessionId);
		this.touch(row);
		const agent = row.agent;
		if (!agent) {
			throw new SessionNotFoundError(sessionId);
		}
		// 边界不在活动分支上时 agent 抛普通错误，这里换成端点认识的分类
		try {
			const result = agent.entriesAfter(afterEntryId);
			debugLog("commit", "返回边界之后的条目", {
				sessionId,
				afterEntryId,
				leafId: result.leafId,
				count: result.entries.length,
				kinds: result.entries.map((entry) => `${entry.kind}:${entry.id}`),
			});
			return result;
		} catch (error) {
			debugLog("commit", "边界条目不在活动分支上", { sessionId, afterEntryId, error: String(error) });
			throw new SessionBoundaryNotFoundError(afterEntryId ?? "");
		}
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
		row.lastUsedAt = Date.now();
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

	/**
	 * 释放会话:停止记录、销毁 agent。
	 *
	 * 还有动作在途时先挂起,最后一个持有归还后再释放,避免把正在启动的一轮连带销毁。
	 */
	release(sessionId: string): void {
		const row = this.table.get(sessionId);
		if (!row) {
			return;
		}
		if (row.holds > 0) {
			row.pendingRelease = true;
			return;
		}
		this.drop(row);
	}

	/** 释放全部会话,可重复调用。持有不阻止清空,进程退出时要能立刻走完。 */
	dispose(): void {
		for (const row of [...this.table.values()]) {
			row.pendingRelease = false;
			this.drop(row);
		}
	}

	private drop(row: SessionState<A>): void {
		this.table.delete(row.sessionId);
		this.clearCloseTimer(row);
		row.unsubscribe?.();
		row.unsubscribe = undefined;
		row.holders.clear();
		for (const channel of row.channels.values()) {
			channel.sinks.clear();
		}
		row.agent?.dispose();
	}

	/** 登记持有,期间这个会话不会被空闲回收。 */
	hold(sessionId: string): SessionLease {
		return this.holdRow(this.requireRow(sessionId));
	}

	private holdRow(row: SessionState<A>): SessionLease {
		row.holds += 1;
		this.clearCloseTimer(row);
		let released = false;
		return {
			release: () => {
				if (released) {
					return;
				}
				released = true;
				row.holds -= 1;
				if (row.holds > 0) {
					return;
				}
				if (row.pendingRelease) {
					this.release(row.sessionId);
					return;
				}
				this.settle(row);
			},
		};
	}

	/**
	 * 持有会话并按会话串行执行一段动作。
	 *
	 * 持有在调用时同步登记,从登记到归还之间这个会话不会被回收;串行队列保证同一会话的
	 * 动作依次执行,后到的动作看到前一个动作完成后的状态。
	 *
	 * 会话还没就绪时等它建好,期间持有有效;会话不存在或已被释放时报错,由调用方转成回执。
	 */
	async withSession(sessionId: string, work: (agent: A) => Promise<void>): Promise<void> {
		const row = this.requireRow(sessionId);
		const lease = this.holdRow(row);
		const previous = row.tail;
		let finish!: () => void;
		row.tail = new Promise<void>((resolve) => {
			finish = resolve;
		});
		try {
			await previous;
			await work(await this.readyAgent(row));
		} finally {
			finish();
			lease.release();
		}
	}

	/** 等会话建好并取运行态。 */
	private async readyAgent(row: SessionState<A>): Promise<A> {
		if (row.opening !== undefined) {
			await row.opening;
		}
		if (!row.agent) {
			throw new SessionNotFoundError(row.sessionId);
		}
		return row.agent;
	}

	/** 建立会话并填进行里。字段先就位再让 promise 兑现,等待者醒来即可用。 */
	private async buildOpen(row: SessionState<A>, cwd: string | undefined): Promise<void> {
		const agent = await this.factory.open({
			sessionFile: row.file as string,
			...(cwd === undefined ? {} : { cwd }),
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
			// 改名与一轮结束都会改会话摘要里的字段，推一份新的给所有端
			if (projected.action.type === "session/titleChanged" || projected.action.type === "chat/settled") {
				this.noteSessions(row.file, "changed");
			}
		}
		// 一轮结束与压缩结束都会改动上下文占用，重新估算一次推给所有端
		if (event.type === "settled") {
			this.publishUsage(row);
		}
		if (event.type === "phase") {
			const wasCompacting = row.wasCompacting;
			row.wasCompacting = event.maintenance?.kind === "compaction";
			if (wasCompacting && !row.wasCompacting) {
				this.publishUsage(row);
			}
		}
		this.settle(row);
	}

	/** 推一份当前的上下文用量。用量可能为空（刚压缩完要等下一次响应才有），空也照实推。 */
	private publishUsage(row: SessionState<A>): void {
		this.publish(row, row.projector.sessionChannelFor(), {
			type: "session/usageChanged",
			usage: row.agent?.contextUsage(),
		});
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
		if (row.holders.size === 0 && row.holds === 0 && !isBusy) {
			// 持有归还后定时器可能已被清掉,这里重新排上
			row.phase = "draining";
			this.scheduleClose(row);
			return;
		}
		if (row.phase === "draining") {
			row.phase = "open";
			this.clearCloseTimer(row);
		}
	}

	/** 读一次会话内容即续期,避免只翻历史不订阅的端在途中被回收。 */
	private touch(row: SessionState<A>): void {
		row.lastUsedAt = Date.now();
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
			if (row.holders.size === 0 && row.holds === 0 && row.agent?.isBusy !== true) {
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
