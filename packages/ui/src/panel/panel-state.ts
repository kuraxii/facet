/**
 * 右栏（工作区）的界面状态与宽度持久化。
 *
 * 开合、已打开的标签集合与激活项仅随具体会话在内存中维护、不落盘；只有面板宽度与定宽时的
 * 视口基准按机器界面偏好保存在本地存储里，夹紧口径与左栏共用 `clampPaneWidth`。
 */

import { LAYOUT_PX } from "../layout/layout-contract.ts";
import { clampPaneWidth, type PaneWidthBounds } from "./pane-width.ts";

/**
 * 右栏的工具。
 *
 * 五者是工作区里的五类内容：文件、变更、提交图谱、终端与浏览器。
 */
export type RightPanelTab = "files" | "changes" | "git-graph" | "terminal" | "browser";

/** 单个会话关联的右栏标签页状态（仅存内存，不落盘）。 */
export interface PanelTabState {
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
}

/** 右栏宽度的持久化状态。 */
export interface PanelWidthState {
	/** 偏好宽，单位 px */
	width: number;
	/**
	 * 定下这个宽度时的视口宽，单位 px；从没手动拖过宽时是 `undefined`。
	 *
	 * 窗口缩小时右栏要先让位：有了这个数才知道「让多少」——窗口少了多少，右栏就跟着窄多少，
	 * 直到下限为止，之后才轮到正文变窄。没有它就只能按阅读上限一刀切，手动拖出来的宽度
	 * 会在窗口一动时就跳回自动值（口径见 `docs/layout.md` §3 约束 2）。
	 */
	widthViewport: number | undefined;
}

/** 右栏的完整状态（内存标签态 + 宽度态）。 */
export interface RightPanelState extends PanelTabState, PanelWidthState {}

/**
 * 宽度的默认值与下限。
 *
 * 右栏**没有固定的宽度上限**：它最宽能到多少由「视口宽 − 正文最小可用宽 − 左栏」现算
 * （`apps/desktop/.../resolve-layout.ts` 的 `paneMaxWidth()`）。偏好宽因此只收下限，落盘
 * 里留着用户拖出来的宽度，窗口变大之后还能长回去。
 */
export const PANEL_DEFAULT_WIDTH = LAYOUT_PX.panel.defaultWidth;
export const PANEL_MIN_WIDTH = LAYOUT_PX.panel.minWidth;

/** 右栏宽度的边界与回落值：读盘、落盘与拖动共用这一份。上限交给正文的宽度约束。 */
export const PANEL_WIDTH_BOUNDS: PaneWidthBounds = {
	min: PANEL_MIN_WIDTH,
	max: Number.POSITIVE_INFINITY,
	defaultWidth: PANEL_DEFAULT_WIDTH,
};

/** 缺省的会话级标签页状态：收起、没有打开任何标签。 */
export const DEFAULT_PANEL_TAB_STATE: PanelTabState = {
	open: false,
	openTabs: [],
	activeTab: null,
};

/** 缺省状态：收起、一个标签都没开、420 宽。 */
export const DEFAULT_PANEL_STATE: RightPanelState = {
	...DEFAULT_PANEL_TAB_STATE,
	width: PANEL_DEFAULT_WIDTH,
	widthViewport: undefined,
};

/** 合法的工具取值；顺序即启动清单与 `+` 菜单的顺序。 */
export const PANEL_TABS: readonly RightPanelTab[] = ["files", "changes", "git-graph", "terminal", "browser"];

/** 本地存储用的宽度键（只存宽度，标签页集合与开合不落盘）。 */
const WIDTH_KEY = "facet.panel.width";
const WIDTH_VIEWPORT_KEY = "facet.panel.widthViewport";

/** 读写本地存储的最小接口，测试里换成假的实现。 */
export interface PanelStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
}

/** 把宽度收回上下限，读不懂的数按缺省值处理。 */
export function clampPanelWidth(width: unknown): number {
	return clampPaneWidth(width, PANEL_WIDTH_BOUNDS);
}

/**
 * 把状态收成自洽的一份。
 *
 * 唯一的约束是「激活项必须在已打开的标签里」：activate 指向一个已经关掉的标签时回落到
 * 第一条（没有标签时为 `null`）。
 */
export function normalizePanelState<T extends PanelTabState>(state: T): T {
	const active =
		state.activeTab !== null && state.openTabs.includes(state.activeTab)
			? state.activeTab
			: (state.openTabs[0] ?? null);
	return { ...state, activeTab: active };
}

/** 打开一个标签：已经开着就只切过去，没开就追加到末尾。 */
export function openPanelTab<T extends PanelTabState>(state: T, tab: RightPanelTab): T {
	const openTabs = state.openTabs.includes(tab) ? state.openTabs : [...state.openTabs, tab];
	return normalizePanelState({ ...state, openTabs, activeTab: tab });
}

/**
 * 关掉一个标签。
 *
 * 关的是当前项时把激活位交给右邻，没有右邻就交给左邻，全都关光了回落到 `null`（那时右栏
 * 停在启动清单上，不跟着收起）。右栏的展开状态与宽度都不动。
 */
export function closePanelTab<T extends PanelTabState>(state: T, tab: RightPanelTab): T {
	const index = state.openTabs.indexOf(tab);
	if (index < 0) {
		return normalizePanelState(state);
	}
	const openTabs = state.openTabs.filter((item) => item !== tab);
	const activeTab =
		state.activeTab === tab ? (openTabs[index] ?? openTabs[index - 1] ?? null) : state.activeTab;
	return normalizePanelState({ ...state, openTabs, activeTab });
}

/**
 * 重排已打开的标签顺序。
 *
 * 只保留当前已打开集合里的标签并按去重后的新顺序排列，若输入遗漏了某个已开标签则补回末尾；
 * 顺序未变化时原样返回。只改显示顺序，不碰激活项与开关状态。
 */
export function reorderPanelTabs<T extends PanelTabState>(state: T, nextOrder: readonly RightPanelTab[]): T {
	const openTabs: RightPanelTab[] = [];
	for (const tab of nextOrder) {
		if (state.openTabs.includes(tab) && !openTabs.includes(tab)) {
			openTabs.push(tab);
		}
	}
	for (const tab of state.openTabs) {
		if (!openTabs.includes(tab)) {
			openTabs.push(tab);
		}
	}
	if (
		openTabs.length === state.openTabs.length &&
		openTabs.every((tab, index) => tab === state.openTabs[index])
	) {
		return normalizePanelState(state);
	}
	return normalizePanelState({ ...state, openTabs });
}

/** 读视口宽：读不懂（空串、0、负数、非数字）就当没手动定过宽。 */
function readViewport(raw: string | null): number | undefined {
	const value = Number.parseFloat(raw ?? "");
	return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

/** 从本地存储读出右栏宽度偏好，读不懂时回落到缺省值。 */
export function readStoredPanelWidth(storage: PanelStorage): PanelWidthState {
	return {
		width: clampPanelWidth(Number.parseFloat(storage.getItem(WIDTH_KEY) ?? "")),
		widthViewport: readViewport(storage.getItem(WIDTH_VIEWPORT_KEY)),
	};
}

/** 写入右栏宽度偏好。 */
export function writeStoredPanelWidth(storage: PanelStorage, state: PanelWidthState): void {
	storage.setItem(WIDTH_KEY, String(clampPanelWidth(state.width)));
	storage.setItem(WIDTH_VIEWPORT_KEY, state.widthViewport === undefined ? "" : String(state.widthViewport));
}
