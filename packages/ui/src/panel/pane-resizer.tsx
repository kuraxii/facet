/**
 * 面板边缘的分隔条。
 *
 * 按住拖动改宽度：拖动期间直接写根节点上的宽度变量，不经过 React 渲染。每移动一次就
 * setState 会把整个界面重画一遍，流式输出时尤其卡；松手时才提交一次，由宿主保存。
 *
 * 拖动期间在根节点上挂 `data-resizing="col"`：样式表据此把整页光标统一成列宽光标并锁住
 * 文字选区，指针滑出分隔条时不会忽然变回箭头，也不会顺手选中背后的正文。
 */
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from "react";
import { clampPaneWidth } from "./pane-width.ts";

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
}

/**
 * 挂上或摘掉拖动期间的全局标记。
 *
 * 标记只能挂在 `<html>` 上：`cursor` 与 `user-select` 要盖住整页，挂在分隔条自己身上只对
 * 那一小块生效。
 */
function setResizingLock(on: boolean): void {
	if (on) {
		document.documentElement.dataset.resizing = "col";
		return;
	}
	delete document.documentElement.dataset.resizing;
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
}: PaneResizerProps) {
	const dragging = useRef<{ startX: number; startWidth: number; current: number } | undefined>(undefined);

	// 拖动中途组件被卸掉（切布局、关面板）时也要把全局标记摘掉，否则光标会一直停在列宽形态
	useEffect(() => () => setResizingLock(false), []);

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLHRElement>) => {
			event.preventDefault();
			dragging.current = { startX: event.clientX, startWidth: width, current: width };
			event.currentTarget.setPointerCapture(event.pointerId);
			setResizingLock(true);
		},
		[width],
	);

	const handlePointerMove = useCallback(
		(event: ReactPointerEvent<HTMLHRElement>) => {
			const start = dragging.current;
			if (start === undefined) {
				return;
			}
			const delta = event.clientX - start.startX;
			// 算出来不是有限数时退回这次拖动的起点宽度，不要跳
			const next = clampPaneWidth(start.startWidth + (side === "start" ? -delta : delta), {
				min,
				max,
				defaultWidth: start.startWidth,
			});
			start.current = next;
			const app = event.currentTarget.closest(".app");
			if (app instanceof HTMLElement) {
				app.style.setProperty(cssVar, `${next}px`);
			}
		},
		[cssVar, side, min, max],
	);

	/**
	 * 收尾：摘掉全局标记、放开指针、提交宽度。
	 *
	 * `pointerup`、`pointercancel` 与 `lostpointercapture` 都可能先到，重复调用是安全的：
	 * 没有进行中的拖动时直接返回，已经放开的捕获也不再去释放。
	 */
	const finishDrag = useCallback(
		(event: ReactPointerEvent<HTMLHRElement>) => {
			const start = dragging.current;
			dragging.current = undefined;
			setResizingLock(false);
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			// 松手时才提交：宿主保存宽度，并把变量对齐到同一个值
			if (start !== undefined && start.current !== width) {
				onWidthChange(start.current);
			}
		},
		[onWidthChange, width],
	);

	return (
		<hr
			className={className}
			aria-orientation="vertical"
			aria-label={label}
			aria-valuenow={width}
			aria-valuemin={min}
			aria-valuemax={max}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={finishDrag}
			onPointerCancel={finishDrag}
			onLostPointerCapture={finishDrag}
		/>
	);
}
