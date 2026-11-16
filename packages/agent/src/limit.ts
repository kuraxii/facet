/**
 * 并发控制。
 *
 * 文件摆在那里一个个读，同时在跑的任务数决定问磁盘有多狠。这里给出按上限并发执行、
 * 结果顺序与输入一致的实现，调用方只需给上限。
 */

/** 按上限并发执行，保持结果顺序。 */
export async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	task: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			results[index] = await task(items[index] as T);
		}
	});
	await Promise.all(workers);
	return results;
}
