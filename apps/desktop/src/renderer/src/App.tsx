import { chatActivity, type DeviceHandshake, SessionClient, toTranscript } from "@facet/client-core";
import type { Maintenance, ProjectInfo, SessionSummary } from "@facet/protocol";
import { WsTransport } from "@facet/transport/ws";
import {
	ArrowDownIcon,
	ChatTranscript,
	CloseIcon,
	Composer,
	CreateProjectDialog,
	QueueStrip,
	SessionSidebar,
	type SidebarHost,
	samePath,
	type ThemeName,
	TrustDialog,
	useStickToBottom,
} from "@facet/ui";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PLACEHOLDER_HOSTS } from "./placeholder-hosts";

/** 预加载脚本注入的启动参数 */
interface FacetBridge {
	endpoint: string;
	projectDir: string;
	platform: string;
	/** 打开系统的目录选择窗口,取消时返回空 */
	pickDirectory: () => Promise<string | undefined>;
}

declare global {
	interface Window {
		facet: FacetBridge;
	}
}

const bridge = window.facet;

const transport = new WsTransport({ url: bridge.endpoint });
const client = new SessionClient({ transport, pageSize: 200 });

type Phase = "connecting" | "ready" | "failed";

/** 主题在本地保存键 */
const THEME_KEY = "facet.theme";

/** 等重试期间给对话面板的提示,其余维护动作不显示。 */
function retryOf(maintenance: Maintenance | undefined): { attempt: number; maxAttempts: number } | undefined {
	return maintenance?.kind === "retry"
		? { attempt: maintenance.attempt, maxAttempts: maintenance.maxAttempts }
		: undefined;
}

