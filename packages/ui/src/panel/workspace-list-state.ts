/**
 * 工作区「预览 + 索引」两栏里索引栏的宽度。
 *
 * 变更页与提交图谱共用同一份偏好宽：两处的索引是同一件事（右侧一列文件），在一处拖出来的
 * 宽度搬到另一处不该变。宽度按这一台机器的偏好存在本地存储里，夹紧口径与左栏、右栏、文件树
 * 共用 `clampPaneWidth`。
 *
 * 三个边界各管一段：落盘与读盘收进 `[200, 480]`；拖动时的实时上限还要再受容器宽约束
 * （`workspaceListMaxWidth()`，左边至少留 `WORKSPACE_DETAIL_KEEP_WIDTH` 给预览）；样式表里
 * 还有一层 `clamp()` 兜底，右栏被拖窄时预览不会被压成一条缝。
 */

import { LAYOUT_PX } from "../layout/layout-contract.ts";
import { clampPaneWidth, type PaneWidthBounds } from "./pane-width.ts";

/** 索引栏的下限、上限与缺省宽度（px）。 */
export const WORKSPACE_LIST_MIN_WIDTH = LAYOUT_PX.workspaceList.minWidth;
export const WORKSPACE_LIST_DEFAULT_WIDTH = LAYOUT_PX.workspaceList.defaultWidth;
export const WORKSPACE_LIST_MAX_WIDTH = LAYOUT_PX.workspaceList.maxWidth;

/**
 * 索引栏再宽也要给左边预览留出的宽度（px）。
 *
 * 补丁行要放得下行号加一截代码，还要留得住横向滚动条；`panel.css` 里 `clamp()` 的第二个
 * 上限用的是同一个数。
 */
export const WORKSPACE_DETAIL_KEEP_WIDTH = LAYOUT_PX.workspaceList.detailKeepWidth;

/** 索引栏宽度的边界与回落值。 */
export const WORKSPACE_LIST_WIDTH_BOUNDS: PaneWidthBounds = {
	min: WORKSPACE_LIST_MIN_WIDTH,
	max: WORKSPACE_LIST_MAX_WIDTH,
	defaultWidth: WORKSPACE_LIST_DEFAULT_WIDTH,
};

/** 本地存储用的键。 */
const WIDTH_KEY = "facet.workspace.listWidth";

/** 读写本地存储的最小接口，测试里换成假的实现。 */
export interface WorkspaceListStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
}

/** 把宽度收进 `[200, 480]`，读不懂的数按缺省值处理。 */
export function clampWorkspaceListWidth(width: unknown): number {
	return clampPaneWidth(width, WORKSPACE_LIST_WIDTH_BOUNDS);
}

/**
 * 这一条右栏里索引栏最多能有多宽。
 *
 * 容器窄到连下限都放不下时返回下限：宁可把预览挤窄一点，也不把索引卷成看不见的一条。样式里
 * 的 `clamp()` 与拖动用的上限读同一条口径。
 */
export function workspaceListMaxWidth(containerWidth: number): number {
	if (!Number.isFinite(containerWidth)) {
		return WORKSPACE_LIST_MAX_WIDTH;
	}
	const budget = Math.floor(containerWidth - WORKSPACE_DETAIL_KEEP_WIDTH);
	return Math.min(WORKSPACE_LIST_MAX_WIDTH, Math.max(WORKSPACE_LIST_MIN_WIDTH, budget));
}

/** 从本地存储读出宽度，读不懂的项回落到缺省值。 */
export function readWorkspaceListWidth(storage: WorkspaceListStorage): number {
	return clampWorkspaceListWidth(Number.parseFloat(storage.getItem(WIDTH_KEY) ?? ""));
}

/** 写入宽度。 */
export function writeWorkspaceListWidth(storage: WorkspaceListStorage, width: number): void {
	storage.setItem(WIDTH_KEY, String(clampWorkspaceListWidth(width)));
}
