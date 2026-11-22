/**
 * 右侧工作区。
 *
 * 只有正文与左缘那条可以拖动的分隔条，宽度拖一次记一次。它永远是外壳网格的第 3 列：
 * 标签与动作在窗口顶部那条带里，由外壳排布；窗口窄下去时这一列自己收窄，不退成浮层。
 */
import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { SHELL_DATA_ATTRS } from "../layout/layout-contract.ts";
import { PaneResizer } from "./pane-resizer.tsx";
import { PANEL_MIN_WIDTH } from "./panel-state.ts";

export interface RightPanelProps {
	/** 宽度，单位 px；宽展开期间不给（那一列由样式按视口现算），此时不渲染分隔条 */
	width?: number | undefined;
	/** 拖动分隔条时给出新宽度 */
	onWidthChange?: ((width: number) => void) | undefined;
	/**
	 * 分隔条此刻能拖到的最大宽度。
	 *
	 * 右栏没有固定的宽度上限，这个值由调用方按「视口宽 − 正文可用宽 − 左栏」现算
	 * （`paneMaxWidth()`）；这一层不自己拍一个数字。
	 */
	maxWidth: number;
	/** 拖动开始与结束的提示，外壳用它在拖动期间锁住折叠 */
	onDraggingChange?: ((dragging: boolean) => void) | undefined;
	/** 缩到最小宽一半以内松手：收起右栏。与点顶带的收起按钮同一条路，不动已打开的标签 */
	onDragCollapse?: (() => void) | undefined;
	/**
	 * 正文区的额外类名。
	 *
	 * 双栏视图（文件树 + 预览）自己分区滚，不需要正文那一圈内边距与整块滚动，靠它换掉。
	 */
	bodyClassName?: string | undefined;
	/** 标签内容 */
	children: ReactNode;
}

export function RightPanel({
	width,
	onWidthChange,
	maxWidth,
	onDraggingChange,
	onDragCollapse,
	bodyClassName,
	children,
}: RightPanelProps) {
	const { t } = useI18n();
	const bodyClasses = bodyClassName === undefined ? "panel-body" : `panel-body ${bodyClassName}`;
	return (
		<aside className="panel">
			{width === undefined || onWidthChange === undefined ? null : (
				<PaneResizer
					className="panel-resizer"
					label={t("panel.resizePanel")}
					width={width}
					min={PANEL_MIN_WIDTH}
					max={maxWidth}
					cssVar="--panel-width"
					side="start"
					onWidthChange={onWidthChange}
					onDraggingChange={onDraggingChange}
					// 缩到最小宽一半以内松手就收起右栏，落盘里仍留着原来的偏好宽
					collapseThreshold={PANEL_MIN_WIDTH / 2}
					{...(onDragCollapse === undefined ? {} : { onCollapse: onDragCollapse })}
					collapsePreviewAttr={SHELL_DATA_ATTRS.panelDragCollapsed}
				/>
			)}
			<div className={bodyClasses} id="workspace-panel" role="tabpanel">
				{children}
			</div>
		</aside>
	);
}
