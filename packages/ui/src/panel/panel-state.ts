/**
 * 右栏的界面状态。
 *
 * 这些是这一台机器上的界面偏好：是否展开、停在哪个分页、宽度多少。它们跟着渲染进程的本地
 * 存储走，不进主机设置，换一台主机也不受影响。
 */

/** 右栏的分页。 */
export type RightPanelTab = "files" | "changes";

/** 右栏的状态。 */
export interface RightPanelState {
	/** 是否展开 */
	open: boolean;
	/** 当前分页 */
	tab: RightPanelTab;
	/** 宽度，单位 px */
	width: number;
}

/** 宽度的默认值与上下限。 */
export const PANEL_DEFAULT_WIDTH = 320;
export const PANEL_MIN_WIDTH = 260;
export const PANEL_MAX_WIDTH = 480;

/** 缺省状态：默认收起，停在变更页。 */
export const DEFAULT_PANEL_STATE: RightPanelState = {
	open: false,
	tab: "changes",
	width: PANEL_DEFAULT_WIDTH,
};

/** 本地存储用的键。 */
const OPEN_KEY = "facet.panel.open";
const TAB_KEY = "facet.panel.tab";
const WIDTH_KEY = "facet.panel.width";

/** 读写本地存储的最小接口，测试里换成假的实现。 */
export interface PanelStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
}

/** 把宽度收回上下限。 */
export function clampPanelWidth(width: number): number {
	if (!Number.isFinite(width)) {
		return PANEL_DEFAULT_WIDTH;
	}
	return Math.min(Math.max(Math.round(width), PANEL_MIN_WIDTH), PANEL_MAX_WIDTH);
}

/** 从本地存储读出右栏状态，读不懂的项回落到缺省值。 */
export function readPanelState(storage: PanelStorage): RightPanelState {
	const open = storage.getItem(OPEN_KEY);
	const tab = storage.getItem(TAB_KEY);
	const width = Number.parseFloat(storage.getItem(WIDTH_KEY) ?? "");
	return {
		open: open === "1",
		tab: tab === "files" || tab === "changes" ? tab : DEFAULT_PANEL_STATE.tab,
		width: clampPanelWidth(width),
	};
}

/** 写入右栏状态。 */
export function writePanelState(storage: PanelStorage, state: RightPanelState): void {
	storage.setItem(OPEN_KEY, state.open ? "1" : "0");
	storage.setItem(TAB_KEY, state.tab);
	storage.setItem(WIDTH_KEY, String(clampPanelWidth(state.width)));
}
