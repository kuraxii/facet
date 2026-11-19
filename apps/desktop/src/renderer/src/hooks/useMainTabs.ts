/**
 * 主区域的标签与标签内容。
 *
 * 标签只记“展示什么”，不记“怎么连”：会话标签随当前会话自动补齐，终端标签由终端域
 * 通过 `focusTab` / `removeTab` 推动，变更与文件文档的加载也在这里。依赖方向自上而下，
 * 这一层不引用连接层与终端层的 Hook。
 */
import type { SessionClient, SessionView } from "@facet/client-core";
import type { FileContent, GitCommit, GitFileChange } from "@facet/protocol";
import { changesTabId, commitTabId, fileTabId, type MainTab, sessionTabId, terminalTabId } from "@facet/ui";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { isCurrentSessionTab } from "../main-tabs.ts";
import type {
	ChangesState,
	CommitDetailState,
	CommitsState,
	HostWorkspaceSnapshot,
} from "../workspace-state.ts";

export interface MainTabsOptions {
	/** 会话客户端 */
	client: SessionClient;
	/** 当前打开的会话视图 */
	session: SessionView | undefined;
	/** 当前会话标识 */
	openedSessionId: string | undefined;
	/** 主机上的终端清单，用来给终端标签取名字 */
	terminals: readonly { id: string; cwd: string; shell: string; restored: boolean }[];
	/** 本端关掉的终端，避免清单还没刷新时又补回标签 */
	closedTerminalIds: RefObject<Set<string>>;
	/** 这台主机上一次离开时的标签与内容；切回来时从这里接着显示 */
	snapshot?: HostWorkspaceSnapshot;
	/** 右栏此刻是否停在变更分页 */
	isPanelOnChanges: boolean;
	/** 切换到一个还没打开的会话标签时交给上层打开 */
	onOpenSession?: (path: string) => void;
}

export interface MainTabs {
	/** 已打开的标签 */
	tabs: readonly MainTab[];
	/** 当前标签；为空时显示空状态 */
	activeTabId: string | undefined;
	/** 打开的文件内容，按标签标识存 */
	fileContents: Readonly<Record<string, FileContent>>;
	/** 取文件失败的原因 */
	fileError: string | undefined;
	/** 变更页数据 */
	changes: ChangesState;
	/** 提交历史 */
	commits: CommitsState;
	/** 每个提交标签的详情 */
	commitDetails: Readonly<Record<string, CommitDetailState>>;
	/** 打开或切到一个标签；同一份内容只保留一个标签 */
	focusTab: (tab: MainTab) => void;
	/** 收起一个标签并丢掉它保存的内容 */
	removeTab: (id: string) => void;
	/**
	 * 关掉一个标签。
	 *
	 * 会话标签顺带标记已关闭并释放缓存；终端标签只收起，返回它的标识，由终端域销毁进程。
	 */
	closeTab: (id: string) => string | undefined;
	/** 一次关掉多个标签；终端标签的标识交给回调销毁 */
	closeTabs: (ids: readonly string[], onTerminal: (terminalId: string) => void) => void;
	/** 切换标签；会话标签指向别的会话时先交给上层打开 */
	selectTab: (id: string) => void;
	/** 按拖动结果重排 */
	reorderTabs: (ids: readonly string[]) => void;
	/** 记下某个文件的内容 */
	setFileContent: (id: string, content: FileContent) => void;
	/** 清掉取文件的错误 */
	clearFileError: () => void;
	/** 打开一个文件：取内容后放进标签 */
	openFile: (cwd: string, path: string) => Promise<void>;
	/** 把变更页里的一行打开到变更文档 */
	openDiff: (cwd: string, file: GitFileChange) => void;
	/** 打开一次提交的改动文档 */
	openCommit: (cwd: string, commit: GitCommit) => void;
	/** 重取某个提交的详情 */
	loadCommit: (tabId: string, cwd: string, sha: string) => Promise<void>;
	/** 重取工作树状态与提交历史 */
	refreshChanges: () => Promise<void>;
	/** 删掉某个会话的标签 */
	removeSessionTabs: (path: string) => void;
}

