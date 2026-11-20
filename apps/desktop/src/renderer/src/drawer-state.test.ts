/**
 * 窄档抽屉的互斥与 Escape 归属。
 *
 * 抽屉状态是一对互斥的枚举值，不是两个布尔量；Escape 的归属由纯函数判定，这里只测判定。
 */
import { describe, expect, it } from "vitest";
import { type NarrowDrawer, shouldCloseDrawerOnEscape, toggleNarrowDrawer } from "./drawer-state.ts";

describe("窄档抽屉互斥", () => {
	it("从关着打开任一侧", () => {
		expect(toggleNarrowDrawer(undefined, "sidebar")).toBe("sidebar");
		expect(toggleNarrowDrawer(undefined, "panel")).toBe("panel");
	});

	it("点开着的那个就全关", () => {
		expect(toggleNarrowDrawer("sidebar", "sidebar")).toBeUndefined();
		expect(toggleNarrowDrawer("panel", "panel")).toBeUndefined();
	});

	it("开另一侧自动关掉原来那侧", () => {
		expect(toggleNarrowDrawer("sidebar", "panel")).toBe("panel");
		expect(toggleNarrowDrawer("panel", "sidebar")).toBe("sidebar");
	});

	it("连点一串之后仍然最多只记着一个抽屉", () => {
		let state: NarrowDrawer | undefined;
		for (const next of ["sidebar", "panel", "panel", "sidebar", "sidebar"] as const) {
			state = toggleNarrowDrawer(state, next);
			expect(state === undefined || state === "sidebar" || state === "panel").toBe(true);
		}
	});
});

describe("抽屉的 Escape 归属", () => {
	it("内层浮层没吃这次按键时由抽屉关闭", () => {
		expect(shouldCloseDrawerOnEscape({ defaultPrevented: false, hasOpenDialog: false })).toBe(true);
	});

	it("内层浮层已 preventDefault 时抽屉不动", () => {
		expect(shouldCloseDrawerOnEscape({ defaultPrevented: true, hasOpenDialog: false })).toBe(false);
	});

	it("原生弹窗开着时抽屉不动", () => {
		expect(shouldCloseDrawerOnEscape({ defaultPrevented: false, hasOpenDialog: true })).toBe(false);
	});

	it("两种内层同时存在时同样不动", () => {
		expect(shouldCloseDrawerOnEscape({ defaultPrevented: true, hasOpenDialog: true })).toBe(false);
	});
});
