import { describe, expect, it } from "vitest";
import { patchBodyLines } from "./diff-lines.ts";

describe("diff-lines", () => {
	it("去掉文件头与 git 元信息，只留 hunk 与正文", () => {
		const patch = [
			"diff --git a/src/app.ts b/src/app.ts",
			"index 1234567..89abcde 100644",
			"--- a/src/app.ts",
			"+++ b/src/app.ts",
			"@@ -1,2 +1,3 @@",
			" const value = 1;",
			"-export { value };",
			"+export { value, other };",
			"+const other = 2;",
		].join("\n");
		expect(patchBodyLines(patch).map((line) => line.line)).toEqual([
			"@@ -1,2 +1,3 @@",
			" const value = 1;",
			"-export { value };",
			"+export { value, other };",
			"+const other = 2;",
		]);
	});

	it("增行只有新行号、删行只有旧行号，上下文两列都有", () => {
		const patch = [
			"@@ -1,2 +1,3 @@",
			" const value = 1;",
			"-export { value };",
			"+export { value, other };",
			"+const other = 2;",
		].join("\n");
		const body = patchBodyLines(patch).slice(1);
		expect(body.map((line) => [line.oldNumber, line.newNumber, line.sign, line.text])).toEqual([
			["1", "1", " ", "const value = 1;"],
			["2", "", "-", "export { value };"],
			["", "2", "+", "export { value, other };"],
			["", "3", "+", "const other = 2;"],
		]);
	});

	it("新文件与重命名只留下改动正文", () => {
		const patch = [
			"diff --git a/a.txt b/b.txt",
			"similarity index 100%",
			"rename from a.txt",
			"rename to b.txt",
		].join("\n");
		expect(patchBodyLines(patch)).toEqual([]);
	});
});
