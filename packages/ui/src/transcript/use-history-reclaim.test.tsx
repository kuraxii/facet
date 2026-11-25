// @vitest-environment jsdom
/**
 * 静默回收的接线：定时器生命周期、闸门落到真实 DOM 上的效果，以及裁完那一帧的锚点补偿。
 *
 * 时间全部用假时钟推进：五分钟的周期在真机上不可能等，但"哪一刻该触发、哪一刻不该触发"
 * 正是最容易出错的地方。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DisplayRow } from "./group.ts";
import { RECLAIM_INTERVAL_MS, VIEWPORT_BUFFER_ROWS } from "./reclaim-gate.ts";
import { type HistoryReclaimOptions, useHistoryReclaim } from "./use-history-reclaim.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement | undefined;

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	act(() => root?.unmount());
	root = undefined;
	host?.remove();
	host = undefined;
	document.body.innerHTML = "";
	vi.useRealTimers();
});

/** 一行行模型：首项标识与裁剪点对齐，判据据此把裁剪点换算成行下标。 */
function rowsOf(count: number): DisplayRow[] {
	return Array.from({ length: count }, (_, index) => ({
		kind: "user" as const,
		id: `e:u${index}`,
		items: [
			{
				kind: "message" as const,
				id: `e:u${index}`,
				entryId: `u${index}`,
				role: "user" as const,
				stopReason: undefined,
				parts: [],
				isStreaming: false,
				startedAt: undefined,
				endedAt: undefined,
			},
		],
		fork: undefined,
		counts: {
			commands: 0,
			reads: 0,
			edits: 0,
			searches: 0,
			others: 0,
			thoughts: 0,
		},
		durationMs: undefined,
		startedAt: undefined,
		isStreaming: false,
	}));
}

/** 假滚动容器：每行 100px，行 i 的顶边是 `baseTop + i * 100`。 */
function fakeScroll(rowCount: number, baseTop: number): HTMLElement {
	const element = document.createElement("div");
	element.className = "scroll";
	element.scrollTop = 0;
	Object.defineProperty(element, "clientHeight", { configurable: true, value: 800 });
	element.getBoundingClientRect = () =>
		({ top: 0, bottom: 800, left: 0, right: 600, width: 600, height: 800, x: 0, y: 0 }) as DOMRect;
	addRows(element, rowCount, baseTop);
	// 挂进文档：锚点补偿会检查 `isConnected`，脱离文档的节点在真实界面里也不该被补偿
	document.body.append(element);
	return element;
}

/** 按同样的几何往容器里补行或裁行。 */
function addRows(element: HTMLElement, rowCount: number, baseTop: number): void {
	const existing = [...element.querySelectorAll<HTMLElement>(".row")];
	const missing = rowCount - existing.length;
	for (let index = 0; index < missing; index += 1) {
		const row = document.createElement("div");
		row.className = "row";
		element.append(row);
	}
	const rows = [...element.querySelectorAll<HTMLElement>(".row")];
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		if (row === undefined) {
			continue;
		}
		const top = baseTop + index * 100;
		row.getBoundingClientRect = () =>
			({ top, bottom: top + 100, left: 0, right: 600, width: 600, height: 100, x: 0, y: top }) as DOMRect;
	}
}

/** 裁掉前 `cut` 行：DOM 里的行少掉一截，几何不变（同一次提交里还没做补偿）。 */
function dropLeadingRows(element: HTMLElement, cut: number, baseTop: number): void {
	const rows = [...element.querySelectorAll<HTMLElement>(".row")];
	for (let index = 0; index < cut; index += 1) {
		rows[index]?.remove();
	}
	addRows(element, rows.length - cut, baseTop);
}

/** 只挂一个探测组件，把选项原样交给钩子。 */
function Probe({ options }: { options: HistoryReclaimOptions }): null {
	useHistoryReclaim(options);
	return null;
}

/** 挂载并在需要时重渲染。 */
function render(options: HistoryReclaimOptions): void {
	if (host === undefined) {
		host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
	}
	act(() => root?.render(<Probe options={options} />));
}

/** 推进一段时间，让定时器有机会触发。 */
function advance(ms: number): void {
	act(() => {
		vi.advanceTimersByTime(ms);
	});
}

/** 一份能通过全部闸门的接线。 */
function options(overrides: Partial<HistoryReclaimOptions> = {}): HistoryReclaimOptions {
	return {
		scrollElement: null,
		rows: rowsOf(120),
		retainMaxEntries: 100,
		entryCount: 300,
		cutViewId: "e:u20",
		isStreaming: false,
		isLoadingOlder: false,
		sessionKey: "chat:/s1",
		onReclaim: () => undefined,
		...overrides,
	};
}

