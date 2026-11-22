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

/**
 * jsdom 没有 `ResizeObserver`。补全菜单用它跟踪锚点位置，缺了会在挂载时就抛错；
 * 测试里不做布局，收到观察与断开就好。
 */
class TestResizeObserver implements ResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

if (typeof globalThis.ResizeObserver !== "function") {
	globalThis.ResizeObserver = TestResizeObserver;
}

/**
 * jsdom 没实现 `<dialog>` 的模态方法。设置窗与图片预览都走原生弹层，测试只关心开合与内容，
 * 这里补一对最小实现：`showModal()` 置 `open`，`close()` 清掉并派发 `close`。
 */
if (typeof HTMLDialogElement === "function" && typeof HTMLDialogElement.prototype.showModal !== "function") {
	HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
		this.setAttribute("open", "");
	};
}

if (typeof HTMLDialogElement === "function" && typeof HTMLDialogElement.prototype.close !== "function") {
	HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, returnValue?: string): void {
		if (returnValue !== undefined) {
			this.returnValue = returnValue;
		}
		this.removeAttribute("open");
		this.dispatchEvent(new Event("close"));
	};
}
