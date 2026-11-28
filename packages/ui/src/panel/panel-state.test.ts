/**
 * 右栏状态的测试。
 *
 * 覆盖宽度读写与收敛、标签开合与重排纯变换：右栏标签与开合仅存于内存，宽度才落盘。
 */
import { describe, expect, it } from "vitest";
import {
	clampPanelWidth,
	closePanelTab,
	DEFAULT_PANEL_STATE,
	DEFAULT_PANEL_TAB_STATE,
	normalizePanelState,
	openPanelTab,
	PANEL_DEFAULT_WIDTH,
	PANEL_MIN_WIDTH,
	type PanelStorage,
	type RightPanelState,
	readStoredPanelWidth,
	reorderPanelTabs,
	writeStoredPanelWidth,
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

/** 一份展开着的状态，便于逐个字段改。 */
function state(patch: Partial<RightPanelState> = {}): RightPanelState {
	return { ...DEFAULT_PANEL_STATE, open: true, ...patch };
}

describe("readStoredPanelWidth / writeStoredPanelWidth", () => {
	it("没有记录时用缺省宽度", () => {
		expect(readStoredPanelWidth(createStorage())).toEqual({
			width: PANEL_DEFAULT_WIDTH,
			widthViewport: undefined,
		});
		expect(DEFAULT_PANEL_TAB_STATE).toEqual({ open: false, openTabs: [], activeTab: null });
	});

	it("读回定宽时的视口基准；读不懂就不算手动定过宽", () => {
		expect(readStoredPanelWidth(createStorage({ "facet.panel.widthViewport": "1400" })).widthViewport).toBe(
			1400,
		);
		for (const bad of ["", "宽", "0", "-10"]) {
			expect(
				readStoredPanelWidth(createStorage({ "facet.panel.widthViewport": bad })).widthViewport,
				bad,
			).toBeUndefined();
		}
	});

	it("宽度没有上限，只收下限", () => {
		expect(readStoredPanelWidth(createStorage({ "facet.panel.width": "9999" })).width).toBe(9999);
		expect(readStoredPanelWidth(createStorage({ "facet.panel.width": "10" })).width).toBe(PANEL_MIN_WIDTH);
		expect(readStoredPanelWidth(createStorage({ "facet.panel.width": "宽" })).width).toBe(
			DEFAULT_PANEL_STATE.width,
		);
	});

	it("写宽度与视口基准时不写入标签页状态键", () => {
		const storage = createStorage();
		writeStoredPanelWidth(storage, { width: 600, widthViewport: 1400 });
		expect(storage.data).toEqual({
			"facet.panel.width": "600",
			"facet.panel.widthViewport": "1400",
		});
		expect(readStoredPanelWidth(storage)).toEqual({ width: 600, widthViewport: 1400 });
	});
});

describe("normalizePanelState", () => {
	it("激活项不在已打开的标签里时落到第一条", () => {
		expect(normalizePanelState(state({ openTabs: ["files"], activeTab: "terminal" })).activeTab).toBe(
			"files",
		);
	});

	it("没有标签时激活项为 null", () => {
		expect(normalizePanelState(state({ openTabs: [], activeTab: "files" })).activeTab).toBeNull();
	});
});

describe("openPanelTab", () => {
	it("没开过的标签追加到末尾并切过去", () => {
		const next = openPanelTab(state({ openTabs: ["files"], activeTab: "files" }), "terminal");
		expect(next.openTabs).toEqual(["files", "terminal"]);
		expect(next.activeTab).toBe("terminal");
	});

	it("已经开着就只切过去，不重复追加", () => {
		const next = openPanelTab(state({ openTabs: ["files", "changes"], activeTab: "changes" }), "files");
		expect(next.openTabs).toEqual(["files", "changes"]);
		expect(next.activeTab).toBe("files");
	});
});

describe("closePanelTab", () => {
	it("关掉当前项后交给右邻", () => {
		const next = closePanelTab(
			state({ openTabs: ["files", "changes", "terminal"], activeTab: "changes" }),
			"changes",
		);
		expect(next.openTabs).toEqual(["files", "terminal"]);
		expect(next.activeTab).toBe("terminal");
	});

	it("关掉图谱标签后交给右邻，跨过新增的那一类", () => {
		const next = closePanelTab(
			state({ openTabs: ["changes", "git-graph", "terminal"], activeTab: "git-graph" }),
			"git-graph",
		);
		expect(next.openTabs).toEqual(["changes", "terminal"]);
		expect(next.activeTab).toBe("terminal");
	});

	it("没有右邻时交给左邻", () => {
		const next = closePanelTab(state({ openTabs: ["files", "changes"], activeTab: "changes" }), "changes");
		expect(next.activeTab).toBe("files");
	});

	it("关的不是当前项时激活位不动", () => {
		const next = closePanelTab(state({ openTabs: ["files", "changes"], activeTab: "files" }), "changes");
		expect(next.activeTab).toBe("files");
	});

	it("关光之后回到空列表，右栏仍开着", () => {
		const next = closePanelTab(state({ openTabs: ["files"], activeTab: "files" }), "files");
		expect(next.openTabs).toEqual([]);
		expect(next.activeTab).toBeNull();
		expect(next.open).toBe(true);
	});

	it("关一个没开着的标签是空操作", () => {
		const before = state({ openTabs: ["files"], activeTab: "files" });
		expect(closePanelTab(before, "terminal")).toEqual(before);
	});
});

describe("reorderPanelTabs", () => {
	it("按给定顺序重排已打开的标签，保留激活项与宽度", () => {
		const before = state({
			openTabs: ["files", "changes", "git-graph", "terminal"],
			activeTab: "changes",
			width: 560,
		});
		const next = reorderPanelTabs(before, ["terminal", "changes", "files", "git-graph"]);
		expect(next.openTabs).toEqual(["terminal", "changes", "files", "git-graph"]);
		expect(next.activeTab).toBe("changes");
		expect(next.width).toBe(560);
	});

	it("过滤未打开与重复标签，遗漏的已开标签补回末尾", () => {
		const before = state({ openTabs: ["files", "changes", "terminal"], activeTab: "files" });
		const next = reorderPanelTabs(before, ["terminal", "git-graph", "terminal", "files"]);
		expect(next.openTabs).toEqual(["terminal", "files", "changes"]);
	});

	it("顺序一致时不制造无意义的副本改动", () => {
		const before = state({ openTabs: ["files", "changes"], activeTab: "files" });
		expect(reorderPanelTabs(before, ["files", "changes"])).toEqual(before);
	});
});

describe("clampPanelWidth", () => {
	it("取整、收下限，不设上限", () => {
		expect(clampPanelWidth(520.6)).toBe(521);
		expect(clampPanelWidth(PANEL_MIN_WIDTH - 40)).toBe(PANEL_MIN_WIDTH);
		expect(clampPanelWidth(4000)).toBe(4000);
		expect(clampPanelWidth(Number.NaN)).toBe(DEFAULT_PANEL_STATE.width);
	});
});
