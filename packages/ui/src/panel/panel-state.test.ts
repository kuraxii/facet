/**
 * 右栏状态的测试。
 *
 * 只测读写与收敛：读不懂的取值回落到缺省，宽度收在上下限之间。
 */
import { describe, expect, it } from "vitest";
import {
	clampPanelWidth,
	DEFAULT_PANEL_STATE,
	PANEL_MAX_WIDTH,
	PANEL_MIN_WIDTH,
	type PanelStorage,
	readPanelState,
	writePanelState,
} from "./panel-state.ts";

/** 内存里的本地存储。 */
function createStorage(
	initial: Record<string, string> = {},
): PanelStorage & { data: Record<string, string> } {
	const data = { ...initial };
	return {
		data,
		getItem: (key) => data[key] ?? null,
		setItem: (key, value) => {
			data[key] = value;
		},
	};
}

describe("readPanelState", () => {
	it("没有记录时用缺省值", () => {
		expect(readPanelState(createStorage())).toEqual(DEFAULT_PANEL_STATE);
	});

	it("读回展开、分页与宽度", () => {
		const storage = createStorage({
			"facet.panel.open": "1",
			"facet.panel.tab": "files",
			"facet.panel.width": "360",
		});
		expect(readPanelState(storage)).toEqual({ open: true, tab: "files", width: 360 });
	});

	it("分页写坏了回到缺省分页", () => {
		const storage = createStorage({ "facet.panel.tab": "设置" });
		expect(readPanelState(storage).tab).toBe(DEFAULT_PANEL_STATE.tab);
	});

	it("宽度超界收回范围", () => {
		expect(readPanelState(createStorage({ "facet.panel.width": "9999" })).width).toBe(PANEL_MAX_WIDTH);
		expect(readPanelState(createStorage({ "facet.panel.width": "10" })).width).toBe(PANEL_MIN_WIDTH);
		expect(readPanelState(createStorage({ "facet.panel.width": "宽" })).width).toBe(
			DEFAULT_PANEL_STATE.width,
		);
	});
});

describe("writePanelState", () => {
	it("写进去能读回来", () => {
		const storage = createStorage();
		writePanelState(storage, { open: true, tab: "files", width: 400 });
		expect(readPanelState(storage)).toEqual({ open: true, tab: "files", width: 400 });
	});
});

describe("clampPanelWidth", () => {
	it("取整并收在范围内", () => {
		expect(clampPanelWidth(320.6)).toBe(321);
		expect(clampPanelWidth(PANEL_MIN_WIDTH - 40)).toBe(PANEL_MIN_WIDTH);
		expect(clampPanelWidth(Number.NaN)).toBe(DEFAULT_PANEL_STATE.width);
	});
});