/** 读取上次选择的主题，缺省深色 */
function readTheme(): ThemeName {
	return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
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

/** 启动时打开的会话：启动目录里最近更新的一条，没有则取全部会话里最近的一条。 */
function pickStartupSession(
	sessions: readonly SessionSummary[],
	projectDir: string,
): SessionSummary | undefined {
	let scoped: SessionSummary | undefined;
	let newest: SessionSummary | undefined;
	for (const session of sessions) {
		if (newest === undefined || session.modified > newest.modified) {
			newest = session;
		}
		if (!samePath(session.cwd, projectDir)) {
			continue;
		}
		if (scoped === undefined || session.modified > scoped.modified) {
			scoped = session;
		}
	}
	return scoped ?? newest;
}

export function App() {
	const version = useSyncExternalStore(
		(onChange) => client.store.subscribe(onChange),
		() => client.store.getVersion(),
	);
	const [phase, setPhase] = useState<Phase>("connecting");
	const [failure, setFailure] = useState<string | undefined>(undefined);
	const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
	const [activeFile, setActiveFile] = useState<string | undefined>(undefined);
	const [device, setDevice] = useState<DeviceHandshake | undefined>(undefined);
	const [projects, setProjects] = useState<readonly ProjectInfo[]>([]);
	/** 项目列表上一次拉取失败，侧栏据此给出刷新入口 */
	const [isProjectsStale, setIsProjectsStale] = useState(false);
	const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
	const [createCwd, setCreateCwd] = useState(bridge.projectDir);
	const [draft, setDraft] = useState("");
	const [theme, setTheme] = useState<ThemeName>(readTheme);
	/** 打开、新建、分叉失败时的提示,带重试入口 */
	const [sessionError, setSessionError] = useState<{ message: string; retry: () => void } | undefined>(
		undefined,
	);
	/** 等待用户决定信任的目录,与决定之后要执行的动作 */
	const [trustPrompt, setTrustPrompt] = useState<{ cwd: string; run: () => void } | undefined>(undefined);
	const started = useRef(false);
	/** 会话切换的序号,只有最后一次选择的结果会落到界面上 */
	const switchSeq = useRef(0);

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
		localStorage.setItem(THEME_KEY, theme);
	}, [theme]);

	const listSeq = useRef(0);

	/** 拉一次项目清单。失败只标脏,已经显示的项目保持原样。 */
	const refreshProjects = useCallback(async (): Promise<void> => {
		try {
			setProjects(await client.listProjects());
			setIsProjectsStale(false);
		} catch {
			setIsProjectsStale(true);
		}
	}, []);

	/** 拉一次全部会话。并发调用时只采用最后一次的结果,避免旧结果覆盖新结果。 */
	const refreshSessions = useCallback(async (): Promise<readonly SessionSummary[] | undefined> => {
		listSeq.current += 1;
		const seq = listSeq.current;
		try {
			const pool = await client.listSessions();
			if (seq === listSeq.current) {
				setSessions(pool);
			}
			return pool;
		} catch {
			// 列表刷新失败时保留已显示的会话,其他项目的历史不因此消失
			return undefined;
		}
	}, []);

	void version;

	const session = client.sessionView();
	const chat = client.chatView();
	// 对话此刻的状态由会话状态得出,界面不自己拼布尔量
	const activity = chatActivity(session);
	const queued = session?.state.queued ?? { steering: [], followUp: [] };
	const canFork = activity === "idle" && session?.state.maintenance === undefined;

	/**
	 * 跑一次会话切换类操作。
	 *
	 * 只采用最后一次选择的文件:后发起的操作会推进序号,先前那次的成功或失败都不再落到界面上。
	 * 失败留下带重试的提示,成功则清掉旧提示并刷新列表。
	 */
	const runSessionAction = useCallback(
		(action: () => Promise<string | undefined>, onDone?: () => void) => {
			switchSeq.current += 1;
			const seq = switchSeq.current;
			void (async () => {
				try {
					const file = await action();
					if (seq !== switchSeq.current) {
						return;
					}
					onDone?.();
					setActiveFile(file);
					setSessionError(undefined);
					await refreshSessions();
				} catch (error) {
					if (seq !== switchSeq.current) {
						return;
					}
					setSessionError({
						message: error instanceof Error ? error.message : String(error),
						retry: () => runSessionAction(action, onDone),
					});
				}
			})();
		},
		[refreshSessions],
	);

	/**
	 * 先确认目录信任,再执行打开类动作。
	 *
	 * 目录里有项目级资源且还没做过决定时先问一次,决定之后再往下走;没有这类资源或已有决定
	 * 时直接执行。查询失败按未信任处理,不拦动作。
	 */
	const withTrust = useCallback((cwd: string | undefined, run: () => void) => {
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
				// 查不到就不拦,交给设备按未信任处理
			}
			run();
		})();
	}, []);

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
					// 决定没记下时仍按未信任继续,下次打开会再问
				}
				prompt.run();
			})();
		},
		[trustPrompt],
	);

	const openSession = useCallback(
		(path: string, knownCwd?: string) => {
			const cwd = knownCwd ?? sessions.find((session) => session.path === path)?.cwd;
			withTrust(cwd, () => {
				runSessionAction(async () => {
					await client.switchSession(path);
					return path;
				});
			});
		},
		[runSessionAction, sessions, withTrust],
	);

	const createSession = useCallback(
		(cwd: string) => {
			withTrust(cwd, () => {
				runSessionAction(async () => {
					const opened = await client.createSession({ ...(cwd.length > 0 ? { cwd } : {}) });
					return opened.file;
				});
			});
		},
		[runSessionAction, withTrust],
	);

	useEffect(() => {
		if (started.current) {
			return;
		}
		started.current = true;
		void (async () => {
			const handshake = await transport.connect();
			client.attach(handshake);
			setDevice(handshake);
			await refreshProjects();
			const pool = (await refreshSessions()) ?? [];
			const newest = pickStartupSession(pool, bridge.projectDir);
			if (newest) {
				openSession(newest.path, newest.cwd);
			}
			setPhase("ready");
		})().catch((error: unknown) => {
			setFailure(error instanceof Error ? error.message : String(error));
			setPhase("failed");
		});
	}, [openSession, refreshProjects, refreshSessions]);

	const send = useCallback(() => {
		const text = draft.trim();
		if (text.length === 0) {
			return;
		}
		// 草稿留到设备确认再收,发送被拒时不用重打
		if (activity === "running") {
			client.enqueue(text);
			return;
		}
		client.send(text);
	}, [activity, draft]);

	/**
	 * 收回排队内容:清空设备侧队列,把文字拼回输入框。
	 *
	 * 排队条来自 session/queueChanged,清空后设备会再推一次空队列,这里只改草稿。
	 */
	const takeBackQueue = useCallback(() => {
		const entries = [...queued.steering, ...queued.followUp];
		client.clearQueue();
		if (entries.length === 0) {
			return;
		}
		setDraft((current) => {
			const restored = entries.join("\n\n");
			return current.trim().length === 0 ? restored : `${restored}\n\n${current}`;
		});
	}, [queued]);

	useEffect(() => {
		return client.onSent((text) => {
			// 只收掉刚发出的那段,等待期间新输入的内容保留
			setDraft((current) => (current.trim() === text ? "" : current));
		});
	}, []);

	/**
	 * 回退到某条用户消息之前:从那一轮末尾分出新会话并切过去,把这条消息的文本放回输入框。
	 *
	 * pi 的会话文件只追加,回退靠分叉实现,原会话保持不动。
	 */
	const revertTo = useCallback(
		(entryId: string, text: string) => {
			withTrust(session?.state.cwd, () => {
				runSessionAction(
					async () => (await client.fork(entryId)).file,
					() => setDraft(text),
				);
			});
		},
		[runSessionAction, session?.state.cwd, withTrust],
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
			setCreateCwd(created.cwd);
			await refreshProjects();
			await refreshSessions();
		},
		[refreshProjects, refreshSessions],
	);

	const forkTurn = useCallback(
		(beforeEntryId: string | undefined) => {
			withTrust(session?.state.cwd, () => {
				runSessionAction(async () => (await client.fork(beforeEntryId)).file);
			});
		},
		[runSessionAction, session?.state.cwd, withTrust],
	);

	const transcript = useMemo(() => (chat ? toTranscript(chat) : []), [chat]);
	const { scrollRef, isPinned, scrollToBottom } = useStickToBottom(transcript, activeFile);

	const hosts = useMemo<readonly SidebarHost[]>(() => {
		const local: SidebarHost = {
			id: device?.hostId ?? "local",
			name: device?.hostName ?? "本机",
			detail: bridge.endpoint,
			state: "connected",
			isLocal: true,
			projects: [],
		};
		return [local, ...PLACEHOLDER_HOSTS];
	}, [device]);

	if (phase === "failed") {
		return (
			<main className="boot">
				<h1>连不上设备</h1>
				<p>{failure}</p>
				<p>{bridge.endpoint}</p>
			</main>
		);
	}

	if (phase === "connecting") {
		return (
			<main className="boot">
				<h1>正在连接设备</h1>
				<p>{bridge.endpoint}</p>
			</main>
		);
	}

	return (
		<div className="shell">
			<SessionSidebar
				sessions={sessions}
				hosts={hosts}
				projects={projects}
				activeFile={activeFile}
				runningFile={activity === "idle" ? undefined : activeFile}
				createCwd={createCwd}
				theme={theme}
				onSelect={(path) => void openSession(path)}
				onCreate={(cwd) => {
					setCreateCwd(cwd);
					void createSession(cwd);
				}}
				canCreate={phase === "ready"}
				onAddProject={() => setIsProjectDialogOpen(true)}
				isProjectsStale={isProjectsStale}
				onRefreshProjects={() => void refreshProjects()}
				onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
			/>

			<main className="main">
				<section className="scroll" ref={scrollRef}>
					<div className="column">
						<ChatTranscript
							items={transcript}
							canFork={canFork}
							onFork={forkTurn}
							canRevert={canFork}
							onRevert={revertTo}
							retry={retryOf(session?.state.maintenance)}
							renames={chat?.renames}
							emptyHint="还没有消息,输入内容开始"
						/>
					</div>
				</section>

				<div className="footer">
					{isPinned ? null : (
						<button
							type="button"
							className="to-bottom"
							aria-label="回到底部"
							onClick={() => scrollToBottom("smooth")}
						>
							<ArrowDownIcon size={16} />
						</button>
					)}
					<div className="footer-column">
						{sessionError ? (
							<div className="session-error">
								<span className="session-error-text">{sessionError.message}</span>
								<button type="button" className="btn" onClick={sessionError.retry}>
									重试
								</button>
								<button
									type="button"
									className="ib"
									aria-label="关闭提示"
									onClick={() => setSessionError(undefined)}
								>
									<CloseIcon size={12} />
								</button>
							</div>
						) : null}
						<QueueStrip queued={queued} onClear={takeBackQueue} />
						<Composer
							value={draft}
							onChange={setDraft}
							onSend={send}
							onStop={() => client.cancel()}
							activity={activity}
							model={session?.state.model}
							thinkingLevel={session?.state.thinkingLevel}
						/>

						{chat && chat.notices.length > 0 ? (
							<div className="notices">
								{chat.notices.map((notice) => (
									<span
										key={`${notice.level}:${notice.message}`}
										className={notice.level === "error" ? "chip is-error" : "chip"}
									>
										{notice.message}
									</span>
								))}
							</div>
						) : null}
					</div>
				</div>
			</main>

			<CreateProjectDialog
				isOpen={isProjectDialogOpen}
				onPickFolder={() => window.facet.pickDirectory()}
				onCreate={createProject}
				onClose={() => setIsProjectDialogOpen(false)}
			/>

			{trustPrompt ? (
				<TrustDialog
					cwd={trustPrompt.cwd}
					onDecide={decideTrust}
					onCancel={() => setTrustPrompt(undefined)}
				/>
			) : null}
		</div>
	);
}
