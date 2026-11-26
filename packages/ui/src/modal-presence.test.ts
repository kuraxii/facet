/**
 * 模态弹层退场时长计算单测。
 */
import { describe, expect, it } from "vitest";
import { modalExitDelayMs, parseModalDurationMs } from "./modal-presence.ts";

describe("parseModalDurationMs", () => {
	it("解析 ms 与 s 单位，空字符串或非正数归零", () => {
		expect(parseModalDurationMs("180ms")).toBe(180);
		expect(parseModalDurationMs(" 0.18s ")).toBe(180);
		expect(parseModalDurationMs("0ms")).toBe(0);
		expect(parseModalDurationMs("")).toBe(0);
		expect(parseModalDurationMs("-10ms")).toBe(0);
	});
});

describe("modalExitDelayMs", () => {
	it("窗口缩放或无动效时立即落定，正常环境下返回对应退场时长", () => {
		expect(modalExitDelayMs({ rawDuration: "180ms", isWindowResizing: false })).toBe(180);
		expect(modalExitDelayMs({ rawDuration: "180ms", isWindowResizing: true })).toBe(0);
		expect(modalExitDelayMs({ rawDuration: "0ms", isWindowResizing: false })).toBe(0);
	});
});
