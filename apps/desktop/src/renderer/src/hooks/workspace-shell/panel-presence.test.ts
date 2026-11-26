/**
 * 右栏开关状态机与 CSS 时长解析的单测。
 */
import { describe, expect, it } from "vitest";
import {
	initialPanelPresence,
	parseCssDurationMs,
	settlePanelPresence,
	shouldSkipPanelTransition,
	transitionPanelPresence,
} from "./panel-presence.ts";

describe("panel-presence 状态机", () => {
	it("初始状态区分静默打开与关闭，不触发进退场", () => {
		expect(initialPanelPresence(true)).toBe("open");
		expect(initialPanelPresence(false)).toBe("closed");
	});

	it("打开、关闭与中途反切按预期流转", () => {
		expect(transitionPanelPresence("closed", true)).toBe("entering");
		expect(settlePanelPresence("entering")).toBe("open");
		expect(transitionPanelPresence("open", false)).toBe("closing");
		expect(settlePanelPresence("closing")).toBe("closed");

		// 关到一半重新点开、开到一半重新点关
		expect(transitionPanelPresence("closing", true)).toBe("entering");
		expect(transitionPanelPresence("entering", false)).toBe("closing");

		// 幂等分支保持原状
		expect(transitionPanelPresence("open", true)).toBe("open");
		expect(transitionPanelPresence("closed", false)).toBe("closed");
		expect(settlePanelPresence("open")).toBe("open");
		expect(settlePanelPresence("closed")).toBe("closed");
	});
});

describe("CSS 时长解析与跳过条件", () => {
	it("支持 ms 与 s，异常值归零", () => {
		expect(parseCssDurationMs("320ms")).toBe(320);
		expect(parseCssDurationMs(" 0.32s ")).toBe(320);
		expect(parseCssDurationMs("0ms")).toBe(0);
		expect(parseCssDurationMs("-10ms")).toBe(0);
		expect(parseCssDurationMs("")).toBe(0);
	});

	it("时长归零、缩放冻结或拖收预览期间立即跳过", () => {
		expect(
			shouldSkipPanelTransition({ durationMs: 320, isWindowResizing: false, isDragCollapsed: false }),
		).toBe(false);
		expect(
			shouldSkipPanelTransition({ durationMs: 0, isWindowResizing: false, isDragCollapsed: false }),
		).toBe(true);
		expect(
			shouldSkipPanelTransition({ durationMs: 320, isWindowResizing: true, isDragCollapsed: false }),
		).toBe(true);
		expect(
			shouldSkipPanelTransition({ durationMs: 320, isWindowResizing: false, isDragCollapsed: true }),
		).toBe(true);
	});
});
