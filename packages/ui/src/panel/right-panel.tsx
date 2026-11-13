/**
 * 右侧栏。
 *
 * 只有正文与左缘那条可以拖动的分隔条，宽度拖一次记一次。分页与收起在窗口顶部那条带里，
 * 由外壳排布。
 */
import { type ReactNode, type PointerEvent as ReactPointerEvent, useCallback, useRef } from "react";
import { clampPanelWidth, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from "./panel-state.ts";

export interface RightPanelProps {
	/** 宽度，单位 px */
	width: number;
	/** 拖动分隔条时给出新宽度 */
	onWidthChange: (width: number) => void;
	/** 分页内容 */
	children: ReactNode;
}

/**
 * 拖动期间直接改根节点上的宽度变量，不经过 React 渲染。
 *
 * 每移动一次就 setState 会把整个界面重画一遍，流式输出时尤其卡；这里只写一个 CSS 变量，
 * 松手时才把最终宽度提交给宿主保存。
 */
function applyWidth(element: HTMLElement, next: number): void {
	const app = element.closest(".app");
	if (app instanceof HTMLElement) {
		app.style.setProperty("--panel-width", `${next}px`);
	}
}

export function RightPanel({ width, onWidthChange, children }: RightPanelProps) {
	const dragging = useRef<{ startX: number; startWidth: number; current: number } | undefined>(undefined);

	/** 按住分隔条开始拖：记住起点，指针捕获到分隔条上，拖出栏外也不会断。 */
	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLHRElement>) => {
			event.preventDefault();
			dragging.current = { startX: event.clientX, startWidth: width, current: width };
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[width],
	);

	/** 往左拖变宽，往右拖变窄，宽度收在上下限之间。 */
	const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLHRElement>) => {
		const start = dragging.current;
		if (start === undefined) {
			return;
		}
		const next = clampPanelWidth(start.startWidth - (event.clientX - start.startX));
		start.current = next;
		applyWidth(event.currentTarget, next);
	}, []);

	const handlePointerUp = useCallback(
		(event: ReactPointerEvent<HTMLHRElement>) => {
			const start = dragging.current;
			dragging.current = undefined;
			event.currentTarget.releasePointerCapture(event.pointerId);
			// 松手时才提交：宿主保存宽度，并把变量对齐到这一个值
			if (start !== undefined && start.current !== width) {
				onWidthChange(start.current);
			}
		},
		[onWidthChange, width],
	);

	return (
		<aside className="panel">
			<hr
				className="panel-resizer"
				aria-orientation="vertical"
				aria-label="调整右侧栏宽度"
				aria-valuenow={width}
				aria-valuemin={PANEL_MIN_WIDTH}
				aria-valuemax={PANEL_MAX_WIDTH}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={handlePointerUp}
			/>
			<div className="panel-body" role="tabpanel">
				{children}
			</div>
		</aside>
	);
}
