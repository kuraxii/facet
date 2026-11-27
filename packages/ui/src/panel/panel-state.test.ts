/**
 * 右栏状态的测试。
 *
 * 只测读写、收敛与两个纯变换：读不懂的取值回落到缺省，宽度收在上下限之间，激活项永远落在
 * 已打开的标签里，旧版单标签存储能迁移过来。
 */
import { describe, expect, it } from "vitest";
import {
	clampPanelWidth,
	closePanelTab,
	DEFAULT_PANEL_STATE,
	normalizePanelState,
	openPanelTab,
	PANEL_DEFAULT_WIDTH,
	PANEL_MIN_WIDTH,
	type PanelStorage,
	type RightPanelState,
	readPanelState,
	reorderPanelTabs,
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

/** 一份展开着的状态，便于逐个字段改。 */
function state(patch: Partial<RightPanelState> = {}): RightPanelState {
	return { ...DEFAULT_PANEL_STATE, open: true, ...patch };
}

describe("readPanelState", () => {
	it("没有记录时用缺省值", () => {
		expect(readPanelState(createStorage())).toEqual(DEFAULT_PANEL_STATE);
	});

	it("缺省是收起、没有标签、420 宽", () => {
		expect(DEFAULT_PANEL_STATE).toEqual({ open: false, openTabs: [], activeTab: null, width: 420 });
		expect(PANEL_DEFAULT_WIDTH).toBe(420);
	});

	it("读回展开、已打开的标签、激活项与宽度", () => {
		const storage = createStorage({
			"facet.panel.open": "1",
			"facet.panel.tabs": '["files","terminal"]',
			"facet.panel.active": "terminal",
			"facet.panel.width": "640",
		});
		expect(readPanelState(storage)).toEqual(
			state({ openTabs: ["files", "terminal"], activeTab: "terminal", width: 640 }),
		);
	});

	it("四类工具都认，顺序与去重都按标签串来", () => {
		const storage = createStorage({
			"facet.panel.tabs": '["terminal","files","terminal","git-graph","changes"]',
		});
		const panel = readPanelState(storage);
		expect(panel.openTabs).toEqual(["terminal", "files", "git-graph", "changes"]);
		// 没有激活项记录时落到第一条
		expect(panel.activeTab).toBe("terminal");
	});

	it("旧版存下来的三标签串照原样读回，不因为新增工具而丢项", () => {
		const storage = createStorage({ "facet.panel.tabs": '["files","changes","terminal"]' });
		expect(readPanelState(storage).openTabs).toEqual(["files", "changes", "terminal"]);
	});

	it("图谱标签能读能写", () => {
		const storage = createStorage();
		writePanelState(storage, state({ openTabs: ["git-graph"], activeTab: "git-graph" }));
		expect(storage.data["facet.panel.tabs"]).toBe('["git-graph"]');
		expect(readPanelState(storage).activeTab).toBe("git-graph");
	});

	it("标签串写坏了回到空列表", () => {
		expect(readPanelState(createStorage({ "facet.panel.tabs": "设置" })).openTabs).toEqual([]);
		expect(readPanelState(createStorage({ "facet.panel.tabs": '{"files":true}' })).openTabs).toEqual([]);
		expect(readPanelState(createStorage({ "facet.panel.tabs": '["设置","diff"]' })).openTabs).toEqual([]);
	});

	it("激活项不在已打开的标签里时落到第一条", () => {
		const storage = createStorage({
			"facet.panel.tabs": '["changes"]',
			"facet.panel.active": "terminal",
		});
		expect(readPanelState(storage).activeTab).toBe("changes");
	});

	it("旧版单标签键迁移成一个已打开的标签", () => {
		const legacy = createStorage({ "facet.panel.open": "1", "facet.panel.tab": "files" });
		expect(readPanelState(legacy)).toEqual(state({ openTabs: ["files"], activeTab: "files" }));
	});

	it("有新版标签串时不再看旧键", () => {
		const storage = createStorage({
			"facet.panel.tabs": "[]",
			"facet.panel.tab": "files",
		});
		expect(readPanelState(storage).openTabs).toEqual([]);
		expect(readPanelState(storage).activeTab).toBeNull();
	});

	it("旧键读不懂时当作没有标签", () => {
		expect(readPanelState(createStorage({ "facet.panel.tab": "图钉" })).openTabs).toEqual([]);
	});

	it("读回定宽时的视口基准；读不懂就不算手动定过宽", () => {
		expect(readPanelState(createStorage({ "facet.panel.widthViewport": "1400" })).widthViewport).toBe(1400);
		for (const bad of ["", "宽", "0", "-10"]) {
			expect(
				readPanelState(createStorage({ "facet.panel.widthViewport": bad })).widthViewport,
				bad,
			).toBeUndefined();
		}
	});

	it("宽度没有上限，只收下限", () => {
		// 上限由正文的最小宽现算，落盘里留用户拖出来的宽度
		expect(readPanelState(createStorage({ "facet.panel.width": "9999" })).width).toBe(9999);
		expect(readPanelState(createStorage({ "facet.panel.width": "10" })).width).toBe(PANEL_MIN_WIDTH);
		expect(readPanelState(createStorage({ "facet.panel.width": "宽" })).width).toBe(
			DEFAULT_PANEL_STATE.width,
		);
	});
});

describe("writePanelState", () => {
	it("定宽时的视口基准一起落盘", () => {
		const storage = createStorage();
		writePanelState(storage, state({ width: 600, widthViewport: 1400 }));
		expect(storage.data["facet.panel.widthViewport"]).toBe("1400");
		expect(readPanelState(storage).widthViewport).toBe(1400);
	});

	it("写进去能读回来", () => {
		const storage = createStorage();
		const written = state({ openTabs: ["files", "changes"], activeTab: "changes", width: 600 });
		writePanelState(storage, written);
		expect(readPanelState(storage)).toEqual(written);
	});

	it("标签列表按 JSON 落盘，空列表也是一个明确的值", () => {
		const storage = createStorage();
		writePanelState(storage, state({ openTabs: [], activeTab: null }));
		expect(storage.data["facet.panel.tabs"]).toBe("[]");
		expect(storage.data["facet.panel.active"]).toBe("");
	});

	it("旧键留着也不会被复活：新版标签串已经写下来了", () => {
		const storage = createStorage({ "facet.panel.tab": "files" });
		writePanelState(storage, state({ openTabs: [], activeTab: null }));
		expect(readPanelState(storage).openTabs).toEqual([]);
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
