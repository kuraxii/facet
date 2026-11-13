/**
 * 顶部工具条。
 *
 * 落在窗口顶部那条拖动区里：中间是「文件 / 变更」两个分页，两侧分别是左栏与右栏的开关。
 * 分页在右栏收起时也能点，点一下就把右栏打开到那一页。整组标 `no-drag`，空白处仍然可以拖窗口。
 */
import { PanelLeftClose, PanelLeftOpen, PanelRight, PanelRightClose } from "lucide-react";
import type { RightPanelTab } from "./panel-state.ts";

/** 两个分页，与右栏一致。 */
const TABS: readonly { id: RightPanelTab; label: string }[] = [
	{ id: "files", label: "文件" },
	{ id: "changes", label: "变更" },
];

export interface TopBarProps {
	/** 左栏是否展开 */
	isSidebarOpen: boolean;
	/** 开关左栏 */
	onToggleSidebar: () => void;
	/** 右栏是否展开 */
	isPanelOpen: boolean;
	/** 开关右栏 */
	onTogglePanel: () => void;
	/** 右栏当前分页 */
	panelTab: RightPanelTab;
	/** 选一个分页，顺带把右栏打开 */
	onSelectPanelTab: (tab: RightPanelTab) => void;
}

export function TopBar({
	isSidebarOpen,
	onToggleSidebar,
	isPanelOpen,
	onTogglePanel,
	panelTab,
	onSelectPanelTab,
}: TopBarProps) {
	return (
		<div className="top-bar">
			<button
				type="button"
				className="top-bar-btn"
				aria-label={isSidebarOpen ? "收起左侧栏" : "展开左侧栏"}
				title={isSidebarOpen ? "收起左侧栏" : "展开左侧栏"}
				aria-pressed={isSidebarOpen}
				onClick={onToggleSidebar}
			>
				{isSidebarOpen ? <PanelLeftClose size={15} strokeWidth={1.5} /> : <PanelLeftOpen size={15} strokeWidth={1.5} />}
			</button>

			<div className="top-bar-tabs" role="tablist" aria-label="右侧栏分页">
				{TABS.map((item) => (
					<button
						key={item.id}
						type="button"
						role="tab"
						className={isPanelOpen && item.id === panelTab ? "top-bar-tab is-on" : "top-bar-tab"}
						aria-selected={isPanelOpen && item.id === panelTab}
						onClick={() => onSelectPanelTab(item.id)}
					>
						{item.label}
					</button>
				))}
			</div>

			<button
				type="button"
				className="top-bar-btn"
				aria-label={isPanelOpen ? "收起右侧栏" : "展开右侧栏"}
				title={isPanelOpen ? "收起右侧栏" : "展开右侧栏"}
				aria-pressed={isPanelOpen}
				onClick={onTogglePanel}
			>
				{isPanelOpen ? <PanelRightClose size={15} strokeWidth={1.5} /> : <PanelRight size={15} strokeWidth={1.5} />}
			</button>
		</div>
	);
}