describe("定时器生命周期", () => {
	it("每五分钟检查一次，条件满足就裁", () => {
		const element = fakeScroll(120, -3000);
		const onReclaim = vi.fn();
		render(options({ scrollElement: element, onReclaim }));

		advance(RECLAIM_INTERVAL_MS - 1);
		expect(onReclaim).not.toHaveBeenCalled();
		advance(1);
		expect(onReclaim).toHaveBeenCalledTimes(1);
		advance(RECLAIM_INTERVAL_MS);
		expect(onReclaim).toHaveBeenCalledTimes(2);
	});

	it("卸载之后不再触发", () => {
		const element = fakeScroll(120, -3000);
		const onReclaim = vi.fn();
		render(options({ scrollElement: element, onReclaim }));
		act(() => root?.unmount());
		root = undefined;
		advance(RECLAIM_INTERVAL_MS * 3);
		expect(onReclaim).not.toHaveBeenCalled();
	});

	it("换会话之后只有新会话的那一只定时器在跑", () => {
		const element = fakeScroll(120, -3000);
		const onReclaim = vi.fn();
		render(options({ scrollElement: element, onReclaim }));
		advance(RECLAIM_INTERVAL_MS);
		expect(onReclaim).toHaveBeenCalledTimes(1);

		render(options({ scrollElement: element, onReclaim, sessionKey: "chat:/s2" }));
		advance(RECLAIM_INTERVAL_MS);
		// 换会话把计时重新起了一遍：这一轮只多一次，不是两次
		expect(onReclaim).toHaveBeenCalledTimes(2);
	});
});

describe("闸门落到 DOM 上", () => {
	it("流式输出期间一轮都不裁", () => {
		const element = fakeScroll(120, -3000);
		const onReclaim = vi.fn();
		render(options({ scrollElement: element, onReclaim, isStreaming: true }));
		advance(RECLAIM_INTERVAL_MS * 2);
		expect(onReclaim).not.toHaveBeenCalled();
	});

	it("补历史的请求在途时不裁", () => {
		const element = fakeScroll(120, -3000);
		const onReclaim = vi.fn();
		render(options({ scrollElement: element, onReclaim, isLoadingOlder: true }));
		advance(RECLAIM_INTERVAL_MS);
		expect(onReclaim).not.toHaveBeenCalled();
	});

	it("用户刚滚过就不裁，安静满十秒之后才裁", () => {
		const element = fakeScroll(120, -3000);
		const onReclaim = vi.fn();
		render(options({ scrollElement: element, onReclaim }));
		// 每次滚一下都把静默期顶回去：五分钟后那一次仍然在静默期里
		for (let round = 0; round < 5; round += 1) {
			advance(RECLAIM_INTERVAL_MS - 1000);
			act(() => {
				element.dispatchEvent(new Event("scroll"));
			});
		}
		expect(onReclaim).not.toHaveBeenCalled();
		// 停手满十秒之后的那一次就裁
		advance(600_000);
		expect(onReclaim).toHaveBeenCalledTimes(1);
	});

	it("视口还停在旧历史里不裁", () => {
		// 保留区从第 20 行开始，视口却停在第 12 行：离裁剪线不足十行
		const element = fakeScroll(120, 0);
		element.scrollTop = 0;
		const onReclaim = vi.fn();
		render(options({ scrollElement: element, onReclaim }));
		advance(RECLAIM_INTERVAL_MS);
		expect(onReclaim).not.toHaveBeenCalled();
	});

	it("行元素与行模型对不上时不裁", () => {
		const element = fakeScroll(90, -3000);
		const onReclaim = vi.fn();
		render(options({ scrollElement: element, onReclaim }));
		advance(RECLAIM_INTERVAL_MS);
		expect(onReclaim).not.toHaveBeenCalled();
	});

	it("不传裁剪点就不裁", () => {
		const element = fakeScroll(120, -3000);
		const onReclaim = vi.fn();
		render(options({ scrollElement: element, onReclaim, cutViewId: undefined }));
		advance(RECLAIM_INTERVAL_MS);
		expect(onReclaim).not.toHaveBeenCalled();
	});
});

describe("0px 锚点补偿", () => {
	it("裁掉视口上方的行之后，锚点行的屏幕位置不变", () => {
		const element = fakeScroll(120, -3000);
		// 行 30 的顶边正好在容器上沿；往下滚了两屏，锚点行是它
		element.scrollTop = 3000;
		const cut = 20;
		let trimmed = false;
		const onReclaim = vi.fn(() => {
			// 模拟 store 裁剪后的一次提交：前 20 行没了，几何还没补偿
			dropLeadingRows(element, cut, -3000);
			trimmed = true;
		});
		const base = options({ scrollElement: element, onReclaim, rows: rowsOf(120) });
		render(base);
		advance(RECLAIM_INTERVAL_MS);
		expect(onReclaim).toHaveBeenCalledTimes(1);

		// 提交：行模型变短，钩子在 layout effect 里把差值补回 scrollTop
		render({ ...base, rows: rowsOf(120 - cut) });
		expect(trimmed).toBe(true);
		// 视口上方少掉的 2000px 从 scrollTop 里减回去，锚点行仍贴在上沿
		expect(element.scrollTop).toBe(3000 - cut * 100);
		expect(VIEWPORT_BUFFER_ROWS).toBe(10);
	});
});
