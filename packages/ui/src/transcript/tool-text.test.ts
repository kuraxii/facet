import { describe, expect, it } from "vitest";
import { foldOutput, scriptBody, scriptCode, toolKind, toolStatusText, toolTarget } from "./tool-text.ts";

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

	it("未执行写出来,耗时无意义", () => {
		expect(toolStatusText("skipped", undefined)).toBe("未执行");
		expect(toolStatusText("skipped", 100)).toBe("未执行");
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

describe("脚本类工具", () => {
	it("短名是 Codemode，按命令类图标显示", () => {
		expect(toolKind("codemode")).toEqual({ label: "Codemode", category: "command" });
	});

	it("摘要取脚本第一行有内容的代码，跳过空行与注释", () => {
		expect(toolTarget({ code: "\n// 先说明\nconst a = await tools.bash({ command: 'ls' });" })).toBe(
			"const a = await tools.bash({ command: 'ls' });",
		);
	});

	it("整段只有注释时摘要为空", () => {
		expect(toolTarget({ code: "// 什么都没做" })).toBe("");
	});
});

describe("脚本类工具的展开内容", () => {
	it("取整段代码，行上摘要只取第一行", () => {
		const code = "const a = 1;\nconst b = 2;";
		expect(scriptCode({ code })).toBe(code);
		expect(toolTarget({ code })).toBe("const a = 1;");
	});

	it("去掉首尾空行，代码缩进照原样保留", () => {
		expect(scriptCode({ code: "\n\n  if (a) {\n    b();\n  }\n\n" })).toBe("  if (a) {\n    b();\n  }");
	});

	it("返回正文去掉运行器加的前置信息", () => {
		const output = "Script completed\nWall time 0.1 seconds\nOutput:\n\n==> uname -r <==\n7.2.13";
		expect(scriptBody(output)).toBe("==> uname -r <==\n7.2.13");
	});

	it("失败的脚本同样去掉前置信息，保留报错正文", () => {
		const output = "Script failed\nWall time 0.0 seconds\nOutput:\nScript error:\nboom";
		expect(scriptBody(output)).toBe("Script error:\nboom");
	});

	it("没有这层前置信息时原样返回", () => {
		expect(scriptBody("普通输出")).toBe("普通输出");
	});

	it("没有代码字段时不当脚本", () => {
		expect(scriptCode({ command: "ls" })).toBeUndefined();
		expect(scriptCode("ls")).toBeUndefined();
	});
});
