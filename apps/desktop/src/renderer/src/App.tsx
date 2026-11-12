import { chatActivity, type HostHandshake, SessionClient, toTranscript } from "@facet/client-core";
import type { FileContent, GitFileChange, GitStatus } from "@facet/protocol";
import {
	DEFAULT_SETTINGS,
	type FacetSettings,
	type Maintenance,
	type ModelInfo,
	type ProjectInfo,
	type SessionSummary,
} from "@facet/protocol";
import { WsTransport } from "@facet/transport/ws";
import {
	ArrowDownIcon,
	ChangesPane,
	ChatOutline,
	ChatTranscript,
	CodeThemeProvider,
	Composer,
	CreateProjectDialog,
	DEFAULT_DARK_THEME,
	EmptyState,
	FilesPane,
	isDarkTheme,
	QueueStrip,
	RightPanel,
	type RightPanelState,
	readPanelState,
	resolveUiTheme,
	SessionSidebar,
	type SettingsDataSource,
	SettingsPage,
	type SettingsSection,
	type SidebarHost,
	samePath,
	THEME_MODES,
	type ThemeName,
	TrustDialog,
	useStickToBottom,
	writePanelState,
} from "@facet/ui";
import { FileView } from "@facet/ui-editor";
import { X } from "lucide-react";
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
	/** 用系统的保存窗口写一段文本,取消时返回 false */
	saveText: (suggestedName: string, text: string) => Promise<boolean>;
	/** 订阅主机端点变化,返回取消订阅的函数 */
	onEndpointChanged: (listener: (endpoint: string) => void) => () => void;
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

/** 主题在本地保存键，主机上的设置读不到时先用它，避免启动时闪一下 */
const THEME_KEY = "facet.theme";

/** 等重试期间给对话面板的提示,其余维护动作不显示。 */
function retryOf(
	maintenance: Maintenance | undefined,
): { attempt: number; maxAttempts: number; delayMs: number } | undefined {
	return maintenance?.kind === "retry"
		? { attempt: maintenance.attempt, maxAttempts: maintenance.maxAttempts, delayMs: maintenance.delayMs }
		: undefined;
}

/** 草稿在本地保存的键 */
const DRAFTS_KEY = "facet.drafts";
/** 还没打开会话时草稿用的键 */
const NEW_DRAFT_KEY = "__new__";

/** 读出保存的各会话草稿；读不懂时当作没有草稿。 */
function readDrafts(): Record<string, string> {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}");
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return {};
		}
		return Object.fromEntries(
			Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
		);
	} catch {
		return {};
	}
}

/** 系统是否偏浅色。 */
function prefersLight(): boolean {
	return window.matchMedia("(prefers-color-scheme: light)").matches;
}

/** 读取上次的主题，只用来在设置读到之前避免闪一下，缺省深色 */
function readTheme(): ThemeName {
	const stored = localStorage.getItem(THEME_KEY);
	const mode = THEME_MODES.find((candidate) => candidate === stored) ?? DEFAULT_DARK_THEME;
	return isDarkTheme(resolveUiTheme(mode, prefersLight())) ? "dark" : "light";
}

/**
 * 把外观设置写到根节点。
 *
 * 主题、字体与字号通过 CSS 变量下发，正文、代码块与差异视图都读同一组变量；减少动效时
 * 根节点带 data-motion="reduced"，样式据此关掉过渡。
 */
