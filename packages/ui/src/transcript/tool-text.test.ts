import { describe, expect, it } from "vitest";
import { foldOutput, toolStatusText, toolTarget } from "./tool-text.ts";

describe("工具状态文字", () => {
	it("成功与失败不写字,只留耗时", () => {
		expect(toolStatusText("done", 220)).toBe("220ms");
		expect(toolStatusText("done", 2400)).toBe("2.4s");
		expect(toolStatusText("failed", 40)).toBe("40ms");
	});

	it("没有耗时就不显示", () => {
		expect(toolStatusText("done", undefined)).toBe("");
		expect(toolStatusText("failed", undefined)).toBe("");
	});

	it("执行中保留状态字样", () => {
		expect(toolStatusText("running", undefined)).toBe("执行中");
		expect(toolStatusText("running", 100)).toBe("执行中");
	});
});

describe("工具参数摘要", () => {
	it("按常见字段取一句话", () => {
		expect(toolTarget({ command: "pnpm test" })).toBe("pnpm test");
		expect(toolTarget({ path: "src/config.ts" })).toBe("src/config.ts");
		expect(toolTarget({ pattern: "useEffect" })).toBe("useEffect");
	});

	it("取不到时返回空串", () => {
		expect(toolTarget(undefined)).toBe("");
		expect(toolTarget({ other: 1 })).toBe("");
	});

	it("过长的摘要截断", () => {
		const long = "a".repeat(80);
		expect(toolTarget({ command: long }).endsWith("…")).toBe(true);
	});
});

describe("长输出折叠", () => {
	it("按行数截断并报出隐藏行数", () => {
		const output = Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n");
		const folded = foldOutput(output, 10);
		expect(folded.preview.split("\n")).toHaveLength(10);
		expect(folded.hiddenLines).toBe(20);
	});

	it("短输出不折叠", () => {
		const folded = foldOutput("a\nb", 10);
		expect(folded.hiddenLines).toBe(0);
		expect(folded.preview).toBe("a\nb");
	});
});
