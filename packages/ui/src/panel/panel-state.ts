/**
 * 右栏（工作区）的界面状态。
 *
 * 这些是这一台机器上的界面偏好：是否展开、开着哪几个工具标签、停在哪个标签上、宽度多少。
 * 它们跟着渲染进程的本地存储走，不进主机设置，换一台主机也不受影响。夹紧口径与左栏共用
 * `clampPaneWidth`。
 */

import { clampPaneWidth, type PaneWidthBounds } from "./pane-width.ts";

/**
 * 右栏的工具。
 *
 * 四者是工作区里的四类内容：文件、变更、提交图谱与终端。取值同时是本地存储里的字面量，改名
 * 要照顾旧存储，读盘时读不懂的值一律丢掉。
 */
export type RightPanelTab = "files" | "changes" | "git-graph" | "terminal";

/** 右栏的状态。 */
export interface RightPanelState {
	/** 是否展开 */
	open: boolean;
	/**
	 * 已打开的工具标签，顺序即标签栏里的显示顺序。
	 *
	 * 可以为空：那时右栏开着但一个标签都没有，正文区给出启动清单（`WorkspaceLauncher`）。
	 */
	openTabs: readonly RightPanelTab[];
	/** 当前激活的标签；`openTabs` 为空时是 `null`，非空时一定是其中之一 */
	activeTab: RightPanelTab | null;
	/** 宽度，单位 px */
	width: number;
}

/**
 * 宽度的默认值与下限。
 *
 * 右栏**没有固定的宽度上限**：它最宽能到多少由「视口宽 − 正文最小可用宽 − 左栏」现算
 * （`apps/desktop/.../resolve-layout.ts` 的 `paneMaxWidth()`）。偏好宽因此只收下限，落盘
 * 里留着用户拖出来的宽度，窗口变大之后还能长回去。
 *
 * 下限与缺省比三栏时期更窄：单栏钻取（`< 680px`）把索引与预览叠成一层，`420px` 也能读得
 * 下去，缺省因此取 `420`。
 */
export const PANEL_DEFAULT_WIDTH = 420;
export const PANEL_MIN_WIDTH = 300;

/** 右栏宽度的边界与回落值：读盘、落盘与拖动共用这一份。上限交给正文的宽度约束。 */
export const PANEL_WIDTH_BOUNDS: PaneWidthBounds = {
	min: PANEL_MIN_WIDTH,
	max: Number.POSITIVE_INFINITY,
	defaultWidth: PANEL_DEFAULT_WIDTH,
};

/** 缺省状态：收起、一个标签都没开。 */
export const DEFAULT_PANEL_STATE: RightPanelState = {
	open: false,
	openTabs: [],
	activeTab: null,
	width: PANEL_DEFAULT_WIDTH,
};

/** 合法的工具取值，读盘时用它判定；顺序即启动清单与 `+` 菜单的顺序。 */
export const PANEL_TABS: readonly RightPanelTab[] = ["files", "changes", "git-graph", "terminal"];

/** 本地存储用的键。 */
const OPEN_KEY = "facet.panel.open";
const TABS_KEY = "facet.panel.tabs";
const ACTIVE_KEY = "facet.panel.active";
const WIDTH_KEY = "facet.panel.width";
/**
 * 三栏时期的单标签键。
 *
 * 只读不写：读到它而 `facet.panel.tabs` 还不存在时，迁移成「开着这一个标签」。之后再也
 * 不碰它，用户把标签关光了也不会被它复活。
 */
const LEGACY_TAB_KEY = "facet.panel.tab";

/** 读写本地存储的最小接口，测试里换成假的实现。 */
export interface PanelStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
}

/** 把宽度收回上下限，读不懂的数按缺省值处理。 */
export function clampPanelWidth(width: unknown): number {
	return clampPaneWidth(width, PANEL_WIDTH_BOUNDS);
}

