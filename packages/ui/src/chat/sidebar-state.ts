/**
 * 左侧栏宽度。
 *
 * 与右栏一样属于这一台机器上的界面偏好，跟着渲染进程的本地存储走，不进主机设置。
 */

/** 宽度的默认值与上下限。 */
export const SIDEBAR_DEFAULT_WIDTH = 272;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 420;

/** 本地存储用的键。 */
const WIDTH_KEY = "facet.sidebar.width";

/** 读写本地存储的最小接口，测试里换成假的实现。 */
export interface SidebarStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
}

/** 把宽度收回上下限，读不懂的数按缺省值处理。 */
export function clampSidebarWidth(width: number): number {
	if (!Number.isFinite(width)) {
		return SIDEBAR_DEFAULT_WIDTH;
	}
	return Math.min(Math.max(Math.round(width), SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

/** 从本地存储读出侧栏宽度，没存过时用缺省值。 */
export function readSidebarWidth(storage: SidebarStorage): number {
	return clampSidebarWidth(Number.parseFloat(storage.getItem(WIDTH_KEY) ?? ""));
}

/** 写入侧栏宽度。 */
export function writeSidebarWidth(storage: SidebarStorage, width: number): void {
	storage.setItem(WIDTH_KEY, String(clampSidebarWidth(width)));
}
