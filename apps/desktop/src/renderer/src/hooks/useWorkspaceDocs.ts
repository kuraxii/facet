/**
 * 工作区里的文档与改动。
 *
 * 右栏的四类工具各有自己的数据：文件要读文件与预览的那一份内容；变更要工作树状态与补丁；
 * 提交图谱要分页的提交历史与单次提交的详情；终端的数据在终端域里。这一层只管前三个，
 * 不碰标签栏，也不决定停在哪个标签——那是外壳的事。依赖方向自上而下，这里不引用连接层
 * 与终端层。
 *
 * 两层的刷新节奏刻意不同：工作树状态跟着文件保存走（高频）；提交历史只在图谱看得见时
 * 才取，并且分页（低频）。图谱打开时如果工作树状态已经刷新过（HEAD 很可能动了），就标记
 * 成「历史过期」，由图谱自己决定什么时候重取第一页。
 */

import type { SessionClient, SessionView } from "@facet/client-core";
import { type FileContent, type GitFileChange, workspaceChannelFor } from "@facet/protocol";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { decideOnSignal, shouldCatchUp } from "../changes-refresh.ts";
import type { ScopedStorage } from "../local-storage.ts";
import type {
	ChangesState,
	CommitDetailState,
	CommitsState,
	HostWorkspaceSnapshot,
	WorkspaceFileRef,
} from "../workspace-state.ts";

const WORKSPACE_FILE_KEY = "facet.workspace.file";

function readStoredFileRef(storage: ScopedStorage | undefined): WorkspaceFileRef | undefined {
	const raw = storage?.getItem(WORKSPACE_FILE_KEY);
	if (raw === null || raw === undefined) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			typeof (parsed as { cwd?: unknown }).cwd === "string" &&
			typeof (parsed as { path?: unknown }).path === "string"
		) {
			return { cwd: (parsed as { cwd: string }).cwd, path: (parsed as { path: string }).path };
		}
	} catch {
		return undefined;
	}
	return undefined;
}

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

/** 提交图谱每页取多少条：一页够撑满一屏多一点，滚到底再要下一页。 */
const COMMIT_PAGE_SIZE = 200;

/** 窗口此刻在前台吗。失焦或隐藏时不该为主机拉一次 git 探测。 */
function windowIsActive(): boolean {
	return !document.hidden && document.hasFocus();
}

/** 文件内容的键：同一个项目里的同一个路径只存一份。 */
export function workspaceFileKey(cwd: string, path: string): string {
	return `${cwd}:${path}`;
}

/** 提交详情的键：同一个项目里的同一个哈希只取一次。 */
export function workspaceCommitKey(cwd: string, sha: string): string {
	return `${cwd}:${sha}`;
}

export interface WorkspaceDocsOptions {
	/** 会话客户端 */
	client: SessionClient;
	/** 当前打开的会话视图 */
	session: SessionView | undefined;
	/** 这台主机上一次离开时的文档状态；切回来时从这里接着显示 */
	snapshot?: HostWorkspaceSnapshot;
	/** 按主机隔离的持久化存储，用于跨重启恢复正在预览的文件 */
	storage?: ScopedStorage;
	/** 变更页是否正在显示：它决定要不要盯住工作树 */
	isChangesVisible: boolean;
	/** 提交图谱是否正在显示：历史只在有人看的时候才取 */
	isHistoryVisible: boolean;
}

