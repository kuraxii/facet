/**
 * 工作区分页的呈现映射。
 *
 * 把工作区的三类内容与它们的计数合成标签栏要的条目；图标与文案都在这里定，标签栏本身
 * 只认 `WorkspaceTabItem`。纯函数（图标是元素，不是行为），便于单独验证；图标用
 * `createElement` 拼，这个模块因此不需要 JSX 运行时的配置。
 */
import type { WorkspaceTabItem } from "@facet/ui";
import { FileDiff, FileText, SquareTerminal } from "lucide-react";
import { createElement } from "react";

/** 决定计数与可用性的那些事实。 */
export interface WorkspaceTabFacts {
	/** 工作树里改动的文件数；0 时不挂计数 */
	changes: number;
	/** 主机上开着的终端数；多于一个才挂计数 */
	terminals: number;
	/** 主机有没有终端能力；没有时终端那一条不可用 */
	canUseTerminal: boolean;
}

/** 三者的名字，来自界面语言。 */
export interface WorkspaceTabText {
	/** 文件分页 */
	files: string;
	/** 变更分页 */
	changes: string;
	/** 终端分页 */
	terminal: string;
}

/** 图标的边长与笔画宽度：与界面里其它小图标一致。 */
const ICON_SIZE = 13;
const ICON_STROKE = 1.5;

/** 三张分页的条目。 */
export function workspaceTabItems(facts: WorkspaceTabFacts, text: WorkspaceTabText): WorkspaceTabItem[] {
	return [
		{
			id: "files",
			label: text.files,
			icon: createElement(FileText, { size: ICON_SIZE, strokeWidth: ICON_STROKE }),
		},
		{
			id: "changes",
			label: text.changes,
			icon: createElement(FileDiff, { size: ICON_SIZE, strokeWidth: ICON_STROKE }),
			badge: facts.changes > 0 ? facts.changes : undefined,
		},
		{
			id: "terminal",
			label: text.terminal,
			icon: createElement(SquareTerminal, { size: ICON_SIZE, strokeWidth: ICON_STROKE }),
			badge: facts.terminals > 1 ? facts.terminals : undefined,
			disabled: !facts.canUseTerminal,
		},
	];
}