export function useMainTabs(options: MainTabsOptions): MainTabs {
	const {
		client,
		session,
		openedSessionId,
		terminals,
		closedTerminalIds,
		snapshot,
		isPanelOnChanges,
		onOpenSession,
	} = options;
	const [tabs, setTabs] = useState<MainTab[]>(() => snapshot?.tabs ?? []);
	const [activeTabId, setActiveTabId] = useState<string | undefined>(() => snapshot?.activeTabId);
	/** 用户主动关掉的会话标签，避免会话更新时又自动补回来 */
	const closedSessionTabIds = useRef(new Set<string>());
	const [fileContents, setFileContents] = useState<Readonly<Record<string, FileContent>>>(
		() => snapshot?.fileContents ?? {},
	);
	const [fileError, setFileError] = useState<string | undefined>(undefined);
	const [changes, setChanges] = useState<ChangesState>({ isLoading: false });
	const changesSeq = useRef(0);
	const [commits, setCommits] = useState<CommitsState>({ isLoading: false });
	const [commitDetails, setCommitDetails] = useState<Record<string, CommitDetailState>>(
		() => snapshot?.commitDetails ?? {},
	);
	const commitRequests = useRef(new Map<string, number>());

	// 每次变化都写回快照：切走这台主机时组件卸载，下次挂回来从这里接着显示
	useEffect(() => {
		if (snapshot === undefined) {
			return;
		}
		snapshot.tabs = tabs;
		snapshot.activeTabId = activeTabId;
		snapshot.fileContents = fileContents;
		snapshot.commitDetails = commitDetails;
	}, [snapshot, tabs, activeTabId, fileContents, commitDetails]);

	const activeTab = tabs.find((item) => item.id === activeTabId);
	const changesTab = activeTab?.kind === "changes" ? activeTab : undefined;
	/** 会话所在的目录，git 命令都在它下面跑 */
	const sessionCwd = session?.state.cwd;

	/** 打开或切到一个标签；同一份内容只保留一个标签。 */
	const focusTab = useCallback((tab: MainTab) => {
		if (tab.kind === "session") {
			closedSessionTabIds.current.delete(tab.id);
		}
		setTabs((current) =>
			current.some((item) => item.id === tab.id)
				? current.map((item) => (item.id === tab.id ? tab : item))
				: [...current, tab],
		);
		setActiveTabId(tab.id);
	}, []);

	/** 收起一个标签，并丢掉它保存的内容。 */
	const removeTab = useCallback((id: string) => {
		setTabs((current) => current.filter((item) => item.id !== id));
		setFileContents((current) => {
			const next = { ...current };
			delete next[id];
			return next;
		});
		setCommitDetails((current) => {
			if (!(id in current)) {
				return current;
			}
			const next = { ...current };
			delete next[id];
			return next;
		});
		commitRequests.current.delete(id);
		setActiveTabId((current) => (current === id ? undefined : current));
	}, []);

	/** 关掉一个标签；终端标签把标识交回去，由终端域销毁进程。 */
	const closeTab = useCallback(
		(id: string): string | undefined => {
			const tab = tabs.find((item) => item.id === id);
			if (tab?.kind === "session") {
				closedSessionTabIds.current.add(id);
				if (tab.file !== undefined) client.closeSession(tab.file);
			}
			removeTab(id);
			return tab?.kind === "terminal" ? tab.terminalId : undefined;
		},
		[client, removeTab, tabs],
	);

	/** 一次关闭多个标签；终端仍走单个关闭流程。 */
	const closeTabs = useCallback(
		(ids: readonly string[], onTerminal: (terminalId: string) => void) => {
			for (const id of ids) {
				const terminalId = closeTab(id);
				if (terminalId !== undefined) {
					onTerminal(terminalId);
				}
			}
		},
		[closeTab],
	);

	/** 按拖动结果重排；标识对不上时保持原顺序。 */
	const reorderTabs = useCallback((ids: readonly string[]) => {
		setTabs((current) => {
			if (ids.length !== current.length) {
				return current;
			}
			const byId = new Map(current.map((tab) => [tab.id, tab]));
			const next: MainTab[] = [];
			for (const id of ids) {
				const tab = byId.get(id);
				if (tab === undefined) {
					return current;
				}
				next.push(tab);
			}
			return next.some((tab, index) => tab !== current[index]) ? next : current;
		});
	}, []);

	const setFileContent = useCallback((id: string, content: FileContent) => {
		setFileContents((current) => ({ ...current, [id]: content }));
	}, []);

	const clearFileError = useCallback(() => setFileError(undefined), []);

	const removeSessionTabs = useCallback((path: string) => {
		setTabs((current) => current.filter((tab) => !(tab.kind === "session" && tab.file === path)));
	}, []);

	// 会话打开或切换后，保证它有一个标签；首次打开时把焦点放到它上面
	const currentSessionTabId =
		session === undefined ? undefined : sessionTabId(session.state.file, openedSessionId ?? session.channel);
	useEffect(() => {
		if (session === undefined || currentSessionTabId === undefined) {
			return;
		}
		if (closedSessionTabIds.current.has(currentSessionTabId)) {
			return;
		}
		setTabs((current) =>
			current.some((item) => item.id === currentSessionTabId)
				? current
				: [
						...current,
						{
							id: currentSessionTabId,
							kind: "session",
							file: session.state.file,
							sessionId: openedSessionId ?? session.channel,
						},
					],
		);
		setActiveTabId((current) => current ?? currentSessionTabId);
	}, [currentSessionTabId, openedSessionId, session]);

	// 标签被关掉后把焦点移到剩下的第一个，避免主区域空白
	useEffect(() => {
		if (tabs.length === 0) {
			setActiveTabId(undefined);
			return;
		}
		if (activeTabId === undefined || !tabs.some((item) => item.id === activeTabId)) {
			setActiveTabId(tabs[0]?.id);
		}
	}, [activeTabId, tabs]);

	// 主机上已经打开的终端都补成标签，不抢当前焦点
	useEffect(() => {
		const open = terminals.filter(
			(terminal) => !terminal.restored && !closedTerminalIds.current.has(terminal.id),
		);
		if (open.length === 0) {
			return;
		}
		setTabs((current) => {
			const missing = open.filter(
				(terminal) => !current.some((tab) => tab.kind === "terminal" && tab.terminalId === terminal.id),
			);
			if (missing.length === 0) {
				return current;
			}
			return [
				...current,
				...missing.map((terminal) => ({
					id: terminalTabId(terminal.id),
					kind: "terminal" as const,
					terminalId: terminal.id,
				})),
			];
		});
	}, [closedTerminalIds, terminals]);

	// 提交历史与变更状态跟着当前会话目录；换项目时丢掉旧列表并关掉对不上的变更标签
	useEffect(() => {
		changesSeq.current += 1;
		setCommits({ isLoading: false });
		setTabs((current) => {
			const next = current.filter(
				(tab) => tab.kind !== "changes" || (sessionCwd !== undefined && tab.cwd === sessionCwd),
			);
			return next.length === current.length ? current : next;
		});
	}, [sessionCwd]);

	// 换会话时清掉上一个会话留下的文件错误提示
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在会话变化时清空，状态设置函数不必列入
	useEffect(() => {
		setFileError(undefined);
	}, [session?.state.file]);

	/** 打开一个文件：取内容后放进主区域标签。 */
	const openFile = useCallback(
		async (cwd: string, path: string): Promise<void> => {
			const id = fileTabId(cwd, path);
			setFileError(undefined);
			try {
				const content = await client.readFile(cwd, path);
				setFileContents((current) => ({ ...current, [id]: content }));
				focusTab({ id, kind: "file", cwd, path });
			} catch (error) {
				setFileError(error instanceof Error ? error.message : String(error));
			}
		},
		[client, focusTab],
	);

	/** 把变更页里的一行打开到变更文档，并定位到该文件。 */
	const openDiff = useCallback(
		(cwd: string, file: GitFileChange): void => {
			focusTab({
				id: changesTabId(cwd),
				kind: "changes",
				cwd,
				focusPath: file.path,
				focusRequestId: Date.now(),
			});
		},
		[focusTab],
	);

	/** 取一次提交的改动详情；同一个标签的旧请求不会覆盖新结果。 */
	const loadCommit = useCallback(
		async (tabId: string, cwd: string, sha: string): Promise<void> => {
			const request = (commitRequests.current.get(tabId) ?? 0) + 1;
			commitRequests.current.set(tabId, request);
			setCommitDetails((current) => ({
				...current,
				[tabId]: { ...current[tabId], isLoading: true, error: undefined },
			}));
			try {
				const detail = await client.gitCommit(cwd, sha);
				if (commitRequests.current.get(tabId) === request) {
					setCommitDetails((current) => ({
						...current,
						[tabId]: { detail, isLoading: false },
					}));
				}
			} catch (error) {
				if (commitRequests.current.get(tabId) === request) {
					setCommitDetails((current) => ({
						...current,
						[tabId]: {
							detail: current[tabId]?.detail,
							isLoading: false,
							error: error instanceof Error ? error.message : String(error),
						},
					}));
				}
			}
		},
		[client],
	);

	/** 打开一次提交的改动文档；同一提交只保留一个标签。 */
	const openCommit = useCallback(
		(cwd: string, commit: GitCommit): void => {
			const tabId = commitTabId(cwd, commit.sha);
			focusTab({
				id: tabId,
				kind: "commit",
				cwd,
				sha: commit.sha,
				shortSha: commit.shortSha,
				subject: commit.subject,
			});
			const current = commitDetails[tabId];
			if (current?.isLoading !== true && (current?.detail === undefined || current.error !== undefined)) {
				void loadCommit(tabId, cwd, commit.sha);
			}
		},
		[commitDetails, focusTab, loadCommit],
	);

	/** 重新取工作树状态与提交历史。并发调用只采用最后一次的结果。 */
	const refreshChanges = useCallback(async (): Promise<void> => {
		if (sessionCwd === undefined) {
			return;
		}
		changesSeq.current += 1;
		const seq = changesSeq.current;
		setChanges((current) => ({ ...current, isLoading: true, error: undefined }));
		setCommits((current) => ({ ...current, isLoading: true, error: undefined }));
		const [statusResult, commitsResult] = await Promise.allSettled([
			client.gitStatus(sessionCwd),
			client.gitCommits(sessionCwd),
		]);
		if (seq !== changesSeq.current) {
			return;
		}
		if (statusResult.status === "fulfilled") {
			setChanges({ status: statusResult.value, isLoading: false });
		} else {
			setChanges({
				isLoading: false,
				error:
					statusResult.reason instanceof Error ? statusResult.reason.message : String(statusResult.reason),
			});
		}
		if (commitsResult.status === "fulfilled") {
			setCommits({ data: commitsResult.value, isLoading: false });
		} else {
			setCommits((current) => ({
				data: current.data,
				isLoading: false,
				error:
					commitsResult.reason instanceof Error ? commitsResult.reason.message : String(commitsResult.reason),
			}));
		}
	}, [client, sessionCwd]);

	/** 变更页是否正在显示：右栏停在变更分页，或主区打开着变更文档。 */
	const isChangesVisible = isPanelOnChanges || changesTab !== undefined;

	// 展开变更页、切换会话、窗口重新获得焦点时各取一次
	useEffect(() => {
		if (isChangesVisible) {
			void refreshChanges();
		}
	}, [isChangesVisible, refreshChanges]);

	useEffect(() => {
		if (!isChangesVisible) {
			return;
		}
		const onFocus = (): void => void refreshChanges();
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [isChangesVisible, refreshChanges]);

	/** 切换标签；会话标签指向别的会话时先把它打开。 */
	const selectTab = useCallback(
		(id: string): void => {
			const tab = tabs.find((item) => item.id === id);
			if (tab === undefined) {
				return;
			}
			if (tab.kind !== "session") {
				setActiveTabId(id);
				return;
			}
			if (isCurrentSessionTab(tab, { session, openedSessionId, summaries: [] }) || tab.file === undefined) {
				setActiveTabId(id);
				return;
			}
			if (client.hasSession(tab.file)) {
				setActiveTabId(id);
			}
			onOpenSession?.(tab.file);
		},
		[client, onOpenSession, openedSessionId, session, tabs],
	);

	return {
		tabs,
		activeTabId,
		fileContents,
		fileError,
		changes,
		commits,
		commitDetails,
		focusTab,
		removeTab,
		closeTab,
		closeTabs,
		selectTab,
		reorderTabs,
		setFileContent,
		clearFileError,
		openFile,
		openDiff,
		openCommit,
		loadCommit,
		refreshChanges,
		removeSessionTabs,
	};
}

/** 判断一条标签是否指向当前会话，供上层切换标签时复用。 */
export { isCurrentSessionTab };
