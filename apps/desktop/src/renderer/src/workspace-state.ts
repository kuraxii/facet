/**
 * 工作区里属于某台主机的轻量状态。
 *
 * 切走一台主机时它的界面会整份卸载（DOM 里只留当前主机的），但下次切回来不该从空白开始：
 * 正在预览哪个文件、文件内容与提交详情读到哪一步、上次新建会话落在哪个目录，这些只与那台
 * 主机有关，按端点存在渲染进程的内存里，随运行时一起活、一起销毁。
 *
 * 只放界面状态：会话与终端的真实数据在各自的客户端里，连接本身在连接链路里。
 */
import type { FileContent, GitCommitDetail, GitCommits, GitStatus } from "@facet/protocol";

/** 变更页的数据、加载状态与失败原因。 */
export interface ChangesState {
	/** 工作树状态；还没取到时为空 */
	readonly status?: GitStatus;
	/** 失败原因 */
	readonly error?: string;
}

/** 提交历史的数据、加载状态与失败原因。 */
export interface CommitsState {
	/** 已经拿到的提交列表；分页时是累积的那一份 */
	readonly data?: GitCommits;
	/** 是否正在取第一页 */
	readonly isLoading: boolean;
	/** 是否正在取下一页 */
	readonly isLoadingMore?: boolean;
	/** 失败原因 */
	readonly error?: string;
}

/** 一次提交的改动详情与加载状态。 */
export interface CommitDetailState {
	/** 取回来的详情 */
	readonly detail?: GitCommitDetail;
	/** 是否正在取 */
	readonly isLoading: boolean;
	/** 失败原因 */
	readonly error?: string;
}

/** 工作区里正在预览的文件：项目目录与相对项目根的路径。 */
export interface WorkspaceFileRef {
	/** 文件所属的项目目录 */
	readonly cwd: string;
	/** 相对项目根的路径 */
	readonly path: string;
}

/** 工作区里正在预览的提交。 */
export interface WorkspaceCommitRef {
	/** 提交所属的项目目录 */
	readonly cwd: string;
	/** 完整提交哈希 */
	readonly sha: string;
	/** 短哈希，文档标题用它 */
	readonly shortSha: string;
	/** 提交说明，文档标题用它 */
	readonly subject: string;
}

/** 一台主机的工作区快照。字段与各 Hook 的初始状态一一对应。 */
export interface HostWorkspaceSnapshot {
	/** 正在预览的文件；为空时文件分页只有树 */
	file: WorkspaceFileRef | undefined;
	/** 打开的文件内容，按「项目目录 + 路径」存 */
	fileContents: Readonly<Record<string, FileContent>>;
	/** 提交改动详情，按「项目目录 + 哈希」存 */
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
		file: undefined,
		fileContents: {},
		commitDetails: {},
		closedTerminalIds: new Set(),
		activeSessionFile: undefined,
		createCwd: undefined,
	};
}
