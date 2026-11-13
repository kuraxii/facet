import { describe, expect, it } from "vitest";
import {
	clampSidebarWidth,
	readSidebarWidth,
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	type SidebarStorage,
	writeSidebarWidth,
} from "./sidebar-state.ts";

function memoryStorage(
	initial: Record<string, string> = {},
): SidebarStorage & { values: Map<string, string> } {
	const values = new Map(Object.entries(initial));
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
	};
}

describe("侧栏宽度", () => {
	it("收回上下限", () => {
		expect(clampSidebarWidth(100)).toBe(SIDEBAR_MIN_WIDTH);
		expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX_WIDTH);
		expect(clampSidebarWidth(300.4)).toBe(300);
		expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
	});

	it("没存过或用的是读不懂的值时用缺省宽度", () => {
		expect(readSidebarWidth(memoryStorage())).toBe(SIDEBAR_DEFAULT_WIDTH);
		expect(readSidebarWidth(memoryStorage({ "facet.sidebar.width": "很宽" }))).toBe(SIDEBAR_DEFAULT_WIDTH);
	});

	it("写入时同样收回上下限", () => {
		const storage = memoryStorage();
		writeSidebarWidth(storage, 100);
		expect(storage.values.get("facet.sidebar.width")).toBe(String(SIDEBAR_MIN_WIDTH));
		expect(readSidebarWidth(storage)).toBe(SIDEBAR_MIN_WIDTH);
	});
});
