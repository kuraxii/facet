/**
 * 补丁虚拟化纯计算的单测：视觉列宽、最长行候选、拖选钉行。
 */
import { describe, expect, it } from "vitest";
import type { PatchLine } from "../transcript/diff-lines.ts";
import { visualWidth, widestLineTexts, withPinnedSpan } from "./patch-virtual.ts";

/** 造一行补丁：只需要 `text`，别处不读。 */
function patchLine(text: string): PatchLine {
	return {
		key: `k-${text}`,
		line: ` ${text}`,
		number: "1",
		oldNumber: "1",
		newNumber: "1",
		sign: " ",
		text,
	};
}

describe("visualWidth", () => {
	it("ASCII 一格、CJK 两格", () => {
		expect(visualWidth("const a = 1;", 4)).toBe(12);
		expect(visualWidth("中文注释", 4)).toBe(8);
		// 混排：3 个 ASCII + 2 个 CJK
		expect(visualWidth("abc中文", 4)).toBe(7);
	});

	it("Tab 对齐到下一个制表位", () => {
		expect(visualWidth("\t", 4)).toBe(4);
		expect(visualWidth("a\t", 4)).toBe(4);
		expect(visualWidth("ab\t", 4)).toBe(4);
		// 制表位之后继续累加
		expect(visualWidth("abcde\t", 4)).toBe(8);
		expect(visualWidth("\t\t", 4)).toBe(8);
	});

	it("空行是零列", () => {
		expect(visualWidth("", 4)).toBe(0);
	});

	it("emoji 这类代理对按一个码位算，不按 UTF-16 单元", () => {
		// "🙂" 在 UTF-16 里是两个单元，按码位算才是两格
		expect(visualWidth("🙂", 4)).toBe(2);
	});
});

describe("widestLineTexts", () => {
	it("按视觉列宽挑最宽的几行，而不是按字符数", () => {
		const lines = [
			patchLine("abcdefgh"), // 8 列
			patchLine("中文中文"), // 8 列（4 字符 × 2）
			patchLine("ab"), // 2 列
		];
		// 只要一个：最宽的并列时取先出现的那个
		expect(widestLineTexts(lines, 1, 4)).toEqual(["abcdefgh"]);
		// 要两个：两行并列最宽
		expect(widestLineTexts(lines, 2, 4)).toEqual(["abcdefgh", "中文中文"]);
	});

	it("候选按宽度降序，且不超过要求条数", () => {
		const lines = [patchLine("a"), patchLine("aaaaaaaaaa"), patchLine("aaaaa")];
		expect(widestLineTexts(lines, 2, 4)).toEqual(["aaaaaaaaaa", "aaaaa"]);
		expect(widestLineTexts(lines, 0, 4)).toEqual([]);
	});

	it("空补丁得到空候选", () => {
		expect(widestLineTexts([], 3, 4)).toEqual([]);
	});
});

describe("withPinnedSpan", () => {
	it("没有选区时原样返回", () => {
		expect(withPinnedSpan([1, 2, 3], null, 100)).toEqual([1, 2, 3]);
	});

	it("把选区覆盖的区间并进来并保持升序", () => {
		expect(withPinnedSpan([1, 10], { start: 4, end: 6 }, 100)).toEqual([1, 4, 5, 6, 10]);
	});

	it("从下往上拖也认（两端反序）", () => {
		expect(withPinnedSpan([10], { start: 6, end: 4 }, 100)).toEqual([4, 5, 6, 10]);
	});

	it("区间已经全在列表里时不重复添加", () => {
		expect(withPinnedSpan([4, 5, 6], { start: 4, end: 6 }, 100)).toEqual([4, 5, 6]);
	});

	it("超过上限只保两端，避免全选时把整份文档钉进 DOM", () => {
		expect(withPinnedSpan([1], { start: 0, end: 9999 }, 100)).toEqual([0, 1, 9999]);
	});
});
