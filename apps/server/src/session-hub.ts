/**
 * 会话的登记与事件扇出。
 *
 * 一个会话对应一个 PiAgent 与一条事件序号流。多个端点可以同时订阅同一会话，
 * 每个订阅各自记录自己的序号；会话释放时统一回收 agent、审批中转与订阅。
 */
import type { PiAgent } from "@facet/agent";
import type { EventFrame, SequencedEvent, SessionSnapshot } from "@facet/protocol";
import type { ApprovalBroker } from "./approval-broker.ts";
import { EventLog } from "./event-log.ts";

/** 事件接收方，通常是某个连接上的转发函数。 */
export type EventSink = (frame: EventFrame) => void;

/** 订阅结果。resync 为真时端点需要重新读取快照与条目。 */
export interface Subscription {
	snapshot: SessionSnapshot;
	/** 订阅完成时的最新序号 */
	seq: number;
	/** 缺口标记，为真表示部分历史事件已不在缓冲内 */
	resync: boolean;
	/** 本次补发的事件条数 */
	replayed: number;
}

interface Channel {
	readonly sessionId: string;
	readonly agent: PiAgent;
	readonly log: EventLog;
	readonly approvals: ApprovalBroker;
	readonly subscribers: Set<EventSink>;
	unsubscribe: () => void;
}

/** 会话不存在或已释放。端点收到后应停止对该会话的操作。 */
export class SessionNotFoundError extends Error {
	readonly sessionId: string;

	constructor(sessionId: string) {
		super(`unknown session: ${sessionId}`);
		this.sessionId = sessionId;
	}
}

export interface SessionHubOptions {
	/** 每个会话保留的事件条数 */
	replayLimit: number;
}

export class SessionHub {
	private readonly channels = new Map<string, Channel>();

	private readonly options: SessionHubOptions;

	constructor(options: SessionHubOptions) {
		this.options = options;
	}

	/** 登记一个已建好的会话并开始记录事件。同一个会话重复登记会替换旧记录。 */
	attach(agent: PiAgent, approvals: ApprovalBroker): void {
		const sessionId = agent.id;
		const existing = this.channels.get(sessionId);
		if (existing) {
			existing.unsubscribe();
		}
		const channel: Channel = {
			sessionId,
			agent,
			log: new EventLog(this.options.replayLimit),
			approvals,
			subscribers: new Set(),
			unsubscribe: () => {},
		};
		channel.unsubscribe = agent.subscribe((event) => {
			const sequenced = channel.log.append(event);
			const frame: EventFrame = {
				type: "event",
				sessionId,
				seq: sequenced.seq,
				event: sequenced.event,
			};
			for (const sink of [...channel.subscribers]) {
				sink(frame);
			}
		});
		this.channels.set(sessionId, channel);
	}

	has(sessionId: string): boolean {
		return this.channels.has(sessionId);
	}

	sessionIds(): string[] {
		return [...this.channels.keys()];
	}

	/** 取会话的 agent，供端点执行发消息、中止与读取条目。 */
	agent(sessionId: string): PiAgent {
		return this.require(sessionId).agent;
	}

	/** 取会话的对外状态。 */
	snapshot(sessionId: string): SessionSnapshot {
		return this.require(sessionId).agent.snapshot();
	}

	/**
	 * 订阅会话事件。
	 *
	 * since 缺省时只订阅后续事件，历史由端点自己读快照与条目；给出 since 时先补发
	 * 缓冲内的事件，缺口用 resync 标记。补发在返回前同步完成，不会与实时事件交错。
	 */
	subscribe(sessionId: string, since: number | undefined, sink: EventSink): Subscription {
		const channel = this.require(sessionId);
		const { events, resync } = channel.log.replay(since ?? channel.log.lastSeq);
		channel.subscribers.add(sink);
		for (const item of events) {
			sink(this.toFrame(channel, item));
		}
		return {
			snapshot: channel.agent.snapshot(),
			seq: channel.log.lastSeq,
			resync,
			replayed: events.length,
		};
	}

	/** 取消订阅。sink 不存在时无副作用。 */
	unsubscribe(sessionId: string, sink: EventSink): void {
		this.channels.get(sessionId)?.subscribers.delete(sink);
	}

	/** 回填一条审批请求的决定。请求不存在时返回假。 */
	respondApproval(
		sessionId: string,
		requestId: string,
		decision: Parameters<ApprovalBroker["respond"]>[1],
	): boolean {
		return this.require(sessionId).approvals.respond(requestId, decision);
	}

	/** 释放会话：停止记录、拒绝未应答的审批、销毁 agent。 */
	release(sessionId: string): void {
		const channel = this.channels.get(sessionId);
		if (!channel) {
			return;
		}
		this.channels.delete(sessionId);
		channel.unsubscribe();
		channel.subscribers.clear();
		channel.approvals.release("会话已释放");
		channel.agent.dispose();
	}

	/** 释放全部会话，可重复调用。 */
	dispose(): void {
		for (const sessionId of [...this.channels.keys()]) {
			this.release(sessionId);
		}
	}

	private require(sessionId: string): Channel {
		const channel = this.channels.get(sessionId);
		if (!channel) {
			throw new SessionNotFoundError(sessionId);
		}
		return channel;
	}

	private toFrame(channel: Channel, item: SequencedEvent): EventFrame {
		return { type: "event", sessionId: channel.sessionId, seq: item.seq, event: item.event };
	}
}
