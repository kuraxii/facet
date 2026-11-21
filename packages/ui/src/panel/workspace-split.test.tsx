/**
 * 工作区两栏。
 *
 * 两个重点：DOM 顺序就是「预览在前、索引在后」（键盘 Tab 与读屏走 DOM 顺序，翻错了就等于
 * 让它们和眼睛看到的对不上），以及单栏钻取停在哪一层只由 `data-view` 表达——样式据此决定
 * 显示哪一层，组件自己不做宽度判断。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WORKSPACE_SPLIT_WIDE_WIDTH_PX, WorkspaceSplit } from "./workspace-split.tsx";

/** 挂一份两栏，预览与索引各给一个能定位的标记。 */
function render(patch: { view?: "list" | "detail"; isListCollapsed?: boolean } = {}): string {
	return renderToStaticMarkup(
		createElement(WorkspaceSplit, {
			detail: createElement("span", { id: "preview" }, "PREVIEW"),
			list: createElement("span", { id: "index" }, "INDEX"),
			view: patch.view ?? "detail",
			isListCollapsed: patch.isListCollapsed ?? false,
		}),
	);
}

describe("工作区两栏", () => {
	it("预览在前、索引在后", () => {
		const html = render();
		expect(html.indexOf("PREVIEW")).toBeLessThan(html.indexOf("INDEX"));
		expect(html.indexOf("workspace-split-detail")).toBeLessThan(html.indexOf("workspace-split-list"));
	});

	it("收起时索引那一栏带上收起标记，预览仍在原位", () => {
		const html = render({ isListCollapsed: true });
		expect(html).toContain("is-list-collapsed");
		expect(html.indexOf("PREVIEW")).toBeLessThan(html.indexOf("workspace-split-list"));
	});

	it("单栏钻取停在哪一层写成 data-view", () => {
		expect(render({ view: "list" })).toContain('data-view="list"');
		expect(render({ view: "detail" })).toContain('data-view="detail"');
	});

	it("解锁两栏的宽度是个正数，与样式里的 680 同源", () => {
		expect(WORKSPACE_SPLIT_WIDE_WIDTH_PX).toBe(680);
	});
});
