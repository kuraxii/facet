/**
 * 变更页刷新时机的判定。
 *
 * 覆盖四种局面：正常取、失焦攒着、超大仓暂停、回到前台补一次。
 */
import { describe, expect, it } from "vitest";
import { decideOnSignal, shouldCatchUp } from "./changes-refresh.ts";

describe("decideOnSignal", () => {
	it("看得见、在前台、仓库不大时直接取", () => {
		expect(decideOnSignal({ isVisible: true, isActive: true, isTruncated: false })).toEqual({
			refresh: true,
			defer: false,
		});
	});

	it("失焦时先攒着，不发请求", () => {
		expect(decideOnSignal({ isVisible: true, isActive: false, isTruncated: false })).toEqual({
			refresh: false,
			defer: true,
		});
	});

	it("改动过大时暂停，攒着等放行", () => {
		expect(decideOnSignal({ isVisible: true, isActive: true, isTruncated: true })).toEqual({
			refresh: false,
			defer: true,
		});
	});

	it("变更页没显示时既不取也不攒", () => {
		expect(decideOnSignal({ isVisible: false, isActive: true, isTruncated: false })).toEqual({
			refresh: false,
			defer: false,
		});
	});
});

describe("shouldCatchUp", () => {
	it("攒下过信号且回到前台时补一次", () => {
		expect(shouldCatchUp({ isVisible: true, isActive: true, hasPending: true, isTruncated: false })).toBe(
			true,
		);
	});

	it("平时切窗口什么都不做", () => {
		expect(shouldCatchUp({ isVisible: true, isActive: true, hasPending: false, isTruncated: false })).toBe(
			false,
		);
	});

	it("超大仓在重新聚焦时放行", () => {
		expect(shouldCatchUp({ isVisible: true, isActive: true, hasPending: false, isTruncated: true })).toBe(
			true,
		);
	});

	it("还没回到前台或变更页不可见时不补", () => {
		expect(shouldCatchUp({ isVisible: true, isActive: false, hasPending: true, isTruncated: true })).toBe(
			false,
		);
		expect(shouldCatchUp({ isVisible: false, isActive: true, hasPending: true, isTruncated: true })).toBe(
			false,
		);
	});
});
