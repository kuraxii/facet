/**
 * 行的增量测高。
 *
 * 正文行用 `content-visibility: auto`，屏外的行不参与布局，高度取 `contain-intrinsic-size`
 * 里的那个估算值（64px）。真实行高均值是它的五倍以上，所以**跨过从未渲染过的区域做跳转**时，
 * 文档高度会在飞行途中被一段段改写成真实值，落点跟着漂——实测差过 1,400px。
 *
 * 这里做的事就是把这个"以后才准"变成"现在就是准的"：把量到的真实高度**显式写回**每一行的
 * `contain-intrinsic-block-size`。写回是必要的——`auto` 关键字依赖浏览器的 `last remembered
 * size`，而它只在真正渲染过的帧里才更新，同步切类再撤类不会留下任何东西（实测撤类后
 * `scrollHeight` 立刻缩回估算值）。
 *
 * 写回用的是**纯长度**，不带 `auto`：带 `auto` 时 remembered size 优先于我们给的兜底值，改宽
 * 之后布局用的还是上一次宽度记住的高度——实测总高比真实值少了 4,090px，锚点漂了 1,611px。
 * 去掉 `auto` 就只认我们量出来的数；内容在屏外变化由 `forgetRowMeasure` 标记脏、下次重测。
 *
 * 只有**脏行**参与测量：宽度没变、也没被标记过内容的行直接跳过，稳态下这个函数只花一次
 * `querySelectorAll` 的钱。
 */

/** 上次测量这一行时的容器宽度（整数像素）。行被回收后自动从表里消失 */
const measuredWidth = new WeakMap<HTMLElement, number>();

/**
 * 测量期间临时挂在行上的类：让这一行不再被 `content-visibility` 跳过。
 *
 * 只挂在脏行上，不整容器切换——否则每测一次都要把整份正文重新布局（实测 28.7ms）。
 */
export const ROW_MEASURING_CLASS = "is-measuring";

/**
 * 尺寸停稳多久之后重新测量一次，毫秒。
 *
 * 比贴底跟随、分隔条那两处（150ms）更短：那两处等的是"别再抖了"，这里等的是"可以把落点算准"。
 * 实测改宽当下浏览器自己 45–50ms 就重排完了，150ms 再加一次全量测量会超出动作前的 200ms 预算。
 */
export const ROW_MEASURE_SETTLE_MS = 80;

/** 一次测量的结果。 */
export interface RowMeasureResult {
	/** 这次真正量了几行 */
	dirty: number;
	/** 这次测量花掉的毫秒数，含强制布局 */
	ms: number;
}

/**
 * 把宽度变了、或内容变了的行重新量一遍，并把真实高度写回它们的行内尺寸。
 *
 * 全程同步完成，必须在同一个任务里跑到底：中间一旦让出一帧，浏览器就会把"一部分行已经变成
 * 真实高度"的中间态画出来，滚动条会明显跳一下。
 */
export function measureStaleRows(container: HTMLElement): RowMeasureResult {
	const started = performance.now();
	const width = Math.round(container.clientWidth);
	const rows = container.querySelectorAll<HTMLElement>(".row");
	const stale: HTMLElement[] = [];
	for (const row of rows) {
		if (measuredWidth.get(row) !== width) {
			stale.push(row);
		}
	}
	if (stale.length === 0) {
		return { dirty: 0, ms: round(performance.now() - started) };
	}
	for (const row of stale) {
		row.classList.add(ROW_MEASURING_CLASS);
	}
	/*
	 * 读写分两遍：第一遍只读（第一次读就把这批行的布局一起算掉，后面都是白读），
	 * 第二遍只写。交错读写会让每一行都重新结算一次布局。
	 *
	 * 高度取小数：`offsetHeight` 会取整，几百行累积下来能偏出上百像素，正好把"锁死高度"废掉。
	 */
	const heights = stale.map((row) => row.getBoundingClientRect().height);
	for (let index = 0; index < stale.length; index += 1) {
		const row = stale[index];
		if (row === undefined) {
			continue;
		}
		row.style.containIntrinsicBlockSize = `${heights[index] ?? 0}px`;
		measuredWidth.set(row, width);
	}
	for (const row of stale) {
		row.classList.remove(ROW_MEASURING_CLASS);
	}
	return { dirty: stale.length, ms: round(performance.now() - started) };
}

/**
 * 把一行记为脏：下次测量时重测它。
 *
 * 只删记录、**不动**已经写回的行内尺寸——否则这一行在下次测量之前会退回到 `64px`，
 * 滚动条长度立刻变一截。
 */
export function forgetRowMeasure(element: Element | null | undefined): void {
	if (element instanceof HTMLElement) {
		measuredWidth.delete(element);
	}
}

/** 毫秒数保留两位，方便直接写进报告 */
function round(value: number): number {
	return Math.round(value * 100) / 100;
}
