import type { UiPrompt } from "@facet/protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExtensionPromptCard } from "./ExtensionPromptCard.tsx";

function render(prompt: UiPrompt, canRespond = true): string {
	return renderToStaticMarkup(
		createElement(ExtensionPromptCard, { prompt, canRespond, onRespond: async () => {} }),
	);
}

describe("扩展交互卡片", () => {
	it("选择是单选列表，未选中时提交不可用", () => {
		const html = render({
			kind: "select",
			requestId: "u1",
			title: "接下来怎么处理？\n\n已核实的内容。",
			options: ["写入报告", "暂不修改"],
		});
		expect(html).toContain('role="radiogroup"');
		expect(html.match(/type="radio"/g)).toHaveLength(2);
		expect(html).toContain("接下来怎么处理？");
		expect(html).toContain("已核实的内容。");
		expect(html).not.toContain('type="search"');
		expect(html).toMatch(/class="extension-action is-primary"[^>]*disabled/);
	});

	it("关闭与提交按钮都在卡片底部，确认请求给正文", () => {
		const html = render({ kind: "confirm", requestId: "u2", title: "确认操作", message: "写入文件。" });
		expect(html).toContain("extension-actions");
		expect(html).toContain("关闭");
		expect(html).toContain("提交");
		expect(html).toContain("写入文件。");
		expect(html).not.toContain("<dialog");
	});

	it("重复选项只展示一项，扩展给的控制字符显示为文本", () => {
		const html = render({ kind: "select", requestId: "u3", title: "<b>标题</b>", options: ["A", "A"] });
		expect(html.match(/type="radio"/g)).toHaveLength(1);
		expect(html).toContain("&lt;b&gt;标题&lt;/b&gt;");
	});

	it("多行编辑保留完整预填内容", () => {
		const html = render({ kind: "editor", requestId: "u4", title: "编辑", prefill: "  第一行\n\n第三行  " });
		expect(html).toContain("  第一行\n\n第三行  ");
	});

	it("只读端显示预览，没有提交入口", () => {
		const html = render({ kind: "select", requestId: "u5", title: "选择", options: ["A", "B"] }, false);
		expect(html).toContain("is-preview");
		expect(html).not.toContain("<button");
		expect(html).toContain("A");
	});
});
