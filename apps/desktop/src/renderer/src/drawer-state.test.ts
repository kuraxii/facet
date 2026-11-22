/**
 * 窄档侧栏抽屉的 Escape 归属与外壳类名。
 *
 * Escape 的归属由纯函数判定，这里只测判定；抽屉本身几时开几时关在 `useDrawerFocus` 的用例里。
 */
import { describe, expect, it } from "vitest";
import { shellClassName, shouldCloseDrawerOnEscape } from "./drawer-state.ts";

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

describe("外壳类名", () => {
	it("窄档开着抽屉时给 has-drawer", () => {
		expect(shellClassName({ isSidebarOpen: false, isDrawerOpen: true, isNarrow: true })).toBe(
			"shell has-drawer",
		);
	});

	it("宽档不认抽屉", () => {
		expect(shellClassName({ isSidebarOpen: true, isDrawerOpen: true, isNarrow: false })).toBe(
			"shell is-sb-open",
		);
	});

	it("侧栏可见时给 is-sb-open", () => {
		expect(shellClassName({ isSidebarOpen: true, isDrawerOpen: false, isNarrow: true })).toBe(
			"shell is-sb-open",
		);
		expect(shellClassName({ isSidebarOpen: false, isDrawerOpen: false, isNarrow: false })).toBe("shell");
	});
});
