/**
 * 会话清单通道。
 *
 * 一个主机一条通道，所有端订阅同一条：主机把会话的新增、改名、删除与一轮结束后的变化
 * 推给全部订阅者，多个端因此看到同一份列表。序号与回放复用通道的日志，断线重连按
 * since 补齐，缺口用 resync 告知端点重新取一份完整清单。
 */
import type { Action, ActionFrame, Channel, SubscribeResult } from "@facet/protocol";
import { EventLog, replayAndSubscribe } from "./event-log.ts";

/** 订阅者。id 是端标识，send 把一帧推给它。 */
export interface SessionsSink {
	readonly id: string;
	send(frame: ActionFrame): void;
}

export class SessionsChannel {
	private readonly log: EventLog<Action>;
	private readonly sinks = new Set<SessionsSink>();

	/** replayLimit 是回放缓冲条数，断线期间的变化要落在缓冲内。 */
	constructor(replayLimit: number) {
		this.log = new EventLog(replayLimit);
	}

	/** 当前最新序号。 */
	get lastSeq(): number {
		return this.log.lastSeq;
	}

	/** 订阅并在返回前补发缓冲内的动作，顺序见 `replayAndSubscribe`。 */
	subscribe(channel: Channel, since: number | undefined, sink: SessionsSink): SubscribeResult {
		const { seq, resync } = replayAndSubscribe(
			this.log,
			this.sinks,
			sink,
			(item) => this.toFrame(channel, item.action, item.seq),
			since,
		);
		return { seq, resync };
	}

	/** 取消订阅，sink 不在时无副作用。 */
	unsubscribe(sink: SessionsSink): void {
		this.sinks.delete(sink);
	}

	/** 追加一条动作并推给所有订阅者。 */
	publish(channel: Channel, action: Action): void {
		const sequenced = this.log.append(action);
		const frame = this.toFrame(channel, sequenced.action, sequenced.seq);
		for (const sink of [...this.sinks]) {
			sink.send(frame);
		}
	}

	/**
	 * 摘掉全部订阅者，端点关闭时用。
	 *
	 * 只动订阅者：日志与序号留着，主机还活着，新端点按旧 since 续订仍然接得上。
	 * 通道整体销毁（终端结束、会话关闭）走各自行的丢弃，不经过这里。
	 */
	dropSubscribers(): void {
		this.sinks.clear();
	}

	private toFrame(channel: Channel, action: Action, seq: number): ActionFrame {
		return { type: "action", channel, action, serverSeq: seq, origin: undefined };
	}
}
