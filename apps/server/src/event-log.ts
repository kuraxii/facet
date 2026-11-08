/**
 * 通道的动作序号与回放缓冲。
 *
 * 序号由设备生成,通道内单调递增;pi 的条目 id 是持久化游标,不承担流内定序。
 * 缓冲有上限,超出的旧动作被丢弃,端点据此判断要不要重新同步。
 */
import type { Action } from "@facet/protocol";

/** 一条带序号的动作。 */
export interface SequencedAction {
	seq: number;
	action: Action;
}

/** 回放结果。resync 为真表示 since 之后的部分动作已不在缓冲内。 */
export interface ReplayResult {
	actions: SequencedAction[];
	resync: boolean;
}

export class EventLog {
	private readonly limit: number;
	private seq = 0;
	private readonly buffer: SequencedAction[] = [];

	/** limit 为缓冲条数上限,需要大于一次断线期间可能产生的动作数。 */
	constructor(limit: number) {
		this.limit = limit;
	}

	/** 当前最新序号,尚无动作时为 0。 */
	get lastSeq(): number {
		return this.seq;
	}

	/** 缓冲内最旧的序号,缓冲为空时返回下一将要分配的序号。 */
	get oldestSeq(): number {
		const first = this.buffer[0];
		return first ? first.seq : this.seq + 1;
	}

	/** 追加一条动作并编号。调用方负责在返回后立即分发。 */
	append(action: Action): SequencedAction {
		this.seq += 1;
		const item: SequencedAction = { seq: this.seq, action };
		this.buffer.push(item);
		while (this.buffer.length > this.limit) {
			this.buffer.shift();
		}
		return item;
	}

	/**
	 * 取出 since 之后的动作。
	 *
	 * since 为 0 或负数表示从头补齐;已有的部分仍会返回,同时用 resync 告知缺口,
	 * 端点需要重新读取快照与历史来修正状态。
	 */
	replay(since: number): ReplayResult {
		const from = Number.isFinite(since) && since > 0 ? since : 0;
		const resync = from + 1 < this.oldestSeq;
		return { actions: this.buffer.filter((item) => item.seq > from), resync };
	}
}
