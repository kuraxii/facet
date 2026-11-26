/**
 * 面板边缘的分隔条。
 *
 * 按住拖动改宽度：拖动期间直接写根节点上的宽度变量，不经过 React 渲染。每移动一次就
 * setState 会把整个界面重画一遍，流式输出时尤其卡；松手时才提交一次，由宿主保存。
 *
 * 拖动期间在 body 上铺一层透明遮罩：整屏的命中与光标都归它，指针滑出分隔条时不会忽然变回
 * 箭头，底下的按钮收不到 hover，正文也不会被顺手选中。遮罩只在开始与结束各渲染一次，拖动
 * 过程中仍然不经过 React。
 *
 * **拖收关闭**：给了 `collapseThreshold` 时，缩到「最小宽再往里一半」就算进了待关闭态——
 * 越过那一刻在 `.app` 上挂 `collapsePreviewAttr`，样式据此把这一列的实占宽摁到 `0`，栏位
 * 实时收起、正文实时补位；分隔条留在原地染上强调色，作为「松手就关」的提示。拖回阈值之上
 * 立刻摘掉属性，宽度从 `min` 起重新跟手。松手时若仍在待关闭态就直接收起这一栏，且**不把
 * 那个宽度写进本地存储**（变量还原成这次拖动的起点），所以下次打开还是原来那份偏好宽。
 *
 * 整个过程不卸载这一栏、不收指针捕获、也不给它 `display: none`：属性只改列轨道，分隔条
 * 始终拿得住指针，会话列表的滚动位置与终端的 DOM 也不会在拖动中被重建。
 */
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { PANEL_WIDTH_VAR, writePanelWidth } from "../layout/panel-width.ts";
import { clampPaneWidth } from "./pane-width.ts";

/** 拖动期间挂在根节点上的属性：`motion.css` 据此把四档过渡时长清零。 */
const RESIZE_ATTR = "data-window-resizing";

/** 一次拖动的现场。 */
interface DragState {
	/** 指针按下时的横坐标 */
	startX: number;
	/** 按下时的宽度；拖收关闭时用来还原 */
	startWidth: number;
	/** 已钳制的显示宽度，松手时提交它 */
	current: number;
	/** 是不是已经缩进待关闭区间 */
	pending: boolean;
	/** 宽度变量写在哪个元素上（通常是 `.app`） */
	target: HTMLElement | null;
}

/** 分隔条参数。 */
export interface PaneResizerProps {
	/** 元素上的类名，决定贴在面板哪一侧、命中区多宽 */
	className: string;
	/** 无障碍名称，读屏软件用它说明这条分隔条调的是什么 */
	label: string;
	/** 当前宽度，拖动起点与提交判重都用它 */
	width: number;
	/** 宽度下限 */
	min: number;
	/** 宽度上限 */
	max: number;
	/** 宽度写在根节点的哪个 CSS 变量上，拖动期间改的是它 */
	cssVar: string;
	/** 分隔条所在的一侧：在面板左侧时指针往左拖面板变宽 */
	side: "start" | "end";
	/** 松手时提交最终宽度 */
	onWidthChange: (width: number) => void;
	/**
	 * 拖动开始与结束的提示。
	 *
	 * 外壳用它在拖动期间锁住布局档位：分隔条正在拖的时候把一栏折起，会先卸载分隔条，
	 * 拿不到 `pointerup` 的那次收尾会把一个没人在看的宽度提交上去。
	 */
	onDraggingChange?: ((dragging: boolean) => void) | undefined;
	/**
	 * 拖收关闭的阈值（未钳制的目标宽，单位 px）。
	 *
	 * 不给就不启用。启用时缩到 `<= collapseThreshold` 进入待关闭态：视觉停在 `min`，
	 * 松手调用 `onCollapse()` 并放弃这次宽度。
	 */
	collapseThreshold?: number | undefined;
	/** 在待关闭态里松手：关掉这一栏。与点它的收起按钮同一条路 */
	onCollapse?: (() => void) | undefined;
	/**
	 * 折叠预览属性的名字（挂在 `.app` 上，如 `"data-sidebar-drag-collapsed"`）。
	 *
	 * 越过阈值时挂上、拖回阈值之上时摘掉，样式据此把这一列的实占宽摁到 `0`。属性直接写在
	 * 元素上、不经过 React 状态，拖动期间因此一次渲染都不发生。
	 */
	collapsePreviewAttr?: string | undefined;
	/**
	 * 「分隔条被压住或正在拖」的属性名（挂在 `.app` 上，如 `"data-panel-resizer-active"`）。
	 *
	 * 样式据此把那一栏的接缝染成强调色。给属性而不是让样式写 `.app:has(.resizer:hover)`：
	 * `.app` 包着整棵文档，`:has()` 会让每次样式重算都按整棵树重验一遍，滚动时每帧多花几毫秒。
	 * 与折叠预览一样直接写在元素上，不经过 React 状态。
	 */
	activeAttr?: string | undefined;
}

