/**
 * 会话与项目的生命周期。
 *
 * 这一层依赖连接结果（`connectEpoch` 变化就整份重取），不反向通知连接层。主机之间靠
 * 工作区整份挂载隔离：换一台主机时组件跟着换，这里没有「换主机」这个概念。
 */
import type { SessionClient } from "@facet/client-core";
import type { ProjectInfo, SessionStatus, SessionSummary } from "@facet/protocol";
import { samePath } from "@facet/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HostWorkspaceSnapshot } from "../workspace-state.ts";

/** 打开类操作失败时的提示，带重试入口。 */
export interface SessionErrorNotice {
	/** 给界面看的事实 */
	readonly message: string;
	/** 再试一次同一个动作 */
	readonly retry: () => void;
}

/** 等用户决定信任的目录，与决定之后要执行的动作。 */
interface TrustPrompt {
	readonly cwd: string;
	readonly run: () => void;
}

/** 取出各会话此刻的状态，侧栏按会话文件路径索引。 */
function statusesOf(client: SessionClient): ReadonlyMap<string, SessionStatus> {
	return new Map(client.store.sessionList().map((entry) => [entry.summary.path, entry.status]));
}

/**
 * 两份状态是否一样。
 *
 * 状态是对象，引用比不出版本差别，得逐字段比：流式期间这里每帧都会走到，判不等就会把
 * 侧栏的 memo 打断，等于没做优化。
 */
function sameStatus(left: SessionStatus, right: SessionStatus): boolean {
	if (
		left.activity !== right.activity ||
		left.pendingInput !== right.pendingInput ||
		left.seenAt !== right.seenAt
	) {
		return false;
	}
	if (left.settle === undefined || right.settle === undefined) {
		return left.settle === right.settle;
	}
	return (
		left.settle.at === right.settle.at &&
		left.settle.outcome === right.settle.outcome &&
		left.settle.message === right.settle.message
	);
}

/** 两份状态表是否一样。内容没变时沿用旧的引用，下游的 memo 才不会被无谓地打断。 */
function sameStatuses(
	left: ReadonlyMap<string, SessionStatus>,
	right: ReadonlyMap<string, SessionStatus>,
): boolean {
	if (left.size !== right.size) {
		return false;
	}
	for (const [key, value] of right) {
		const current = left.get(key);
		if (current === undefined || !sameStatus(current, value)) {
			return false;
		}
	}
	return true;
}