export interface WorkspaceDocs {
	/** 正在预览的文件；为空时文件分页只有树 */
	file: WorkspaceFileRef | undefined;
	/** 打开的文件内容，按 `workspaceFileKey` 存 */
	fileContents: Readonly<Record<string, FileContent>>;
	/** 取文件失败的原因 */
	fileError: string | undefined;
	/** 变更页数据 */
	changes: ChangesState;
	/** 提交历史（分页累积） */
	commits: CommitsState;
	/** 拿到手的这段历史可能已经过期：工作树刷新过，HEAD 也许动了 */
	isHistoryStale: boolean;
	/** 每个提交的改动详情，按 `workspaceCommitKey` 存 */
	commitDetails: Readonly<Record<string, CommitDetailState>>;
	/** 变更预览要定位到的文件；没有时从文档顶部开始 */
	changesFocus: { path: string; requestId: number } | undefined;
	/** 打开一个文件：取内容之后放进预览 */
	openFile: (cwd: string, path: string) => Promise<void>;
	/** 记下某个文件的新内容 */
	setFileContent: (key: string, content: FileContent) => void;
	/** 清掉取文件的错误 */
	clearFileError: () => void;
	/** 在变更预览里定位到某个文件，并回到工作树那一份 */
	focusDiff: (file: GitFileChange) => void;
	/** 重取某个提交的详情 */
	loadCommit: (cwd: string, sha: string) => Promise<void>;
	/** 重取工作树状态（变更页的刷新） */
	refreshChanges: (options?: { force?: boolean }) => Promise<void>;
	/** 重取提交历史的第一页（图谱的刷新） */
	refreshCommits: (options?: { force?: boolean }) => Promise<void>;
	/** 取下一页追加到列表末尾 */
	loadMoreCommits: () => Promise<void>;
}

