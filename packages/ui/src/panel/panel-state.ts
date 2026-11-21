/**
 * 右栏（工作区）的界面状态。
 *
 * 这些是这一台机器上的界面偏好：是否展开、停在哪个分页、是不是固定在三栏里、宽度多少。
 * 它们跟着渲染进程的本地存储走，不进主机设置，换一台主机也不受影响。夹紧口径与左栏共用
 * `clampPaneWidth`。
 */

import { clampPaneWidth, type PaneWidthBounds } from "./pane-width.ts";

/**
 * 右栏的分页。
 *
 * 三者是工作区里并排的三类内容：文件、变更与终端。取值同时是本地存储里的字面量，改名要
 * 照顾旧存储，读盘时读不懂的值一律回落到缺省分页。
 */
export type RightPanelTab = "files" | "changes" | "terminal";

/** 右栏的状态。 */
export interface RightPanelState {
	/** 是否展开 */
	open: boolean;
	/** 当前分页 */
	tab: RightPanelTab;
	/**
	 * 是否固定在正文右侧平铺。
	 *
	 * `true`：占 Grid 第 3 列，中档超预算时与左栏互斥折叠；`false`：不占列，展开时是一层
	 * 盖住正文的全高抽屉（口径见 `docs/layout.md` §2「图钉」）。
	 */
	pinned: boolean;
	/** 宽度，单位 px */
	width: number;
}

/**
 * 宽度的默认值与下限。
 *
 * 右栏**没有固定的宽度上限**：它最宽能到多少由「视口宽 − 正文最小可用宽 − 左栏」现算
 * （`apps/desktop/.../resolve-layout.ts` 的 `paneMaxWidth()`）。偏好宽因此只收下限，落盘
 * 里留着用户拖出来的宽度，窗口变大之后还能长回去。
 */
export const PANEL_DEFAULT_WIDTH = 520;
export const PANEL_MIN_WIDTH = 360;

/** 右栏宽度的边界与回落值：读盘、落盘与拖动共用这一份。上限交给正文的宽度约束。 */
export const PANEL_WIDTH_BOUNDS: PaneWidthBounds = {
	min: PANEL_MIN_WIDTH,
	max: Number.POSITIVE_INFINITY,
	defaultWidth: PANEL_DEFAULT_WIDTH,
};

/** 缺省状态：默认收起、固定在三栏里，停在变更页。 */
export const DEFAULT_PANEL_STATE: RightPanelState = {
	open: false,
	tab: "changes",
	pinned: true,
	width: PANEL_DEFAULT_WIDTH,
};

/** 合法的分页取值，读盘时用它判定。 */
const TABS: readonly RightPanelTab[] = ["files", "changes", "terminal"];

/** 本地存储用的键。 */
const OPEN_KEY = "facet.panel.open";
const TAB_KEY = "facet.panel.tab";
const WIDTH_KEY = "facet.panel.width";
const PINNED_KEY = "facet.panel.pinned";

/** 读写本地存储的最小接口，测试里换成假的实现。 */
export interface PanelStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
}

/** 把宽度收回上下限，读不懂的数按缺省值处理。 */
export function clampPanelWidth(width: unknown): number {
	return clampPaneWidth(width, PANEL_WIDTH_BOUNDS);
}

/** 读一个分页；不是三个合法取值之一时回落到缺省分页。 */
function readTab(raw: string | null): RightPanelTab {
	const found = TABS.find((tab) => tab === raw);
	return found ?? DEFAULT_PANEL_STATE.tab;
}

/**
 * 从本地存储读出右栏状态，读不懂的项回落到缺省值。
 *
 * 图钉只有显式的 `0` 算取消固定：这一项是本轮才加的，旧存储里没有它，缺省必须是「固定」，
 * 否则升级之后所有的右栏都会变成浮层。
 */
export function readPanelState(storage: PanelStorage): RightPanelState {
	return {
		open: storage.getItem(OPEN_KEY) === "1",
		tab: readTab(storage.getItem(TAB_KEY)),
		pinned: storage.getItem(PINNED_KEY) !== "0",
		width: clampPanelWidth(Number.parseFloat(storage.getItem(WIDTH_KEY) ?? "")),
	};
}

/** 写入右栏状态。 */
export function writePanelState(storage: PanelStorage, state: RightPanelState): void {
	storage.setItem(OPEN_KEY, state.open ? "1" : "0");
	storage.setItem(TAB_KEY, state.tab);
	storage.setItem(WIDTH_KEY, String(clampPanelWidth(state.width)));
	storage.setItem(PINNED_KEY, state.pinned ? "1" : "0");
}
