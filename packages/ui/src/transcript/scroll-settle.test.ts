import { afterEach, describe, expect, it, vi } from "vitest";
import { whenScrollSettles } from "./scroll-settle.ts";

/**
 * 假滚动容器：只实现本模块用到的三件事（`scrollTop`、增删监听、`scrollend` 是否存在）。
 *
 * 用它而不是真元素，是因为 jsdom 已经带上了 `onscrollend`，真元素走不到"退回轮询"那条分支。
 */
function fakeScroller(options: { scrollEnd?: boolean } = {}) {
	const listeners = new Map<string, Set<() => void>>();
	const element = {
		scrollTop: 0,
		addEventListener: (type: string, handler: () => void): void => {
			const set = listeners.get(type) ?? new Set();
			set.add(handler);
			listeners.set(type, set);
		},
		removeEventListener: (type: string, handler: () => void): void => {
			listeners.get(type)?.delete(handler);
		},
	} as unknown as HTMLElement;
	if (options.scrollEnd === true) {
		Object.defineProperty(element, "onscrollend", { value: null });
	}
	return {
		element,
		emit: (type: string): void => {
			for (const handler of listeners.get(type) ?? []) {
				handler();
			}
		},
		count: (type: string): number => listeners.get(type)?.size ?? 0,
	};
}

const flushFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

afterEach(() => {
	vi.useRealTimers();
});

describe("whenScrollSettles", () => {
	it("有 scrollend 时只认事件，落定一次之后不再调用", () => {
		const scroller = fakeScroller({ scrollEnd: true });
		const done = vi.fn();
		whenScrollSettles(scroller.element, done);
		scroller.emit("scroll");
		expect(done).not.toHaveBeenCalled();
		scroller.emit("scrollend");
		expect(done).toHaveBeenCalledTimes(1);
		scroller.emit("scrollend");
		expect(done).toHaveBeenCalledTimes(1);
	});

	it("没有 scrollend 时退回轮询：连续两帧位置不动才算落定", async () => {
		const scroller = fakeScroller();
		const done = vi.fn();
		whenScrollSettles(scroller.element, done);
		scroller.emit("scroll");
		await flushFrame();
		expect(done).not.toHaveBeenCalled();
		scroller.emit("scroll");
		await flushFrame();
		expect(done).toHaveBeenCalledTimes(1);
	});

	it("取消之后落定也不调用，并摘掉监听", () => {
		const scroller = fakeScroller({ scrollEnd: true });
		const done = vi.fn();
		const cancel = whenScrollSettles(scroller.element, done);
		cancel();
		expect(scroller.count("scrollend")).toBe(0);
		scroller.emit("scrollend");
		expect(done).not.toHaveBeenCalled();
	});

	it("一直没有位移时由兜底时长收尾", async () => {
		vi.useFakeTimers();
		const scroller = fakeScroller({ scrollEnd: true });
		const done = vi.fn();
		whenScrollSettles(scroller.element, done, 300);
		await vi.advanceTimersByTimeAsync(299);
		expect(done).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(done).toHaveBeenCalledTimes(1);
	});
});
