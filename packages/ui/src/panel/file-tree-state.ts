/**
 * 文件树的宽度。
 *
 * 文件树在 `files` 视图里与编辑器并排占位，宽度按这一台机器的偏好存在本地存储里；夹紧口径
 * 与左栏、右栏共用 `clampPaneWidth`。
 *
 * 三处边界各管一段：落盘与读盘收进 `[180, 420]`；拖动时的实时上限还要再受容器宽约束
 * （`fileTreeMaxWidth()`，右侧至少留 `EDITOR_KEEP_WIDTH` 给编辑器）；样式表里还有一层
 * `clamp()` 兜底，容器被拖窄时编辑器不会被压成 0。
 */

import { LAYOUT_PX } from "../layout/layout-contract.ts";
import { clampPaneWidth, type PaneWidthBounds } from "./pane-width.ts";

/** 悬浮文件树的下限、上限与缺省宽度（px）。 */
export const FILE_TREE_MIN_WIDTH = LAYOUT_PX.fileTree.minWidth;
export const FILE_TREE_DEFAULT_WIDTH = LAYOUT_PX.fileTree.defaultWidth;
export const FILE_TREE_MAX_WIDTH = LAYOUT_PX.fileTree.maxWidth;

/**
 * 文件树再宽也要给编辑器留出的宽度（px）。
 *
 * 并排占位时这一条是硬兜底：右栏拖到下限（`300`）时文件树让到 `180`，编辑器还剩 `120`
 * ——行号加一截代码，读得下去也点得到滚动条。`panel.css` 里 `clamp()` 的第二个上限用的是
 * 同一个数。
 */
export const EDITOR_KEEP_WIDTH = LAYOUT_PX.fileTree.editorKeepWidth;

/** 文件树宽度的边界与回落值。 */
export const FILE_TREE_WIDTH_BOUNDS: PaneWidthBounds = {
	min: FILE_TREE_MIN_WIDTH,
	max: FILE_TREE_MAX_WIDTH,
	defaultWidth: FILE_TREE_DEFAULT_WIDTH,
};

/** 本地存储用的键。 */
const WIDTH_KEY = "facet.files.treeWidth";

/** 读写本地存储的最小接口，测试里换成假的实现。 */
export interface FileTreeStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
}

/** 把宽度收进 `[180, 420]`，读不懂的数按缺省值处理。 */
export function clampFileTreeWidth(width: unknown): number {
	return clampPaneWidth(width, FILE_TREE_WIDTH_BOUNDS);
}

/**
 * 这一条右栏里文件树最多能有多宽。
 *
 * 容器本身窄到连下限都放不下时返回下限：宁可压一点编辑器，也不把文件树卷成看不见的一条。
 * 拖动用的上限与样式里的 `clamp()` 都读同一条口径。
 */
export function fileTreeMaxWidth(containerWidth: number): number {
	if (!Number.isFinite(containerWidth)) {
		return FILE_TREE_MAX_WIDTH;
	}
	const budget = Math.floor(containerWidth - EDITOR_KEEP_WIDTH);
	return Math.min(FILE_TREE_MAX_WIDTH, Math.max(FILE_TREE_MIN_WIDTH, budget));
}

/** 从本地存储读出宽度，读不懂的项回落到缺省值。 */
export function readFileTreeWidth(storage: FileTreeStorage): number {
	return clampFileTreeWidth(Number.parseFloat(storage.getItem(WIDTH_KEY) ?? ""));
}

/** 写入宽度。 */
export function writeFileTreeWidth(storage: FileTreeStorage, width: number): void {
	storage.setItem(WIDTH_KEY, String(clampFileTreeWidth(width)));
}
