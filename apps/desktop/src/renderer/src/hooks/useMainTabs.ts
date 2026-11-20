/**
 * 主区域的标签与标签内容。
 *
 * 标签只记“展示什么”，不记“怎么连”：会话标签随当前会话自动补齐，终端标签由终端域
 * 通过 `focusTab` / `removeTab` 推动，变更与文件文档的加载也在这里。依赖方向自上而下，
 * 这一层不引用连接层与终端层的 Hook。
 */
import type { SessionClient, SessionView } from "@facet/client-core";
import { type FileContent, type GitCommit, type GitFileChange, workspaceChannelFor } from "@facet/protocol";
import { changesTabId, commitTabId, fileTabId, type MainTab, sessionTabId, terminalTabId } from "@facet/ui";
import { type RefObject, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { decideOnSignal, shouldCatchUp } from "../changes-refresh.ts";
import { isCurrentSessionTab } from "../main-tabs.ts";
import type {
	ChangesState,
	CommitDetailState,
	CommitsState,
	HostWorkspaceSnapshot,
} from "../workspace-state.ts";

/**
 * 收到工作树信号之后等多久再取，毫秒。
 *
 * 主机侧已经把一波写盘按 500ms 合并过一次，这里再等一小会儿，是为了抹平连着来的几条
 * 信号，也避开文件正在写的那几毫秒。
 */
const SIGNAL_SETTLE_MS = 250;

/**
 * 回到前台之后等多久再补刷，毫秒。
 *
 * `focus` 与 `visibilitychange` 常常一起到，两个入口共用一个防抖，一次切回前台只发
 * 一次请求。
 */
const WAKE_SETTLE_MS = 80;

/** 窗口此刻在前台吗。失焦或隐藏时不该为主机拉一次 git 探测。 */
function windowIsActive(): boolean {
	return !document.hidden && document.hasFocus();
}

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
	refreshChanges: (options?: { force?: boolean }) => Promise<void>;
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
	const [changes, setChanges] = useState<ChangesState>({});
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

	/** 重新取工作树状态。并发调用只采用最后一次的结果。 */
	const refreshStatus = useCallback(
		async (options: { force?: boolean } = {}): Promise<void> => {
			if (sessionCwd === undefined) {
				return;
			}
			changesSeq.current += 1;
			const seq = changesSeq.current;
			setChanges((current) => ({ ...current, error: undefined }));
			const result = await client.gitStatus(sessionCwd, options).then(
				(status) => ({ ok: true as const, status }),
				(reason: unknown) => ({ ok: false as const, reason }),
			);
			if (seq !== changesSeq.current) {
				return;
			}
			if (result.ok) {
				setChanges({ status: result.status });
				return;
			}
			setChanges({
				error: result.reason instanceof Error ? result.reason.message : String(result.reason),
			});
		},
		[client, sessionCwd],
	);

	/**
	 * 重新取提交历史。
	 *
	 * 比工作树状态贵得多：主机要读完整的 log，每条还要算一次 diff 规模。所以只在提交历史
	 * 可能变了的信号上取，不跟工作树的每一次保存；主机那边也是单独一条车道，冷却更长。
	 */
	const refreshCommits = useCallback(
		async (options: { force?: boolean } = {}): Promise<void> => {
			if (sessionCwd === undefined) {
				return;
			}
			setCommits((current) => ({ ...current, isLoading: true, error: undefined }));
			try {
				setCommits({ data: await client.gitCommits(sessionCwd, options), isLoading: false });
			} catch (error: unknown) {
				setCommits((current) => ({
					data: current.data,
					isLoading: false,
					error: error instanceof Error ? error.message : String(error),
				}));
			}
		},
		[client, sessionCwd],
	);

	/**
	 * 两样一起重取：刚打开变更页、切会话、错误态的重试与回到前台时用它。
	 *
	 * `force` 一路传到主机，跳过那边的冷却窗口——用户明说要刷新或者刚刚才回到前台看这一页，
	 * 不该再等冷却。
	 */
	const refreshChanges = useCallback(
		async (options: { force?: boolean } = {}): Promise<void> => {
			await Promise.all([refreshStatus(options), refreshCommits(options)]);
		},
		[refreshStatus, refreshCommits],
	);

	/** 变更页是否正在显示：右栏停在变更分页，或主区打开着变更文档。 */
	const isChangesVisible = isPanelOnChanges || changesTab !== undefined;

	/** 当前项目目录的工作树通道；没有会话时没有通道可订。 */
	const workspaceChannel = sessionCwd === undefined ? undefined : workspaceChannelFor(sessionCwd);

	/**
	 * 变更页看得见的时候才盯工作树。
	 *
	 * 订阅就是「替我盯着这个目录」：主机按订阅者建监听，界面收起来就退订，主机的监听
	 * 跟着停，没人看的时候不为任何目录付出代价。
	 */
	useEffect(() => {
		if (!isChangesVisible || sessionCwd === undefined) {
			return;
		}
		return client.watchWorkspace(sessionCwd);
	}, [client, isChangesVisible, sessionCwd]);

	// 主机推来的两类信号：工作树变了，以及其中提交历史可能也变了
	const statusSignal = useSyncExternalStore(
		(onChange) => client.store.subscribe(onChange),
		() => (workspaceChannel === undefined ? 0 : client.store.workspaceRevision(workspaceChannel)),
	);
	const historySignal = useSyncExternalStore(
		(onChange) => client.store.subscribe(onChange),
		() => (workspaceChannel === undefined ? 0 : client.store.workspaceHistoryRevision(workspaceChannel)),
	);

	/** 改动条数超过了主机侧的上限：自动刷新暂停，等重新聚焦或用户明说要刷新。 */
	const isTruncated = changes.status?.truncated === true;
	/** 失焦期间到达的信号只在这里记一笔，回到前台再补一次。 */
	const hasPendingSignal = useRef(false);

	/**
	 * 收到信号之后等一拍再取。
	 *
	 * 主机那边已经按 500ms 合并过一波，这里再等一小会儿，是为了让同一个信号里连着的
	 * 状态取一次就够，也避开正在流式写盘的那几毫秒。
	 *
	 * 失焦或隐藏时不拉请求：主机那边监听照旧，但界面没人看，git 探测留给回到前台那一次。
	 * 超大仓同理——那种仓库每探一次都要扫一遍工作树，只在用户真的看过来时才值得。
	 */
	useEffect(() => {
		if (statusSignal === 0) {
			return;
		}
		const decision = decideOnSignal({
			isVisible: isChangesVisible,
			isActive: windowIsActive(),
			isTruncated,
		});
		if (decision.defer) {
			hasPendingSignal.current = true;
		}
		if (!decision.refresh) {
			return;
		}
		const timer = setTimeout(() => void refreshStatus(), SIGNAL_SETTLE_MS);
		return () => clearTimeout(timer);
	}, [isChangesVisible, isTruncated, statusSignal, refreshStatus]);

	useEffect(() => {
		if (historySignal === 0) {
			return;
		}
		const decision = decideOnSignal({
			isVisible: isChangesVisible,
			isActive: windowIsActive(),
			isTruncated,
		});
		if (decision.defer) {
			hasPendingSignal.current = true;
		}
		if (!decision.refresh) {
			return;
		}
		const timer = setTimeout(() => void refreshCommits(), SIGNAL_SETTLE_MS);
		return () => clearTimeout(timer);
	}, [isChangesVisible, historySignal, isTruncated, refreshCommits]);

	// 展开变更页、切换会话时各取一次：信号只覆盖「之后变了」，打开那一刻手上还没有东西
	useEffect(() => {
		if (isChangesVisible) {
			void refreshChanges();
		}
	}, [isChangesVisible, refreshChanges]);

	/**
	 * 回到前台时补一次。
	 *
	 * 平时切窗口不发请求：既没有攒下的信号，也不在等超大仓放行，就什么都不必做。真有空档
	 * 时也只发一次——`focus` 与 `visibilitychange` 走同一个防抖入口。
	 */
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const wake = (): void => {
			timer = undefined;
			const catchUp = shouldCatchUp({
				isVisible: isChangesVisible,
				isActive: windowIsActive(),
				hasPending: hasPendingSignal.current,
				isTruncated,
			});
			if (!catchUp) {
				return;
			}
			hasPendingSignal.current = false;
			void refreshChanges({ force: true });
		};
		const onWake = (): void => {
			if (timer !== undefined) {
				clearTimeout(timer);
			}
			timer = setTimeout(wake, WAKE_SETTLE_MS);
		};
		window.addEventListener("focus", onWake);
		document.addEventListener("visibilitychange", onWake);
		return () => {
			if (timer !== undefined) {
				clearTimeout(timer);
			}
			window.removeEventListener("focus", onWake);
			document.removeEventListener("visibilitychange", onWake);
		};
	}, [isChangesVisible, isTruncated, refreshChanges]);

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
