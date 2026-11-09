import { describe, expect, it } from "vitest";
import { CODE_DARK_THEME, getHighlighter, highlightLines } from "./highlighter.ts";

describe("语法高亮", () => {
	it("按行输出带颜色的片段", async () => {
		const instance = await getHighlighter();
		const lines = highlightLines(
			instance,
			"const a: number = 1;\nexport function f() {}",
			"typescript",
			CODE_DARK_THEME,
		);
		expect(lines).toBeDefined();
		expect(lines?.length).toBe(2);
		const colors = new Set(lines?.flatMap((line) => line.tokens.map((token) => token.color)));
		expect(colors.size).toBeGreaterThan(1);
		expect(lines?.[0]?.tokens.map((token) => token.text).join("")).toBe("const a: number = 1;");
	});

	it("同样的输入命中缓存,返回同一份结果", async () => {
		const instance = await getHighlighter();
		const first = highlightLines(instance, "let x = 1;", "typescript", CODE_DARK_THEME);
		const second = highlightLines(instance, "let x = 1;", "typescript", CODE_DARK_THEME);
		expect(second).toBe(first);
	});

	it("不认识的语言返回空,由调用方退回纯文本", async () => {
		const instance = await getHighlighter();
		expect(highlightLines(instance, "x", "notalanguage", CODE_DARK_THEME)).toBeUndefined();
	});
});
