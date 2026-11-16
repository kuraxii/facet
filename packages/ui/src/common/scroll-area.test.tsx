/**
 * 滚动容器组件的测试。
 *
 * 覆盖类名、`--scroll-inset` 与沟槽开关：这三样决定滚动条是否贴容器边缘。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScrollArea, ScrollRow } from "./scroll-area.tsx";

describe("ScrollArea", () => {
	it("带上滚动行为的类名", () => {
		const html = renderToStaticMarkup(createElement(ScrollArea, {}, "x"));
		expect(html).toContain('class="scroll-y"');
	});

	it("类名与 inset 一起写进元素", () => {
		const html = renderToStaticMarkup(
			createElement(ScrollArea, { className: "sb-queue", inset: "var(--sidebar-edge)" }),
		);
		expect(html).toContain("scroll-y sb-queue");
		expect(html).toContain("--scroll-inset:var(--sidebar-edge)");
	});

	it("关掉沟槽时改成 auto", () => {
		const html = renderToStaticMarkup(createElement(ScrollArea, { gutter: false }));
		expect(html).toContain("--scroll-gutter:auto");
	});

	it("保留调用方给的其它属性", () => {
		const html = renderToStaticMarkup(
			createElement(ScrollArea, { "aria-label": "列表", onScroll: () => {} }),
		);
		expect(html).toContain('aria-label="列表"');
	});
});

describe("ScrollRow", () => {
	it("带上行留白的类名", () => {
		const html = renderToStaticMarkup(createElement(ScrollRow, {}, "x"));
		expect(html).toContain('class="scroll-row"');
	});

	it("可以和自己的类名并存", () => {
		const html = renderToStaticMarkup(createElement(ScrollRow, { className: "sb-row-item" }));
		expect(html).toContain('class="scroll-row sb-row-item"');
	});
});
