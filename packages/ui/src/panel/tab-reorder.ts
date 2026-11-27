/**
 * 标签栏拖拽重排的纯几何计算。
 *
 * 与 React / DOM 解耦：只认滚动条坐标系下的一组矩形与水平位移，算出预览顺序、每条邻项的
 * 平移量与夹紧后的拖拽位移。判定门槛采用「拖拽前沿越过邻项中点」：窄标签跨宽标签与宽标签
 * 跨窄标签都只拖过半个邻项就让位，且相邻两个方向之间天然留出 `gap` 死区，不会来回抖动。
 */

/** 启动拖拽所需的最小指针位移（px）；小于该值视为普通点击。 */
export const TAB_DRAG_THRESHOLD_PX = 4;

/** 单个标签在标签栏滚动坐标系下的水平边界。 */
export interface TabStripRect {
	/** 标签标识 */
	readonly id: string;
	/** 左缘坐标（px） */
	readonly left: number;
	/** 右缘坐标（px） */
	readonly right: number;
	/** 标签宽度（px） */
	readonly width: number;
}

/** 一次指针位置算出的拖拽布局结果。 */
export interface TabDragLayout {
	/** 预览插入槽位（去掉被拖项后的序列下标，范围 `0 .. rects.length - 1`） */
	readonly targetIndex: number;
	/** 被拖标签夹紧后的水平位移（px） */
	readonly dx: number;
	/** 其余标签需要让位的水平位移（px，未让位时为 `0`） */
	readonly shifts: Readonly<Record<string, number>>;
	/** 当前预览对应的完整标签标识顺序 */
	readonly orderedIds: readonly string[];
}

/** 判断指针移动距离是否已达到拖拽阈值。 */
export function hasExceededDragThreshold(deltaX: number, deltaY: number): boolean {
	return Math.hypot(deltaX, deltaY) >= TAB_DRAG_THRESHOLD_PX;
}

/** 从原始顺序里的相邻项推算标签间距（px，最小为 0）。 */
function resolveTabGap(rects: readonly TabStripRect[], fromIndex: number): number {
	const current = rects[fromIndex];
	if (current === undefined) {
		return 0;
	}
	const next = rects[fromIndex + 1];
	if (next !== undefined) {
		return Math.max(0, next.left - current.right);
	}
	const prev = rects[fromIndex - 1];
	if (prev !== undefined) {
		return Math.max(0, current.left - prev.right);
	}
	return 0;
}

/** 其余标签在给定预览槽位下此刻的中心横坐标。 */
function neighborCenterAtPreview(
	others: readonly { rect: TabStripRect; origIndex: number }[],
	otherIndex: number,
	previewIndex: number,
	fromIndex: number,
	draggedSpan: number,
): number {
	const entry = others[otherIndex];
	if (entry === undefined) {
		return 0;
	}
	const baseCenter = (entry.rect.left + entry.rect.right) / 2;
	if (otherIndex < previewIndex && entry.origIndex > fromIndex) {
		return baseCenter - draggedSpan;
	}
	if (otherIndex >= previewIndex && entry.origIndex < fromIndex) {
		return baseCenter + draggedSpan;
	}
	return baseCenter;
}

/**
 * 根据被拖标签的当前位移计算最新预览顺序与各标签平移量。
 *
 * `currentTargetIndex` 是上一次的预览槽位（初始为被拖项原始下标）：从它出发向左右步进，
 * 既支持慢拖时按局部邻项中点稳态换位，也支持快甩时一次跨越多个标签。
 */
export function resolveDraggedTabOrder(
	rects: readonly TabStripRect[],
	draggedId: string,
	currentTargetIndex: number,
	rawDx: number,
): TabDragLayout {
	const ids = rects.map((rect) => rect.id);
	const fromIndex = rects.findIndex((rect) => rect.id === draggedId);
	if (fromIndex < 0 || rects.length < 2) {
		return { targetIndex: 0, dx: 0, shifts: {}, orderedIds: ids };
	}

	const first = rects[0];
	const last = rects[rects.length - 1];
	const dragged = rects[fromIndex];
	if (first === undefined || last === undefined || dragged === undefined) {
		return { targetIndex: 0, dx: 0, shifts: {}, orderedIds: ids };
	}

	const minDx = first.left - dragged.left;
	const maxDx = last.right - dragged.right;
	const dx = Math.min(maxDx, Math.max(minDx, rawDx));
	const draggedLeft = dragged.left + dx;
	const draggedRight = dragged.right + dx;
	const draggedSpan = dragged.width + resolveTabGap(rects, fromIndex);

	const others = rects
		.map((rect, origIndex) => ({ rect, origIndex }))
		.filter((entry) => entry.origIndex !== fromIndex);

	let targetIndex = Math.min(others.length, Math.max(0, currentTargetIndex));

	while (targetIndex < others.length) {
		const rightCenter = neighborCenterAtPreview(others, targetIndex, targetIndex, fromIndex, draggedSpan);
		if (draggedRight > rightCenter) {
			targetIndex += 1;
		} else {
			break;
		}
	}

	while (targetIndex > 0) {
		const leftCenter = neighborCenterAtPreview(others, targetIndex - 1, targetIndex, fromIndex, draggedSpan);
		if (draggedLeft < leftCenter) {
			targetIndex -= 1;
		} else {
			break;
		}
	}

	const shifts: Record<string, number> = {};
	const orderedIds: string[] = [];
	for (let index = 0; index < others.length; index += 1) {
		if (index === targetIndex) {
			orderedIds.push(dragged.id);
		}
		const entry = others[index];
		if (entry === undefined) {
			continue;
		}
		orderedIds.push(entry.rect.id);
		if (index < targetIndex && entry.origIndex > fromIndex) {
			shifts[entry.rect.id] = -draggedSpan;
		} else if (index >= targetIndex && entry.origIndex < fromIndex) {
			shifts[entry.rect.id] = draggedSpan;
		} else {
			shifts[entry.rect.id] = 0;
		}
	}
	if (targetIndex === others.length) {
		orderedIds.push(dragged.id);
	}

	return { targetIndex, dx, shifts, orderedIds };
}
