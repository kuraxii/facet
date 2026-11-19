import { describe, expect, it } from "vitest";
import { wordRangeAt } from "./word.ts";

describe("双击选词的范围", () => {
	it("点在词中间取整个词", () => {
		expect(wordRangeAt("const answer = 42;", 8)).toEqual({ from: 6, to: 12 });
	});

	it("点在词首与词尾同样取整个词", () => {
		expect(wordRangeAt("const answer = 42;", 6)).toEqual({ from: 6, to: 12 });
		expect(wordRangeAt("const answer = 42;", 11)).toEqual({ from: 6, to: 12 });
	});

	it("点在词尾右侧的标点上时取左边那个词", () => {
		expect(wordRangeAt("*.tsbuildinfo", 2)).toEqual({ from: 2, to: 13 });
		expect(wordRangeAt("foo.bar()", 3)).toEqual({ from: 0, to: 3 });
	});

	it("数字与下划线算同一个词，连字符与点分段", () => {
		expect(wordRangeAt("maple_mono_400", 12)).toEqual({ from: 0, to: 14 });
		expect(wordRangeAt("gpt-5.3-flash", 6)).toEqual({ from: 6, to: 7 });
		expect(wordRangeAt("maple_mono-cn-400", 12)).toEqual({ from: 11, to: 13 });
	});

	it("汉字连成一段", () => {
		expect(wordRangeAt("读完只说一句看到了什么。", 4)).toEqual({ from: 0, to: 11 });
	});

	it("点在空白里且左边没有词时没有范围", () => {
		expect(wordRangeAt("   ", 1)).toBeUndefined();
		expect(wordRangeAt("", 0)).toBeUndefined();
	});

	it("越界的偏移夹到行内", () => {
		expect(wordRangeAt("abc", 99)).toEqual({ from: 0, to: 3 });
		expect(wordRangeAt("abc", -5)).toEqual({ from: 0, to: 3 });
	});
});
