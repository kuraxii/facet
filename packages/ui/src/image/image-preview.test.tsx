// @vitest-environment jsdom
/**
 * 图片预览浮层：打开、缩放、翻页、关闭，以及 View Transitions 的降级。
 *
 * 控件只剩两簇：右上角的下载 / 关闭与底部的减 / 百分比 / 加；翻页只有方向键。整层盖一层七成的
 * 遮罩，背后的会话隐约看得见；点图片以外的空白、按 `Esc`、点右上角那枚按钮都关。
 *
 * jsdom 没有 `<dialog>` 的模态方法，`vitest.setup.ts` 补了一对最小实现；`showModal()` 只置
 * `open` 属性，因此这里断言的是「浮层被挂上并处于打开态」，而不是真的进了 Top Layer。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImagePreviewProvider, useImagePreview } from "./image-preview.tsx";
import type { ImagePreviewItem } from "./image-preview-types.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS: readonly ImagePreviewItem[] = [
	{ src: "data:image/png;base64,AAAA", alt: "甲" },
	{ src: "data:image/png;base64,BBBB", alt: "乙" },
];

/** 只有一枚按钮的调用方：点它就像点了某张图。 */
function Opener({ items, index }: { items: readonly ImagePreviewItem[]; index?: number }): ReactElement {
	const open = useImagePreview();
	return createElement(
		"button",
		{
			type: "button",
			className: "opener",
			onClick: (event) => open({ items, index: index ?? 0, source: event.currentTarget }),
		},
		"open",
	);
}

let root: Root | undefined;
let container: HTMLElement | undefined;

function mount(element: ReactElement): void {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => root?.render(element));
}

function unmount(): void {
	act(() => root?.unmount());
	container?.remove();
	root = undefined;
	container = undefined;
}

/** 浮层本体（没有打开时是 null）。 */
function dialog(): HTMLDialogElement | null {
	return document.querySelector<HTMLDialogElement>("dialog.image-preview-dialog");
}

/** 浮层里的图片。 */
function shownImage(): HTMLImageElement | null {
	return document.querySelector<HTMLImageElement>(".image-preview-stage img");
}

/** 按无障碍名点一枚浮层上的按钮。 */
function clickButton(label: string): void {
	const button = [...document.querySelectorAll<HTMLButtonElement>(".image-preview button")].find(
		(item) => item.getAttribute("aria-label") === label,
	);
	if (button === undefined) {
		throw new Error(`浮层上没有「${label}」`);
	}
	act(() => button.click());
}

/** 浮层上现在有哪些动作按钮。 */
function buttonLabels(): (string | null)[] {
	return [...document.querySelectorAll(".image-preview button")].map((item) =>
		item.getAttribute("aria-label"),
	);
}

/** 在浮层根节点上按一个键。 */
function pressKey(key: string): void {
	const node = document.querySelector<HTMLElement>(".image-preview");
	if (node === null) {
		throw new Error("浮层没有打开");
	}
	act(() => {
		node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	});
}

function clickOpener(): void {
	const button = container?.querySelector<HTMLButtonElement>(".opener");
	if (button === null || button === undefined) {
		throw new Error("没有调用方按钮");
	}
	act(() => button.click());
}

beforeEach(() => {
	mount(createElement(ImagePreviewProvider, null, createElement(Opener, { items: ITEMS })));
});