export function useWorkspaceDocs(options: WorkspaceDocsOptions): WorkspaceDocs {
	const { client, session, snapshot, storage, isChangesVisible, isHistoryVisible } = options;
	const [file, setFile] = useState<WorkspaceFileRef | undefined>(
		() => snapshot?.file ?? readStoredFileRef(storage),
	);
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
	const [changesFocus, setChangesFocus] = useState<{ path: string; requestId: number } | undefined>(
		undefined,
	);
	const commitRequests = useRef(new Map<string, number>());
	/** 工作树状态刷新的次数与取历史时的那一次：两个数不等就说明历史可能落后于 HEAD */
	const worktreeRevision = useRef(0);
	const [historyRevision, setHistoryRevision] = useState(0);

	// 每次变化都写回快照与主机级存储：切主机与重启后都能恢复预览文件
	useEffect(() => {
		if (snapshot !== undefined) {
			snapshot.file = file;
			snapshot.fileContents = fileContents;
			snapshot.commitDetails = commitDetails;
		}
		if (storage !== undefined) {
			if (file !== undefined) {
				storage.setItem(WORKSPACE_FILE_KEY, JSON.stringify(file));
			} else {
				storage.removeItem(WORKSPACE_FILE_KEY);
			}
		}
	}, [snapshot, storage, file, fileContents, commitDetails]);

	/** 会话所在的目录，git 命令都在它下面跑 */
	const sessionCwd = session?.state.cwd;

	// 提交历史与变更状态跟着当前会话目录；仅当切换到真实新目录时清掉旧项目预览（初始未就绪不清空）
	useEffect(() => {
		changesSeq.current += 1;
		setCommits({ isLoading: false });
		worktreeRevision.current = 0;
		setHistoryRevision(0);
		setChangesFocus(undefined);
		if (sessionCwd !== undefined) {
			setFile((current) => (current !== undefined && current.cwd === sessionCwd ? current : undefined));
		}
	}, [sessionCwd]);

	// 重启恢复出预览文件引用但内容尚未加载时，自动拉取一次文件内容
	useEffect(() => {
		if (file === undefined || sessionCwd === undefined || file.cwd !== sessionCwd) {
			return;
		}
		const key = workspaceFileKey(file.cwd, file.path);
		if (fileContents[key] !== undefined) {
			return;
		}
		void client
			.readFile(file.cwd, file.path)
			.then((content) => {
				setFileContents((current) => (current[key] !== undefined ? current : { ...current, [key]: content }));
			})
			.catch((error: unknown) => {
				setFileError(error instanceof Error ? error.message : String(error));
			});
	}, [client, file, fileContents, sessionCwd]);

	// 换会话时清掉上一个会话留下的文件错误提示
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在会话变化时清空，状态设置函数不必列入
	useEffect(() => {
		setFileError(undefined);
	}, [session?.state.file]);

	/** 打开一个文件：取内容之后放进预览。 */
	const openFile = useCallback(
		async (cwd: string, path: string): Promise<void> => {
			setFileError(undefined);
			setFile({ cwd, path });
			try {
				const content = await client.readFile(cwd, path);
				setFileContents((current) => ({ ...current, [workspaceFileKey(cwd, path)]: content }));
			} catch (error) {
				setFileError(error instanceof Error ? error.message : String(error));
			}
		},
		[client],
	);

	const setFileContent = useCallback((key: string, content: FileContent) => {
		setFileContents((current) => ({ ...current, [key]: content }));
	}, []);

	const clearFileError = useCallback(() => setFileError(undefined), []);

	/** 在变更预览里定位到某个文件。 */
	const focusDiff = useCallback((changed: GitFileChange): void => {
		setChangesFocus({ path: changed.path, requestId: Date.now() });
	}, []);

	/** 取一次提交的改动详情；同一个提交的旧请求不会覆盖新结果。 */
	const loadCommit = useCallback(
		async (cwd: string, sha: string): Promise<void> => {
			const key = workspaceCommitKey(cwd, sha);
			const request = (commitRequests.current.get(key) ?? 0) + 1;
			commitRequests.current.set(key, request);
			setCommitDetails((current) => ({
				...current,
				[key]: { ...current[key], isLoading: true, error: undefined },
			}));
			try {
				const detail = await client.gitCommit(cwd, sha);
				if (commitRequests.current.get(key) === request) {
					setCommitDetails((current) => ({ ...current, [key]: { detail, isLoading: false } }));
				}
			} catch (error) {
				if (commitRequests.current.get(key) === request) {
					setCommitDetails((current) => ({
						...current,
						[key]: {
							detail: current[key]?.detail,
							isLoading: false,
							error: error instanceof Error ? error.message : String(error),
						},
					}));
				}
			}
		},
		[client],
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
				worktreeRevision.current += 1;
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
	 * 重新取提交历史的第一页。
	 *
	 * 比工作树状态贵得多：主机要读 log，每条还要算一次 diff 规模。所以只在图谱看得见、
	 * 或者图谱自己发现历史过期时才取；主机那边也是单独一条车道，冷却更长。
	 */
	const refreshCommits = useCallback(
		async (options: { force?: boolean } = {}): Promise<void> => {
			if (sessionCwd === undefined) {
				return;
			}
			const revision = worktreeRevision.current;
			setCommits((current) => ({ ...current, isLoading: true, error: undefined }));
			try {
				const data = await client.gitCommits(sessionCwd, { ...options, limit: COMMIT_PAGE_SIZE });
				setCommits({ data, isLoading: false, isLoadingMore: false });
				setHistoryRevision(revision);
			} catch (error: unknown) {
				setCommits((current) => ({
					data: current.data,
					isLoading: false,
					isLoadingMore: false,
					error: error instanceof Error ? error.message : String(error),
				}));
			}
		},
		[client, sessionCwd],
	);

	/** 取下一页并追加：主机那边按 `skip` 跳过已经拿到的那几条。 */
	const loadMoreCommits = useCallback(async (): Promise<void> => {
		if (sessionCwd === undefined) {
			return;
		}
		const loaded = commits.data;
		if (loaded === undefined || loaded.hasMore !== true || commits.isLoadingMore) {
			return;
		}
		setCommits((current) => ({ ...current, isLoadingMore: true, error: undefined }));
		try {
			const next = await client.gitCommits(sessionCwd, {
				limit: COMMIT_PAGE_SIZE,
				skip: loaded.commits.length,
			});
			setCommits((current) => {
				const head = current.data?.commits ?? [];
				return {
					data: {
						...next,
						commits: [...head, ...next.commits],
					},
					isLoading: false,
					isLoadingMore: false,
				};
			});
		} catch (error: unknown) {
			setCommits((current) => ({
				...current,
				isLoadingMore: false,
				error: error instanceof Error ? error.message : String(error),
			}));
		}
	}, [client, commits.data, commits.isLoadingMore, sessionCwd]);

	/**
	 * 两样一起重取：刚打开变更页、切会话、错误态的重试与回到前台时用它。
	 *
	 * `force` 一路传到主机，跳过那边的冷却窗口——用户明说要刷新或者刚刚才回到前台看这一页，
	 * 不该再等冷却。
	 */
	const refreshChanges = useCallback(
		async (options: { force?: boolean } = {}): Promise<void> => {
			await refreshStatus(options);
		},
		[refreshStatus],
	);

	/** 当前项目目录的工作树通道；没有会话时没有通道可订。 */
	const workspaceChannel = sessionCwd === undefined ? undefined : workspaceChannelFor(sessionCwd);

	/**
	 * 变更页看得见的时候才盯工作树。
	 *
	 * 订阅就是「替我盯着这个目录」：主机按订阅者建监听，界面收起来就退订，主机的监听
	 * 跟着停，没人看的时候不为任何目录付出代价。
	 */
	useEffect(() => {
		if ((!isChangesVisible && !isHistoryVisible) || sessionCwd === undefined) {
			return;
		}
		return client.watchWorkspace(sessionCwd);
	}, [client, isChangesVisible, isHistoryVisible, sessionCwd]);

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
			isVisible: isChangesVisible || isHistoryVisible,
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
	}, [isChangesVisible, isHistoryVisible, isTruncated, statusSignal, refreshStatus]);

	useEffect(() => {
		if (historySignal === 0) {
			return;
		}
		const decision = decideOnSignal({
			isVisible: isHistoryVisible,
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
	}, [isHistoryVisible, historySignal, isTruncated, refreshCommits]);

	// 展开变更页、切换会话时各取一次：信号只覆盖「之后变了」，打开那一刻手上还没有东西
	useEffect(() => {
		if (isChangesVisible) {
			void refreshChanges();
		}
	}, [isChangesVisible, refreshChanges]);

	/*
	 * 图谱第一次打开、或者历史已经过期时取一次第一页。
	 *
	 * 过期判据是「工作树状态刷新过，而那次刷新晚于取历史」——最常见的来源就是用户在别处
	 * 提交了东西（HEAD 动了），这时图谱该显示新提交，而不是上一次的缓存。
	 */
	useEffect(() => {
		if (!isHistoryVisible) {
			return;
		}
		if (commits.data === undefined || worktreeRevision.current > historyRevision) {
			void refreshCommits({ force: true });
		}
	}, [isHistoryVisible, commits.data, historyRevision, refreshCommits]);

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
				isVisible: isChangesVisible || isHistoryVisible,
				isActive: windowIsActive(),
				hasPending: hasPendingSignal.current,
				isTruncated,
			});
			if (!catchUp) {
				return;
			}
			hasPendingSignal.current = false;
			void refreshChanges({ force: true });
			if (isHistoryVisible) {
				void refreshCommits({ force: true });
			}
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
	}, [isChangesVisible, isHistoryVisible, isTruncated, refreshChanges, refreshCommits]);

	return useMemo(
		() => ({
			file,
			fileContents,
			fileError,
			changes,
			commits,
			isHistoryStale: commits.data !== undefined && worktreeRevision.current > historyRevision,
			commitDetails,
			changesFocus,
			openFile,
			setFileContent,
			clearFileError,
			focusDiff,
			loadCommit,
			refreshChanges,
			refreshCommits,
			loadMoreCommits,
		}),
		[
			file,
			fileContents,
			fileError,
			changes,
			commits,
			historyRevision,
			commitDetails,
			changesFocus,
			openFile,
			setFileContent,
			clearFileError,
			focusDiff,
			loadCommit,
			refreshChanges,
			refreshCommits,
			loadMoreCommits,
		],
	);
}
