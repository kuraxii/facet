/**
 * 排队消息列表的稳定键生成。
 *
 * 连续发出内容相同的排队消息时，仅靠文本作 React key 会冲突；这里按同类文本出现序号
 * 派生唯一键，供插话气泡与后续消息卡片共用。
 */

/** 带稳定 React key 与原始下标的排队条目。 */
export interface KeyedQueueEntry {
	/** 唯一且在重排前保持稳定的渲染键 */
	key: string;
	/** 排队消息纯文本 */
	text: string;
	/** 原始队列下标 */
	index: number;
}

/** 为一组排队文本生成带去重序号的渲染条目。 */
export function keyedEntries(items: readonly string[], prefix: string): KeyedQueueEntry[] {
	const counts = new Map<string, number>();
	return items.map((text, index) => {
		const seen = (counts.get(text) ?? 0) + 1;
		counts.set(text, seen);
		return { key: `${prefix}:${text}:${seen}`, text, index };
	});
}
