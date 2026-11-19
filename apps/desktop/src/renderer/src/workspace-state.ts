/**
 * 工作区里属于某台主机的轻量状态。
 *
 * 切走一台主机时它的界面会整份卸载（DOM 里只留当前主机的），但下次切回来不该从空白开始：
 * 哪些标签开着、停在哪个标签、文件内容与提交详情读到哪一步、上次新建会话落在哪个目录，
 * 这些只与那台主机有关，按端点存在渲染进程的内存里，随运行时一起活、一起销毁。
 *
 * 只放界面状态：会话与终端的真实数据在各自的客户端里，连接本身在连接链路里。
 */
import type { FileContent, GitCommitDetail, GitCommits, GitStatus } from "@facet/protocol";
import type { MainTab } from "@facet/ui";

/** 变更页的数据、加载状态与失败原因。 */
export interface ChangesState {
	/** 工作树状态 */
	readonly status?: GitStatus;
	/** 是否正在取 */
	readonly isLoading: boolean;
	/** 失败原因 */
	readonly error?: string;
}

/** 提交历史的数据、加载状态与失败原因。 */
export interface CommitsState {
	/** 提交列表 */
	readonly data?: GitCommits;
	/** 是否正在取 */
	readonly isLoading: boolean;
	/** 失败原因 */
	readonly error?: string;
}

/** 每个提交标签的改动详情。 */
export interface CommitDetailState {
	/** 取回来的详情 */
	readonly detail?: GitCommitDetail;
	/** 是否正在取 */
	readonly isLoading: boolean;
	/** 失败原因 */
	readonly error?: string;
}

/** 一台主机的工作区快照。字段与各 Hook 的初始状态一一对应。 */
export interface HostWorkspaceSnapshot {
	/** 主区域的标签，按打开顺序 */
	tabs: MainTab[];
	/** 当前标签；为空时显示空状态 */
	activeTabId: string | undefined;
	/** 打开的文件内容，按标签标识存 */
	fileContents: Readonly<Record<string, FileContent>>;
	/** 每个提交标签的详情，按标签标识存 */
	commitDetails: Readonly<Record<string, CommitDetailState>>;
	/** 本端关掉的终端，避免清单刷新时又补回标签 */
	closedTerminalIds: Set<string>;
	/** 上次打开的会话文件 */
	activeSessionFile: string | undefined;
	/** 上次新建会话落在哪个目录 */
	createCwd: string | undefined;
}

/** 一台主机的空白快照。 */
export function createWorkspaceSnapshot(): HostWorkspaceSnapshot {
	return {
		tabs: [],
		activeTabId: undefined,
		fileContents: {},
		commitDetails: {},
		closedTerminalIds: new Set(),
		activeSessionFile: undefined,
		createCwd: undefined,
	};
}
