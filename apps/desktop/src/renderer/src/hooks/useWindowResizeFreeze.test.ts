// @vitest-environment jsdom
/**
 * 窗口缩放期间的过渡冻结。
 *
 * 三件事：`resize` 一进来就挂标记；停手 150ms 之后才摘（拖动途中会有一连串极短的停顿，
 * 立刻摘会让冻结反复开关）；卸载时清掉定时器与标记，不给下一页留一个冻住的根节点。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowResizeFreeze } from "./useWindowResizeFreeze.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ATTR = "data-window-resizing";

let root: Root | undefined;

/** 只跑这个 Hook 的组件；定义在外层，挂载时不会每次造一个新的组件类型。 */
function Probe(): null {
	useWindowResizeFreeze();
	return null;
}

/** 挂一个只跑这个 Hook 的组件。 */
function mount(): void {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	act(() => root?.render(createElement(Probe)));
}

/** 派发一次窗口缩放。 */
function resize(): void {
	act(() => {
		window.dispatchEvent(new Event("resize"));
	});
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	act(() => root?.unmount());
	root = undefined;
	document.body.innerHTML = "";
	document.documentElement.removeAttribute(ATTR);
	vi.useRealTimers();
});

describe("窗口缩放冻结", () => {
	it("缩放进来的那一刻挂上标记，停手之后才摘掉", () => {
		mount();
		expect(document.documentElement.hasAttribute(ATTR)).toBe(false);

		resize();
		expect(document.documentElement.hasAttribute(ATTR)).toBe(true);

		// 没到 150ms 还在冻着
		act(() => vi.advanceTimersByTime(100));
		expect(document.documentElement.hasAttribute(ATTR)).toBe(true);

		act(() => vi.advanceTimersByTime(60));
		expect(document.documentElement.hasAttribute(ATTR)).toBe(false);
	});

	it("连着缩放的中间停顿时不摘标记，防抖从最后一次算起", () => {
		mount();
		resize();
		act(() => vi.advanceTimersByTime(120));
		resize();

		act(() => vi.advanceTimersByTime(120));
		expect(document.documentElement.hasAttribute(ATTR)).toBe(true);

		act(() => vi.advanceTimersByTime(60));
		expect(document.documentElement.hasAttribute(ATTR)).toBe(false);
	});

	it("卸载时把标记与定时器一起清掉", () => {
		mount();
		resize();
		act(() => root?.unmount());
		root = undefined;
		expect(document.documentElement.hasAttribute(ATTR)).toBe(false);

		// 定时器已经清掉：再推进时间也不会有回调去动属性
		act(() => vi.advanceTimersByTime(500));
		expect(document.documentElement.hasAttribute(ATTR)).toBe(false);
	});
});
