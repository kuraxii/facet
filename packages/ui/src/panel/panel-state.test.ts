/**
 * 右栏状态的测试。
 *
 * 只测读写与收敛：读不懂的取值回落到缺省，宽度收在上下限之间，旧存储里没有图钉时按固定。
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

	it("缺省是固定在三栏里、收起、停在变更页、520 宽", () => {
		expect(DEFAULT_PANEL_STATE).toEqual({ open: false, tab: "changes", pinned: true, width: 520 });
	});

	it("读回展开、分页、图钉与宽度", () => {
		const storage = createStorage({
			"facet.panel.open": "1",
			"facet.panel.tab": "files",
			"facet.panel.width": "640",
			"facet.panel.pinned": "0",
		});
		expect(readPanelState(storage)).toEqual({ open: true, tab: "files", pinned: false, width: 640 });
	});

	it("三类分页都认，终端也在其中", () => {
		expect(readPanelState(createStorage({ "facet.panel.tab": "terminal" })).tab).toBe("terminal");
	});

	it("分页写坏了回到缺省分页", () => {
		expect(readPanelState(createStorage({ "facet.panel.tab": "设置" })).tab).toBe(DEFAULT_PANEL_STATE.tab);
		expect(readPanelState(createStorage({ "facet.panel.tab": "diff" })).tab).toBe(DEFAULT_PANEL_STATE.tab);
	});

	it("旧存储里没有图钉这一项时按固定处理", () => {
		const legacy = createStorage({ "facet.panel.open": "1", "facet.panel.tab": "files" });
		expect(readPanelState(legacy).pinned).toBe(true);
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
		writePanelState(storage, { open: true, tab: "files", pinned: false, width: 600 });
		expect(readPanelState(storage)).toEqual({ open: true, tab: "files", pinned: false, width: 600 });
	});

	it("取消固定的值写成 0，缺省值不会被当作取消", () => {
		const storage = createStorage();
		writePanelState(storage, { ...DEFAULT_PANEL_STATE, pinned: false });
		expect(storage.data["facet.panel.pinned"]).toBe("0");
		writePanelState(storage, DEFAULT_PANEL_STATE);
		expect(storage.data["facet.panel.pinned"]).toBe("1");
	});
});

describe("clampPanelWidth", () => {
	it("取整并收在范围内", () => {
		expect(clampPanelWidth(520.6)).toBe(521);
		expect(clampPanelWidth(PANEL_MIN_WIDTH - 40)).toBe(PANEL_MIN_WIDTH);
		expect(clampPanelWidth(Number.NaN)).toBe(DEFAULT_PANEL_STATE.width);
	});
});
