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

	it("结构化请求按题显示标签页、单选或多选与备注", () => {
		const html = render({
			kind: "form",
			requestId: "u6",
			title: "选择项目",
			questions: [
				{
					id: "p1",
					title: "选择项目",
					body: "两个候选",
					choices: [{ label: "A", description: "写入报告" }, { label: "B" }],
				},
				{ id: "p2", title: "补充", multiple: true, choices: [{ label: "X" }, { label: "Y" }] },
			],
		});
		expect(html.match(/role="tab"/g)).toHaveLength(2);
		expect(html.match(/extension-tab-dot/g)).toHaveLength(2);
		expect(html).toContain('type="radio"');
		expect(html).not.toContain('type="checkbox"');
		expect(html).toContain("写入报告");
		expect(html).toContain('placeholder="备注"');
		expect(html).not.toContain("<kbd>");
	});

	it("结构化题目显示标签、预览与自定义答案入口", () => {
		const html = render({
			kind: "form",
			requestId: "u8",
			title: "选择模板",
			questions: [
				{
					id: "p1",
					header: "模板",
					title: "选择模板",
					allowCustom: true,
					choices: [
						{ label: "空白", description: "只建目录", preview: "目录树" },
						{ label: "示例", description: "带示例代码" },
					],
				},
			],
		});
		expect(html).toContain("模板");
		expect(html).toContain("extension-preview");
		expect(html).toContain("目录树");
		expect(html).toContain("Type something.");
		expect(html).not.toContain("extension-custom-input");
	});

	it("多选题目使用复选框", () => {
		const html = render({
			kind: "form",
			requestId: "u7",
			title: "补充",
			questions: [{ id: "p1", title: "补充", multiple: true, choices: [{ label: "X" }] }],
		});
		expect(html).toContain('type="checkbox"');
		expect(html).not.toContain('type="radio"');
	});

	it("只读端显示预览，没有提交入口", () => {
		const html = render({ kind: "select", requestId: "u5", title: "选择", options: ["A", "B"] }, false);
		expect(html).toContain("is-preview");
		expect(html).not.toContain("<button");
		expect(html).toContain("A");
	});
});
