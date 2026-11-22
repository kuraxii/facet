/**
 * 顶带右格里的工作区控件。
 *
 * 两处用到同一组东西：占列时的顶带右格、窄档抽屉的顶头。两处都是「动态标签 + `+` 菜单 +
 * 右端两枚动作（`⤢` 宽展开 / 收起）」，差别只在画到哪一格、给不给宽展开，所以控件本身只写
 * 一份。
 *
 * 这一格与抽屉顶头各是一处容器查询的容器（宽度即整列/整条抽屉宽），里面这一行负责让出
 * 右上角那 132px 的窗口按钮簇——位置口径见 `docs/layout.md` §3 约束 1。
 */

import type { WorkspaceTabId, WorkspaceTabItem } from "@facet/ui";
import { ICON_SIZE, IconButton, useI18n, WorkspaceTabBar, WorkspaceTabMenu } from "@facet/ui";
import { Maximize2, Minimize2, PanelRightClose } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceShell } from "../hooks/useWorkspaceShell.ts";

/** 工作区那一组控件。 */
export interface WorkspacePanelControlsProps {
	/** 外壳状态：开着哪些标签、停在哪个上、是不是在宽展开里 */
	shell: WorkspaceShell;
	/** 全部三类工具，`+` 菜单用它 */
	items: readonly WorkspaceTabItem[];
	/** 打开或切到某个工具 */
	onSelectTab: (id: WorkspaceTabId) => void;
	/** 关掉一个标签 */
	onCloseTab: (id: WorkspaceTabId) => void;
	/** 标签栏对应的面板 id，给到 `aria-controls` */
	controlsId?: string;
	/** 给不给 `⤢` 宽展开：抽屉已经接近满宽，那时不给 */
	showExpand: boolean;
}

/** 动态标签 + `+` 菜单 + 宽展开 / 收起：顶带右格与抽屉顶头共用。 */
export function WorkspacePanelControls({
	shell,
	items,
	onSelectTab,
	onCloseTab,
	controlsId,
	showExpand,
}: WorkspacePanelControlsProps): ReactNode {
	const { t } = useI18n();
	// 标签栏只放已经打开的那些，顺序就是打开顺序
	const openTabs = shell.panel.openTabs;
	const openItems = openTabs
		.map((id) => items.find((item) => item.id === id))
		.filter((item): item is WorkspaceTabItem => item !== undefined);
	const ExpandIcon = shell.isPanelExpanded ? Minimize2 : Maximize2;

	return (
		<>
			<WorkspaceTabBar
				items={openItems}
				activeId={shell.panel.activeTab}
				onSelect={onSelectTab}
				onClose={onCloseTab}
				controlsId={controlsId}
			/>
			{/*
			 * 所有工具都开着时不再给 `+`：它没有可打开的东西，留着只会占掉顶带里最紧的那几十像素。
			 * 关掉一个标签它就会回来。
			 */}
			{openTabs.length >= items.length ? null : (
				<WorkspaceTabMenu
					items={items}
					openTabs={openTabs}
					activeId={shell.panel.activeTab}
					onPick={onSelectTab}
				/>
			)}
			<span className="chrome-spacer" />
			{showExpand ? (
				<IconButton
					variant="ghost"
					size="sm"
					className="chrome-toggle"
					aria-label={shell.isPanelExpanded ? t("panel.restoreWide") : t("panel.expandWide")}
					aria-pressed={shell.isPanelExpanded}
					onClick={shell.togglePanelExpanded}
				>
					<ExpandIcon size={ICON_SIZE.md} />
				</IconButton>
			) : null}
			<IconButton
				variant="ghost"
				size="sm"
				className="chrome-toggle"
				aria-label={t("panel.collapsePanel")}
				onClick={shell.togglePanel}
			>
				<PanelRightClose size={ICON_SIZE.md} />
			</IconButton>
		</>
	);
}