export function PaneResizer({
	className,
	label,
	width,
	min,
	max,
	cssVar,
	side,
	onWidthChange,
	onDraggingChange,
	collapseThreshold,
	onCollapse,
	collapsePreviewAttr,
	activeAttr,
}: PaneResizerProps) {
	const dragging = useRef<DragState | undefined>(undefined);
	/** 拖动中才挂遮罩；组件中途被卸掉时遮罩跟着它一起走 */
	const [isDragging, setIsDragging] = useState(false);
	/** 待关闭态的视觉提示挂在这条分隔条自己身上 */
	const [isCollapsePending, setIsCollapsePending] = useState(false);
	/** 拖动状态回调放 ref 里：拖动过程中它换引用不该重绑指针事件 */
	const draggingListener = useRef(onDraggingChange);
	draggingListener.current = onDraggingChange;
	/** 收尾时读最新的两个回调，不把它们卷进 `useCallback` 的依赖里 */
	const finishRef = useRef({ onCollapse, onWidthChange });
	finishRef.current = { onCollapse, onWidthChange };

	/**
	 * 写一列的宽度。
	 *
	 * 右栏宽度有两个落点（`.app` 的轨道 + 顶带中格的让位副本），统一走 `writePanelWidth`；
	 * 左栏只有一个落点，直接写。
	 */
	const writeWidth = useCallback(
		(target: HTMLElement | null, value: string): void => {
			if (target === null) {
				return;
			}
			if (cssVar === PANEL_WIDTH_VAR) {
				writePanelWidth(target, value);
				return;
			}
			target.style.setProperty(cssVar, value);
		},
		[cssVar],
	);

	// 拖动到一半被卸载时补发一次「结束」：否则外壳会一直以为还在拖，折叠永远锁着。
	// 变量也还原成起点、预览属性一并摘掉，别把一个没提交的宽度或一列零宽留在界面上。
	useEffect(() => {
		return () => {
			const start = dragging.current;
			if (start === undefined) {
				return;
			}
			dragging.current = undefined;
			document.documentElement.removeAttribute(RESIZE_ATTR);
			draggingListener.current?.(false);
			writeWidth(start.target, `${start.startWidth}px`);
			if (start.pending && collapsePreviewAttr !== undefined) {
				start.target?.removeAttribute(collapsePreviewAttr);
			}
		};
	}, [collapsePreviewAttr, writeWidth]);

	/** 把「被压住」的状态写到 `.app` 上；`on` 为假时摘掉 */
	const markActive = useCallback(
		(node: Element, on: boolean): void => {
			if (activeAttr === undefined) {
				return;
			}
			const root = node.closest(".app");
			if (root === null) {
				return;
			}
			if (on) {
				root.setAttribute(activeAttr, "true");
				return;
			}
			root.removeAttribute(activeAttr);
		},
		[activeAttr],
	);

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLHRElement>) => {
			event.preventDefault();
			markActive(event.currentTarget, true);
			const target = event.currentTarget.closest(".app");
			dragging.current = {
				startX: event.clientX,
				startWidth: width,
				current: width,
				pending: false,
				target: target instanceof HTMLElement ? target : null,
			};
			event.currentTarget.setPointerCapture(event.pointerId);
			setIsDragging(true);
			// 拖动期间冻结全仓过渡：列宽每帧都在变，过渡会把它们叠成拖影
			document.documentElement.setAttribute(RESIZE_ATTR, "");
			draggingListener.current?.(true);
		},
		[markActive, width],
	);

	const handlePointerMove = useCallback(
		(event: ReactPointerEvent<HTMLHRElement>) => {
			const start = dragging.current;
			if (start === undefined) {
				return;
			}
			const delta = event.clientX - start.startX;
			// 未钳制的目标宽：拖收判定看它，显示看钳制之后的值
			const raw = start.startWidth + (side === "start" ? -delta : delta);
			// 算出来不是有限数时退回这次拖动的起点宽度，不要跳
			const next = clampPaneWidth(raw, { min, max, defaultWidth: start.startWidth });
			start.current = next;

			// 跨阈值才翻状态：拖动过程中不做无谓的重渲染
			const pending = collapseThreshold !== undefined && Number.isFinite(raw) && raw <= collapseThreshold;
			if (pending !== start.pending) {
				start.pending = pending;
				setIsCollapsePending(pending);
				// 实时收起 / 实时展开：只改 `.app` 上的属性，列轨道由样式跟着算
				if (collapsePreviewAttr !== undefined) {
					if (pending) {
						start.target?.setAttribute(collapsePreviewAttr, "true");
					} else {
						start.target?.removeAttribute(collapsePreviewAttr);
					}
				}
			}
			// 属性先落，宽度后写：顶带中格的副本按"这一列实际占多宽"算，收起预览里要跟着归零
			writeWidth(start.target, `${next}px`);
		},
		[collapsePreviewAttr, collapseThreshold, writeWidth, max, min, side],
	);

	/**
	 * 收尾：摘掉全局标记、放开指针、提交宽度。
	 *
	 * `pointerup`、`pointercancel` 与 `lostpointercapture` 都可能先到，重复调用是安全的：
	 * 没有进行中的拖动时直接返回，已经放开的捕获也不再去释放。
	 *
	 * 取消与待关闭都不提交宽度：变量还原成起点，落盘里仍是用户原来那一份偏好宽。
	 *
	 * 待关闭时先同步提交一次收起（`flushSync`），等 `is-*-hidden` 落到 `.app` 上再摘预览
	 * 属性——反过来的话，松手那一帧会先看见宽度还原、收起还没生效，闪一下原宽度。
	 */
	const finishDrag = useCallback(
		(event: ReactPointerEvent<HTMLHRElement>, cancelled: boolean) => {
			const start = dragging.current;
			dragging.current = undefined;
			setIsDragging(false);
			setIsCollapsePending(false);
			document.documentElement.removeAttribute(RESIZE_ATTR);
			markActive(event.currentTarget, false);
			if (event.currentTarget.hasPointerCapture?.(event.pointerId) === true) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			if (start === undefined) {
				return;
			}
			draggingListener.current?.(false);
			if (cancelled || start.pending) {
				writeWidth(start.target, `${start.startWidth}px`);
				const collapse = finishRef.current.onCollapse;
				if (!cancelled && collapse !== undefined) {
					flushSync(collapse);
				}
				if (collapsePreviewAttr !== undefined) {
					start.target?.removeAttribute(collapsePreviewAttr);
				}
				return;
			}
			// 松手时才提交：宿主保存宽度，并把变量对齐到同一个值
			if (start.current !== width) {
				finishRef.current.onWidthChange(start.current);
			}
		},
		[collapsePreviewAttr, markActive, writeWidth, width],
	);

	return (
		<>
			<hr
				className={className}
				aria-orientation="vertical"
				aria-label={label}
				aria-valuenow={width}
				aria-valuemin={min}
				aria-valuemax={max}
				data-collapse-pending={isCollapsePending ? "true" : undefined}
				onPointerEnter={(event) => markActive(event.currentTarget, true)}
				onPointerLeave={(event) => markActive(event.currentTarget, false)}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={(event) => finishDrag(event, false)}
				onPointerCancel={(event) => finishDrag(event, true)}
				onLostPointerCapture={(event) => finishDrag(event, true)}
			/>
			{isDragging
				? createPortal(<div className="pane-resize-overlay" aria-hidden="true" />, document.body)
				: null}
		</>
	);
}
