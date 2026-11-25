/**
 * 增量测高的单元测试。
 *
 * jsdom 不做布局，所以量出来的高度与容器宽度都得自己造：这里只验流程对不对——
 * 哪些行算脏、行内尺寸写成什么、测完类有没有摘掉、宽度变了会不会全部重来。
 */
import { describe, expect, it } from "vitest";
import { forgetRowMeasure, measureStaleRows, ROW_MEASURING_CLASS } from "./row-measure.ts";

/** 造一个容器 + 若干行，宽度与行高都由调用方指定 */
function build(heights: readonly number[], width = 800): { container: HTMLElement; rows: HTMLElement[] } {
	const container = document.createElement("div");
	Object.defineProperty(container, "clientWidth", { value: width, configurable: true });
	const rows = heights.map((height) => {
		const row = document.createElement("div");
		row.className = "row";
		Object.defineProperty(row, "getBoundingClientRect", {
			value: () => ({ height }) as DOMRect,
			configurable: true,
		});
		container.append(row);
		return row;
	});
	document.body.append(container);
	return { container, rows };
}

describe("measureStaleRows", () => {
	it("把真实高度按小数写回行内尺寸（纯长度，不带 auto），并在测完摘掉临时类", () => {
		const { container, rows } = build([123.45, 67.8]);
		const result = measureStaleRows(container);
		expect(result.dirty).toBe(2);
		expect(rows[0]?.style.getPropertyValue("contain-intrinsic-block-size")).toBe("123.45px");
		expect(rows[1]?.style.getPropertyValue("contain-intrinsic-block-size")).toBe("67.8px");
		// 测完不能留着这个类，否则整行一直是 content-visibility: visible
		for (const row of rows) {
			expect(row.classList.contains(ROW_MEASURING_CLASS)).toBe(false);
		}
	});

	it("同一宽度下再测一次不量任何行", () => {
		const { container } = build([100, 200]);
		measureStaleRows(container);
		const again = measureStaleRows(container);
		expect(again.dirty).toBe(0);
	});

	it("宽度变了就全部重测", () => {
		const { container } = build([100, 200], 800);
		measureStaleRows(container);
		Object.defineProperty(container, "clientWidth", { value: 640, configurable: true });
		expect(measureStaleRows(container).dirty).toBe(2);
	});

	it("标记为脏的那一行下次会重测，且不动已经写回的高度", () => {
		const { container, rows } = build([100, 200]);
		measureStaleRows(container);
		const target = rows[1];
		expect(target).toBeDefined();
		if (target === undefined) {
			return;
		}
		forgetRowMeasure(target);
		// 只删记录：行内尺寸必须还在，否则离屏行会瞬间缩回 64px
		expect(target.style.getPropertyValue("contain-intrinsic-block-size")).toBe("200px");
		expect(measureStaleRows(container).dirty).toBe(1);
	});

	it("容器里没有行时什么都不做", () => {
		const { container } = build([]);
		expect(measureStaleRows(container).dirty).toBe(0);
	});
});
