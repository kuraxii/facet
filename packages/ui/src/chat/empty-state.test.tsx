import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState.tsx";

function render(cwd: string | undefined, canCreate: boolean): string {
	return renderToStaticMarkup(
		createElement(EmptyState, { cwd, canCreate, onCreate: () => {}, onAddProject: () => {} }),
	);
}

describe("空状态页", () => {
	it("有项目时说明新建会落在哪个目录", () => {
		const html = render("/work/app", true);
		expect(html).toContain("/work/app");
		expect(html).not.toMatch(/class="empty-primary"[^>]*disabled/);
	});

	it("没有项目时引导添加,新建置灰", () => {
		const html = render(undefined, true);
		expect(html).toContain("先添加一个项目");
		expect(html).toMatch(/class="empty-primary"[^>]*disabled/);
	});

	it("连接未就绪时新建置灰", () => {
		const html = render("/work/app", false);
		expect(html).toMatch(/class="empty-primary"[^>]*disabled/);
	});
});
