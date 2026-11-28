/**
 * 主工作区。
 *
 * 三栏骨架、顶带三格、右栏与各种弹窗的组装；状态都来自上层建好的几个域，这里只把它们
 * 摆到位并接上回调。
 *
 * 主区只有对话：消息流与输入区直接撑满中列，主区自己不再有标签栏。文件、变更与终端都在
 * 右栏那几个动态标签里（口径见 `docs/layout.md` §2）。顶带三格的分工：左格是侧栏自己的
 * 头部（搜索、新建、收起），中格是会话标题与右栏入口，右格是右栏的标签、`+` 与两枚动作。
 */

import type { ChatView } from "@facet/client-core";
import { chatActivity } from "@facet/client-core";
import type { LanguageSetting } from "@facet/i18n";
import {
	type AcpConfigOption,
	type AcpModeState,
	type AgentCapabilities,
	type AppearanceSettings,
	type InputSettings,
	type ModelInfo,
	type NotificationSettings,
	PI_AGENT_ID,
	type TerminalLocalSettings,
	type ThinkingLevel,
} from "@facet/protocol";
import {
	Button,
	baseName,
	CodeThemeProvider,
	type ComposerHandle,
	CreateProjectDialog,
	capabilitiesOf,
	type DraftContextStore,
	type DraftHostOption,
	EmptyState,
	type HostNodeState,
	HostSwitcher,
	ICON_SIZE,
	IconButton,
	PanelToggle,
	parseCommand,
	pushRecentDraftContext,
	type RecentDraftContext,
	RightPanel,
	readDraftContextStore,
	SessionSearch,
	SessionSidebar,
	SettingsPage,
	SidebarHeader,
	type SidebarSettledItem,
	type SidebarTaskCard,
	SidebarToggle,
	sessionTitle,
	TrustDialog,
	updateEndpointDraftMemory,
	useI18n,
	useModalPresence,
	type WorkspaceTabId,
	writeDraftContextStore,
} from "@facet/ui";
import { RotateCw, X } from "lucide-react";
import {
	type CSSProperties,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { AppFrame } from "../app-frame.tsx";
import { bridge } from "../bridge.ts";
import type { Composer } from "../hooks/useComposer.ts";
import type { HostConnection } from "../hooks/useHostConnection.ts";
import type { Hosts } from "../hooks/useHosts.ts";
import type { MultiHostInbox } from "../hooks/useMultiHostInbox.ts";
import type { SessionLifecycle } from "../hooks/useSessionLifecycle.ts";
import { useSettingsData } from "../hooks/useSettingsData.ts";
import type { TerminalPanel } from "../hooks/useTerminalPanel.ts";
import type { Transcript } from "../hooks/useTranscript.ts";
import type { WorkspaceDocs } from "../hooks/useWorkspaceDocs.ts";
import type { WorkspaceShell } from "../hooks/useWorkspaceShell.ts";
import { applyAppearance } from "../hooks/useWorkspaceShell.ts";
import { usePanelPresence } from "../hooks/workspace-shell/usePanelPresence.ts";
import { LOCAL_TARGET } from "../host-connection.ts";
import { useHostClient } from "../host-context.tsx";
import { appStorage, type ScopedStorage } from "../local-storage.ts";
import { type ActiveTarget, toSessionKey } from "../session-target.ts";
import { useToast } from "../toast-provider.tsx";
import { workspaceTabItems } from "../workspace-tabs.ts";
import { ChatArea } from "./chat-area.tsx";
import { WorkspacePanelControls } from "./workspace-band.tsx";
import { WorkspaceBody } from "./workspace-body.tsx";

const ACP_DRAFT_CAPABILITIES: AgentCapabilities = {
	configStyle: "acp",
	canCompact: false,
	hasContextBreakdown: false,
	canFork: false,
	canRevert: false,
	supportsFollowUp: false,
	supportsImages: true,
	hasToolsList: false,
	supportsSteering: false,
	supportsHistoryLoad: false,
};

export interface WorkbenchProps {
	/** 连接域 */
	host: HostConnection;
	/** 会话域 */
	session: SessionLifecycle;
	/** 外壳呈现状态 */
	shell: WorkspaceShell;
	/** 右栏的文档与改动 */
	docs: WorkspaceDocs;
	/** 终端域 */
	terminal: TerminalPanel;
	/** 输入区 */
	composer: Composer;
	/** 对话状态 */
	transcript: Transcript;
	/** 语言设置与切换 */
	languageSetting: LanguageSetting;
	onLanguageChange: (setting: LanguageSetting) => void;
	/** 本机优先的外观偏好 */
	localAppearance: AppearanceSettings;
	onLocalAppearanceChange: (appearance: AppearanceSettings) => void;
	/** 本机优先的输入偏好 */
	localInput: InputSettings;
	onLocalInputChange: (input: InputSettings) => void;
	/** 本机优先的通知偏好 */
	localNotifications: NotificationSettings;
	onLocalNotificationsChange: (notifications: NotificationSettings) => void;
	/** 本机优先的终端交互偏好 */
	localTerminal: TerminalLocalSettings;
	onLocalTerminalChange: (terminal: TerminalLocalSettings) => void;
	/** 按主机端点隔离的持久化存储 */
	workspaceStorage?: ScopedStorage;
	/** 当前会话标识 */
	openedSessionId: string | undefined;
	/** 终端标签要显示的那个终端 */
	terminalId: string | undefined;
	/** 复制一段文本 */
	copyText: (text: string) => void;
	/** 输入区的命令式句柄：引用之后把结构插进去、光标放回末尾 */
	composerInput: RefObject<ComposerHandle | null>;
	/** 可 `@` 引用的文件：项目根下的相对路径 */
	mentionFiles: readonly string[];
	/** 开一个终端 */
	openTerminal: () => Promise<void>;
	/** 新建会话引导页选中的项目目录 */
	draftCwd: string | undefined;
	/** 更新引导页选中的项目目录 */
	onDraftCwdChange: (cwd: string | undefined) => void;
	/** 全局主机注册表与连接管理 */
	hosts: Hosts;
	/** 跨主机 Task Inbox 聚合模型 */
	inbox: MultiHostInbox;
	/** 当前选中的跨主机目标 `(endpoint, file)` */
	activeTarget: ActiveTarget | undefined;
	/** 切换当前主工作区目标 */
	onActiveTargetChange: (target: ActiveTarget | undefined) => void;
	/** 新建会话引导页目标主机端点 */
	draftEndpoint: string;
	/** 切换新建会话引导页目标主机端点 */
	onDraftEndpointChange: (endpoint: string) => void;
}

/** 三栏工作区。 */
export function Workbench(props: WorkbenchProps): ReactNode {
	const {
		host,
		session,
		shell,
		docs,
		terminal,
		composer,
		transcript,
		languageSetting,
		onLanguageChange,
		localAppearance,
		onLocalAppearanceChange,
		localInput,
		onLocalInputChange,
		localNotifications,
		onLocalNotificationsChange,
		localTerminal,
		onLocalTerminalChange,
		workspaceStorage,
		openedSessionId,
		terminalId,
		copyText,
		openTerminal,
		composerInput,
		mentionFiles,
		draftCwd,
		onDraftCwdChange,
		hosts,
		inbox,
		activeTarget,
		onActiveTargetChange,
		draftEndpoint,
		onDraftEndpointChange,
	} = props;
	void draftEndpoint;
	void onDraftEndpointChange;
	const { t } = useI18n();
	const toast = useToast();
	const client = useHostClient();
	const activeKey =
		activeTarget === undefined ? undefined : toSessionKey(activeTarget.endpoint, activeTarget.file);
	const activeSettled = activeKey !== undefined && inbox.isSettled(activeKey);
	const activeCard = useMemo(
		() => (activeKey === undefined ? undefined : inbox.activeCards.find((card) => card.key === activeKey)),
		[activeKey, inbox.activeCards],
	);

	const handleSelectTarget = useCallback(
		(endpoint: string, file: string, knownCwd?: string) => {
			if (knownCwd !== undefined) {
				onDraftCwdChange(knownCwd);
			}
			if (endpoint !== LOCAL_TARGET && hosts.registry.get(endpoint) === undefined) {
				hosts.connectHost(endpoint);
			}
			if (endpoint === host.endpoint) {
				session.selectSession(file);
				return;
			}
			onActiveTargetChange({ endpoint, file });
		},
		[host.endpoint, hosts, onActiveTargetChange, onDraftCwdChange, session],
	);

	const handleSettleCard = useCallback(
		(card: SidebarTaskCard) => {
			inbox.settle(card.key);
			if (activeKey === card.key) {
				session.resetActive();
				onActiveTargetChange(undefined);
			}
			toast.show({
				level: "info",
				message: t("inbox.settledToast", { title: card.title }),
				action: {
					label: t("inbox.undo"),
					onClick: () => inbox.reopen(card.key),
				},
			});
		},
		[activeKey, inbox, onActiveTargetChange, session, t, toast],
	);

	const handleReopenItem = useCallback(
		(item: SidebarSettledItem) => {
			inbox.reopen(item.key);
		},
		[inbox],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
				return;
			}
			if (event.key.toLowerCase() !== "e" || activeCard === undefined) {
				return;
			}
			event.preventDefault();
			handleSettleCard(activeCard);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [activeCard, handleSettleCard]);

	const renameSessionFor = useCallback(
		async (endpoint: string, path: string, name: string | undefined) => {
			const runtime = hosts.getRuntime(endpoint);
			await runtime.client.renameSession(path, name);
			await runtime.client.refreshSessionList().catch(() => undefined);
		},
		[hosts],
	);

	const deleteSessionFor = useCallback(
		async (endpoint: string, path: string) => {
			const runtime = hosts.getRuntime(endpoint);
			await runtime.client.deleteSession(path);
			if (activeTarget?.endpoint === endpoint && activeTarget.file === path) {
				session.resetActive();
				onActiveTargetChange(undefined);
			}
			await runtime.client.refreshSessionList().catch(() => undefined);
		},
		[activeTarget, hosts, onActiveTargetChange, session],
	);

	const revealSessionFolderFor = useCallback(
		async (endpoint: string, cwd: string) => {
			await hosts.getRuntime(endpoint).client.revealPath(cwd);
		},
		[hosts],
	);
	const sessionView = client.sessionView();
	const chat: ChatView | undefined = client.chatView();
	const activity = chatActivity(sessionView);
	const sessionCwd: string | undefined = sessionView?.state.cwd;
	const canUseTerminal = host.host?.capabilities.includes("terminal") ?? false;
	const canUseBrowser = bridge.browser !== undefined;
	/** mac 的主修饰键写成 ⌘，其它平台是 Ctrl；启动清单与 `+` 菜单的提示共用这一份 */
	const isMac = bridge.platform === "darwin";
	const tabItems = useMemo(
		() =>
			workspaceTabItems(
				{
					changes: docs.changes.status?.files.length ?? 0,
					terminals: terminal.terminals.length,
					canUseTerminal,
					canUseBrowser,
				},
				{
					files: t("panel.files"),
					changes: t("panel.changes"),
					gitGraph: t("panel.gitGraph"),
					terminal: t("panel.terminal"),
					browser: t("panel.browser"),
				},
				isMac,
			),
		[canUseBrowser, canUseTerminal, docs.changes.status, isMac, t, terminal.terminals.length],
	);
	/** 主区顶带里的会话标题：跟着侧栏里那一条走，没名字时用首条消息 */
	const activeSession = session.sessions.find((item) => item.path === session.activeFile);
	const chromeTitle =
		activeSession === undefined
			? undefined
			: sessionTitle(activeSession.name, activeSession.firstMessage, t("sidebar.untitled"));

	const [settingsEndpoint, setSettingsEndpoint] = useState<string>(LOCAL_TARGET);
	const settingsRuntime = hosts.getRuntime(settingsEndpoint);
	const refreshAgentsCallback = useCallback(() => {
		void session.refreshAgents();
	}, [session.refreshAgents]);
	const settingsData = useSettingsData(settingsRuntime, refreshAgentsCallback);
	const targetHosts = useMemo(() => {
		const localReady = hosts.hostStates.get(LOCAL_TARGET)?.link.status === "ready";
		return [
			{ endpoint: LOCAL_TARGET, label: t("app.localHost"), isOnline: localReady },
			...host.hostList.hosts.map((entry) => ({
				endpoint: entry.endpoint,
				label: entry.name,
				isOnline: hosts.hostStates.get(entry.endpoint)?.link.status === "ready",
			})),
		];
	}, [host.hostList.hosts, hosts.hostStates, t]);

	const [draftContexts, setDraftContexts] = useState<DraftContextStore>(() =>
		readDraftContextStore(appStorage),
	);
	const updateDraftContexts = useCallback((next: DraftContextStore) => {
		setDraftContexts(next);
		writeDraftContextStore(appStorage, next);
	}, []);
	const draftHostOptions = useMemo<readonly DraftHostOption[]>(() => {
		const phaseOf = (endpoint: string) => {
			const state = hosts.hostStates.get(endpoint);
			if (state === undefined) return "idle" as const;
			return state.sshAuthPrompt !== undefined ? ("auth" as const) : state.phase;
		};
		return [
			{ endpoint: LOCAL_TARGET, name: t("app.localHost"), isLocal: true, phase: phaseOf(LOCAL_TARGET) },
			...host.hostList.hosts.map((entry) => ({
				endpoint: entry.endpoint,
				name: entry.name,
				isLocal: false,
				phase: phaseOf(entry.endpoint),
			})),
		];
	}, [host.hostList.hosts, hosts.hostStates, t]);
	const draftHostLabel = useMemo(
		() =>
			draftEndpoint === LOCAL_TARGET
				? t("app.localHost")
				: (host.hostList.hosts.find((entry) => entry.endpoint === draftEndpoint)?.name ?? draftEndpoint),
		[draftEndpoint, host.hostList.hosts, t],
	);

	const capabilities = capabilitiesOf(sessionView?.state.capabilities);
	const hostNodeStatuses = useMemo(() => {
		const map = new Map<string, HostNodeState>();
		for (const [endpoint, state] of host.hostStates) {
			map.set(endpoint, {
				phase: state.sshAuthPrompt !== undefined ? "auth" : state.phase,
				isOnline: state.link.status === "ready",
				isReconnecting: state.link.status === "reconnecting",
				failure: state.failure?.message,
				sshAuthPrompt:
					state.sshAuthPrompt === undefined
						? undefined
						: { host: state.sshAuthPrompt.host, isRetry: state.sshAuthPrompt.isRetry },
			});
		}
		return map as ReadonlyMap<string, HostNodeState>;
	}, [host.hostStates]);
	const providerAuth = host.catalog.auth;
	const draftCommand = parseCommand(composer.draft.trim());
	const isExtensionCommand =
		draftCommand !== undefined &&
		composer.commands.some((item) => item.source === "extension" && item.name === draftCommand.name);
	const isBlocked =
		!host.isOnline ||
		host.host?.role === "viewer" ||
		activity === "compacting" ||
		activity === "stopping" ||
		(sessionView !== undefined && sessionView.state.initialization.kind !== "ready") ||
		(sessionView?.state.extensionUi.prompts.length ?? 0) > 0 ||
		(capabilities.configStyle === "pi" &&
			!isExtensionCommand &&
			(sessionView?.state.model === undefined || providerAuth[sessionView.state.model.provider] === false));
	const queued = sessionView?.state.queued ?? { steering: [], followUp: [] };
	const canFork =
		activity === "idle" &&
		sessionView?.state.maintenance === undefined &&
		sessionView?.state.initialization.kind === "ready" &&
		sessionView.state.extensionUi.prompts.length === 0;
	const [draftModel, setDraftModel] = useState<ModelInfo | undefined>(undefined);
	const [draftThinkingLevel, setDraftThinkingLevel] = useState<ThinkingLevel | undefined>(undefined);
	const [draftAcpState, setDraftAcpState] = useState<
		{ mode?: AcpModeState; configOptions: AcpConfigOption[] } | undefined
	>(undefined);
	useEffect(() => {
		if (host.phase !== "ready" || session.selectedAgentId !== PI_AGENT_ID) {
			return;
		}
		let cancelled = false;
		void client
			.getAgentDefaults()
			.then((defaults) => {
				if (cancelled) {
					return;
				}
				const savedMem = draftContexts.byEndpoint[draftEndpoint];
				const desiredProvider = savedMem?.modelProvider ?? defaults.model?.provider;
				const desiredId = savedMem?.modelId ?? defaults.model?.id;
				const matched =
					desiredProvider !== undefined && desiredId !== undefined
						? host.catalog.models.find((item) => item.provider === desiredProvider && item.id === desiredId)
						: undefined;
				setDraftModel(matched ?? host.catalog.models[0]);
				setDraftThinkingLevel(savedMem?.thinkingLevel ?? defaults.thinkingLevel);
			})
			.catch(() => {
				if (!cancelled) {
					setDraftModel((current) => current ?? host.catalog.models[0]);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [
		client,
		draftContexts.byEndpoint,
		draftEndpoint,
		host.catalog.models,
		host.phase,
		session.selectedAgentId,
	]);

	useEffect(() => {
		if (host.phase !== "ready" || session.selectedAgentId === PI_AGENT_ID || sessionView !== undefined) {
			return;
		}
		let cancelled = false;
		setDraftAcpState(undefined);
		void client
			.getAcpDraftConfig({
				agentId: session.selectedAgentId,
				...(draftCwd === undefined ? {} : { cwd: draftCwd }),
			})
			.then((result) => {
				if (!cancelled) {
					setDraftAcpState(result);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setDraftAcpState(undefined);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [client, draftCwd, host.phase, session.selectedAgentId, sessionView]);

	const updateDraftAcpMode = useCallback((modeId: string) => {
		setDraftAcpState((current) =>
			current?.mode === undefined
				? current
				: { ...current, mode: { ...current.mode, currentModeId: modeId } },
		);
	}, []);

	const updateDraftAcpConfigOption = useCallback(
		(configId: string, value: string) => {
			setDraftAcpState((current) =>
				current === undefined
					? current
					: {
							...current,
							configOptions: current.configOptions.map((opt) =>
								opt.id === configId ? { ...opt, currentValue: value } : opt,
							),
						},
			);
			if (host.phase !== "ready" || session.selectedAgentId === PI_AGENT_ID) {
				return;
			}
			void client
				.getAcpDraftConfig({
					agentId: session.selectedAgentId,
					...(draftCwd === undefined ? {} : { cwd: draftCwd }),
					configId,
					configValue: value,
				})
				.then((result) => {
					setDraftAcpState((current) => ({
						mode: current?.mode ?? result.mode,
						configOptions: result.configOptions,
					}));
				})
				.catch(() => undefined);
		},
		[client, draftCwd, host.phase, session.selectedAgentId],
	);
	const errorBar =
		session.sessionError === undefined ? null : (
			<div className="session-error">
				<span className="session-error-text">{session.sessionError.message}</span>
				<Button variant="secondary" size="md" onClick={session.sessionError.retry}>
					{t("common.retry")}
				</Button>
				<IconButton
					variant="ghost"
					size="sm"
					className="ib"
					aria-label={t("app.closeNotice")}
					onClick={() => session.setSessionError(undefined)}
				>
					<X size={ICON_SIZE.sm} />
				</IconButton>
			</div>
		);

	/**
	 * 打开工作区的一件工具（启动清单、`+` 菜单与标签栏三处共用）。
	 *
	 * 终端还没有就地新建一个：标签本身就是入口，用户点了它要的就是一个能用的终端，而不是
	 * 一片空白；建成之后由上层把标签切过去。
	 */
	const selectWorkspaceTab = useCallback(
		(id: WorkspaceTabId): void => {
			if (id === "terminal" && terminalId === undefined) {
				void openTerminal();
				return;
			}
			shell.setPanelTab(id);
		},
		[openTerminal, shell, terminalId],
	);

	/**
	 * 点输入区里的 `@文件` 胶囊：打开右栏的文件页并把它打开。
	 *
	 * 只是看文件，不碰草稿——用户多半是照着引用核对一眼，回来还要接着写。右栏收起或没开
	 * 文件页时 `setPanelTab` 会顺手把它们打开。
	 */
	const openMentionFile = useCallback(
		(filePath: string): void => {
			if (sessionCwd === undefined) {
				return;
			}
			selectWorkspaceTab("files");
			void docs.openFile(sessionCwd, filePath);
		},
		[docs, selectWorkspaceTab, sessionCwd],
	);

	/**
	 * 关掉右栏的一个标签。
	 *
	 * 关终端标签时顺手把它的 PTY 关掉：标签没了还留一个进程在主机上，下次打开在同一列里
	 * 会看到一个没人看的会话。文件与变更只卸界面，不碰磁盘。
	 */
	const closeWorkspaceTab = useCallback(
		(id: WorkspaceTabId): void => {
			if (id === "terminal" && terminalId !== undefined) {
				void terminal.closeTerminal(terminalId);
			}
			if (id === "browser") {
				bridge.browser?.dispose();
			}
			shell.closePanelTab(id);
		},
		[shell, terminal, terminalId],
	);

	const handleSelectDraftHost = useCallback(
		(endpoint: string) => {
			onDraftEndpointChange(endpoint);
			if (endpoint !== LOCAL_TARGET) {
				hosts.connectHost(endpoint);
			}
			const remembered = draftContexts.byEndpoint[endpoint];
			onDraftCwdChange(remembered?.cwd);
			if (remembered?.agentId !== undefined) {
				session.selectAgent(remembered.agentId);
			}
		},
		[draftContexts.byEndpoint, hosts, onDraftCwdChange, onDraftEndpointChange, session],
	);

	const handleSelectDraftCwd = useCallback(
		(cwd: string | undefined) => {
			onDraftCwdChange(cwd);
			updateDraftContexts(updateEndpointDraftMemory(draftContexts, draftEndpoint, { cwd }));
		},
		[draftContexts, draftEndpoint, onDraftCwdChange, updateDraftContexts],
	);

	const handleSelectDraftAgent = useCallback(
		(agentId: string) => {
			session.selectAgent(agentId);
			updateDraftContexts(updateEndpointDraftMemory(draftContexts, draftEndpoint, { agentId }));
		},
		[draftContexts, draftEndpoint, session, updateDraftContexts],
	);

	const handleSelectRecentContext = useCallback(
		(ctx: RecentDraftContext) => {
			onDraftEndpointChange(ctx.endpoint);
			if (ctx.endpoint !== LOCAL_TARGET) {
				hosts.connectHost(ctx.endpoint);
			}
			onDraftCwdChange(ctx.cwd);
			session.selectAgent(ctx.agentId);
		},
		[hosts, onDraftCwdChange, onDraftEndpointChange, session],
	);

	const isRemoteActive = activeTarget !== undefined && activeTarget.endpoint !== LOCAL_TARGET;
	const activeHostLabel = useMemo(() => {
		if (activeTarget === undefined || activeTarget.endpoint === LOCAL_TARGET) {
			return t("app.localHost");
		}
		return (
			host.hostList.hosts.find((entry) => entry.endpoint === activeTarget.endpoint)?.name ??
			activeTarget.endpoint
		);
	}, [activeTarget, host.hostList.hosts, t]);
	const activeProjectLabel =
		sessionCwd !== undefined && sessionCwd.length > 0 ? baseName(sessionCwd) || sessionCwd : undefined;

	const offlineTargetBanner =
		isRemoteActive && !host.isOnline && session.sessionError === undefined ? (
			<div className="session-error">
				<span className="session-error-text">{activeHostLabel}</span>
				<Button variant="secondary" size="md" onClick={() => hosts.reconnectHost(activeTarget.endpoint)}>
					<RotateCw size={ICON_SIZE.sm} />
					{t("common.retry")}
				</Button>
			</div>
		) : null;

	/** 主区的内容：有会话就是对话，没有会话就是空状态 */
	const mainContent =
		sessionView === undefined ? (
			<div className="empty-wrap">
				{errorBar}
				<EmptyState
					hostName={draftHostLabel}
					hosts={draftHostOptions}
					selectedHostEndpoint={draftEndpoint}
					onSelectHost={handleSelectDraftHost}
					cwd={draftCwd}
					projects={session.projects}
					agents={session.agents}
					selectedAgentId={session.selectedAgentId}
					onSelectCwd={handleSelectDraftCwd}
					onSelectAgent={handleSelectDraftAgent}
					canCreate={host.phase === "ready"}
					onSend={(text) => {
						updateDraftContexts(
							pushRecentDraftContext(
								updateEndpointDraftMemory(draftContexts, draftEndpoint, {
									cwd: draftCwd,
									agentId: session.selectedAgentId,
									...(draftModel !== undefined
										? { modelProvider: draftModel.provider, modelId: draftModel.id }
										: {}),
									...(draftThinkingLevel !== undefined ? { thinkingLevel: draftThinkingLevel } : {}),
								}),
								{
									endpoint: draftEndpoint,
									hostLabel: draftHostLabel,
									cwd: draftCwd,
									agentId: session.selectedAgentId,
									updatedAt: Date.now(),
								},
							),
						);
						void composer.takePendingImages().then((images) => {
							const acpConfig =
								session.selectedAgentId !== PI_AGENT_ID && draftAcpState !== undefined
									? Object.fromEntries(draftAcpState.configOptions.map((opt) => [opt.id, opt.currentValue]))
									: undefined;
							session.createSession(draftCwd ?? "", text, {
								...(session.selectedAgentId === PI_AGENT_ID && draftModel !== undefined
									? { model: { provider: draftModel.provider, id: draftModel.id } }
									: {}),
								...(session.selectedAgentId === PI_AGENT_ID && draftThinkingLevel !== undefined
									? { thinkingLevel: draftThinkingLevel }
									: {}),
								...(session.selectedAgentId !== PI_AGENT_ID && draftAcpState?.mode !== undefined
									? { acpModeId: draftAcpState.mode.currentModeId }
									: {}),
								...(acpConfig !== undefined && Object.keys(acpConfig).length > 0 ? { acpConfig } : {}),
								...(images.length === 0 ? {} : { images }),
							});
						});
					}}
					onAddProject={session.openProjectDialog}
					onRenameProject={session.renameProject}
					onRemoveProject={session.removeProject}
					onRevealProject={session.revealProject}
					recentContexts={draftContexts.recent}
					onSelectRecentContext={handleSelectRecentContext}
					shiftEnterToSend={localInput.sendKey === "shiftEnter"}
					capabilities={session.selectedAgentId === PI_AGENT_ID ? undefined : ACP_DRAFT_CAPABILITIES}
					acpMode={session.selectedAgentId === PI_AGENT_ID ? undefined : draftAcpState?.mode}
					acpConfigOptions={
						session.selectedAgentId === PI_AGENT_ID ? undefined : draftAcpState?.configOptions
					}
					onAcpModeChange={updateDraftAcpMode}
					onAcpConfigOptionChange={updateDraftAcpConfigOption}
					model={session.selectedAgentId === PI_AGENT_ID ? draftModel : undefined}
					models={session.selectedAgentId === PI_AGENT_ID ? host.catalog.models : undefined}
					thinkingLevel={session.selectedAgentId === PI_AGENT_ID ? draftThinkingLevel : undefined}
					thinkingLevels={
						session.selectedAgentId === PI_AGENT_ID && draftModel?.reasoning
							? ["off", "minimal", "low", "medium", "high", "xhigh"]
							: undefined
					}
					providerAuth={session.selectedAgentId === PI_AGENT_ID ? host.catalog.auth : undefined}
					onModelChange={(next) => {
						setDraftModel(next);
						updateDraftContexts(
							updateEndpointDraftMemory(draftContexts, draftEndpoint, {
								modelProvider: next.provider,
								modelId: next.id,
							}),
						);
					}}
					onThinkingLevelChange={(level) => {
						setDraftThinkingLevel(level);
						updateDraftContexts(
							updateEndpointDraftMemory(draftContexts, draftEndpoint, { thinkingLevel: level }),
						);
					}}
					attachments={composer.pendingImages.map((item) => ({
						id: item.id,
						name: item.name,
						previewUrl: item.previewUrl,
					}))}
					onPickImages={composer.pickImages}
					onAddImages={composer.addImages}
					canAddImages={draftModel?.input.includes("image") ?? true}
					onRemoveAttachment={composer.removeImage}
					attachmentNotice={composer.imageNotice}
					mentionFiles={draftCwd === undefined ? [] : mentionFiles}
				/>
			</div>
		) : (
			<ChatArea
				host={host}
				session={session}
				composer={composer}
				transcript={transcript}
				sessionView={sessionView}
				chat={chat}
				openedSessionId={openedSessionId}
				activity={activity}
				sessionCwd={sessionCwd}
				canFork={canFork}
				isBlocked={isBlocked}
				queued={queued}
				errorBar={errorBar ?? offlineTargetBanner}
				copyText={copyText}
				composerInput={composerInput}
				mentionFiles={mentionFiles}
				onOpenMentionFile={openMentionFile}
				localInput={localInput}
				isSettled={activeSettled}
				onReopen={activeKey === undefined ? undefined : () => inbox.reopen(activeKey)}
			/>
		);

	/* 右栏占着列时，它的控件在顶带右格里；否则顶带中格右端只留一个入口。浏览器标签无项目时也可用 */
	const hasWorkspaceCwd = sessionCwd !== undefined || draftCwd !== undefined;
	const hasBrowserTab = canUseBrowser && shell.panel.openTabs.includes("browser");
	const hasPanelColumn = shell.panelVisible && (hasWorkspaceCwd || hasBrowserTab);
	const [isPaneResizing, setIsPaneResizing] = useState(false);
	const settingsOpen = shell.view === "settings";
	const settingsMounted = useModalPresence(settingsOpen);
	const shellRef = useRef<HTMLDivElement | null>(null);
	const panelPresence = usePanelPresence(hasPanelColumn, shellRef);
	const panelChromeClass = ["chrome-slot", "is-panel", hasPanelColumn ? "is-open" : undefined]
		.filter((item) => item !== undefined)
		.join(" ");
	const panelChromeStyle = { "--panel-box-width": `${shell.panelEffectiveWidth}px` } as CSSProperties;

	return (
		<CodeThemeProvider value={shell.codeTheme}>
			<AppFrame
				sidebarWidth={`${shell.sidebarWidth}px`}
				// 列轨道用实占宽：偏好宽可能比「给正文留够地方」之后剩下的宽度更宽
				panelWidth={`${shell.panelEffectiveWidth}px`}
				sidebarVisible={shell.sidebarVisible}
				panelVisible={hasPanelColumn}
				panelExpanded={shell.isPanelExpanded}
				chrome={
					<>
						<div
							className={
								shell.isNarrow || !shell.isSidebarOpen
									? "chrome-slot is-sidebar"
									: "chrome-slot is-sidebar is-open"
							}
						>
							{shell.isNarrow ? null : (
								<SidebarHeader
									isSearchOpen={shell.isSearchOpen}
									onToggleSearch={() => shell.setSearchOpen(!shell.isSearchOpen)}
								/>
							)}
						</div>
						<div className="chrome-slot is-main">
							{chromeTitle === undefined ? null : (
								<>
									{activeProjectLabel === undefined ? null : (
										<>
											<span className="chrome-project">{activeProjectLabel}</span>
											<span className="chrome-crumb-sep">/</span>
										</>
									)}
									<span className="chrome-title">{chromeTitle}</span>
								</>
							)}
							<span className="chrome-spacer" />
						</div>
						{panelPresence.mounted ? (
							<div className={panelChromeClass} style={panelChromeStyle}>
								<div className="chrome-slot-row">
									<WorkspacePanelControls
										shell={shell}
										items={tabItems}
										onSelectTab={selectWorkspaceTab}
										onCloseTab={closeWorkspaceTab}
										controlsId="workspace-panel"
										showExpand={!shell.isNarrow}
									/>
								</div>
							</div>
						) : null}
						{/* 左右栏开关各自固定在顶带两端（置于 slot 之后以防兄弟拖窗层截获命中），仅形变内部竖线 */}
						<div className="chrome-brand">
							<span className="sb-title">Facet</span>
							<SidebarToggle
								isOpen={shell.isNarrow ? shell.isDrawerOpen : shell.sidebarVisible}
								onToggle={shell.toggleSidebar}
							/>
						</div>
						{hasWorkspaceCwd || hasBrowserTab ? (
							<PanelToggle
								isOpen={shell.panelVisible}
								onToggle={shell.togglePanel}
								badge={tabItems.find((item) => item.id === "changes")?.badge}
							/>
						) : null}
					</>
				}
			>
				<div className={shell.className} ref={shellRef}>
					{shell.isDrawerOpen ? (
						<button
							type="button"
							className="drawer-scrim"
							aria-label={t("app.closeDrawer")}
							onClick={shell.closeDrawer}
						/>
					) : null}
					<SessionSidebar
						activeCards={inbox.activeCards}
						settledItems={inbox.settledItems}
						activeKey={activeKey}
						onSelectTarget={handleSelectTarget}
						onSettle={handleSettleCard}
						onReopen={handleReopenItem}
						onStartNew={() => {
							onDraftCwdChange(draftCwd ?? session.projects[0]?.cwd);
							session.resetActive();
							onActiveTargetChange(undefined);
						}}
						canCreate={host.phase === "ready" || hosts.localRuntime.getSnapshot().phase === "ready"}
						onOpenSearch={() => shell.setSearchOpen(true)}
						showHeader={shell.isNarrow}
						width={shell.isNarrow ? undefined : shell.sidebarWidth}
						onWidthChange={shell.isNarrow ? undefined : shell.updateSidebarWidth}
						maxWidth={shell.sidebarMaxWidth}
						onDraggingChange={shell.setPaneResizing}
						// 缩到最小宽一半以内松手就收起侧栏，与点收起按钮同一条路
						onDragCollapse={shell.toggleSidebar}
						onCollapse={shell.closeDrawer}
						onRevealSessionFolder={revealSessionFolderFor}
						onRenameSession={renameSessionFor}
						onDeleteSession={deleteSessionFor}
						onOpenSettings={shell.openSettings}
						isSettingsOpen={shell.view === "settings"}
						isOpen={shell.isDrawerOpen}
						onNavigate={shell.closeDrawer}
						hostSwitcher={
							<HostSwitcher
								localEndpoint={LOCAL_TARGET}
								localName={t("app.localHost")}
								hosts={host.hostList.hosts}
								statuses={hostNodeStatuses}
								onConnect={host.connectHost}
								onDisconnect={(endpoint) => {
									host.disconnectHost(endpoint);
									inbox.clearEndpointOffline(endpoint);
									if (activeTarget?.endpoint === endpoint) {
										onActiveTargetChange(undefined);
									}
								}}
								onReconnect={host.reconnectHost}
								onSubmitPassword={host.submitSshPasswordFor}
								onCancelAuth={host.cancelSshAuthFor}
								onAddHost={host.addHost}
								onRemoveHost={(id) => {
									const removedEndpoint = host.hostList.hosts.find((item) => item.id === id)?.endpoint;
									host.removeHost(id);
									if (removedEndpoint !== undefined) {
										inbox.clearEndpointOffline(removedEndpoint);
										if (activeTarget?.endpoint === removedEndpoint) {
											onActiveTargetChange(undefined);
										}
									}
								}}
								onRenameHost={host.renameHost}
								onToggleAutoConnect={host.setHostAutoConnect}
							/>
						}
					/>

					{/* 主区只有对话：消息流与输入区直接撑满这一列，不再有标签栏 */}
					<main className="main">{mainContent}</main>

					{panelPresence.mounted ? (
						<RightPanel
							/*
							 * 始终把实占宽传给右栏作为 `--panel-box-width`，只通过 `onWidthChange` 开关分隔条；
							 * 展开/还原过渡时右侧栏据此在固定位置与整行宽之间平滑伸缩覆盖主栏。
							 */
							width={shell.panelEffectiveWidth}
							onWidthChange={shell.isPanelExpanded ? undefined : (width) => shell.updatePanel({ width })}
							maxWidth={shell.panelMaxWidth}
							onDraggingChange={(dragging) => {
								setIsPaneResizing(dragging);
								shell.setPaneResizing(dragging);
							}}
							// 缩到最小宽一半以内松手就收起右栏，已打开的标签不动
							onDragCollapse={shell.togglePanel}
							bodyClassName="is-workspace"
						>
							<WorkspaceBody
								openTabs={shell.panel.openTabs}
								activeTab={shell.panel.activeTab}
								items={tabItems}
								onOpenTab={selectWorkspaceTab}
								docs={docs}
								terminal={terminal}
								sessionCwd={sessionCwd}
								terminalId={terminalId}
								storage={workspaceStorage}
								browserOccluded={
									!shell.panelVisible ||
									isPaneResizing ||
									settingsOpen ||
									shell.isSearchOpen ||
									session.isProjectDialogOpen ||
									session.trustPrompt !== undefined ||
									shell.isDrawerOpen
								}
								uiScale={shell.uiScale}
							/>
						</RightPanel>
					) : null}

					<SessionSearch
						isOpen={shell.isSearchOpen}
						activeCards={inbox.activeCards}
						settledItems={inbox.settledItems}
						activeKey={activeKey}
						onClose={() => shell.setSearchOpen(false)}
						onSelectTarget={handleSelectTarget}
					/>

					{settingsMounted ? (
						<SettingsPage
							open={settingsOpen}
							section={shell.settingsSection}
							onSectionChange={shell.setSettingsSection}
							onClose={shell.closeSettings}
							data={settingsData}
							onSettingsApplied={(next) => settingsRuntime.applySettings(next)}
							onAppearancePreview={(appearance) => {
								applyAppearance(appearance);
							}}
							about={{
								appVersion: bridge.appVersion,
								runtime: `Electron ${bridge.platform}`,
								endpoint: settingsEndpoint,
							}}
							targetHosts={targetHosts}
							selectedHostEndpoint={settingsEndpoint}
							onSelectTargetHost={setSettingsEndpoint}
							onConnectTargetHost={(endpoint) => hosts.connectHost(endpoint)}
							uiScale={bridge.platform === "web" ? undefined : shell.uiScale}
							onUiScaleChange={bridge.platform === "web" ? undefined : shell.changeUiScale}
							languageSetting={languageSetting}
							onLanguageChange={onLanguageChange}
							localAppearance={localAppearance}
							onLocalAppearanceChange={onLocalAppearanceChange}
							localInput={localInput}
							onLocalInputChange={onLocalInputChange}
							localNotifications={localNotifications}
							onLocalNotificationsChange={onLocalNotificationsChange}
							localTerminal={localTerminal}
							onLocalTerminalChange={onLocalTerminalChange}
							// 浏览器入口改不了主机配置，桌面与 SSH 通道可以
							canEdit={settingsRuntime.getSnapshot().handshake?.canManage === true}
						/>
					) : null}

					<CreateProjectDialog
						isOpen={session.isProjectDialogOpen}
						onPickFolder={() => bridge.pickDirectory()}
						onCreate={session.createProject}
						onClose={session.closeProjectDialog}
					/>

					{session.trustPrompt ? (
						<TrustDialog
							cwd={session.trustPrompt.cwd}
							onDecide={session.decideTrust}
							onCancel={session.cancelTrust}
						/>
					) : null}
				</div>
			</AppFrame>
			{shell.zoomBadge === undefined ? null : (
				<div className="zoom-badge" role="status">
					{shell.zoomBadge}%
				</div>
			)}
		</CodeThemeProvider>
	);
}
