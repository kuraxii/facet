/**
 * 空态启动清单。
 *
 * 右栏开着但一个标签都没开时，正文区居中给出这三行：图标、名字、右对齐的快捷键提示。点一
 * 行就把那个工具打开；关掉最后一个标签也回到这里——右栏不跟着收起，操作因此是可预期的。
 *
 * 这里只写对象自身的名字与键位，不写「请选择要打开的工具」这类说明（见 `AGENTS.md`
 * 界面表达）。
 */

import type { ReactNode } from "react";
import type { WorkspaceTabId, WorkspaceTabItem } from "./workspace-tab-bar.tsx";

/** 启动清单的参数。 */
export interface WorkspaceLauncherProps {
	/** 可打开的工具，顺序即清单顺序 */
	items: readonly WorkspaceTabItem[];
	/** 选了一项 */
	onPick: (id: WorkspaceTabId) => void;
}

export function WorkspaceLauncher({ items, onPick }: WorkspaceLauncherProps): ReactNode {
	return (
		<div className="workspace-launcher">
			<div className="workspace-launcher-list">
				{items.map((item) => (
					<button
						key={item.id}
						type="button"
						className="workspace-launcher-item"
						disabled={item.disabled === true}
						onClick={() => onPick(item.id)}
					>
						<span className="workspace-launcher-icon">{item.icon}</span>
						<span className="workspace-launcher-label">{item.label}</span>
						{item.badge === undefined || item.badge === 0 || item.badge === "" ? null : (
							<span className="workspace-launcher-badge">{item.badge}</span>
						)}
						{item.shortcut === undefined ? null : (
							<span className="workspace-launcher-key">{item.shortcut}</span>
						)}
					</button>
				))}
			</div>
		</div>
	);
}
