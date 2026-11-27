/**
 * 工作区标签栏的指针拖拽重排 Hook。
 *
 * 采用 Pointer Events 而非 HTML5 DnD：顶带外层存在 `-webkit-app-region: drag` 且标签栏
 * 仅 26px 高，HTML5 拖拽容易因指针轻微上下移出而打断并产生模糊残影。左键越过 4px 阈值后
 * 进入拖拽态，支持实时跟手位移、邻项平滑让位、`Escape` 取消与溢出边缘自动横滚。
 */

import {
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { RightPanelTab } from "./panel-state.ts";
import { hasExceededDragThreshold, resolveDraggedTabOrder, type TabStripRect } from "./tab-reorder.ts";

/** 拖拽靠近标签栏左右边缘时触发自动横滚的热区宽度（px）与每帧最大步长（px）。 */
const DRAG_AUTOSCROLL_EDGE_PX = 24;
const DRAG_AUTOSCROLL_MAX_STEP_PX = 8;

/** 拖拽期间渲染层的预览态。 */
export interface TabDragPreview {
	/** 正在被拖动的标签标识 */
	readonly draggedId: RightPanelTab;
	/** 被拖标签此刻相对初始位置的水平平移（px） */
	readonly dx: number;
	/** 其余标签为让位而平移的距离（px） */
	readonly shifts: Readonly<Record<string, number>>;
}

/** 单次拖拽会话的可变现场（挂在 ref 上，未跨过阈值前不触发 React 重渲染）。 */
interface DragSession {
	readonly id: RightPanelTab;
	readonly pointerId: number;
	readonly startClientX: number;
	readonly startClientY: number;
	readonly startScrollLeft: number;
	readonly rects: readonly TabStripRect[];
	readonly snapshotIds: readonly RightPanelTab[];
	started: boolean;
	targetIndex: number;
	lastClientX: number;
	orderedIds: readonly RightPanelTab[];
}

/** 按标签顺序量出滚动条坐标系下的矩形表。 */
function measureShellRects(
	bar: HTMLDivElement,
	shellRefs: ReadonlyMap<RightPanelTab, HTMLDivElement>,
	itemIds: readonly RightPanelTab[],
): TabStripRect[] | undefined {
	const barRect = bar.getBoundingClientRect();
	const scrollLeft = bar.scrollLeft;
	const rects: TabStripRect[] = [];
	for (const id of itemIds) {
		const node = shellRefs.get(id);
		if (node === undefined) {
			return undefined;
		}
		const rect = node.getBoundingClientRect();
		const left = rect.left - barRect.left + scrollLeft;
		rects.push({ id, left, right: left + rect.width, width: rect.width });
	}
	return rects;
}

/** 指针落点靠近溢出边界时返回每帧横向滚动步长，否则返回 0。 */
function computeEdgeScrollStep(bar: HTMLDivElement, clientX: number): number {
	const maxScroll = bar.scrollWidth - bar.clientWidth;
	if (maxScroll <= 0) {
		return 0;
	}
	const barRect = bar.getBoundingClientRect();
	if (clientX < barRect.left + DRAG_AUTOSCROLL_EDGE_PX && bar.scrollLeft > 0) {
		const ratio = Math.min(1, (barRect.left + DRAG_AUTOSCROLL_EDGE_PX - clientX) / DRAG_AUTOSCROLL_EDGE_PX);
		return -Math.max(1, Math.round(ratio * DRAG_AUTOSCROLL_MAX_STEP_PX));
	}
	if (clientX > barRect.right - DRAG_AUTOSCROLL_EDGE_PX && bar.scrollLeft < maxScroll) {
		const ratio = Math.min(
			1,
			(clientX - (barRect.right - DRAG_AUTOSCROLL_EDGE_PX)) / DRAG_AUTOSCROLL_EDGE_PX,
		);
		return Math.max(1, Math.round(ratio * DRAG_AUTOSCROLL_MAX_STEP_PX));
	}
	return 0;
}

export function useTabStripDrag(
	barRef: RefObject<HTMLDivElement | null>,
	shellRefs: RefObject<Map<RightPanelTab, HTMLDivElement>>,
	itemIds: readonly RightPanelTab[],
	onReorder: ((orderedIds: readonly RightPanelTab[]) => void) | undefined,
): {
	dragPreview: TabDragPreview | null;
	onTabPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, id: RightPanelTab) => void;
	consumeSuppressedClick: (id: RightPanelTab) => boolean;
} {
	const [dragPreview, setDragPreview] = useState<TabDragPreview | null>(null);
	const sessionRef = useRef<DragSession | null>(null);
	const suppressedClickIdRef = useRef<RightPanelTab | null>(null);
	const onReorderRef = useRef(onReorder);
	onReorderRef.current = onReorder;
	const itemIdsRef = useRef(itemIds);
	itemIdsRef.current = itemIds;
	const autoScrollFrameRef = useRef(0);
	const cleanupListenersRef = useRef<(() => void) | null>(null);

	const stopAutoScroll = useCallback((): void => {
		if (autoScrollFrameRef.current !== 0) {
			cancelAnimationFrame(autoScrollFrameRef.current);
			autoScrollFrameRef.current = 0;
		}
	}, []);

	/** 根据会话当前 `lastClientX` 与滚动偏移刷新一次预览布局。 */
	const syncPreview = useCallback(
		(session: DragSession): void => {
			const bar = barRef.current;
			const currentScrollLeft = bar?.scrollLeft ?? session.startScrollLeft;
			const rawDx =
				session.lastClientX - session.startClientX + (currentScrollLeft - session.startScrollLeft);
			const layout = resolveDraggedTabOrder(session.rects, session.id, session.targetIndex, rawDx);
			session.targetIndex = layout.targetIndex;
			session.orderedIds = layout.orderedIds as RightPanelTab[];
			setDragPreview({ draggedId: session.id, dx: layout.dx, shifts: layout.shifts });
		},
		[barRef],
	);

	const abortDrag = useCallback((): void => {
		cleanupListenersRef.current?.();
		cleanupListenersRef.current = null;
		stopAutoScroll();
		sessionRef.current = null;
		setDragPreview(null);
	}, [stopAutoScroll]);

	/** 若外部在拖拽途中增删或改排了标签集合，立即中止本次拖拽以防用过期坐标提交。 */
	useEffect(() => {
		const session = sessionRef.current;
		if (session === null) {
			return;
		}
		const unchanged =
			session.snapshotIds.length === itemIds.length &&
			session.snapshotIds.every((id, index) => id === itemIds[index]);
		if (!unchanged) {
			abortDrag();
		}
	}, [abortDrag, itemIds]);

	useEffect(() => abortDrag, [abortDrag]);

	const onTabPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>, id: RightPanelTab): void => {
			if (onReorderRef.current === undefined || itemIdsRef.current.length < 2 || event.button !== 0) {
				return;
			}
			const bar = barRef.current;
			if (bar === null) {
				return;
			}
			const snapshotIds = [...itemIdsRef.current];
			const startIndex = snapshotIds.indexOf(id);
			const rects = startIndex < 0 ? undefined : measureShellRects(bar, shellRefs.current, snapshotIds);
			if (rects === undefined) {
				return;
			}

			cleanupListenersRef.current?.();
			stopAutoScroll();

			const session: DragSession = {
				id,
				pointerId: event.pointerId,
				startClientX: event.clientX,
				startClientY: event.clientY,
				startScrollLeft: bar.scrollLeft,
				rects,
				snapshotIds,
				started: false,
				targetIndex: startIndex,
				lastClientX: event.clientX,
				orderedIds: snapshotIds,
			};
			sessionRef.current = session;

			const tickAutoScroll = (): void => {
				const active = sessionRef.current;
				const barNode = barRef.current;
				if (active === null || !active.started || barNode === null) {
					autoScrollFrameRef.current = 0;
					return;
				}
				const step = computeEdgeScrollStep(barNode, active.lastClientX);
				if (step === 0) {
					autoScrollFrameRef.current = 0;
					return;
				}
				const prev = barNode.scrollLeft;
				barNode.scrollLeft += step;
				if (barNode.scrollLeft === prev) {
					autoScrollFrameRef.current = 0;
					return;
				}
				syncPreview(active);
				autoScrollFrameRef.current = requestAnimationFrame(tickAutoScroll);
			};

			const finish = (cancelled: boolean): void => {
				const active = sessionRef.current;
				cleanupListenersRef.current?.();
				cleanupListenersRef.current = null;
				stopAutoScroll();
				sessionRef.current = null;
				if (active === null || !active.started) {
					return;
				}
				// 拖拽松手后浏览器可能紧接着对原按钮补发一次 click，在同轮任务末尾清掉抑制标记
				suppressedClickIdRef.current = active.id;
				window.setTimeout(() => {
					if (suppressedClickIdRef.current === active.id) {
						suppressedClickIdRef.current = null;
					}
				}, 0);
				setDragPreview(null);
				if (!cancelled && active.orderedIds.some((tabId, index) => tabId !== active.snapshotIds[index])) {
					onReorderRef.current?.(active.orderedIds);
				}
			};

			const onPointerMove = (moveEvent: PointerEvent): void => {
				const active = sessionRef.current;
				if (active === null || moveEvent.pointerId !== active.pointerId) {
					return;
				}
				active.lastClientX = moveEvent.clientX;
				if (!active.started) {
					if (
						!hasExceededDragThreshold(
							moveEvent.clientX - active.startClientX,
							moveEvent.clientY - active.startClientY,
						)
					) {
						return;
					}
					active.started = true;
				}
				syncPreview(active);
				const barNode = barRef.current;
				if (barNode !== null && computeEdgeScrollStep(barNode, active.lastClientX) !== 0) {
					if (autoScrollFrameRef.current === 0) {
						autoScrollFrameRef.current = requestAnimationFrame(tickAutoScroll);
					}
				} else {
					stopAutoScroll();
				}
			};

			const onPointerUp = (e: PointerEvent): void => {
				if (e.pointerId === session.pointerId) {
					finish(false);
				}
			};
			const onPointerCancel = (e: PointerEvent): void => {
				if (e.pointerId === session.pointerId) {
					finish(true);
				}
			};
			const onKeyDown = (e: KeyboardEvent): void => {
				if (e.key === "Escape" && sessionRef.current?.started) {
					// 阻止同一键顺便关闭外层抽屉或弹窗（见 docs/layout.md 约束 3）
					e.preventDefault();
					finish(true);
				}
			};
			const onBlur = (): void => finish(true);

			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", onPointerUp);
			window.addEventListener("pointercancel", onPointerCancel);
			window.addEventListener("keydown", onKeyDown);
			window.addEventListener("blur", onBlur);

			cleanupListenersRef.current = () => {
				window.removeEventListener("pointermove", onPointerMove);
				window.removeEventListener("pointerup", onPointerUp);
				window.removeEventListener("pointercancel", onPointerCancel);
				window.removeEventListener("keydown", onKeyDown);
				window.removeEventListener("blur", onBlur);
			};
		},
		[barRef, shellRefs, stopAutoScroll, syncPreview],
	);

	const consumeSuppressedClick = useCallback((id: RightPanelTab): boolean => {
		if (suppressedClickIdRef.current !== id) {
			return false;
		}
		suppressedClickIdRef.current = null;
		return true;
	}, []);

	return { dragPreview, onTabPointerDown, consumeSuppressedClick };
}
