/**
 * 左侧栏宽度。
 *
 * 与右栏一样属于这一台机器上的界面偏好，跟着渲染进程的本地存储走，不进主机设置。
 * 夹紧口径与右栏共用 `clampPaneWidth`。
 */

import { LAYOUT_PX } from "../layout/layout-contract.ts";
import { clampPaneWidth, type PaneWidthBounds } from "../panel/pane-width.ts";

/** 宽度的默认值与上下限。 */
export const SIDEBAR_DEFAULT_WIDTH = LAYOUT_PX.sidebar.defaultWidth;
export const SIDEBAR_MIN_WIDTH = LAYOUT_PX.sidebar.minWidth;
export const SIDEBAR_MAX_WIDTH = LAYOUT_PX.sidebar.maxWidth;

/** 侧栏宽度的边界与回落值：读盘、落盘与拖动共用这一份。 */
export const SIDEBAR_WIDTH_BOUNDS: PaneWidthBounds = {
	min: SIDEBAR_MIN_WIDTH,
	max: SIDEBAR_MAX_WIDTH,
	defaultWidth: SIDEBAR_DEFAULT_WIDTH,
};

/** 本地存储用的键。 */
const WIDTH_KEY = "facet.sidebar.width";

/** 读写本地存储的最小接口，测试里换成假的实现。 */
export interface SidebarStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
}

/** 把宽度收回上下限，读不懂的数按缺省值处理。 */
export function clampSidebarWidth(width: unknown): number {
	return clampPaneWidth(width, SIDEBAR_WIDTH_BOUNDS);
}

/** 从本地存储读出侧栏宽度，没存过时用缺省值。 */
export function readSidebarWidth(storage: SidebarStorage): number {
	return clampSidebarWidth(Number.parseFloat(storage.getItem(WIDTH_KEY) ?? ""));
}

/** 写入侧栏宽度。 */
export function writeSidebarWidth(storage: SidebarStorage, width: number): void {
	storage.setItem(WIDTH_KEY, String(clampSidebarWidth(width)));
}
