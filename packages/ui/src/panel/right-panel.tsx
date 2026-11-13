/**
 * 右侧栏。
 *
 * 只有正文与左缘那条可以拖动的分隔条，宽度拖一次记一次。分页与收起在窗口顶部那条带里，
 * 由外壳排布。
 */
import type { ReactNode } from "react";
import { PaneResizer } from "./pane-resizer.tsx";
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from "./panel-state.ts";

export interface RightPanelProps {
	/** 宽度，单位 px */
	width: number;
	/** 拖动分隔条时给出新宽度 */
	onWidthChange: (width: number) => void;
	/** 分页内容 */
	children: ReactNode;
}

export function RightPanel({ width, onWidthChange, children }: RightPanelProps) {
	return (
		<aside className="panel">
			<PaneResizer
				className="panel-resizer"
				label="调整右侧栏宽度"
				width={width}
				min={PANEL_MIN_WIDTH}
				max={PANEL_MAX_WIDTH}
				cssVar="--panel-width"
				side="start"
				onWidthChange={onWidthChange}
			/>
			<div className="panel-body" role="tabpanel">
				{children}
			</div>
		</aside>
	);
}
