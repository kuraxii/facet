import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState.tsx";

const PROJECTS = [{ id: "p1", cwd: "/work/app", name: "custom-label", createdAt: 1 }];
const AGENTS = [
	{ id: "pi", kind: "pi" as const, name: "Pi", available: true, enabled: true, builtIn: true },
	{
		id: "antigravity",
		kind: "acp" as const,
		name: "Antigravity",
		available: true,
		enabled: true,
		builtIn: true,
	},
];

function render(cwd: string | undefined, canCreate: boolean): string {
	return renderToStaticMarkup(
		createElement(EmptyState, {
			hostName: "Local",
			cwd,
			projects: PROJECTS,
			agents: AGENTS,
			selectedAgentId: "pi",
			onSelectCwd: () => {},
			onSelectAgent: () => {},
			canCreate,
			onSend: () => {},
			onAddProject: () => {},
		}),
	);
}

describe("空状态页", () => {
	it("未选择项目时显示默认欢迎语与未选择项目", () => {
		const html = render(undefined, true);
		expect(html).toContain("嘿，我们接下来做什么?");
		expect(html).toContain("未选择项目");
	});

	it("选中项目时在欢迎语里带出项目名称", () => {
		const html = render("/work/app", true);
		expect(html).toContain("嘿，我们接下来在 app 里做什么？");
		const winHtml = render("D:\\User\\Desktop\\ZTools", true);
		expect(winHtml).toContain("嘿，我们接下来在 ZTools 里做什么？");
		expect(winHtml).not.toContain("D:\\User\\Desktop");
	});

	it("草稿为空时发送按钮置灰", () => {
		const html = render("/work/app", true);
		expect(html).toMatch(/aria-label="发送"[^>]*disabled/);
	});
});
