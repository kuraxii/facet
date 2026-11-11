import { chatActivity, type DeviceHandshake, SessionClient, toTranscript } from "@facet/client-core";
import {
	DEFAULT_SETTINGS,
	type FacetSettings,
	type Maintenance,
	type ProjectInfo,
	type SessionSummary,
} from "@facet/protocol";
import { WsTransport } from "@facet/transport/ws";
import {
	ArrowDownIcon,
	ChatTranscript,
	CloseIcon,
	Composer,
	CreateProjectDialog,
	EmptyState,
	QueueStrip,
	SessionSidebar,
	type SettingsDataSource,
	SettingsPage,
	type SettingsSection,
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
	/** 应用版本 */
	appVersion: string;
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

/** 主题在本地保存键，设备上的设置读不到时先用它，避免启动时闪一下 */
const THEME_KEY = "facet.theme";

/** 等重试期间给对话面板的提示,其余维护动作不显示。 */
function retryOf(maintenance: Maintenance | undefined): { attempt: number; maxAttempts: number } | undefined {
	return maintenance?.kind === "retry"
		? { attempt: maintenance.attempt, maxAttempts: maintenance.maxAttempts }
		: undefined;
}

/** 读取上次选择的主题，缺省深色 */
function readTheme(): ThemeName {
	const stored = localStorage.getItem(THEME_KEY);
	if (stored === "light") {
		return "light";
	}
	if (stored === "system") {
		return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
	}
	return "dark";
}

/**
 * 把外观设置写到根节点。
 *
 * 主题、字体与字号通过 CSS 变量下发，正文、代码块与差异视图都读同一组变量；减少动效时
 * 根节点带 data-motion="reduced"，样式据此关掉过渡。
 */
function applyAppearance(appearance: FacetSettings["appearance"]): void {
	const root = document.documentElement;
	root.dataset.theme = appearance.theme === "light" ? "light" : "dark";
	root.dataset.motion = appearance.reducedMotion ? "reduced" : "full";
	if (appearance.bodyFont.trim().length > 0) {
		root.style.setProperty("--font-sans", appearance.bodyFont.trim());
	} else {
		root.style.removeProperty("--font-sans");
	}
	if (appearance.codeFont.trim().length > 0) {
		root.style.setProperty("--font-mono", appearance.codeFont.trim());
	} else {
		root.style.removeProperty("--font-mono");
	}
	root.style.setProperty("--text-size", `${appearance.fontSize}px`);
	localStorage.setItem(THEME_KEY, appearance.theme);
}

/** 把设置里的主题换成实际生效的深浅色。 */
function resolveTheme(mode: FacetSettings["appearance"]["theme"]): ThemeName {
	if (mode === "system") {
		return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
	}
	return mode;
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
	/** 设备上的偏好设置；没读到之前先用缺省值 */
	const [settings, setSettings] = useState<FacetSettings>(DEFAULT_SETTINGS);
	/** 主区域显示对话还是设置 */
	const [view, setView] = useState<"chat" | "settings">("chat");
	const [settingsSection, setSettingsSection] = useState<SettingsSection>("providers");
	/** 打开、新建、分叉失败时的提示,带重试入口 */
	const [sessionError, setSessionError] = useState<{ message: string; retry: () => void } | undefined>(
		undefined,
	);
	/** 等待用户决定信任的目录,与决定之后要执行的动作 */
	const [trustPrompt, setTrustPrompt] = useState<{ cwd: string; run: () => void } | undefined>(undefined);
	const started = useRef(false);
	/** 会话切换的序号,只有最后一次选择的结果会落到界面上 */
	const switchSeq = useRef(0);

	// 设置变化时应用外观，并把有效主题同步给侧栏的切换按钮
	useEffect(() => {
		applyAppearance(settings.appearance);
		setTheme(resolveTheme(settings.appearance.theme));
	}, [settings.appearance]);

	const listSeq = useRef(0);

	/** 设置页的数据来源，接到设备上。 */
	const settingsData = useMemo<SettingsDataSource>(
		() => ({
			loadSettings: () => client.getSettings(),
			saveSettings: (next) => client.saveSettings(next),
			loadProviders: () => client.listProviders(),
			loadModels: () => client.listModels(),
		}),
		[],
	);

	/**
	 * 切换深浅色。
	 *
	 * 外观立刻生效，同时写回设置；写不进去时界面按新主题显示，下次启动回到原来的值。
	 */
	const toggleTheme = useCallback(() => {
		const next = theme === "dark" ? "light" : "dark";
		setTheme(next);
		const changed: FacetSettings = {
			...settings,
			appearance: { ...settings.appearance, theme: next },
		};
		setSettings(changed);
		applyAppearance(changed.appearance);
		void client.saveSettings(changed).catch(() => undefined);
	}, [settings, theme]);

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

	/** 新建会话，采用设置里的默认模型与思考档位；没有设置时交给设备决定。 */
	const createSession = useCallback(
		(cwd: string) => {
			const model = settings.defaultModel;
			const thinkingLevel = settings.defaultThinkingLevel;
			withTrust(cwd, () => {
				runSessionAction(async () => {
					const opened = await client.createSession({
						...(cwd.length > 0 ? { cwd } : {}),
						...(model === undefined ? {} : { model }),
						...(thinkingLevel === undefined ? {} : { thinkingLevel }),
					});
					return opened.file;
				});
			});
		},
		[runSessionAction, settings.defaultModel, settings.defaultThinkingLevel, withTrust],
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
			// 设置读不到时用缺省值，界面照常可用
			setSettings(await client.getSettings().catch(() => DEFAULT_SETTINGS));
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

	/** 改名结果直接替换列表里那一条，名字在过滤器与新建提示里同步变化。 */
	const renameProject = useCallback(async (id: string, name: string | undefined) => {
		const updated = await client.renameProject(id, name);
		setProjects((current) => mergeProject(current, updated));
	}, []);

	/** 移除项目。会话文件与项目目录都不动，只从清单里去掉。 */
	const removeProject = useCallback(
		async (id: string) => {
			await client.removeProject(id);
			setProjects((current) => current.filter((item) => item.id !== id));
			await refreshProjects();
			await refreshSessions();
		},
		[refreshProjects, refreshSessions],
	);

	const revealProject = useCallback(async (id: string) => {
		await client.revealProject(id);
	}, []);

	/** 会话改名。改的是当前会话时名字会随会话状态一起推过来，列表在这里重拉一次。 */
	const renameSession = useCallback(
		async (path: string, name: string | undefined) => {
			await client.renameSession(path, name);
			await refreshSessions();
		},
		[refreshSessions],
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
			const pool = (await refreshSessions()) ?? [];
			if (activeFile !== path) {
				return;
			}
			setActiveFile(undefined);
			// 还有别的会话就切过去,一个都不剩时留在空状态页
			const next = pickStartupSession(pool, bridge.projectDir);
			if (next !== undefined) {
				openSession(next.path, next.cwd);
			}
		},
		[activeFile, openSession, refreshSessions],
	);

	const forkTurn = useCallback(
		(beforeEntryId: string | undefined) => {
			withTrust(session?.state.cwd, () => {
				runSessionAction(async () => (await client.fork(beforeEntryId)).file);
			});
		},
		[runSessionAction, session?.state.cwd, withTrust],
	);

	/** 没有打开会话时新建落在的目录：优先上次用过的，其次第一个项目。 */
	const emptyCreateCwd = createCwd.length > 0 ? createCwd : projects[0]?.cwd;
	/** 会话错误条，打开类操作失败时共用。 */
	const errorBar =
		sessionError === undefined ? null : (
			<div className="session-error">
				<span className="session-error-text">{sessionError.message}</span>
				<button type="button" className="btn" onClick={sessionError.retry}>
					重试
				</button>
				<button type="button" className="ib" aria-label="关闭提示" onClick={() => setSessionError(undefined)}>
					<CloseIcon size={12} />
				</button>
			</div>
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
				onRenameProject={renameProject}
				onRemoveProject={removeProject}
				onRevealProject={revealProject}
				onRenameSession={renameSession}
				onDeleteSession={deleteSession}
				onToggleTheme={toggleTheme}
				onOpenSettings={() => {
					setView("settings");
				}}
				isSettingsOpen={view === "settings"}
			/>

			<main className="main">
				{view === "settings" ? (
					<SettingsPage
						section={settingsSection}
						onSectionChange={setSettingsSection}
						onClose={() => setView("chat")}
						data={settingsData}
						onSettingsApplied={setSettings}
						about={{
							appVersion: bridge.appVersion,
							runtime: `Electron ${bridge.platform}`,
							endpoint: bridge.endpoint,
						}}
					/>
				) : session === undefined ? (
					<div className="empty-wrap">
						{errorBar}
						<EmptyState
							cwd={emptyCreateCwd}
							canCreate={phase === "ready"}
							onCreate={() => {
								if (emptyCreateCwd !== undefined) {
									createSession(emptyCreateCwd);
								}
							}}
							onAddProject={() => setIsProjectDialogOpen(true)}
						/>
					</div>
				) : (
					<>
						<section className="scroll" ref={scrollRef}>
							<div className="column">
								<ChatTranscript
									items={transcript}
									canFork={canFork}
									onFork={forkTurn}
									canRevert={canFork}
									onRevert={revertTo}
									retry={retryOf(session.state.maintenance)}
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
								{errorBar}
								<QueueStrip queued={queued} onClear={takeBackQueue} />
								<Composer
									value={draft}
									onChange={setDraft}
									onSend={send}
									onStop={() => client.cancel()}
									activity={activity}
									model={session.state.model}
									thinkingLevel={session.state.thinkingLevel}
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
					</>
				)}
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
