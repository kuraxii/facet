/**
 * 模型通道。
 *
 * 一个主机一条通道，所有端订阅同一条：与具体会话无关的模型侧状态从这里推给全部订阅者。
 * 目前只有提供方登录的推进——登录要用浏览器回调与多步问答，一次请求说不完。序号与回放
 * 复用通道日志，断线重连按 since 补齐，缺口用 resync 告知端点重新取一份状态。
 */
import type { Action, ActionFrame, Channel, ProviderLoginEvent, SubscribeResult } from "@facet/protocol";
import { EventLog, replayAndSubscribe } from "./event-log.ts";

/** 订阅者。id 是端标识，send 把一帧推给它。 */
export interface ModelsSink {
	readonly id: string;
	send(frame: ActionFrame): void;
}

export class ModelsChannel {
	private readonly log: EventLog<Action>;
	private readonly sinks = new Set<ModelsSink>();

	/** replayLimit 是回放缓冲条数，断线期间的变化要落在缓冲内。 */
	constructor(replayLimit: number) {
		this.log = new EventLog(replayLimit);
	}

	/** 当前最新序号。 */
	get lastSeq(): number {
		return this.log.lastSeq;
	}

	/** 订阅并在返回前补发缓冲内的动作，顺序见 `replayAndSubscribe`。 */
	subscribe(channel: Channel, since: number | undefined, sink: ModelsSink): SubscribeResult {
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
	unsubscribe(sink: ModelsSink): void {
		this.sinks.delete(sink);
	}

	/** 追加一条登录进展并推给所有订阅者。 */
	publishLogin(channel: Channel, loginId: string, providerId: string, event: ProviderLoginEvent): void {
		this.publish(channel, { type: "models/loginEvent", loginId, providerId, event });
	}

	/** 摘掉全部订阅者，端点关闭时用。日志与序号留着，新端点按旧 since 续订仍然接得上。 */
	dropSubscribers(): void {
		this.sinks.clear();
	}

	private publish(channel: Channel, action: Action): void {
		const sequenced = this.log.append(action);
		const frame = this.toFrame(channel, sequenced.action, sequenced.seq);
		for (const sink of [...this.sinks]) {
			sink.send(frame);
		}
	}

	private toFrame(channel: Channel, action: Action, seq: number): ActionFrame {
		return { type: "action", channel, action, serverSeq: seq, origin: undefined };
	}
}
