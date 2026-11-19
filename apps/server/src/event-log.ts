/**
 * 通道的动作序号与回放缓冲。
 *
 * 序号由主机生成,通道内单调递增;pi 的条目 id 是持久化游标,不承担流内定序。
 * 缓冲有上限,超出的旧动作被丢弃,端点据此判断要不要重新同步。
 *
 * 这个文件只放纯数据大小与一段顺序不变量：订阅者的集合、帧的拼装与生命周期都留给调用方，
 * 三处通道（会话、清单、终端）各自的持有者登记、水印记账与销毁策略不受这里影响。
 */

/** 一条带序号的载荷。 */
export interface SequencedItem<T> {
	seq: number;
	action: T;
}

/** 回放结果。resync 为真表示 since 之后的部分动作已不在缓冲内。 */
export interface ReplayResult<T> {
	actions: SequencedItem<T>[];
	resync: boolean;
}

/** 一次重连续订的结果。 */
export interface ReplaySubscribeResult {
	/** 订好之后的通道序号 */
	seq: number;
	/** 缺口标记，为真表示需要重新同步 */
	resync: boolean;
	/** 这次补发了多少条 */
	replayed: number;
}

export class EventLog<T> {
	private readonly limit: number;
	private seq = 0;
	private readonly buffer: SequencedItem<T>[] = [];

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
	append(action: T): SequencedItem<T> {
		this.seq += 1;
		const item: SequencedItem<T> = { seq: this.seq, action };
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
	 *
	 * 两种情况算缺口:since 早于缓冲里最旧的一条(中间的动作已经被丢掉),以及 since 比
	 * 当前序号还大——那份水位不是这条通道产生的(端换过主机或通道重建),照它续订会
	 * 永远等不到后续动作,必须让它重新同步。
	 */
	replay(since: number): ReplayResult<T> {
		const from = Number.isFinite(since) && since > 0 ? since : 0;
		const resync = from > this.seq || from + 1 < this.oldestSeq;
		return { actions: this.buffer.filter((item) => item.seq > from), resync };
	}
}

/**
 * 补发缺口，再把订阅者接上实时流。
 *
 * 顺序是「取快照 → 把 sink 加进活跃集合 → 同步发补发帧」，三步中间没有 await：
 *
 * - 快照先取，保证补发的是 since 之后、此刻已有的部分；
 * - sink 在发包之前就进活跃集合，于是这轮补发期间若有人重入 `publish`，新帧能落到这个
 *   sink 上，排在补发帧之后投递；反过来先发后加，那一帧既不在快照里也不在集合里，直接丢，
 *   只能等下一次 resync 补救；
 * - 整段同步执行，实时帧不会插到补发中间，不会重也不会漏。
 *
 * 这里只管这一段顺序；订阅者的类型、持有者登记、帧的拼装形态与销毁策略都留在调用方。
 */
export function replayAndSubscribe<T, S extends { send(frame: unknown): void }>(
	log: EventLog<T>,
	sinks: Set<S>,
	sink: S,
	toFrame: (item: SequencedItem<T>) => Parameters<S["send"]>[0],
	since: number | undefined,
): ReplaySubscribeResult {
	const { actions, resync } = log.replay(since ?? log.lastSeq);
	sinks.add(sink);
	for (const item of actions) {
		sink.send(toFrame(item));
	}
	return { seq: log.lastSeq, resync, replayed: actions.length };
}
