/**
 * 顶带里的工作区控件，与收起态的悬浮竖轨。
 *
 * 三处用到同一组东西：顶带右格（右栏占列时）、抽屉顶头（右栏是浮层时）与竖轨（右栏收起
 * 时）。三处都是分页 + 图钉 + 关闭，差别只在排布方向与让位方式，所以控件本身只写一份。
 *
 * 顶带那一格与抽屉顶头各是一处容器查询的容器（宽度即整列/整条抽屉宽），里面这一行负责
 * 让出右上角那 132px 的窗口按钮簇——位置口径见 `docs/layout.md` §3 约束 1。
 */

import type { WorkspaceTabId, WorkspaceTabItem } from "@facet/ui";
import { useI18n, WorkspaceTabBar } from "@facet/ui";
import { Pin, X } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceShell } from "../hooks/useWorkspaceShell.ts";

/** 工作区分页那一组控件。 */
export interface WorkspacePanelControlsProps {
	/** 外壳状态：分页停在哪、钉没钉住、此刻是不是浮层 */
	shell: WorkspaceShell;
	/** 三张分页 */
	items: readonly WorkspaceTabItem[];
	/** 切到某一页 */
	onSelectTab: (id: WorkspaceTabId) => void;
	/** 要不要放图钉；窄档忽略图钉，那时不放 */
	showPin: boolean;
	/** 分页对应的面板 id，给到 `aria-controls` */
	controlsId?: string;
}

/** 分页 + 图钉 + 关闭：顶带右格与抽屉顶头共用。 */
export function WorkspacePanelControls({
	shell,
	items,
	onSelectTab,
	showPin,
	controlsId,
}: WorkspacePanelControlsProps): ReactNode {
	const { t } = useI18n();
	return (
		<>
			<WorkspaceTabBar
				items={items}
				activeId={shell.panel.tab}
				onSelect={onSelectTab}
				controlsId={controlsId}
			/>
			<span className="chrome-spacer" />
			{showPin ? (
				<button
					type="button"
					className="chrome-toggle"
					aria-label={t("panel.pinPanel")}
					aria-pressed={shell.panel.pinned}
					onClick={() => shell.setPanelPinned(!shell.panel.pinned)}
				>
					<Pin size={14} strokeWidth={1.5} />
				</button>
			) : null}
			<button
				type="button"
				className="chrome-toggle"
				aria-label={t("panel.collapsePanel")}
				onClick={shell.isPanelDrawerOpen ? shell.closePanelDrawer : shell.togglePanel}
			>
				<X size={15} strokeWidth={1.5} />
			</button>
		</>
	);
}

/** 抽屉顶头的内容：分页、图钉（非窄档）与关闭。 */
export interface PanelHeadProps {
	/** 外壳状态 */
	shell: WorkspaceShell;
	/** 三张分页 */
	items: readonly WorkspaceTabItem[];
	/** 切到某一页 */
	onSelectTab: (id: WorkspaceTabId) => void;
}

export function PanelHead({ shell, items, onSelectTab }: PanelHeadProps): ReactNode {
	return (
		<WorkspacePanelControls
			shell={shell}
			items={items}
			onSelectTab={onSelectTab}
			// 窄档忽略图钉：那里一律是抽屉，钉不钉没有区别
			showPin={!shell.isNarrow}
			controlsId="workspace-panel"
		/>
	);
}

/**
 * 收起态右侧的悬浮竖轨。
 *
 * 只在非窄档且右栏收着时出现：三张分页竖着排，底部一枚图钉。窄档不显示它——那里正文
 * 本来就窄，竖轨会盖住正文控件与滚动条，入口统一留在顶带右上角。
 */
export interface PanelRailProps {
	/** 外壳状态 */
	shell: WorkspaceShell;
	/** 三张分页 */
	items: readonly WorkspaceTabItem[];
	/** 切到某一页 */
	onSelectTab: (id: WorkspaceTabId) => void;
}

export function PanelRail({ shell, items, onSelectTab }: PanelRailProps): ReactNode {
	const { t } = useI18n();
	return (
		<div className="panel-rail">
			<WorkspaceTabBar
				items={items}
				activeId={shell.panel.tab}
				onSelect={onSelectTab}
				orientation="vertical"
				labelMode="never"
			/>
			<button
				type="button"
				className="panel-rail-pin"
				aria-label={t("panel.pinPanel")}
				aria-pressed={shell.panel.pinned}
				onClick={() => shell.setPanelPinned(!shell.panel.pinned)}
			>
				<Pin size={13} strokeWidth={1.5} />
			</button>
		</div>
	);
}
