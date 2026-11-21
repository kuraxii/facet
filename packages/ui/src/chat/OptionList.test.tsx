/**
 * 候选列表：高亮跟随滚动。
 *
 * jsdom 不做布局，所以这里给容器和每行补上矩形、可视高度与一个可写的 `scrollTop`，
 * 模拟「十行装在 240px 高的盒子里」这一版式；滚动本身只改容器自己的 `scrollTop`。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { OptionList, scrollTopToReveal } from "./OptionList.tsx";

// React 19 的 act 只在测试环境里开关作批处理，这个开关是 React 的约定
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 造一份「顶边在 top、高 height」的矩形，补布局给 jsdom 用。 */
function rectAt(top: number, height: number): DOMRect {
	const left = 0;
	const width = 240;
	return {
		x: left,
		y: top,
		top,
		left,
		width,
		height,
		bottom: top + height,
		right: left + width,
		toJSON: () => ({}),
	} as DOMRect;
}

/** 一条候选。 */
interface Row {
	key: string;
	label: string;
}

const ROWS: Row[] = Array.from({ length: 10 }, (_, index) => ({
	key: `r${String(index)}`,
	label: `第 ${String(index + 1)} 条`,
}));

/** 挂一棵候选列表，返回容器与列表本身。 */
function mount(activeIndex: number | null): { container: HTMLElement; list: HTMLElement; root: Root } {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	act(() => {
		root.render(listElement(activeIndex));
	});
	const list = container.querySelector<HTMLElement>(".cmd-pop");
	if (list === null) {
		throw new Error("列表没有渲染出来");
	}
	return { container, list, root };
}

/** 一次渲染产出的元素树。 */
function listElement(activeIndex: number | null): ReactElement {
	return createElement(OptionList<Row>, {
		items: ROWS,
		keyOf: (row: Row) => row.key,
		activeIndex,
		label: "候选",
		onPick: () => {},
		renderRow: (row: Row) => createElement("span", { className: "cmd-name" }, row.label),
	});
}

/** 给列表与每行补上布局：十行各高 26，容器可视高 240。 */
function stubLayout(list: HTMLElement): { read: () => number } {
	let scrollTop = 0;
	Object.defineProperty(list, "clientHeight", { value: 240, configurable: true });
	Object.defineProperty(list, "clientTop", { value: 0, configurable: true });
	Object.defineProperty(list, "scrollTop", {
		get: () => scrollTop,
		set: (value: number) => {
			scrollTop = value;
		},
		configurable: true,
	});
	// 行的位置跟着滚动走：滚动之后上面那一行才在视口外
	list.getBoundingClientRect = () => rectAt(0, 240);
	[...list.children].forEach((row, index) => {
		(row as HTMLElement).getBoundingClientRect = () => rectAt(index * 26 - scrollTop, 26);
	});
	return { read: () => scrollTop };
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("scrollTopToReveal", () => {
	const viewport = { height: 240, scrollTop: 0 };

	it("行在可视范围里就不动", () => {
		expect(scrollTopToReveal({ top: 10, bottom: 36 }, viewport)).toBe(0);
	});

	it("行超出下沿时把容器往下推，行停在底边", () => {
		// 第 10 行：top 234，bottom 260，比 240 的可视高度多出 20
		expect(scrollTopToReveal({ top: 234, bottom: 260 }, viewport)).toBe(20);
	});

	it("行超出上沿时往回收", () => {
		expect(scrollTopToReveal({ top: -8, bottom: 18 }, { height: 240, scrollTop: 40 })).toBe(32);
	});

	it("往回滚不会滚成负值", () => {
		expect(scrollTopToReveal({ top: -8, bottom: 18 }, { height: 240, scrollTop: 4 })).toBe(0);
	});

	it("已经在可视范围里时保持当前滚动位置", () => {
		expect(scrollTopToReveal({ top: 40, bottom: 66 }, { height: 240, scrollTop: 20 })).toBe(20);
	});
});

describe("高亮跟随滚动", () => {
	it("换到看不见的那一条时，容器跟着滚过去", () => {
		const { list, root } = mount(0);
		const scroll = stubLayout(list);
		expect(scroll.read()).toBe(0);

		act(() => {
			root.render(listElement(9));
		});
		// 第 10 条的下沿 260 比可视高度 240 多出 20
		expect(scroll.read()).toBe(20);
		act(() => {
			root.unmount();
		});
	});

	it("往上回到第一条时再滚回顶部", () => {
		const { list, root } = mount(0);
		const scroll = stubLayout(list);
		act(() => {
			root.render(listElement(9));
		});
		expect(scroll.read()).toBe(20);

		act(() => {
			root.render(listElement(0));
		});
		expect(scroll.read()).toBe(0);
		act(() => {
			root.unmount();
		});
	});

	it("没有高亮时不动滚动位置", () => {
		const { list, root } = mount(null);
		const scroll = stubLayout(list);
		act(() => {
			root.render(listElement(null));
		});
		expect(scroll.read()).toBe(0);
		act(() => {
			root.unmount();
		});
	});
});
