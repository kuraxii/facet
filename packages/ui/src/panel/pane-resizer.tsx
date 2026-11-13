/**
 * 面板边缘的分隔条。
 *
 * 按住拖动改宽度：拖动期间直接写根节点上的宽度变量，不经过 React 渲染。每移动一次就
 * setState 会把整个界面重画一遍，流式输出时尤其卡；松手时才提交一次，由宿主保存。
 */
import { type PointerEvent as ReactPointerEvent, useCallback, useRef } from "react";

/** 分隔条参数。 */
export interface PaneResizerProps {
	/** 元素上的类名，决定贴在面板哪一侧、命中区多宽 */
	className: string;
	/** 无障碍名称，读屏软件用它说明这条分隔条调的是什么 */
	label: string;
	/** 当前宽度，拖动起点与提交判重都用它 */
	width: number;
	/** 宽度上下限，拖动过程中就收住 */
	min: number;
	max: number;
	/** 宽度写在根节点的哪个 CSS 变量上，拖动期间改的是它 */
	cssVar: string;
	/** 分隔条所在的一侧：在面板左侧时指针往左拖面板变宽 */
	side: "start" | "end";
	/** 松手时提交最终宽度 */
	onWidthChange: (width: number) => void;
}

/** 把宽度收回上下限，非有限数按上限处理。 */
export function clampWidth(width: number, min: number, max: number): number {
	if (!Number.isFinite(width)) {
		return max;
	}
	return Math.min(Math.max(Math.round(width), min), max);
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

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLHRElement>) => {
			event.preventDefault();
			dragging.current = { startX: event.clientX, startWidth: width, current: width };
			event.currentTarget.setPointerCapture(event.pointerId);
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
			const next = clampWidth(start.startWidth + (side === "start" ? -delta : delta), min, max);
			start.current = next;
			const app = event.currentTarget.closest(".app");
			if (app instanceof HTMLElement) {
				app.style.setProperty(cssVar, `${next}px`);
			}
		},
		[cssVar, side, min, max],
	);

	const handlePointerUp = useCallback(
		(event: ReactPointerEvent<HTMLHRElement>) => {
			const start = dragging.current;
			dragging.current = undefined;
			event.currentTarget.releasePointerCapture(event.pointerId);
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
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerUp}
		/>
	);
}
