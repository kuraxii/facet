// @vitest-environment jsdom
/**
 * 悬浮提示的收起时机。
 *
 * 浮层用的是触发元素在视口里的固定矩形，滚动之后矩形就不准了，所以任何滚动都要把它收掉；
 * 例外只有浮层自己内部的滚动——「提交概览」「工具参数全文」这两类卡片里本来就要能滚。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useHoverTip } from "./tip.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

beforeAll(() => {
	// jsdom 没有实现 pointer 捕获与布局，触发元素的矩形自己给
	Element.prototype.getBoundingClientRect = function rect(): DOMRect {
		return { left: 10, top: 20, bottom: 40, right: 100, width: 90, height: 20, x: 10, y: 20 } as DOMRect;
	};
});

afterEach(() => {
	act(() => root?.unmount());
	root = undefined;
	document.body.innerHTML = "";
	vi.useRealTimers();
});

/** 触发元素上挂的提示：与「提交概览」同一套参数（要能在浮层里接着滚） */
const probe = { trigger: null as HTMLElement | null };
const Probe: React.FC<{ label: React.ReactNode }> = ({ label }) => {
	const tip = useHoverTip({ holdOnLeave: true, flush: true });
	return (
		<>
			<button
				type="button"
				ref={(node) => {
					probe.trigger = node;
				}}
				{...tip.handlers(label)}
			>
				行
			</button>
			{tip.render()}
		</>
	);
};

/** 挂一个用提示的小组件，返回触发元素 */
function mountTip(): HTMLElement {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	act(() => root?.render(<Probe label="提交概览" />));
	if (probe.trigger === null) {
		throw new Error("触发元素没有挂上");
	}
	return probe.trigger;
}

/**
 * 让提示真的显示出来：指针进入 + 走完显示延迟。
 *
 * React 的 `onPointerEnter` 是由 `pointerover` 合成出来的，直接派发 `pointerenter` 不会被收到。
 */
function reveal(trigger: HTMLElement): void {
	act(() => {
		trigger.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: null }));
	});
	act(() => {
		vi.advanceTimersByTime(500);
	});
}

describe("悬浮提示在滚动时收起", () => {
	it("指针还压在触发元素上，滚一下也要收", () => {
		vi.useFakeTimers();
		const trigger = mountTip();
		reveal(trigger);
		expect(document.querySelector(".pop-tip")).not.toBeNull();
		act(() => {
			window.dispatchEvent(new Event("scroll"));
		});
		expect(document.querySelector(".pop-tip")).toBeNull();
	});

	it("滚动发生在哪个容器里都算（scroll 不冒泡，靠捕获阶段收）", () => {
		vi.useFakeTimers();
		const trigger = mountTip();
		const scroller = document.createElement("div");
		document.body.append(scroller);
		reveal(trigger);
		expect(document.querySelector(".pop-tip")).not.toBeNull();
		act(() => {
			scroller.dispatchEvent(new Event("scroll"));
		});
		expect(document.querySelector(".pop-tip")).toBeNull();
	});

	it("浮层自己内部的滚动不算，卡片里还能接着看", () => {
		vi.useFakeTimers();
		const trigger = mountTip();
		reveal(trigger);
		const tip = document.querySelector(".pop-tip");
		expect(tip).not.toBeNull();
		act(() => {
			tip?.dispatchEvent(new Event("scroll", { bubbles: true }));
		});
		expect(document.querySelector(".pop-tip")).not.toBeNull();
	});

	it("没收起之前滚了也不影响下一次显示", () => {
		vi.useFakeTimers();
		const trigger = mountTip();
		reveal(trigger);
		act(() => {
			window.dispatchEvent(new Event("scroll"));
		});
		act(() => {
			trigger.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
		});
		reveal(trigger);
		expect(document.querySelector(".pop-tip")).not.toBeNull();
	});
});
