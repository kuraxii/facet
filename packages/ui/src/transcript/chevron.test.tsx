/**
 * 展开箭头：树里收起朝右、展开朝下；卡片里收起朝下、展开朝上。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChevronIcon, TreeChevron } from "./chevron.tsx";

describe("展开箭头", () => {
	it("树里始终是同一枚朝右的箭头，靠 data-open 转 90°", () => {
		// 换图标是瞬切，转角是过渡：收起与展开都给 chevron-right，只有 data-open 不同
		expect(renderToStaticMarkup(createElement(TreeChevron, { isOpen: false }))).toContain("chevron-right");
		expect(renderToStaticMarkup(createElement(TreeChevron, { isOpen: false }))).toContain(
			'data-open="false"',
		);
		expect(renderToStaticMarkup(createElement(TreeChevron, { isOpen: true }))).toContain("chevron-right");
		expect(renderToStaticMarkup(createElement(TreeChevron, { isOpen: true }))).toContain('data-open="true"');
	});

	it("卡片里收起朝下、展开朝上", () => {
		expect(renderToStaticMarkup(createElement(ChevronIcon, { isOpen: false }))).toContain("chevron-down");
		expect(renderToStaticMarkup(createElement(ChevronIcon, { isOpen: true }))).toContain("chevron-up");
	});
});
