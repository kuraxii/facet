/**
 * 右侧栏。
 *
 * 左边一条可以拖动的分隔条，宽度拖一次记一次。分页切换与收起在顶部工具条上，这里只放内容：
 * 文件页是目录树与编辑器，变更页是工作树的改动。
 */
import { type ReactNode, type PointerEvent as ReactPointerEvent, useCallback, useRef } from "react";
import { clampPanelWidth, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, type RightPanelTab } from "./panel-state.ts";

export interface RightPanelProps {
	/** 当前分页，只用来标 tabpanel */
	tab: RightPanelTab;
	/** 宽度，单位 px */
	width: number;
	/** 拖动分隔条时给出新宽度 */
	onWidthChange: (width: number) => void;
	/** 分页内容 */
	children: ReactNode;
}

export function RightPanel({ tab, width, onWidthChange, children }: RightPanelProps) {
	const dragging = useRef<{ startX: number; startWidth: number } | undefined>(undefined);

	/** 按住分隔条开始拖：记住起点，指针捕获到分隔条上，拖出栏外也不会断。 */
	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLHRElement>) => {
			event.preventDefault();
			dragging.current = { startX: event.clientX, startWidth: width };
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[width],
	);

	/** 往左拖变宽，往右拖变窄，宽度收在上下限之间。 */
	const handlePointerMove = useCallback(
		(event: ReactPointerEvent<HTMLHRElement>) => {
			const start = dragging.current;
			if (start === undefined) {
				return;
			}
			onWidthChange(clampPanelWidth(start.startWidth - (event.clientX - start.startX)));
		},
		[onWidthChange],
	);

	const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLHRElement>) => {
		dragging.current = undefined;
		event.currentTarget.releasePointerCapture(event.pointerId);
	}, []);

	return (
		<aside className="panel" style={{ width }}>
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
