import { describe, expect, it } from "vitest";
import { shouldShowCodeBlock } from "./code-block-state.ts";

describe("代码块门控", () => {
	it("围栏行未写完且没有正文时不出卡片", () => {
		expect(shouldShowCodeBlock({ loading: true, code: "" })).toBe(false);
		expect(shouldShowCodeBlock({ loading: true, code: undefined })).toBe(false);
	});

	it("正文非空即出卡片", () => {
		expect(shouldShowCodeBlock({ loading: true, code: "const a = 1" })).toBe(true);
	});

	it("已经结束的块总是显示", () => {
		expect(shouldShowCodeBlock({ loading: false, code: "" })).toBe(true);
		expect(shouldShowCodeBlock({ code: "" })).toBe(true);
	});
});
