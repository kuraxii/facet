import { describe, expect, it } from "vitest";
import { appendQuote, quoteBlock } from "./quote.ts";

describe("引用块", () => {
	it("逐行加引用符号", () => {
		expect(quoteBlock("第一行\n第二行")).toBe("> 第一行\n> 第二行");
	});

	it("中间的空行只留引用符号", () => {
		expect(quoteBlock("第一段\n\n第二段")).toBe("> 第一段\n>\n> 第二段");
	});

	it("去掉首尾的空行", () => {
		expect(quoteBlock("\n\n第一段\n第二段\n\n")).toBe("> 第一段\n> 第二段");
	});

	it("保留行内缩进与 CRLF 之外的换行", () => {
		expect(quoteBlock("   缩进的一行\r\n第二行  ")).toBe(">    缩进的一行\n> 第二行");
	});

	it("全是空白时没有引用块", () => {
		expect(quoteBlock("  \n\n ")).toBe("");
	});
});

describe("接进草稿", () => {
	it("空草稿时引用块自成一段", () => {
		expect(appendQuote("", "被引用的文字")).toBe("> 被引用的文字");
	});

	it("草稿非空时空一行接在后面", () => {
		expect(appendQuote("我的问题", "被引用的文字")).toBe("我的问题\n\n> 被引用的文字");
	});

	it("草稿末尾已有换行时不叠出多余空行", () => {
		expect(appendQuote("我的问题\n\n", "被引用的文字")).toBe("我的问题\n\n> 被引用的文字");
	});

	it("没有可引用的内容时草稿不变", () => {
		expect(appendQuote("我的问题", "   ")).toBe("我的问题");
		expect(appendQuote("", "\n")).toBe("");
	});
});
