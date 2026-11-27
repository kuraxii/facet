import { describe, expect, it } from "vitest";
import { computeListNewlineEdit } from "./list-continuation.ts";

/** 在单行模拟应用 ListNewlineEdit，返回应用后的结果字符串。 */
function applyOnLine(lineBefore: string, lineAfter = ""): string | undefined {
	const edit = computeListNewlineEdit(lineBefore, lineAfter);
	if (edit === undefined) {
		return undefined;
	}
	const full = lineBefore + lineAfter;
	return full.slice(0, edit.replaceFromLineOffset) + edit.insert + full.slice(edit.replaceToLineOffset);
}

describe("list-continuation 列表换行续写", () => {
	it("有序列表有内容时换行自动递增序号并保留缩进", () => {
		expect(applyOnLine("1. 第一步")).toBe("1. 第一步\n2. ");
		expect(applyOnLine("  9. 缩进项")).toBe("  9. 缩进项\n  10. ");
		expect(applyOnLine("1. 前半", "后半")).toBe("1. 前半\n2. 后半");
	});

	it("空的有序列表项再按换行会清除前缀退出列表", () => {
		expect(applyOnLine("2. ")).toBe("");
		expect(applyOnLine("  3. ")).toBe("");
	});

	it("无序列表有内容时续写，空项再按换行清除前缀", () => {
		expect(applyOnLine("- 项目一")).toBe("- 项目一\n- ");
		expect(applyOnLine("  * 子项")).toBe("  * 子项\n  * ");
		expect(applyOnLine("- ")).toBe("");
	});

	it("非列表行或缺少空格时不触发列表续行", () => {
		expect(computeListNewlineEdit("普通文本", "")).toBeUndefined();
		expect(computeListNewlineEdit("1.无空格", "")).toBeUndefined();
		expect(computeListNewlineEdit("v1.2.3", "")).toBeUndefined();
	});
});