afterEach(() => {
	unmount();
	document.documentElement.dataset.motion = "";
	// 假 API 是 `defineProperty` 装上去的，`restoreAllMocks` 收不走它
	Reflect.deleteProperty(document, "startViewTransition");
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

describe("打开与关闭", () => {
	it("点击打开原生 dialog 并显示对应的图", () => {
		expect(dialog()).toBeNull();
		clickOpener();
		expect(dialog()?.hasAttribute("open")).toBe(true);
		expect(shownImage()?.getAttribute("src")).toBe(ITEMS[0]?.src);
		expect(dialog()?.getAttribute("aria-label")).toBe("图片预览");
	});

	it("Esc 关闭", () => {
		clickOpener();
		pressKey("Escape");
		expect(dialog()).toBeNull();
	});

	it("点图片以外的空白也关", () => {
		clickOpener();
		const stage = document.querySelector<HTMLElement>(".image-preview-stage");
		expect(stage).not.toBeNull();
		act(() => {
			stage?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
		});
		expect(dialog()).toBeNull();
	});

	it("点在图上不关", () => {
		clickOpener();
		const image = shownImage();
		expect(image).not.toBeNull();
		act(() => {
			image?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
		});
		expect(dialog()).not.toBeNull();
	});

	it("右上角的关闭按钮也关", () => {
		clickOpener();
		clickButton("关闭");
		expect(dialog()).toBeNull();
	});
});

describe("缩放", () => {
	it("默认 100%，加减各走一档，按 0 回到 100%", () => {
		clickOpener();
		const percent = (): string | null | undefined =>
			document.querySelector(".image-preview-scale")?.textContent;
		expect(percent()).toBe("100%");

		clickButton("放大");
		expect(percent()).toBe("125%");

		clickButton("缩小");
		expect(percent()).toBe("100%");

		clickButton("放大");
		pressKey("0");
		expect(percent()).toBe("100%");
	});

	it("键盘 + 与 - 同样生效", () => {
		clickOpener();
		pressKey("+");
		expect(document.querySelector(".image-preview-scale")?.textContent).toBe("125%");
		pressKey("-");
		expect(document.querySelector(".image-preview-scale")?.textContent).toBe("100%");
	});
});

describe("控件只有两簇", () => {
	it("缩放条上是减、百分比与加，右上角是下载与关闭", () => {
		clickOpener();
		expect(document.querySelectorAll(".image-preview-zoom")).toHaveLength(1);
		expect(document.querySelectorAll(".image-preview-actions")).toHaveLength(1);
		// 顺序照着 DOM：右上角那簇在前，底部缩放条在后
		expect(buttonLabels()).toEqual(["保存图片", "关闭", "缩小", "放大"]);
	});

	it("单张与多张的按钮一样多：翻页只在方向键上", () => {
		clickOpener();
		const many = buttonLabels().length;
		unmount();
		mount(
			createElement(
				ImagePreviewProvider,
				null,
				createElement(Opener, { items: [ITEMS[0] as ImagePreviewItem] }),
			),
		);
		clickOpener();
		expect(buttonLabels()).toHaveLength(many);
	});
});

describe("多图翻页", () => {
	it("方向键能翻并绕回", () => {
		clickOpener();
		pressKey("ArrowLeft");
		expect(shownImage()?.getAttribute("src")).toBe(ITEMS[1]?.src);
		pressKey("ArrowRight");
		expect(shownImage()?.getAttribute("src")).toBe(ITEMS[0]?.src);
	});
});

describe("View Transitions", () => {
	/** 装一个假的 `startViewTransition`：同步跑更新回调，并记下调用次数。 */
	function stubTransition(): { calls: number } {
		const counter = { calls: 0 };
		Object.defineProperty(document, "startViewTransition", {
			configurable: true,
			value: (update: () => void) => {
				counter.calls += 1;
				update();
				return {
					finished: Promise.resolve(),
					ready: Promise.resolve(),
					updateCallbackDone: Promise.resolve(),
				};
			},
		});
		return counter;
	}

	it("浏览器支持时用 View Transitions 打开", () => {
		const counter = stubTransition();
		clickOpener();
		expect(counter.calls).toBe(1);
		expect(dialog()).not.toBeNull();
	});

	it("减动效时直接切换，不碰 View Transitions", () => {
		const counter = stubTransition();
		document.documentElement.dataset.motion = "reduced";
		clickOpener();
		expect(counter.calls).toBe(0);
		expect(dialog()).not.toBeNull();
		clickButton("关闭");
		expect(counter.calls).toBe(0);
		expect(dialog()).toBeNull();
	});

	it("没有 startViewTransition 时直接切换", () => {
		expect(typeof document.startViewTransition).not.toBe("function");
		clickOpener();
		expect(dialog()).not.toBeNull();
	});
});
