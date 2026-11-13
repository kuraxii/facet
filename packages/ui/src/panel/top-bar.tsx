/**
 * 顶部两端的开关。
 *
 * 位置照 paseo：左栏开关贴在主区左上角（侧栏头部右边一点），右栏开关贴在窗口右上角、窗口
 * 按钮的左边。两个都落在窗口顶部那条拖动带里，自己标 `no-drag`，带中间的空白仍可拖窗口。
 * 右栏的「文件 / 变更」分页留在右栏自己的顶部。
 */
import { PanelLeftClose, PanelLeftOpen, PanelRight, PanelRightClose } from "lucide-react";

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
			{isOpen ? (
				<PanelLeftClose size={15} strokeWidth={1.5} />
			) : (
				<PanelLeftOpen size={15} strokeWidth={1.5} />
			)}
		</button>
	);
}

/** 右栏开关：窗口右上角，窗口按钮的左边。 */
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
			{isOpen ? <PanelRightClose size={15} strokeWidth={1.5} /> : <PanelRight size={15} strokeWidth={1.5} />}
		</button>
	);
}
