/**
 * 右侧栏。
 *
 * 顶部是「文件 / 变更」两个分页，左边一条可以拖动的分隔条，宽度拖一次记一次。收起入口在
 * 顶部的右栏开关上，这里不给。内容由宿主填：文件页是目录树与编辑器，变更页是工作树的改动。
 */
import { type ReactNode, type PointerEvent as ReactPointerEvent, useCallback, useRef } from "react";
import { clampPanelWidth, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, type RightPanelTab } from "./panel-state.ts";

export interface RightPanelProps {
	/** 当前分页 */
	tab: RightPanelTab;
	/** 切换分页 */
	onTabChange: (tab: RightPanelTab) => void;
	/** 宽度，单位 px */
	width: number;
	/** 拖动分隔条时给出新宽度 */
	onWidthChange: (width: number) => void;
	/** 分页内容 */
	children: ReactNode;
}

/** 两个分页的名称。 */
const TABS: readonly { id: RightPanelTab; label: string }[] = [
	{ id: "files", label: "文件" },
	{ id: "changes", label: "变更" },
];

export function RightPanel({ tab, onTabChange, width, onWidthChange, children }: RightPanelProps) {
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
			<div className="panel-head">
				<div className="panel-tabs" role="tablist" aria-label="右侧栏分页">
					{TABS.map((item) => (
						<button
							key={item.id}
							type="button"
							role="tab"
							className={item.id === tab ? "panel-tab is-on" : "panel-tab"}
							aria-selected={item.id === tab}
							onClick={() => onTabChange(item.id)}
						>
							{item.label}
						</button>
					))}
				</div>
			</div>
			<div className="panel-body" role="tabpanel">
				{children}
			</div>
		</aside>
	);
}
