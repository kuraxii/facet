/**
 * 历史分页的窗口计算。
 *
 * 条目按根到叶子的顺序传入，分页从 cursor 指向的条目往更早取，cursor 缺省表示从末尾开始。
 * 定位与切片都在原始条目上完成，调用方只映射窗口内的条目，避免每请求一页就转换整份历史。
 */
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** 一页的取数结果。 */
export interface PageWindow {
	/** 这一页的条目，顺序与传入顺序一致 */
	window: readonly SessionEntry[];
	/** 下一页的游标，为空表示已经到最早 */
	nextCursor: string | undefined;
	/** 游标不在传入的条目里 */
	missing: boolean;
}

/** 取一页。limit 至少为 1，超过总数时返回全部。 */
export function pageOf(
	entries: readonly SessionEntry[],
	cursor: string | undefined,
	limit: number,
): PageWindow {
	const size = Math.max(1, Math.trunc(limit));
	if (cursor !== undefined) {
		const index = entries.findIndex((entry) => entry.id === cursor);
		if (index < 0) {
			return { window: [], nextCursor: undefined, missing: true };
		}
		const start = Math.max(0, index - size);
		return {
			window: entries.slice(start, index),
			nextCursor: start > 0 ? entries[start]?.id : undefined,
			missing: false,
		};
	}
	const start = Math.max(0, entries.length - size);
	return {
		window: entries.slice(start),
		nextCursor: start > 0 ? entries[start]?.id : undefined,
		missing: false,
	};
}
