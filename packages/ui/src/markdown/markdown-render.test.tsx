/**
 * 正文里的公式与流程图。
 *
 * 公式与流程图都由 markstream 渲染：这里验容器有没有出来、坏输入会不会把整段正文带崩。
 * 公式的排版要等浏览器里的排版器，服务端渲染停在加载态，所以只断言容器。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown.tsx";

function render(text: string): string {
	return renderToStaticMarkup(createElement(Markdown, { text, isStreaming: false }));
}

describe("公式与流程图", () => {
	it("块级公式有容器", () => {
		expect(render("$$\na^2+b^2=c^2\n$$")).toContain("math-block");
	});

	it("行内公式有容器", () => {
		expect(render("行内 $a^2+b^2$ 结束")).toContain("math-inline");
	});

	it("mermaid 围栏有容器", () => {
		expect(render("```mermaid\ngraph TD\nA-->B\n```")).toContain("mermaid-block");
	});

	it("写坏的公式与流程图不让正文渲染失败", () => {
		const broken = render("$$\n\\notacommand{$\n$$\n\n```mermaid\n这不是流程图\n```\n\n后面的正文");
		expect(broken).toContain("math-block");
		expect(broken).toContain("mermaid-block");
		expect(broken).toContain("后面的正文");
	});
});

describe("代码块", () => {
	/** 数卡片里的行数。 */
	function codeLineCount(html: string): number {
		return html.match(/code-card-line/g)?.length ?? 0;
	}

	it("结尾的换行不再多出一行", () => {
		expect(codeLineCount(render("```ts\nconst a = 1;\n```"))).toBe(1);
		expect(codeLineCount(render("```ts\nconst a = 1;\nconst b = 2;\n```"))).toBe(2);
	});

	it("复制按钮用图标，带无障碍名", () => {
		const html = render("```ts\nconst a = 1;\n```");
		expect(html).toContain('aria-label="复制代码"');
		expect(html).toContain("<svg");
	});
});
