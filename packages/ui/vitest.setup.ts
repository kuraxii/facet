/**
 * 界面测试的浏览器补齐。
 *
 * jsdom 不做布局，`Range` 上也没有矩形查询。编辑器在恢复选区时会去量光标的位置，缺了这两个
 * 方法就会在提交更新时抛错，而量到的尺寸在 jsdom 里本来也没有意义。这里给一个空矩形：
 * 让「量不到」成为正常结果，而不是把测试打断。
 *
 * 少数用例跑在 Node 环境（读文件、WASM 高亮器），那里没有 `Range`，跳过即可。
 */

/** 量不到布局时统一的空矩形。 */
const EMPTY_RECT = {
	x: 0,
	y: 0,
	width: 0,
	height: 0,
	top: 0,
	right: 0,
	bottom: 0,
	left: 0,
	toJSON: () => ({}),
} as DOMRect;

/** 空矩形列表，形状与 `DOMRectList` 一致。 */
const EMPTY_RECTS = Object.assign([] as DOMRect[], {
	item: (): DOMRect | null => null,
});

if (typeof Range === "function") {
	Range.prototype.getBoundingClientRect = (): DOMRect => EMPTY_RECT;
	Range.prototype.getClientRects = (): DOMRectList => EMPTY_RECTS as unknown as DOMRectList;
}