function applyAppearance(appearance: FacetSettings["appearance"]): void {
	const root = document.documentElement;
	root.dataset.theme = resolveUiTheme(appearance.theme, prefersLight());
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

/** 把设置里的主题换成实际生效的深浅色，侧栏的切换按钮按它决定图标与文案。 */
function resolveTheme(mode: FacetSettings["appearance"]["theme"]): ThemeName {
	return isDarkTheme(resolveUiTheme(mode, prefersLight())) ? "dark" : "light";
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
	/** 当前连的主机端点，嵌入主机被重新拉起后会换 */
	const [endpoint, setEndpoint] = useState(bridge.endpoint);
	/** 与主机的连接是否可用，断开时输入区说明原因并禁用发送 */
	const [isOnline, setIsOnline] = useState(false);
	const [failure, setFailure] = useState<string | undefined>(undefined);
	const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
	const [activeFile, setActiveFile] = useState<string | undefined>(undefined);
	const [host, setHost] = useState<HostHandshake | undefined>(undefined);
	const [projects, setProjects] = useState<readonly ProjectInfo[]>([]);
	/** 项目列表上一次拉取失败，侧栏据此给出刷新入口 */
	const [isProjectsStale, setIsProjectsStale] = useState(false);
	const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
	const [createCwd, setCreateCwd] = useState(bridge.projectDir);
	/** 各会话的草稿，键为会话文件路径，新会话页面用 NEW_DRAFT_KEY */
	const [drafts, setDrafts] = useState<Record<string, string>>(readDrafts);
	const [theme, setTheme] = useState<ThemeName>(readTheme);
	/** 主机上的偏好设置；没读到之前先用缺省值 */
	const [settings, setSettings] = useState<FacetSettings>(DEFAULT_SETTINGS);
	/** 主区域显示对话还是设置 */
	const [view, setView] = useState<"chat" | "settings">("chat");
	/** 右栏的状态；展开、分页与宽度都记在本地 */
	const [panel, setPanel] = useState<RightPanelState>(() => readPanelState(localStorage));

	/** 右栏里打开的文件；为空时显示目录树 */
	const [openedFile, setOpenedFile] = useState<{ path: string; content: FileContent } | undefined>(undefined);
	/** 取文件失败的原因 */
	const [fileError, setFileError] = useState<string | undefined>(undefined);

	/** 变更页的数据：工作树状态、是否在取、失败原因 */
	const [changes, setChanges] = useState<{ status?: GitStatus; isLoading: boolean; error?: string }>({
		isLoading: false,
	});
	/** 变更请求的序号，只采用最后一次的结果 */
	const changesSeq = useRef(0);

	/** 改右栏状态并写回本地存储。 */
	const updatePanel = useCallback((patch: Partial<RightPanelState>) => {
		setPanel((current) => {
			const next = { ...current, ...patch };
			writePanelState(localStorage, next);
			return next;
		});
	}, []);
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
	/** 正在进行的重连,重复触发时共用同一次 */
	const reconnecting = useRef<Promise<void> | undefined>(undefined);

	// 设置变化时应用外观，并把有效主题同步给侧栏的切换按钮
	useEffect(() => {
		applyAppearance(settings.appearance);
		setTheme(resolveTheme(settings.appearance.theme));
	}, [settings.appearance]);

	const listSeq = useRef(0);

	/**
	 * 切换深浅色。
	 *
	 * 外观立刻生效，同时写回设置；写不进去时界面按新主题显示，下次启动回到原来的值。
	 */
	// 侧栏的快捷切换只在浅色与缺省深色之间来回，其余配色在设置页里选
	const toggleTheme = useCallback(() => {
		const next = theme === "dark" ? "light" : DEFAULT_DARK_THEME;
		setTheme(next === "light" ? "light" : "dark");
		const changed: FacetSettings = {
			...settings,
			appearance: { ...settings.appearance, theme: next },
		};
		setSettings(changed);
		applyAppearance(changed.appearance);
		void client.saveSettings(changed).catch(() => undefined);
	}, [settings, theme]);

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

	/** 拉一次项目清单。失败只标脏,已经显示的项目保持原样。 */
	const refreshProjects = useCallback(async (): Promise<void> => {
		try {
			setProjects(await client.listProjects());
			setIsProjectsStale(false);
		} catch {
			setIsProjectsStale(true);
		}
	}, []);

	/**
	 * 重连主机。
	 *
	 * 断线之后按退避间隔一直试，连上就续订已打开的会话、重取会话状态与会话列表；同一个
	 * 时刻只跑一次，手动重试与自动重连共用这条路。
	 */
	const reconnect = useCallback(async (): Promise<void> => {
		reconnecting.current ??= (async () => {
			let delay = 400;
			for (;;) {
				try {
					const handshake = await transport.connect();
					client.attach(handshake);
					setHost(handshake);
					// 会话回不来(例如它的文件已经不在了)时退回没有会话的状态,连接本身照常可用
					const resumed = await client.resume().then(
						() => true,
						() => false,
					);
					if (!resumed) {
						await client.release().catch(() => undefined);
						setActiveFile(undefined);
					}
					await refreshSessions();
					await refreshProjects();
					return;
				} catch {
					await new Promise((done) => setTimeout(done, delay));
					delay = Math.min(delay * 2, 8000);
				}
			}
		})().finally(() => {
			reconnecting.current = undefined;
		});
		await reconnecting.current;
	}, [refreshProjects, refreshSessions]);

	// 断线之后自动重连，期间输入区提示连接已断开
	useEffect(() => {
		if (!isOnline && phase === "ready") {
			void reconnect();
		}
	}, [isOnline, phase, reconnect]);

	// 嵌入主机被重新拉起后端口会变：换地址再握手，会话由 resume 续订
	useEffect(
		() =>
			bridge.onEndpointChanged((next) => {
				transport.setUrl(next);
				setEndpoint(next);
				setPhase("connecting");
				void reconnect().then(
					() => setPhase("ready"),
					(error: unknown) => {
						setFailure(error instanceof Error ? error.message : String(error));
						setPhase("failed");
					},
				);
			}),
		[reconnect],
	);

	void version;

	const session = client.sessionView();
	/** 变更页是否正在显示：展开右栏并停在变更分页 */
	const isChangesVisible = panel.open && panel.tab === "changes";
	/** 会话所在的目录，git 命令都在它下面跑 */
	const sessionCwd = session?.state.cwd;

	/** 打开一个文件：取内容失败时把原因留在右栏。 */
	const openFile = useCallback(
		async (path: string): Promise<void> => {
			if (sessionCwd === undefined) {
				return;
			}
			setFileError(undefined);
			try {
				const content = await client.readFile(sessionCwd, path);
				setOpenedFile({ path, content });
			} catch (error) {
				setFileError(error instanceof Error ? error.message : String(error));
			}
		},
		[sessionCwd],
	);

	// 换会话时把打开的文件收起来
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在会话变化时清空，状态设置函数不必列入
	useEffect(() => {
		setOpenedFile(undefined);
		setFileError(undefined);
	}, [activeFile]);

	/** 重新取工作树状态。并发调用只采用最后一次的结果。 */
	const refreshChanges = useCallback(async (): Promise<void> => {
		if (sessionCwd === undefined) {
			return;
		}
		changesSeq.current += 1;
		const seq = changesSeq.current;
		setChanges((current) => ({ ...current, isLoading: true, error: undefined }));
		try {
			const status = await client.gitStatus(sessionCwd);
			if (seq === changesSeq.current) {
				setChanges({ status, isLoading: false });
			}
		} catch (error) {
			if (seq === changesSeq.current) {
				setChanges({
					isLoading: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}, [sessionCwd]);

	// 展开变更页、切换会话、窗口重新获得焦点时各取一次（会话目录变化已含在 refreshChanges 里）
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

	const chat = client.chatView();
	// 对话此刻的状态由会话状态得出,界面不自己拼布尔量
	const activity = chatActivity(session);

	// 一轮结束之后工作树可能变了，顺手再取一次
	const lastActivity = useRef(activity);
	useEffect(() => {
		if (lastActivity.current !== "idle" && activity === "idle" && isChangesVisible) {
			void refreshChanges();
		}
		lastActivity.current = activity;
	}, [activity, isChangesVisible, refreshChanges]);

	/** 主机的模型目录与各提供方的凭证状态，供输入区的模型选择使用。 */
	const [catalog, setCatalog] = useState<{ models: readonly ModelInfo[]; auth: Record<string, boolean> }>({
		models: [],
		auth: {},
	});
	/**
	 * 重取模型目录与各提供方的凭证状态。
	 *
	 * 设置里加过凭证或改过自定义提供方之后要再取一次，否则选择器还停在旧的可用清单上。
	 */
	const refreshCatalog = useCallback(async (): Promise<void> => {
		const [models, providers] = await Promise.all([
			client.listAvailableModels().catch(() => []),
			client.listProviders().catch(() => []),
		]);
		setCatalog({
			models,
			auth: Object.fromEntries(providers.map((provider) => [provider.id, provider.authenticated])),
		});
	}, []);

	/** 输入区可选的模型：去掉设置里隐藏的那些。 */
	const visibleModels = useMemo(
		() => catalog.models.filter((model) => !settings.hiddenModels.includes(`${model.provider}/${model.id}`)),
		[catalog.models, settings.hiddenModels],
	);
	const providerAuth = catalog.auth;

	/** 设置页的数据来源，接到主机上。 */
	const settingsData = useMemo<SettingsDataSource>(
		() => ({
			loadSettings: () => client.getSettings(),
			saveSettings: (next) => client.saveSettings(next),
			loadProviders: () => client.listProviders(),
			loadModels: () => client.listModels(),
			// 凭证与自定义提供方会改变可用模型，改完重取一次目录
			saveCredential: (providerId, apiKey) =>
				client.saveCredential(providerId, apiKey).then(async (providers) => {
					await refreshCatalog();
					return providers;
				}),
			deleteCredential: (providerId) =>
				client.deleteCredential(providerId).then(async (providers) => {
					await refreshCatalog();
					return providers;
				}),
			setProviderBaseUrl: (providerId, baseUrl) => client.setProviderBaseUrl(providerId, baseUrl),
			listCustomProviders: () => client.listCustomProviders(),
			saveCustomProvider: (provider) =>
				client.saveCustomProvider(provider).then(async (providers) => {
					await refreshCatalog();
					return providers;
				}),
			removeCustomProvider: (providerId) =>
				client.removeCustomProvider(providerId).then(async (providers) => {
					await refreshCatalog();
					return providers;
				}),
			testModel: (model) => client.testModel(model),
			diagnostics: () => client.diagnostics(),
			saveText: (suggestedName, text) => window.facet.saveText(suggestedName, text),
		}),
		[refreshCatalog],
	);

	/**
	 * 现在不能发送的原因。
	 *
	 * 依次看连接、阶段与凭证：任何一条不满足都不该把消息送出去，说明写在输入区上方，
	 * 草稿留在输入框里。
	 */
	let blockedReason: string | undefined;
	if (!isOnline) {
		blockedReason = "与主机的连接已断开,恢复之后可以继续发送";
	} else if (activity === "compacting") {
		blockedReason = "正在压缩上下文,完成之后再发送";
	} else if (activity === "stopping") {
		blockedReason = "正在停止这一轮,稍后可以继续发送";
	} else if (session !== undefined && session.state.model === undefined) {
		blockedReason = "这个会话没有可用模型,到设置里配置提供方与凭证";
	} else if (session !== undefined && providerAuth[session.state.model?.provider ?? ""] === false) {
		blockedReason = "当前模型的提供方还没有配置凭证,到设置里补上";
	}
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
				// 查不到就不拦,交给主机按未信任处理
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

	/** 新建会话，采用设置里的默认模型与思考档位；没有设置时交给主机决定。 */
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

	// 连接状态：断开时输入区说明原因，恢复后自动放开
	useEffect(() => {
		setIsOnline(transport.state === "ready");
		return transport.onStateChange((state) => setIsOnline(state === "ready"));
	}, []);

	useEffect(() => {
		if (started.current) {
			return;
		}
		started.current = true;
		void (async () => {
			const handshake = await transport.connect();
			client.attach(handshake);
			setHost(handshake);
			await refreshProjects();
			// 设置读不到时用缺省值，界面照常可用
			setSettings(await client.getSettings().catch(() => DEFAULT_SETTINGS));
			// 模型选择器只列可用的模型（已配置凭证的提供方），凭证状态仍用来标注当前模型
			await refreshCatalog();
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
	}, [openSession, refreshCatalog, refreshProjects, refreshSessions]);

	/** 当前草稿落在哪个键：打开的会话按文件路径分开存，没有会话时存到新会话页面。 */
	const draftKey = activeFile ?? NEW_DRAFT_KEY;
	const draft = drafts[draftKey] ?? "";

	/** 改当前草稿。延迟写入本地保存，切换会话时不丢。 */
	const updateDraft = useCallback(
		(change: string | ((current: string) => string)) => {
			setDrafts((current) => {
				const value = typeof change === "function" ? change(current[draftKey] ?? "") : change;
				const next = { ...current };
				if (value.length === 0) {
					delete next[draftKey];
				} else {
					next[draftKey] = value;
				}
				return next;
			});
		},
		[draftKey],
	);

	// 草稿写进本地保存，重启之后还在
	useEffect(() => {
		localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
	}, [drafts]);

	const send = useCallback(() => {
		const text = draft.trim();
		if (text.length === 0) {
			return;
		}
		// 草稿留到主机确认再收,发送被拒时不用重打
		if (activity === "running") {
			client.enqueue(text);
			return;
		}
		client.send(text);
	}, [activity, draft]);

	/**
	 * 收回排队内容:清空主机侧队列,把文字拼回输入框。
	 *
	 * 排队条来自 session/queueChanged,清空后主机会再推一次空队列,这里只改草稿。
	 */
	const takeBackQueue = useCallback(() => {
		const entries = [...queued.steering, ...queued.followUp];
		client.clearQueue();
		if (entries.length === 0) {
			return;
		}
		updateDraft((current) => {
			const restored = entries.join("\n\n");
			return current.trim().length === 0 ? restored : `${restored}\n\n${current}`;
		});
	}, [queued, updateDraft]);

	useEffect(() => {
		return client.onSent((text) => {
			// 只收掉刚发出的那段,等待期间新输入的内容保留
			updateDraft((current) => (current.trim() === text ? "" : current));
		});
	}, [updateDraft]);

	/**
	 * 回退到某条用户消息之前:从那一轮末尾分出新会话并切过去,把这条消息的文本放回输入框。
	 *
	 * pi 的会话文件只追加,回退靠分叉实现,原会话保持不动。
	 */
	const revertTo = useCallback(
		(entryId: string, text: string) => {
			// 回退在同一个会话里改分支指针，不新建会话；文本先放回输入框，历史由主机推的
			// chat/branchMoved 触发重装
			client.revert(entryId);
			updateDraft(() => text);
		},
		[updateDraft],
	);

	/**
	 * 添加项目。
	 *
	 * 添加接口返回的数据直接并进列表，后续的列表刷新失败只标脏，已经添加成功的项目不会
	 * 从侧栏消失；拉取会话失败同样不影响添加结果。
	 */
	/**
	 * 重试失败的一轮。
	 *
	 * 从这条用户消息之前分叉出新会话并立刻重发同一段文本:新会话里只有一份用户消息,失败
	 * 的那次调用留在原会话里,不会重复追加。
	 */
	const retryTurn = useCallback(
		(entryId: string, text: string) => {
			withTrust(session?.state.cwd, () => {
				runSessionAction(
					async () => (await client.fork(entryId)).file,
					() => {
						updateDraft(() => text);
						client.send(text);
					},
				);
			});
		},
		[runSessionAction, session?.state.cwd, updateDraft, withTrust],
	);

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
					<X size={12} strokeWidth={1.5} />
				</button>
			</div>
		);

	const transcript = useMemo(() => (chat ? toTranscript(chat) : []), [chat]);
	const {
		scrollRef,
		element: scrollElement,
		isPinned,
		scrollToBottom,
	} = useStickToBottom(transcript, activeFile);

	const hosts = useMemo<readonly SidebarHost[]>(() => {
		const local: SidebarHost = {
			id: host?.hostId ?? "local",
			name: host?.hostName ?? "本机",
			detail: endpoint,
			state: "connected",
			isLocal: true,
			projects: [],
		};
		return [local, ...PLACEHOLDER_HOSTS];
	}, [host, endpoint]);

	// 代码高亮的配色与深浅一起下发，正文里的代码块按它取 shiki 主题
	const codeThemeValue = useMemo(
		() => ({
			theme: settings.appearance.codeTheme,
			isDark: resolveTheme(settings.appearance.theme) === "dark",
		}),
		[settings.appearance.codeTheme, settings.appearance.theme],
	);

	if (phase === "failed") {
		return (
			<main className="boot">
				<h1>连不上主机</h1>
				<p>{failure}</p>
				<p>{endpoint}</p>
				<button
					type="button"
					className="boot-retry"
					onClick={() => {
						setPhase("connecting");
						void reconnect().then(
							() => setPhase("ready"),
							(error: unknown) => {
								setFailure(error instanceof Error ? error.message : String(error));
								setPhase("failed");
							},
						);
					}}
				>
					重试
				</button>
			</main>
		);
	}

	if (phase === "connecting") {
		return (
			<main className="boot">
				<h1>正在连接主机</h1>
				<p>{endpoint}</p>
			</main>
		);
	}

	return (
		<CodeThemeProvider value={codeThemeValue}>
			<div className="shell">
				<SessionSidebar
					sessions={sessions}
					hosts={hosts}
					projects={projects}
					activeFile={activeFile}
					runningFile={activity === "idle" ? undefined : activeFile}
					runningDot={activity === "compacting" ? "compacting" : "running"}
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
					onTogglePanel={() => updatePanel({ open: !panel.open })}
					isPanelOpen={panel.open}
				/>

				<main className="main">
					{session === undefined ? null : <ChatOutline items={transcript} container={scrollElement} />}
					{session === undefined ? (
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
										onRetryTurn={retryTurn}
										onOpenSettings={() => {
											setSettingsSection("providers");
											setView("settings");
										}}
										onCopyDetails={(text) => {
											void navigator.clipboard.writeText(text).catch(() => undefined);
										}}
										onCopyText={(text) => {
											void navigator.clipboard.writeText(text).catch(() => undefined);
										}}
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
										onChange={updateDraft}
										onSend={send}
										onStop={() => client.cancel()}
										activity={activity}
										model={session.state.model}
										thinkingLevel={session.state.thinkingLevel}
										thinkingLevels={session.state.availableThinkingLevels}
										models={visibleModels}
										providerAuth={providerAuth}
										onModelChange={(next) => client.setModel({ provider: next.provider, id: next.id })}
										onThinkingLevelChange={(level) => client.setThinkingLevel(level)}
										shiftEnterToSend={settings.input.sendKey === "shiftEnter"}
										blockedReason={blockedReason}
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

				{panel.open ? (
					<RightPanel
						tab={panel.tab}
						onTabChange={(tab) => updatePanel({ tab })}
						width={panel.width}
						onWidthChange={(width) => updatePanel({ width })}
						onClose={() => updatePanel({ open: false })}
					>
						{panel.tab === "changes" ? (
							<ChangesPane
								status={changes.status}
								isLoading={changes.isLoading}
								error={changes.error}
								onRefresh={() => void refreshChanges()}
								loadDiff={(file: GitFileChange) =>
									sessionCwd === undefined
										? Promise.reject(new Error("还没有打开会话"))
										: client.gitDiff(sessionCwd, file.path, file.status === "untracked")
								}
							/>
						) : openedFile === undefined ? (
							fileError === undefined ? (
								<FilesPane
									loadDirectory={(path) =>
										sessionCwd === undefined
											? Promise.reject(new Error("还没有打开会话"))
											: client.listDirectory(sessionCwd, path)
									}
									onOpenFile={(path) => void openFile(path)}
								/>
							) : (
								<p className="chg-note is-error">
									{fileError}
									<button type="button" className="chg-retry" onClick={() => setFileError(undefined)}>
										返回目录
									</button>
								</p>
							)
						) : (
							<FileView
								path={openedFile.path}
								content={openedFile.content}
								onClose={() => setOpenedFile(undefined)}
								onSave={(text, expectedRevision) =>
									sessionCwd === undefined
										? Promise.reject(new Error("还没有打开会话"))
										: client.writeFile(sessionCwd, openedFile.path, text, expectedRevision)
								}
								onReload={async () => {
									if (sessionCwd === undefined) {
										throw new Error("还没有打开会话");
									}
									const next = await client.readFile(sessionCwd, openedFile.path);
									setOpenedFile({ path: openedFile.path, content: next });
									return next;
								}}
							/>
						)}
					</RightPanel>
				) : null}

				{view === "settings" ? (
					<SettingsPage
						section={settingsSection}
						onSectionChange={setSettingsSection}
						onClose={() => {
							// 预览过但没保存的外观回到已保存的那份
							applyAppearance(settings.appearance);
							setTheme(resolveTheme(settings.appearance.theme));
							setView("chat");
						}}
						data={settingsData}
						onSettingsApplied={setSettings}
						onAppearancePreview={(appearance) => {
							applyAppearance(appearance);
							setTheme(resolveTheme(appearance.theme));
						}}
						about={{
							appVersion: bridge.appVersion,
							runtime: `Electron ${bridge.platform}`,
							endpoint,
						}}
					/>
				) : null}

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
		</CodeThemeProvider>
	);
}
