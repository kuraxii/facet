/**
 * 底部终端面板的界面状态。
 *
 * 与右栏同一套做法：展开与否、面板高度、上次停在哪个终端都属于这台机器上的界面偏好，
 * 存在渲染进程的本地存储里，不进主机设置。
 */

/** 面板高度的默认值与上下限，单位 px。 */
export const DOCK_DEFAULT_HEIGHT = 260;
export const DOCK_MIN_HEIGHT = 120;
/**
 * 上限按窗口高度的比例算：小窗口里 60% 已经占掉大半屏，再高就没有对话的位置了。
 */
export const DOCK_MAX_RATIO = 0.6;

/** 面板的界面状态。 */
export interface TerminalDockState {
	/** 是否展开 */
	open: boolean;
	/** 面板高度 */
	height: number;
	/** 上次停在这个终端，换主机或重开时优先回到它 */
	activeId: string | undefined;
}

/** 缺省状态：收起，高度取默认值。 */
export const DEFAULT_DOCK_STATE: TerminalDockState = {
	open: false,
	height: DOCK_DEFAULT_HEIGHT,
	activeId: undefined,
};

/** 本地存储用的键。 */
const OPEN_KEY = "facet.terminal.open";
const HEIGHT_KEY = "facet.terminal.height";
const ACTIVE_KEY = "facet.terminal.active";

/** 读写本地存储的最小接口，测试里换成假的实现。 */
export interface DockStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
}

/** 把高度收进上下限，窗口高度未知时只收下限。 */
export function clampDockHeight(height: number, viewportHeight?: number): number {
	if (!Number.isFinite(height)) {
		return DOCK_DEFAULT_HEIGHT;
	}
	const upper =
		viewportHeight === undefined || viewportHeight <= 0
			? DOCK_DEFAULT_HEIGHT * 2
			: Math.max(DOCK_MIN_HEIGHT, Math.round(viewportHeight * DOCK_MAX_RATIO));
	return Math.min(upper, Math.max(DOCK_MIN_HEIGHT, Math.round(height)));
}

/** 读出保存的界面状态；读不懂的部分各自回到缺省值。 */
export function readDockState(storage: DockStorage): TerminalDockState {
	const open = storage.getItem(OPEN_KEY);
	const height = Number(storage.getItem(HEIGHT_KEY));
	const activeId = storage.getItem(ACTIVE_KEY);
	return {
		open: open === "1",
		height: Number.isFinite(height) && height > 0 ? clampDockHeight(height) : DEFAULT_DOCK_STATE.height,
		activeId: activeId === null || activeId.length === 0 ? undefined : activeId,
	};
}

/** 写回界面状态。 */
export function writeDockState(storage: DockStorage, state: TerminalDockState): void {
	storage.setItem(OPEN_KEY, state.open ? "1" : "0");
	storage.setItem(HEIGHT_KEY, String(Math.round(state.height)));
	if (state.activeId === undefined) {
		storage.setItem(ACTIVE_KEY, "");
		return;
	}
	storage.setItem(ACTIVE_KEY, state.activeId);
}
