/**
 * 分隔条宽度的夹紧口径：左右两条分隔条、读盘、落盘与拖动都走这一份。
 */
import { describe, expect, it } from "vitest";
import { clampPaneWidth, type PaneWidthBounds } from "./pane-width.ts";

const BOUNDS: PaneWidthBounds = { min: 220, max: 420, defaultWidth: 272 };

describe("夹紧分隔条宽度", () => {
	it("范围内的整数原样返回", () => {
		expect(clampPaneWidth(272, BOUNDS)).toBe(272);
		expect(clampPaneWidth(220, BOUNDS)).toBe(220);
		expect(clampPaneWidth(420, BOUNDS)).toBe(420);
	});

	it("小数四舍五入", () => {
		expect(clampPaneWidth(320.4, BOUNDS)).toBe(320);
		expect(clampPaneWidth(320.6, BOUNDS)).toBe(321);
	});

	it("低于下限的收到下限，超出上限的收到上限", () => {
		expect(clampPaneWidth(100, BOUNDS)).toBe(220);
		expect(clampPaneWidth(-40, BOUNDS)).toBe(220);
		expect(clampPaneWidth(9999, BOUNDS)).toBe(420);
	});

	it("非有限数与缺失值一律回落到默认宽度", () => {
		expect(clampPaneWidth(Number.NaN, BOUNDS)).toBe(272);
		expect(clampPaneWidth(Number.POSITIVE_INFINITY, BOUNDS)).toBe(272);
		expect(clampPaneWidth(Number.NEGATIVE_INFINITY, BOUNDS)).toBe(272);
		expect(clampPaneWidth(undefined, BOUNDS)).toBe(272);
		expect(clampPaneWidth(null, BOUNDS)).toBe(272);
		// 字符串宽度要在调用方先 parseFloat，直接传进来按读不懂处理
		expect(clampPaneWidth("300", BOUNDS)).toBe(272);
		expect(clampPaneWidth({}, BOUNDS)).toBe(272);
	});
});
