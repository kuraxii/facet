import { describe, expect, it } from "vitest";
import { isMarkdownPath } from "./markdown-file.ts";

describe("isMarkdownPath", () => {
	it("认常见的 Markdown 扩展名", () => {
		expect(isMarkdownPath("README.md")).toBe(true);
		expect(isMarkdownPath("docs/notes.markdown")).toBe(true);
		expect(isMarkdownPath("a/b/c.mkd")).toBe(true);
	});

	it("扩展名大小写不敏感", () => {
		expect(isMarkdownPath("README.MD")).toBe(true);
		expect(isMarkdownPath("Changelog.Markdown")).toBe(true);
	});

	it("只认最后一段扩展名", () => {
		expect(isMarkdownPath("README.md.txt")).toBe(false);
		expect(isMarkdownPath("notes.md/index.ts")).toBe(false);
	});

	it("不是 Markdown 的一律为假", () => {
		expect(isMarkdownPath("src/app.ts")).toBe(false);
		expect(isMarkdownPath("image.png")).toBe(false);
		expect(isMarkdownPath("Makefile")).toBe(false);
		expect(isMarkdownPath("x.mdx")).toBe(false);
	});

	it("点开头的文件名不当扩展名", () => {
		expect(isMarkdownPath(".md")).toBe(false);
		expect(isMarkdownPath("docs/.md")).toBe(false);
	});

	it("目录名带 markdown 字样不算", () => {
		expect(isMarkdownPath("markdown/list.ts")).toBe(false);
		expect(isMarkdownPath("markdown")).toBe(false);
	});
});
