/**
 * 静默回收的闸门。
 *
 * 每一条红线都在这里钉一次：流式中不裁、跳转中不裁、十秒内有交互不裁、有选区不裁、视口停在
 * 更早的历史页不裁。放过一轮的代价只是晚五分钟，裁错的代价是用户被拽到别处去。
 */
import { describe, expect, it } from "vitest";
import {
	decideHistoryReclaim,
	IDLE_GUARD_MS,
	RECLAIM_INTERVAL_MS,
	type ReclaimGateInput,
	VIEWPORT_BUFFER_ROWS,
} from "./reclaim-gate.ts";

/** 一切都允许时的输入：50 条之外都该裁。 */
function input(overrides: Partial<ReclaimGateInput> = {}): ReclaimGateInput {
	return {
		entryCount: 300,
		retainMaxEntries: 100,
		isStreaming: false,
		isJumping: false,
		isLoadingOlder: false,
		idleMs: IDLE_GUARD_MS,
		hasSelection: false,
		isVisible: true,
		viewportHeight: 800,
		rowCount: 120,
		cutRowIndex: 20,
		firstVisibleRowIndex: 20 + VIEWPORT_BUFFER_ROWS,
		...overrides,
	};
}

describe("常量口径", () => {
	it("五分钟检查一次，静默期十秒", () => {
		expect(RECLAIM_INTERVAL_MS).toBe(5 * 60 * 1000);
		expect(IDLE_GUARD_MS).toBe(10_000);
		expect(VIEWPORT_BUFFER_ROWS).toBe(10);
	});
});

describe("decideHistoryReclaim", () => {
	it("条件都满足时裁，锚点是视口最顶那一行", () => {
		const decision = decideHistoryReclaim(input());
		expect(decision.go).toBe(true);
		expect(decision.block).toBeUndefined();
		expect(decision.anchorRowIndex).toBe(20 + VIEWPORT_BUFFER_ROWS);
	});

	it("装载量没超过两页水位时不裁", () => {
		expect(decideHistoryReclaim(input({ entryCount: 100 })).block).toBe("below-watermark");
		expect(decideHistoryReclaim(input({ entryCount: 99 })).block).toBe("below-watermark");
	});

	it("正在流式输出时不裁", () => {
		expect(decideHistoryReclaim(input({ isStreaming: true })).block).toBe("streaming");
	});

	it("正在程序化跳转时不裁", () => {
		expect(decideHistoryReclaim(input({ isJumping: true })).block).toBe("jumping");
	});

	it("正在补更早的历史时不裁", () => {
		expect(decideHistoryReclaim(input({ isLoadingOlder: true })).block).toBe("loading-older");
	});

	it("十秒内有交互就不裁，刚过静默期才裁", () => {
		expect(decideHistoryReclaim(input({ idleMs: IDLE_GUARD_MS - 1 })).block).toBe("recent-interaction");
		expect(decideHistoryReclaim(input({ idleMs: IDLE_GUARD_MS })).go).toBe(true);
	});

	it("有非空文本选区时不裁", () => {
		expect(decideHistoryReclaim(input({ hasSelection: true })).block).toBe("selection");
	});

	it("窗口不可见或滚动区没有高度时不裁", () => {
		expect(decideHistoryReclaim(input({ isVisible: false })).block).toBe("hidden");
		expect(decideHistoryReclaim(input({ viewportHeight: 0 })).block).toBe("hidden");
	});

	it("对不上行的裁剪点时不裁", () => {
		expect(decideHistoryReclaim(input({ cutRowIndex: undefined })).block).toBe("no-cut");
	});

	it("行元素还没挂上来时不裁", () => {
		expect(decideHistoryReclaim(input({ rowCount: 0, firstVisibleRowIndex: undefined })).block).toBe(
			"no-rows",
		);
	});

	it("视口还停在更早的历史页时不裁：离裁剪线不足十行就不动手", () => {
		expect(decideHistoryReclaim(input({ firstVisibleRowIndex: 20 })).block).toBe("old-page");
		expect(decideHistoryReclaim(input({ firstVisibleRowIndex: 20 + VIEWPORT_BUFFER_ROWS - 1 })).block).toBe(
			"old-page",
		);
		expect(decideHistoryReclaim(input({ firstVisibleRowIndex: 20 + VIEWPORT_BUFFER_ROWS })).go).toBe(true);
	});

	it("一眼就分开的优先级：流式压过水位以下的判断之外的其它条", () => {
		// 水位之内的判断排最前：一轮刚开始就够不着裁剪线，没必要再看别的
		expect(decideHistoryReclaim(input({ entryCount: 10, isStreaming: true })).block).toBe("below-watermark");
		// 其余按「状态 → 交互 → 布局」的顺序
		expect(decideHistoryReclaim(input({ isStreaming: true, idleMs: 0 })).block).toBe("streaming");
		expect(decideHistoryReclaim(input({ idleMs: 0, hasSelection: true })).block).toBe("recent-interaction");
	});
});
