/**
 * 工作区里属于某台主机的轻量内存状态（不落盘）。
 *
 * 切走一台主机时它的界面会整份卸载（DOM 里只留当前主机的），但下次切回来只要会话还在
 * 缓存中，不该从空白开始：每个会话各自关联的右栏开合、标签页列表、激活标签与正在预览的
 * 文件都保存在本快照的 `sessions` 映射里，随会话回收一并清理、不写入本地存储。
 *
 * 只放界面状态：会话与终端的真实数据在各自的客户端里，连接本身在连接链路里。
 */
import type { FileContent, GitCommitDetail, GitCommits, GitStatus } from "@facet/protocol";
import { DEFAULT_PANEL_TAB_STATE, type PanelTabState } from "@facet/ui";

/** 无会话草稿/引导页在内存状态映射中使用的键。 */
export const DRAFT_SESSION_KEY = "";

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

/** 单个会话关联的工作区右栏内存状态（不落盘）。 */
export interface SessionWorkspaceState {
	/** 右栏开合、已打开标签与激活项 */
	panel: PanelTabState;
	/** 文件页当前正在预览的文件 */
	file: WorkspaceFileRef | undefined;
}

/** 一台主机的工作区快照。字段与各 Hook 的初始状态一一对应。 */
export interface HostWorkspaceSnapshot {
	/** 按会话标识（会话文件路径或 `DRAFT_SESSION_KEY`）存放的右栏内存状态 */
	sessions: Map<string, SessionWorkspaceState>;
	/** 打开的文件内容，按「项目目录 + 路径」存 */
	fileContents: Readonly<Record<string, FileContent>>;
	/** 提交改动详情，按「项目目录 + 哈希」存 */
	commitDetails: Readonly<Record<string, CommitDetailState>>;
	/** 上次打开的会话文件 */
	activeSessionFile: string | undefined;
	/** 上次新建会话落在哪个目录 */
	createCwd: string | undefined;
}

/** 构造空白的会话级工作区状态。 */
export function createSessionWorkspaceState(): SessionWorkspaceState {
	return {
		panel: { ...DEFAULT_PANEL_TAB_STATE },
		file: undefined,
	};
}

/** 把当前激活会话路径转为工作区状态键。 */
export function workspaceSessionKey(activeFile: string | undefined): string {
	return activeFile !== undefined && activeFile.length > 0 ? activeFile : DRAFT_SESSION_KEY;
}

/** 读取某个会话的右栏内存状态（不存在时返回默认空白状态，不写回映射）。 */
export function getSessionWorkspaceState(
	snapshot: HostWorkspaceSnapshot,
	sessionKey: string,
): SessionWorkspaceState {
	return snapshot.sessions.get(sessionKey) ?? createSessionWorkspaceState();
}

/** 写入某个会话的右栏标签页状态。 */
export function setSessionWorkspacePanel(
	snapshot: HostWorkspaceSnapshot,
	sessionKey: string,
	panel: PanelTabState,
): void {
	const existing = snapshot.sessions.get(sessionKey);
	if (existing !== undefined) {
		existing.panel = panel;
		return;
	}
	snapshot.sessions.set(sessionKey, { panel, file: undefined });
}

/** 写入某个会话正在预览的文件引用。 */
export function setSessionWorkspaceFile(
	snapshot: HostWorkspaceSnapshot,
	sessionKey: string,
	file: WorkspaceFileRef | undefined,
): void {
	const existing = snapshot.sessions.get(sessionKey);
	if (existing !== undefined) {
		existing.file = file;
		return;
	}
	if (file === undefined) {
		return;
	}
	snapshot.sessions.set(sessionKey, { panel: { ...DEFAULT_PANEL_TAB_STATE }, file });
}

/** 会话被回收或释放后清除其关联的右栏标签与预览文件引用。 */
export function evictSessionWorkspaceState(snapshot: HostWorkspaceSnapshot, sessionKey: string): boolean {
	return snapshot.sessions.delete(sessionKey);
}

/** 一台主机的空白快照。 */
export function createWorkspaceSnapshot(): HostWorkspaceSnapshot {
	return {
		sessions: new Map(),
		fileContents: {},
		commitDetails: {},
		activeSessionFile: undefined,
		createCwd: undefined,
	};
}
