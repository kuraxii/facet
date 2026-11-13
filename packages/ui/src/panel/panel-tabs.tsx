/**
 * 右栏的两个分页。
 *
 * 它们落在窗口顶部那条带里，贴着右栏开关后面，与右栏正文同一列。分页在右栏收起时不可见，
 * 因为那时这一格只放开关与窗口按钮。
 */
import type { RightPanelTab } from "./panel-state.ts";

const TABS: readonly { id: RightPanelTab; label: string }[] = [
	{ id: "files", label: "文件" },
	{ id: "changes", label: "变更" },
];

export interface PanelTabsProps {
	/** 当前分页 */
	tab: RightPanelTab;
	/** 切换分页 */
	onTabChange: (tab: RightPanelTab) => void;
}

export function PanelTabs({ tab, onTabChange }: PanelTabsProps) {
	return (
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
	);
}