/** 两份会话清单是否一样。摘要对象在没变时是同一个引用，逐项比引用即可。 */
function sameSessions(left: readonly SessionSummary[], right: readonly SessionSummary[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < right.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

/** 把一条项目并进列表：同一个标识就替换，没有就追加，保持原有顺序。 */
function mergeProject(list: readonly ProjectInfo[], project: ProjectInfo): ProjectInfo[] {
	const index = list.findIndex((item) => item.id === project.id);
	if (index < 0) {
		return [...list, project];
	}
	const next = [...list];
	next[index] = project;
	return next;
}

/**
 * 启动时打开的会话：启动目录里最近更新的一条，没有则取全部会话里最近的一条。
 *
 * 远端主机没有「启动目录」这个概念（那是本机进程被拉起来时所在的目录），给空即按全部
 * 会话里最近的一条挑。
 */
export function pickStartupSession(
	sessions: readonly SessionSummary[],
	projectDir: string | undefined,
): SessionSummary | undefined {
	let scoped: SessionSummary | undefined;
	let newest: SessionSummary | undefined;
	for (const session of sessions) {
		if (newest === undefined || session.modified > newest.modified) {
			newest = session;
		}
		if (projectDir === undefined || !samePath(session.cwd, projectDir)) {
			continue;
		}
		if (scoped === undefined || session.modified > scoped.modified) {
			scoped = session;
		}
	}
	return scoped ?? newest;
}

/**
 * 新建会话默认落在哪个项目目录。
 *
 * 本机优先用启动目录（桌面被拉起来时所在的仓库），那台主机上没有这个项目时退回清单里的
 * 第一个；一个项目都没有时为空，界面据此不给「新建会话」的入口。
 */
function pickProjectCwd(
	projects: readonly ProjectInfo[] | undefined,
	projectDir: string | undefined,
): string | undefined {
	if (projectDir !== undefined) {
		const matched = projects?.find((project) => samePath(project.cwd, projectDir));
		if (matched !== undefined) {
			return matched.cwd;
		}
	}
	return projects?.[0]?.cwd;
}

export interface SessionLifecycleOptions {
	/** 会话客户端 */
	client: SessionClient;
	/** 第几次连接就绪；变化即整份重取 */
	connectEpoch: number;
	/** 启动目录，用来挑启动时打开的会话；远端主机没有这一项 */
	projectDir: string | undefined;
	/** 这台主机上一次离开时的选中会话与落地目录；切回来时从这里接着显示 */
	snapshot?: HostWorkspaceSnapshot;
	/** 打开会话之后的收尾，例如把标签摆到主区域 */
	onSessionOpened?: (file: string) => void;
	/** 删掉会话之后的收尾，例如清掉相关标签与滚动位置 */
	onSessionRemoved?: (path: string) => void;
}

export interface SessionLifecycle {
	/** 主机上的会话清单 */
	sessions: readonly SessionSummary[];
	/** 各会话的活动状态，侧栏行首的状态点用它 */
	statuses: ReadonlyMap<string, SessionStatus>;
	/** 当前打开的会话文件 */
	activeFile: string | undefined;
	/** 项目清单 */
	projects: readonly ProjectInfo[];
	/** 项目列表上一次拉取失败，侧栏据此给出刷新入口 */
	isProjectsStale: boolean;
	/** 新建项目弹窗是否打开 */
	isProjectDialogOpen: boolean;
	/** 新建会话落在哪个目录 */
	createCwd: string;
	/** 打开类操作失败时的提示 */
	sessionError: SessionErrorNotice | undefined;
	/** 等用户决定信任的目录 */
	trustPrompt: TrustPrompt | undefined;
	/** 拉一次会话清单 */
	refreshSessions: () => Promise<readonly SessionSummary[] | undefined>;
	/** 拉一次项目清单，返回这一份 */
	refreshProjects: () => Promise<readonly ProjectInfo[] | undefined>;
	/** 打开一个会话；已经缓存过的直接切过去 */
	openSession: (path: string, knownCwd?: string) => void;
	/** 新建会话 */
	createSession: (cwd: string) => void;
	/** 侧栏与搜索用的稳定回调：直接选会话 */
	selectSession: (path: string) => void;
	/** 侧栏用的稳定回调：记下目录并新建会话 */
	createSessionAt: (cwd: string) => void;
	/** 会话改名 */
	renameSession: (path: string, name: string | undefined) => Promise<void>;
	/** 删除会话 */
	deleteSession: (path: string) => Promise<void>;
	/** 新建项目 */
	createProject: (input: { cwd: string; name: string | undefined }) => Promise<void>;
	/** 项目改名 */
	renameProject: (id: string, name: string | undefined) => Promise<void>;
	/** 移除项目 */
	removeProject: (id: string) => Promise<void>;
	/** 在系统里打开项目目录 */
	revealProject: (id: string) => Promise<void>;
	/** 在系统里打开会话所在的工作目录 */
	revealSessionFolder: (cwd: string) => Promise<void>;
	/** 记下信任决定并继续被挡住的那次打开 */
	decideTrust: (trusted: boolean) => void;
	/** 取消信任询问 */
	cancelTrust: () => void;
	/** 关掉新建项目弹窗 */
	closeProjectDialog: () => void;
	/** 打开新建项目弹窗 */
	openProjectDialog: () => void;
	/** 改新建会话的落地目录 */
	setCreateCwd: (cwd: string) => void;
	/** 打开类操作失败就用它摆提示 */
	setSessionError: (notice: SessionErrorNotice | undefined) => void;
	/** 先确认目录信任，再执行打开类动作 */
	withTrust: (cwd: string | undefined, run: () => void) => void;
	/** 跑一次会话切换类操作：只采用最后一次的结果，失败留下带重试的提示 */
	runSessionAction: (
		action: () => Promise<string | undefined>,
		onDone?: (file: string | undefined) => void,
		actionOptions?: { refresh?: boolean },
	) => void;
	/** 丢掉当前会话：续订回不来时用 */
	resetActive: () => void;
}

export function useSessionLifecycle(options: SessionLifecycleOptions): SessionLifecycle {
	const { client, connectEpoch, projectDir, snapshot, onSessionOpened, onSessionRemoved } = options;
	/** 会话清单与状态在客户端的 store 里已经是主机的那一份，挂上来先照它显示 */
	const [sessions, setSessions] = useState<readonly SessionSummary[]>(() =>
		client.store.sessionList().map((entry) => entry.summary),
	);
	const [statuses, setStatuses] = useState<ReadonlyMap<string, SessionStatus>>(() => statusesOf(client));
	const [activeFile, setActiveFile] = useState<string | undefined>(
		() => snapshot?.activeSessionFile ?? client.current?.snapshot.file,
	);
	const [projects, setProjects] = useState<readonly ProjectInfo[]>([]);
	const [isProjectsStale, setIsProjectsStale] = useState(false);
	const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
	/** 新建会话落在哪个目录：没有项目时为空，界面据此不给「新建会话」的入口 */
	const [createCwd, setCreateCwd] = useState<string>(() => snapshot?.createCwd ?? projectDir ?? "");
	/** 新建目录是否已经由用户或项目清单定下来，定下来之后不再自动改 */
	const createCwdChosen = useRef(createCwd.length > 0);

	// 选中会话与落地目录都只与这台主机有关：变化时写回快照，切回来接着用
	useEffect(() => {
		if (snapshot === undefined) {
			return;
		}
		snapshot.activeSessionFile = activeFile;
		snapshot.createCwd = createCwd.length > 0 ? createCwd : undefined;
	}, [snapshot, activeFile, createCwd]);
	const [sessionError, setSessionError] = useState<SessionErrorNotice | undefined>(undefined);
	const [trustPrompt, setTrustPrompt] = useState<TrustPrompt | undefined>(undefined);
	const listSeq = useRef(0);
	/** 会话切换的序号，只有最后一次选择的结果会落到界面上 */
	const switchSeq = useRef(0);
	/** 启动时挑一个会话打开，只做一次 */
	const started = useRef(false);

	/**
	 * 拉一次全部会话。
	 *
	 * 平时靠主机推来的清单，这里用于启动、重连与用户手动刷新；清单通道补齐缺口时也会走
	 * 这条路。并发调用只采用最后一次的结果，避免旧结果覆盖新结果。
	 */
	const refreshSessions = useCallback(async (): Promise<readonly SessionSummary[] | undefined> => {
		listSeq.current += 1;
		const seq = listSeq.current;
		try {
			const pool = await client.refreshSessionList();
			if (seq === listSeq.current) {
				setSessions((current) => (sameSessions(current, pool) ? current : pool));
				const nextStatuses = statusesOf(client);
				setStatuses((current) => (sameStatuses(current, nextStatuses) ? current : nextStatuses));
			}
			return pool;
		} catch {
			// 列表刷新失败时保留已显示的会话，其他项目的历史不因此消失
			return undefined;
		}
	}, [client]);

	// 主机推来清单变化时侧栏跟着变，别的端新建、改名或删除会话这边立刻看到
	useEffect(
		() =>
			client.store.subscribe(() => {
				const pushed = client.store.sessionList();
				if (pushed.length > 0) {
					const next = pushed.map((entry) => entry.summary);
					setSessions((current) => (sameSessions(current, next) ? current : next));
				}
				// 流式期间每帧都会走到这里，状态没变就不换引用，侧栏因此不必重渲染
				const nextStatuses = statusesOf(client);
				setStatuses((current) => (sameStatuses(current, nextStatuses) ? current : nextStatuses));
			}),
		[client],
	);

	/** 拉一次项目清单。失败只标脏，已经显示的项目保持原样。 */
	const refreshProjects = useCallback(async (): Promise<readonly ProjectInfo[] | undefined> => {
		try {
			const list = await client.listProjects();
			setProjects(list);
			setIsProjectsStale(false);
			return list;
		} catch {
			setIsProjectsStale(true);
			return undefined;
		}
	}, [client]);

	/**
	 * 连接就绪：重取项目与会话；启动那一次再挑一个会话打开。
	 *
	 * 重连之后不自动开新会话，屏幕上那个由链路续订。切回一台在后台连着的主机时，会话
	 * 客户端里那个会话还开着，这里不再去挑「启动会话」把它顶掉。
	 */
	const openSessionRef = useRef<(path: string, knownCwd?: string) => void>(() => undefined);
	useEffect(() => {
		if (connectEpoch === 0) {
			return;
		}
		let cancelled = false;
		void (async () => {
			const list = await refreshProjects();
			const pool = (await refreshSessions()) ?? [];
			if (cancelled) {
				return;
			}
			// 还没有选过落地目录时按项目清单定一个：远端主机没有本机启动目录可退
			if (!createCwdChosen.current) {
				const first = pickProjectCwd(list, projectDir);
				if (first !== undefined) {
					createCwdChosen.current = true;
					setCreateCwd(first);
				}
			}
			if (started.current) {
				return;
			}
			started.current = true;
			// 已经有开着的会话（切回保活主机）：屏幕上的那个由它自己继续
			if (client.current !== undefined) {
				setActiveFile(client.current.snapshot.file);
				return;
			}
			const newest = pickStartupSession(pool, projectDir);
			if (newest !== undefined) {
				openSessionRef.current(newest.path, newest.cwd);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [client, connectEpoch, projectDir, refreshProjects, refreshSessions]);

	/**
	 * 跑一次会话切换类操作。
	 *
	 * 只采用最后一次选择的文件：后发起的操作会推进序号，先前那次的成功或失败都不再落到
	 * 界面上。失败留下带重试的提示，成功则清掉旧提示并刷新列表。
	 */
	const runSessionAction = useCallback(
		(
			action: () => Promise<string | undefined>,
			onDone?: (file: string | undefined) => void,
			actionOptions: { refresh?: boolean } = {},
		) => {
			switchSeq.current += 1;
			const seq = switchSeq.current;
			void (async () => {
				try {
					const file = await action();
					if (seq !== switchSeq.current) {
						return;
					}
					onDone?.(file);
					setActiveFile(file);
					setSessionError(undefined);
					if (actionOptions.refresh !== false) {
						await refreshSessions();
					}
				} catch (error) {
					if (seq !== switchSeq.current) {
						return;
					}
					setSessionError({
						message: error instanceof Error ? error.message : String(error),
						retry: () => runSessionAction(action, onDone, actionOptions),
					});
				}
			})();
		},
		[refreshSessions],
	);

	/**
	 * 先确认目录信任，再执行打开类动作。
	 *
	 * 目录里有项目级资源且还没做过决定时先问一次，决定之后再往下走；没有这类资源或已有
	 * 决定时直接执行。查询失败按未信任处理，不拦动作。
	 */
	const withTrust = useCallback(
		(cwd: string | undefined, run: () => void) => {
			if (cwd === undefined) {
				run();
				return;
			}
			void (async () => {
				try {
					const state = await client.projectTrust(cwd);
					if (state.hasProjectResources && state.trusted === undefined) {
						setTrustPrompt({ cwd, run });
						return;
					}
				} catch {
					// 查不到就不拦，交给主机按未信任处理
				}
				run();
			})();
		},
		[client],
	);

	/** 记下信任决定并继续被挡住的那次打开。 */
	const decideTrust = useCallback(
		(trusted: boolean) => {
			const prompt = trustPrompt;
			if (prompt === undefined) {
				return;
			}
			setTrustPrompt(undefined);
			void (async () => {
				try {
					await client.setProjectTrust(prompt.cwd, trusted);
				} catch {
					// 决定没记下时仍按未信任继续，下次打开会再问
				}
				prompt.run();
			})();
		},
		[client, trustPrompt],
	);

	const cancelTrust = useCallback(() => setTrustPrompt(undefined), []);

	const openSession = useCallback(
		(path: string, knownCwd?: string) => {
			const cached = client.hasSession(path);
			const run = (): void => {
				runSessionAction(
					async () => {
						await client.switchSession(path);
						return path;
					},
					(file) => {
						if (file === undefined || client.current === undefined) {
							return;
						}
						onSessionOpened?.(file);
					},
				);
			};
			if (cached) {
				// 取消还在排队的打开结果，并让队列最后落回这个缓存会话
				switchSeq.current += 1;
				const opened = client.activateSession(path);
				if (opened !== undefined) {
					onSessionOpened?.(path);
					setActiveFile(path);
					setSessionError(undefined);
				}
				void client.switchSession(path).catch(() => undefined);
				void client.markSessionsSeen([path]).catch(() => undefined);
				return;
			}
			const cwd = knownCwd ?? sessions.find((session) => session.path === path)?.cwd;
			withTrust(cwd, run);
		},
		[client, onSessionOpened, runSessionAction, sessions, withTrust],
	);
	openSessionRef.current = openSession;

	/** 新建会话：默认模型与默认思考档位都交给 pi，它按自己的设置开局。 */
	const createSession = useCallback(
		(cwd: string) => {
			withTrust(cwd, () => {
				runSessionAction(
					async () => {
						const opened = await client.createSession({
							...(cwd.length > 0 ? { cwd } : {}),
						});
						return opened.file;
					},
					(file) => {
						if (file === undefined || client.current === undefined) {
							return;
						}
						onSessionOpened?.(file);
					},
				);
			});
		},
		[client, onSessionOpened, runSessionAction, withTrust],
	);

	/**
	 * 侧栏与搜索要的回调。
	 *
	 * 它们依赖的会话操作会随依赖变化换引用，直接用会让侧栏的 memo 每帧失效；这里经 ref
	 * 转一层，侧栏拿到的始终是同一个函数。
	 */
	const createSessionRef = useRef(createSession);
	createSessionRef.current = createSession;
	const selectSession = useCallback((path: string) => void openSessionRef.current(path), []);
	/** 记下用户选的落地目录：定下来之后不再被项目清单自动改掉 */
	const chooseCreateCwd = useCallback((cwd: string) => {
		createCwdChosen.current = true;
		setCreateCwd(cwd);
	}, []);
	const createSessionAt = useCallback(
		(cwd: string) => {
			chooseCreateCwd(cwd);
			void createSessionRef.current(cwd);
		},
		[chooseCreateCwd],
	);

	/** 会话改名。改的是当前会话时名字会随会话状态一起推过来，列表在这里重拉一次。 */
	const renameSession = useCallback(
		async (path: string, name: string | undefined) => {
			await client.renameSession(path, name);
			await refreshSessions();
		},
		[client, refreshSessions],
	);

	/**
	 * 删除会话。
	 *
	 * 删的是当前打开的会话时，连接会连带释放，界面回到没有会话的状态，再重新拉起一个
	 * 可用的会话或落到空状态页。
	 */
	const deleteSession = useCallback(
		async (path: string) => {
			await client.deleteSession(path);
			onSessionRemoved?.(path);
			const pool = (await refreshSessions()) ?? [];
			if (activeFile !== path) {
				return;
			}
			setActiveFile(undefined);
			// 还有别的会话就切过去，一个都不剩时留在空状态页
			const next = pickStartupSession(pool, projectDir);
			if (next !== undefined) {
				openSessionRef.current(next.path, next.cwd);
			}
		},
		[activeFile, client, onSessionRemoved, projectDir, refreshSessions],
	);

	/**
	 * 添加项目。
	 *
	 * 添加接口返回的数据直接并进列表，后续的列表刷新失败只标脏，已经添加成功的项目不会
	 * 从侧栏消失；拉取会话失败同样不影响添加结果。
	 */
	const createProject = useCallback(
		async (input: { cwd: string; name: string | undefined }) => {
			const created = await client.addProject({
				cwd: input.cwd,
				...(input.name === undefined ? {} : { name: input.name }),
			});
			setProjects((current) => mergeProject(current, created));
			chooseCreateCwd(created.cwd);
			await refreshProjects();
			await refreshSessions();
		},
		[chooseCreateCwd, client, refreshProjects, refreshSessions],
	);

	/** 改名结果直接替换列表里那一条，名字在过滤器与新建提示里同步变化。 */
	const renameProject = useCallback(
		async (id: string, name: string | undefined) => {
			const updated = await client.renameProject(id, name);
			setProjects((current) => mergeProject(current, updated));
		},
		[client],
	);

	/** 移除项目。会话文件与项目目录都不动，只从清单里去掉。 */
	const removeProject = useCallback(
		async (id: string) => {
			await client.removeProject(id);
			setProjects((current) => current.filter((item) => item.id !== id));
			await refreshProjects();
			await refreshSessions();
		},
		[client, refreshProjects, refreshSessions],
	);

	const revealProject = useCallback(
		async (id: string) => {
			await client.revealProject(id);
		},
		[client],
	);

	const revealSessionFolder = useCallback(
		async (cwd: string) => {
			await client.revealPath(cwd);
		},
		[client],
	);

	/** 丢掉当前会话：续订回不来时连订阅一起放掉，界面回到没有会话的状态。 */
	const resetActive = useCallback(() => {
		void client.release().catch(() => undefined);
		setActiveFile(undefined);
	}, [client]);

	const openProjectDialog = useCallback(() => setIsProjectDialogOpen(true), []);
	const closeProjectDialog = useCallback(() => setIsProjectDialogOpen(false), []);

	return {
		sessions,
		statuses,
		activeFile,
		projects,
		isProjectsStale,
		isProjectDialogOpen,
		createCwd,
		sessionError,
		trustPrompt,
		refreshSessions,
		refreshProjects,
		openSession,
		createSession,
		selectSession,
		createSessionAt,
		renameSession,
		deleteSession,
		createProject,
		renameProject,
		removeProject,
		revealProject,
		revealSessionFolder,
		decideTrust,
		cancelTrust,
		closeProjectDialog,
		openProjectDialog,
		setSessionError,
		setCreateCwd: chooseCreateCwd,
		withTrust,
		runSessionAction,
		resetActive,
	};
}
