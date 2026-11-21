/**
 * 工作区工具的呈现映射。
 *
 * 把三类内容与它们的计数合成标签、`+` 菜单与启动清单要的条目；图标、文案与快捷键都在这里
 * 定，三处组件本身只认 `WorkspaceTabItem`。纯函数（图标是元素，不是行为），便于单独验证；
 * 图标用 `createElement` 拼，这个模块因此不需要 JSX 运行时的配置。
 */
import type { WorkspaceTabItem } from "@facet/ui";
import { FileDiff, FolderTree, SquareTerminal } from "lucide-react";
import { createElement } from "react";
import { workspaceShortcutLabel } from "./workspace-shortcuts.ts";

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
	/** 文件 */
	files: string;
	/** 变更 */
	changes: string;
	/** 终端 */
	terminal: string;
}

/** 图标的边长与笔画宽度：与界面里其它小图标一致。 */
const ICON_SIZE = 13;
const ICON_STROKE = 1.5;

/**
 * 三件工具的条目。
 *
 * 快捷键提示按平台写：mac 上是 `⌘⇧E`，其它平台是 `Ctrl+Shift+E`。提示与真实绑定同源
 * （`workspace-shortcuts.ts`），不会出现「写着却按不出来」。
 */
export function workspaceTabItems(
	facts: WorkspaceTabFacts,
	text: WorkspaceTabText,
	isMac: boolean,
): WorkspaceTabItem[] {
	return [
		{
			id: "files",
			label: text.files,
			icon: createElement(FolderTree, { size: ICON_SIZE, strokeWidth: ICON_STROKE }),
			shortcut: workspaceShortcutLabel("files", isMac),
		},
		{
			id: "changes",
			label: text.changes,
			icon: createElement(FileDiff, { size: ICON_SIZE, strokeWidth: ICON_STROKE }),
			badge: facts.changes > 0 ? facts.changes : undefined,
			shortcut: workspaceShortcutLabel("changes", isMac),
		},
		{
			id: "terminal",
			label: text.terminal,
			icon: createElement(SquareTerminal, { size: ICON_SIZE, strokeWidth: ICON_STROKE }),
			badge: facts.terminals > 1 ? facts.terminals : undefined,
			shortcut: workspaceShortcutLabel("terminal", isMac),
			disabled: !facts.canUseTerminal,
		},
	];
}
