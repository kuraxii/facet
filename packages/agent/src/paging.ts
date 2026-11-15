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

/** 活动分支的快照，按叶子 id 复用。 */
export interface BranchSnapshot {
	/** 生成快照时的叶子条目 id */
	readonly leafId: string | null;
	/** 活动分支的条目，按根到叶子排列 */
	readonly entries: readonly SessionEntry[];
	/** 条目 id 到分支内下标的索引 */
	readonly indexById: ReadonlyMap<string, number>;
}

/** 为一条活动分支建立快照与 id 索引。 */
export function branchSnapshot(leafId: string | null, entries: readonly SessionEntry[]): BranchSnapshot {
	const indexById = new Map<string, number>();
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry !== undefined) {
			indexById.set(entry.id, index);
		}
	}
	return { leafId, entries, indexById };
}

/** 取一页。limit 至少为 1，超过总数时返回全部。 */
export function pageOf(
	entries: readonly SessionEntry[],
	cursor: string | undefined,
	limit: number,
	indexById?: ReadonlyMap<string, number>,
): PageWindow {
	const size = Math.max(1, Math.trunc(limit));
	if (cursor !== undefined) {
		const index =
			indexById === undefined
				? entries.findIndex((entry) => entry.id === cursor)
				: (indexById.get(cursor) ?? -1);
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
