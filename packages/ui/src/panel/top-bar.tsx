/**
 * 顶部两端的开关。
 *
 * 两个开关分别贴在主区顶部的两个角上：左栏开关在主区左上角、离侧栏 4px，右栏开关在主区
 * 右上角。图标用 paseo 那一个，不分开合，展开时提亮、收起时压暗。它们落在窗口顶部那条拖动
 * 带里，各自标 `no-drag`，带中间的空白仍然可以拖窗口。
 */
import { PanelLeft, PanelRight } from "lucide-react";

/** 左栏开关：主区左上角。 */
export function SidebarToggle({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
	return (
		<button
			type="button"
			className="chrome-toggle is-sidebar"
			aria-label={isOpen ? "收起左侧栏" : "展开左侧栏"}
			title={isOpen ? "收起左侧栏" : "展开左侧栏"}
			aria-pressed={isOpen}
			onClick={onToggle}
		>
			<PanelLeft size={15} strokeWidth={1.5} />
		</button>
	);
}

/** 右栏开关：主区右上角。 */
export function PanelToggle({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
	return (
		<button
			type="button"
			className="chrome-toggle is-panel"
			aria-label={isOpen ? "收起右侧栏" : "展开右侧栏"}
			title={isOpen ? "收起右侧栏" : "展开右侧栏"}
			aria-pressed={isOpen}
			onClick={onToggle}
		>
			<PanelRight size={15} strokeWidth={1.5} />
		</button>
	);
}
