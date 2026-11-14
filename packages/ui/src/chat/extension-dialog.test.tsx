import type { UiPrompt } from "@facet/protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExtensionDialog } from "./ExtensionDialog.tsx";

function render(prompt: UiPrompt, canRespond = true): string {
	return renderToStaticMarkup(
		createElement(ExtensionDialog, { prompt, canRespond, onRespond: async () => {} }),
	);
}

describe("扩展交互弹窗", () => {
	it("选择包含搜索控件与原始选项", () => {
		const html = render({ kind: "select", requestId: "u1", title: "项目", options: ["项目 A", "项目 B"] });
		expect(html).toContain("<dialog");
		expect(html).toContain('type="search"');
		expect(html).toContain('aria-label="搜索选项"');
		expect(html).toContain("项目 A");
		expect(html).toContain("项目 B");
	});

	it("空选项无法确认，重复选项只展示一项", () => {
		expect(render({ kind: "select", requestId: "u1", title: "项目", options: [] })).toMatch(
			/class="dialog-primary"[^>]*disabled/,
		);
		const html = render({ kind: "select", requestId: "u2", title: "项目", options: ["A", "A"] });
		expect(html.match(/<option/g)).toHaveLength(1);
	});

	it("多行预填完整保留，扩展提供的 HTML 显示为文本", () => {
		const prefill = "  第一行\n\n<script>window.secret = true</script>\n末行  ";
		const html = render({ kind: "editor", requestId: "u1", title: "<img src=x>", prefill });
		expect(html).toContain("  第一行\n\n&lt;script&gt;window.secret = true&lt;/script&gt;\n末行  ");
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("<img src=x>");
	});

	it("viewer 与断线预览保留请求内容，不提供提交按钮", () => {
		const html = render({ kind: "confirm", requestId: "u1", title: "确认", message: "操作内容" }, false);
		expect(html).toContain("extension-preview");
		expect(html).toContain("操作内容");
		expect(html).not.toContain("<dialog");
		expect(html).not.toContain("<button");
	});

	it("确认内容与标题分别提供可访问名称，输入框保留 placeholder", () => {
		const html = render({ kind: "confirm", requestId: "u1", title: "确认", message: "操作内容" });
		expect(html).toContain("aria-labelledby=");
		expect(html).toContain("aria-describedby=");
		expect(render({ kind: "input", requestId: "u2", title: "路径", placeholder: "/work/project" })).toContain(
			'placeholder="/work/project"',
		);
	});
});
