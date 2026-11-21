/**
 * 面板宽度的夹紧口径。
 *
 * 左栏与右栏各有一条分隔条，宽度值要经过三条路：拖动过程中夹紧、松手后落盘、启动时读盘。
 * 三处一旦各写一套回落规则，同一个非法值就会在「拖动时按上限、读盘时按默认」之间来回跳，
 * 宽度因此忽大忽小。这里只留一份口径，调用方各自提供边界。
 */

/** 一条分隔条的宽度边界与回落值。 */
export interface PaneWidthBounds {
	/** 最小允许宽度（px） */
	readonly min: number;
	/** 最大允许宽度（px）；`Number.POSITIVE_INFINITY` 表示没有固定上限 */
	readonly max: number;
	/** 非法或缺失输入时的回落默认宽度（px） */
	readonly defaultWidth: number;
}

/**
 * 把任意输入夹成一条分隔条能用的宽度。
 *
 * 判定顺序：`Number.isFinite` 不通过的（`NaN`、`±Infinity`、`null`、`undefined`、字符串等）
 * 一律回落到 `bounds.defaultWidth`；通过后先四舍五入取整，再夹进 `[min, max]`——界面按整像素
 * 布局，带小数的宽度会在面板与正文之间留下半像素缝。
 *
 * 入参用 `unknown` 是为了把「读盘读到什么都没写」与「拖动算出来的数」收进同一个入口；
 * 不做类型转换，字符串宽度请在调用方先 `Number.parseFloat`，读不懂就传 `NaN` 进来。
 */
export function clampPaneWidth(raw: unknown, bounds: PaneWidthBounds): number {
	if (!Number.isFinite(raw)) {
		return bounds.defaultWidth;
	}
	const width = Math.round(raw as number);
	return Math.min(bounds.max, Math.max(bounds.min, width));
}
