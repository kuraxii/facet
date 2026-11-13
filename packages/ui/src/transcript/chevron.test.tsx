/**
 * 展开箭头：树里收起朝右、展开朝下；卡片里收起朝下、展开朝上。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChevronIcon, TreeChevron } from "./chevron.tsx";

describe("展开箭头", () => {
	it("树里收起朝右、展开朝下", () => {
		expect(renderToStaticMarkup(createElement(TreeChevron, { isOpen: false }))).toContain("chevron-right");
		expect(renderToStaticMarkup(createElement(TreeChevron, { isOpen: true }))).toContain("chevron-down");
	});

	it("卡片里收起朝下、展开朝上", () => {
		expect(renderToStaticMarkup(createElement(ChevronIcon, { isOpen: false }))).toContain("chevron-down");
		expect(renderToStaticMarkup(createElement(ChevronIcon, { isOpen: true }))).toContain("chevron-up");
	});
});