/** 这个值是不是一个合法的工具。 */
function isTab(value: unknown): value is RightPanelTab {
	return PANEL_TABS.some((tab) => tab === value);
}

/**
 * 把状态收成自洽的一份。
 *
 * 唯一的约束是「激活项必须在已打开的标签里」：activate 指向一个已经关掉的标签时回落到
 * 第一条（没有标签时为 `null`）。读盘与改状态都经过它，界面因此不会拿到一个开着却不指向
 * 任何标签的激活项。
 */
export function normalizePanelState(state: RightPanelState): RightPanelState {
	const active =
		state.activeTab !== null && state.openTabs.includes(state.activeTab)
			? state.activeTab
			: (state.openTabs[0] ?? null);
	return { ...state, activeTab: active };
}

/** 打开一个标签：已经开着就只切过去，没开就追加到末尾。 */
export function openPanelTab(state: RightPanelState, tab: RightPanelTab): RightPanelState {
	const openTabs = state.openTabs.includes(tab) ? state.openTabs : [...state.openTabs, tab];
	return normalizePanelState({ ...state, openTabs, activeTab: tab });
}

/**
 * 关掉一个标签。
 *
 * 关的是当前项时把激活位交给右邻，没有右邻就交给左邻，全都关光了回落到 `null`（那时右栏
 * 停在启动清单上，不跟着收起）。右栏的展开状态与宽度都不动。
 */
export function closePanelTab(state: RightPanelState, tab: RightPanelTab): RightPanelState {
	const index = state.openTabs.indexOf(tab);
	if (index < 0) {
		return normalizePanelState(state);
	}
	const openTabs = state.openTabs.filter((item) => item !== tab);
	const activeTab =
		state.activeTab === tab ? (openTabs[index] ?? openTabs[index - 1] ?? null) : state.activeTab;
	return normalizePanelState({ ...state, openTabs, activeTab });
}

/** 读标签串：必须是 JSON 数组，元素按出现顺序去重，读不懂的项丢掉。 */
function readTabs(raw: string | null): readonly RightPanelTab[] | undefined {
	if (raw === null) {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!Array.isArray(parsed)) {
		return undefined;
	}
	const tabs: RightPanelTab[] = [];
	for (const item of parsed) {
		if (isTab(item) && !tabs.includes(item)) {
			tabs.push(item);
		}
	}
	return tabs;
}

/** 读激活项；不在已打开的标签里时交给 `normalizePanelState` 回落。 */
function readActive(raw: string | null): RightPanelTab | null {
	return isTab(raw) ? raw : null;
}

/**
 * 从本地存储读出右栏状态，读不懂的项回落到缺省值。
 *
 * 旧版单标签键只在 `facet.panel.tabs` 缺失或读不懂时才看：三栏时期的存储里只有一个
 * `facet.panel.tab`，升级之后它对应的那个工具应该还开着。
 */
export function readPanelState(storage: PanelStorage): RightPanelState {
	const stored = readTabs(storage.getItem(TABS_KEY));
	const legacy = readActive(storage.getItem(LEGACY_TAB_KEY));
	const openTabs = stored ?? (legacy === null ? [] : [legacy]);
	return normalizePanelState({
		open: storage.getItem(OPEN_KEY) === "1",
		openTabs,
		activeTab: readActive(storage.getItem(ACTIVE_KEY)) ?? legacy,
		width: clampPanelWidth(Number.parseFloat(storage.getItem(WIDTH_KEY) ?? "")),
	});
}

/** 写入右栏状态。 */
export function writePanelState(storage: PanelStorage, state: RightPanelState): void {
	storage.setItem(OPEN_KEY, state.open ? "1" : "0");
	storage.setItem(TABS_KEY, JSON.stringify(state.openTabs));
	storage.setItem(ACTIVE_KEY, state.activeTab ?? "");
	storage.setItem(WIDTH_KEY, String(clampPanelWidth(state.width)));
}
