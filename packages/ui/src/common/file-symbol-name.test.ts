/**
 * Symbols 文件与目录名称提取单测。
 */
import { describe, expect, it } from "vitest";
import { normalizeFolderSymbolName, symbolEntryBasename } from "./file-symbol-name.ts";

describe("symbolEntryBasename", () => {
	it("从正反斜杠路径提取文件名", () => {
		expect(symbolEntryBasename("a.ts")).toBe("a.ts");
		expect(symbolEntryBasename("apps/desktop/tsconfig.json")).toBe("tsconfig.json");
		expect(symbolEntryBasename("src\\components\\Button.tsx")).toBe("Button.tsx");
	});
});

describe("normalizeFolderSymbolName", () => {
	it("提取最后一级目录并转为小写", () => {
		expect(normalizeFolderSymbolName("Docs")).toBe("docs");
		expect(normalizeFolderSymbolName("packages/ui/Components")).toBe("components");
	});
});
