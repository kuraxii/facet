/**
 * 工作区正文：四类工具的轻量路由。
 *
 * 这里只做两件事——判断哪个标签在显示、把共享上下文（文档数据、终端域、会话目录）透传给
 * 对应的标签组件。视图状态（文件树的开关与宽度、变更的钻取、图谱的分页与钻取、终端的焦点）
 * 都在各自的标签里，这个文件不再持有任何 `useState`。
 *
 * 四块内容都留在 DOM 里，只切换显隐：终端藏起来是不让它丢 PTY 会话与回滚，其余三块藏起来
 * 是为了保住展开状态与滚动位置。关掉一个标签才是真的卸载——终端的 PTY 也就在那一下结束
 * （外壳在关终端标签时同时关掉终端）。
 */
import { WorkspaceLauncher, type WorkspaceTabId, type WorkspaceTabItem } from "@facet/ui";
import type { ReactNode } from "react";
import type { TerminalPanel } from "../hooks/useTerminalPanel.ts";
import type { WorkspaceDocs } from "../hooks/useWorkspaceDocs.ts";
import { ChangesTab } from "./workspace/changes-tab.tsx";
import { FilesTab } from "./workspace/files-tab.tsx";
import { GitGraphTab } from "./workspace/git-graph-tab.tsx";
import { TerminalTab } from "./workspace/terminal-tab.tsx";

/** 工作区正文的参数。 */
export interface WorkspaceBodyProps {
	/** 已打开的工具标签 */
	openTabs: readonly WorkspaceTabId[];
	/** 当前激活项；为 `null` 时正文是启动清单 */
	activeTab: WorkspaceTabId | null;
	/** 全部工具：启动清单用它列出可打开的那几项 */
	items: readonly WorkspaceTabItem[];
	/** 打开一个工具（点启动清单里的一行） */
	onOpenTab: (id: WorkspaceTabId) => void;
	/** 文档与改动 */
	docs: WorkspaceDocs;
	/** 终端域 */
	terminal: TerminalPanel;
	/** 当前会话所在的目录；没有会话时为空 */
	sessionCwd: string | undefined;
	/** 终端标签要显示的那个终端；主机上没有终端时为空 */
	terminalId: string | undefined;
}

/** 一个标签的外壳：显隐只靠类名，内容一直留在 DOM 里。 */
function TabView({ isActive, children }: { isActive: boolean; children: ReactNode }): ReactNode {
	return <div className={isActive ? "workspace-view" : "workspace-view is-inactive"}>{children}</div>;
}

/** 工作区正文。 */
export function WorkspaceBody(props: WorkspaceBodyProps): ReactNode {
	const { openTabs, activeTab, items, onOpenTab, docs, terminal, sessionCwd, terminalId } = props;
	if (activeTab === null) {
		return <WorkspaceLauncher items={items} onPick={onOpenTab} />;
	}
	return (
		<div className="workspace-body">
			{openTabs.includes("files") ? (
				<TabView isActive={activeTab === "files"}>
					<FilesTab docs={docs} sessionCwd={sessionCwd} />
				</TabView>
			) : null}
			{openTabs.includes("changes") ? (
				<TabView isActive={activeTab === "changes"}>
					<ChangesTab docs={docs} sessionCwd={sessionCwd} />
				</TabView>
			) : null}
			{openTabs.includes("git-graph") ? (
				<TabView isActive={activeTab === "git-graph"}>
					<GitGraphTab docs={docs} sessionCwd={sessionCwd} isActive={activeTab === "git-graph"} />
				</TabView>
			) : null}
			{/* 终端只切显隐：卸载会丢掉 PTY 会话与回滚，切回来还要重取一遍历史 */}
			{openTabs.includes("terminal") ? (
				<TabView isActive={activeTab === "terminal"}>
					<TerminalTab terminal={terminal} terminalId={terminalId} isActive={activeTab === "terminal"} />
				</TabView>
			) : null}
		</div>
	);
}
