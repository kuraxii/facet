/**
 * 右侧栏。
 *
 * 只有正文与左缘那条可以拖动的分隔条，宽度拖一次记一次。分页与收起在窗口顶部那条带里，
 * 由外壳排布。窄屏时右栏是浮层、宽度由样式定，外壳不给宽度，这里也就不渲染分隔条。
 */
import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { PaneResizer } from "./pane-resizer.tsx";
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from "./panel-state.ts";

export interface RightPanelProps {
	/** 宽度，单位 px；窄屏浮层模式下不给，此时不渲染分隔条 */
	width?: number | undefined;
	/** 拖动分隔条时给出新宽度 */
	onWidthChange?: ((width: number) => void) | undefined;
	/** 分隔条此刻能拖到的最大宽度；不给用 `PANEL_MAX_WIDTH`。中档按空间预算给出 */
	maxWidth?: number | undefined;
	/** 拖动开始与结束的提示，外壳用它在拖动期间锁住折叠 */
	onDraggingChange?: ((dragging: boolean) => void) | undefined;
	/** 分页内容 */
	children: ReactNode;
}

export function RightPanel({ width, onWidthChange, maxWidth, onDraggingChange, children }: RightPanelProps) {
	const { t } = useI18n();
	return (
		<aside className="panel">
			{width === undefined || onWidthChange === undefined ? null : (
				<PaneResizer
					className="panel-resizer"
					label={t("panel.resizePanel")}
					width={width}
					min={PANEL_MIN_WIDTH}
					max={maxWidth ?? PANEL_MAX_WIDTH}
					cssVar="--panel-width"
					side="start"
					onWidthChange={onWidthChange}
					onDraggingChange={onDraggingChange}
				/>
			)}
			<div className="panel-body" role="tabpanel">
				{children}
			</div>
		</aside>
	);
}
