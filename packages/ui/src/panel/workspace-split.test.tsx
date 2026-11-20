/**
 * 工作区两栏。
 *
 * 这里的重点只有一个：DOM 顺序就是「预览在前、索引在后」，不靠视觉翻转。键盘 Tab 与读屏
 * 走的是 DOM 顺序，翻错了顺序就等于让它们和眼睛看到的对不上。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceSplit } from "./workspace-split.tsx";

/** 挂一份两栏，预览与索引各给一个能定位的标记。 */
function render(isListCollapsed: boolean): string {
	return renderToStaticMarkup(
		createElement(WorkspaceSplit, {
			detail: createElement("span", { id: "preview" }, "PREVIEW"),
			list: createElement("span", { id: "index" }, "INDEX"),
			isListCollapsed,
		}),
	);
}

describe("工作区两栏", () => {
	it("预览在前、索引在后", () => {
		const html = render(false);
		expect(html.indexOf("PREVIEW")).toBeLessThan(html.indexOf("INDEX"));
		expect(html.indexOf("workspace-split-detail")).toBeLessThan(html.indexOf("workspace-split-list"));
	});

	it("收起时索引那一栏带上收起标记，预览仍在原位", () => {
		const html = render(true);
		expect(html).toContain("is-list-collapsed");
		expect(html.indexOf("PREVIEW")).toBeLessThan(html.indexOf("workspace-split-list"));
	});
});
