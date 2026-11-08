/**
 * 会话事件的序号与回放缓冲。
 *
 * 序号由设备生成，端到端单调递增；pi 的条目 id 是持久化游标，不承担流内定序。
 * 缓冲有上限，超出的旧事件被丢弃，端点据此判断要不要重新同步。
 */
import type { SequencedEvent, SessionEvent } from "@facet/protocol";

/** 回放结果。resync 为真表示 since 之后的事件已有部分不在缓冲内。 */
export interface ReplayResult {
	events: SequencedEvent[];
	resync: boolean;
}

export class EventLog {
	private seq = 0;
	private readonly buffer: SequencedEvent[] = [];

	private readonly limit: number;

	/** limit 为缓冲条数上限，需要大于一次断线期间可能产生的事件数。 */
	constructor(limit: number) {
		this.limit = limit;
	}

	/** 当前最新序号，尚无事件时为 0。 */
	get lastSeq(): number {
		return this.seq;
	}

	/** 缓冲内最旧的序号，缓冲为空时返回下一将要分配的序号。 */
	get oldestSeq(): number {
		const first = this.buffer[0];
		return first ? first.seq : this.seq + 1;
	}

	/** 追加一条事件并编号。调用方负责在返回后立即分发。 */
	append(event: SessionEvent): SequencedEvent {
		this.seq += 1;
		const item: SequencedEvent = { seq: this.seq, event };
		this.buffer.push(item);
		while (this.buffer.length > this.limit) {
			this.buffer.shift();
		}
		return item;
	}

	/**
	 * 取出 since 之后的事件。
	 *
	 * since 为 0 或负数表示从头补齐；已有的部分仍会返回，同时用 resync 告知缺口，
	 * 端点需要重新读取快照与条目来修正状态。
	 */
	replay(since: number): ReplayResult {
		const from = Number.isFinite(since) && since > 0 ? since : 0;
		const resync = from + 1 < this.oldestSeq;
		return { events: this.buffer.filter((item) => item.seq > from), resync };
	}
}
