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
	Button,
	CodeThemeProvider,
	type ComposerHandle,
	CreateProjectDialog,
	EmptyState,
	HostSwitcher,
	ICON_SIZE,
	IconButton,
	PanelToggle,
	parseCommand,
	RightPanel,
	SessionSearch,
	SessionSidebar,
	type SettingsDataSource,
	SettingsPage,
	SidebarHeader,
	SidebarToggle,
	sessionTitle,
	TrustDialog,
	useI18n,
	type WorkspaceTabId,
} from "@facet/ui";
import { X } from "lucide-react";
import { type ReactNode, type RefObject, useCallback, useMemo } from "react";
import { AppFrame } from "../app-frame.tsx";
import { bridge } from "../bridge.ts";
import type { Composer } from "../hooks/useComposer.ts";
import type { HostConnection } from "../hooks/useHostConnection.ts";
import type { SessionLifecycle } from "../hooks/useSessionLifecycle.ts";
import type { TerminalPanel } from "../hooks/useTerminalPanel.ts";
import type { Transcript } from "../hooks/useTranscript.ts";
import type { WorkspaceDocs } from "../hooks/useWorkspaceDocs.ts";
import type { WorkspaceShell } from "../hooks/useWorkspaceShell.ts";
import { applyAppearance } from "../hooks/useWorkspaceShell.ts";
import { LOCAL_TARGET } from "../host-connection.ts";
import { useHostClient } from "../host-context.tsx";
import { workspaceTabItems } from "../workspace-tabs.ts";
import { ChatArea } from "./chat-area.tsx";
import { WorkspacePanelControls } from "./workspace-band.tsx";
import { WorkspaceBody } from "./workspace-body.tsx";

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
		openedSessionId,
		terminalId,
		copyText,
		openTerminal,
		composerInput,
		mentionFiles,
	} = props;
	const { t } = useI18n();
	const client = useHostClient();
	const sessionView = client.sessionView();
	const chat: ChatView | undefined = client.chatView();
	const activity = chatActivity(sessionView);
	const sessionCwd: string | undefined = sessionView?.state.cwd;
	const canUseTerminal = host.host?.capabilities.includes("terminal") ?? false;
	/** mac 的主修饰键写成 ⌘，其它平台是 Ctrl；启动清单与 `+` 菜单的提示共用这一份 */
	const isMac = bridge.platform === "darwin";
	const tabItems = useMemo(
		() =>
			workspaceTabItems(
				{
					changes: docs.changes.status?.files.length ?? 0,
					terminals: terminal.terminals.length,
					canUseTerminal,
				},
				{
					files: t("panel.files"),
					changes: t("panel.changes"),
					gitGraph: t("panel.gitGraph"),
					terminal: t("panel.terminal"),
				},
				isMac,
			),
		[canUseTerminal, docs.changes.status, isMac, t, terminal.terminals.length],
	);
	/** 主区顶带里的会话标题：跟着侧栏里那一条走，没名字时用首条消息 */
	const activeSession = session.sessions.find((item) => item.path === session.activeFile);
	const chromeTitle =
		activeSession === undefined
			? undefined
			: sessionTitle(activeSession.name, activeSession.firstMessage, t("sidebar.untitled"));
	const settingsData = useMemo<SettingsDataSource>(
		() => ({
			loadSettings: () => client.getSettings(),
			saveSettings: (next) => client.saveSettings(next),
			loadProviders: () => client.listProviders(),
			loadModels: () => client.listModels(),
			// 凭证与自定义提供方会改变可用模型，改完重取一次目录
			saveCredential: (providerId, apiKey) =>
				client.saveCredential(providerId, apiKey).then(async (providers) => {
					await host.refreshCatalog();
					return providers;
				}),
			deleteCredential: (providerId) =>
				client.deleteCredential(providerId).then(async (providers) => {
					await host.refreshCatalog();
					return providers;
				}),
			// 登录的进展走模型通道，状态由 client 的 session store 持有；这里只做转接
			providerLogin: (providerId) => client.store.providerLogin(providerId),
			subscribeProviderLogin: (listener) => client.store.subscribe(listener),
			startProviderLogin: (providerId, authType) => client.startProviderLogin(providerId, authType),
			respondProviderLogin: (loginId, promptId, value) =>
				client.respondProviderLogin(loginId, promptId, value),
			cancelProviderLogin: (loginId) => client.cancelProviderLogin(loginId),
			fetchProviderModels: (input) => client.fetchProviderModels(input),
			listCustomProviders: () => client.listCustomProviders(),
			saveCustomProvider: (provider) =>
				client.saveCustomProvider(provider).then(async (providers) => {
					await host.refreshCatalog();
					return providers;
				}),
			removeCustomProvider: (providerId) =>
				client.removeCustomProvider(providerId).then(async (providers) => {
					await host.refreshCatalog();
					return providers;
				}),
			testModel: (model) => client.testModel(model),
			loadAgentDefaults: () => client.getAgentDefaults(),
			saveAgentDefaults: (patch) => client.setAgentDefaults(patch),
			diagnostics: () => client.diagnostics(),
			saveText: (suggestedName, text) => bridge.saveText(suggestedName, text),
		}),
		[client, host.refreshCatalog],
	);
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
		(!isExtensionCommand &&
			(sessionView?.state.model === undefined || providerAuth[sessionView.state.model.provider] === false));
	const queued = sessionView?.state.queued ?? { steering: [], followUp: [] };
	const canFork =
		activity === "idle" &&
		sessionView?.state.maintenance === undefined &&
		sessionView?.state.initialization.kind === "ready" &&
		sessionView.state.extensionUi.prompts.length === 0;
	const emptyCreateCwd = session.createCwd.length > 0 ? session.createCwd : session.projects[0]?.cwd;
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
			shell.closePanelTab(id);
		},
		[shell, terminal, terminalId],
	);

	/** 主区的内容：有会话就是对话，没有会话就是空状态 */
	const mainContent =
		sessionView === undefined ? (
			<div className="empty-wrap">
				{errorBar}
				<EmptyState
					cwd={emptyCreateCwd}
					canCreate={host.phase === "ready"}
					onCreate={() => {
						if (emptyCreateCwd !== undefined) {
							session.createSession(emptyCreateCwd);
						}
					}}
					onAddProject={session.openProjectDialog}
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
				errorBar={errorBar}
				copyText={copyText}
				composerInput={composerInput}
				mentionFiles={mentionFiles}
				onOpenMentionFile={openMentionFile}
			/>
		);

	/* 右栏占着列时，它的控件在顶带右格里；否则顶带中格右端只留一个入口 */
	const hasPanelColumn = shell.panelVisible;

	return (
		<CodeThemeProvider value={shell.codeTheme}>
			<AppFrame
				sidebarWidth={`${shell.sidebarWidth}px`}
				// 列轨道用实占宽：偏好宽可能比「给正文留够地方」之后剩下的宽度更宽
				panelWidth={`${shell.panelEffectiveWidth}px`}
				sidebarVisible={shell.sidebarVisible}
				panelVisible={shell.panelVisible}
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
							{shell.isNarrow || !shell.isSidebarOpen ? null : (
								<SidebarHeader
									isSearchOpen={shell.isSearchOpen}
									onToggleSearch={() => shell.setSearchOpen(!shell.isSearchOpen)}
									onAddProject={session.openProjectDialog}
									onCollapse={shell.toggleSidebar}
								/>
							)}
						</div>
						<div className="chrome-slot is-main">
							{/*
							 * 宽展开时这一列被右栏整个盖住（轨道宽度是 0），整格不渲染控件：
							 * 留着的按钮看不见却还能 Tab 到，还会溢出到右栏那一格上。
							 */}
							{shell.isPanelExpanded ? null : (
								<>
									{/*
									 * 侧栏展开时开关在它自己的头部里，收起之后才回到主区左上角。
									 * 窄档抽屉开着时这个开关留在原地（被抽屉与遮罩盖住）：抽屉关掉之后
									 * 焦点要还给它，元素不能在打开期间就被卸载掉。
									 */}
									{shell.isNarrow || !shell.isSidebarOpen ? (
										<SidebarToggle isOpen={false} onToggle={shell.toggleSidebar} />
									) : null}
									{chromeTitle === undefined ? null : <span className="chrome-title">{chromeTitle}</span>}
									<span className="chrome-spacer" />
									{/* 右栏占列时它的入口在右格；收起（或进抽屉）时回到主区右端 */}
									{hasPanelColumn ? null : (
										<PanelToggle
											isOpen={shell.isPanelOpen}
											onToggle={shell.togglePanel}
											badge={tabItems.find((item) => item.id === "changes")?.badge}
										/>
									)}
								</>
							)}
						</div>
						{hasPanelColumn ? (
							<div className="chrome-slot is-panel is-open">
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
					</>
				}
			>
				<div className={shell.className}>
					{shell.isDrawerOpen ? (
						<button
							type="button"
							className="drawer-scrim"
							aria-label={t("app.closeDrawer")}
							onClick={shell.closeDrawer}
						/>
					) : null}
					<SessionSidebar
						sessions={session.sessions}
						projects={session.projects}
						activeFile={session.activeFile}
						statuses={session.statuses}
						createCwd={session.createCwd}
						onSelect={session.selectSession}
						onCreate={session.createSessionAt}
						canCreate={host.phase === "ready"}
						onAddProject={session.openProjectDialog}
						isSearchOpen={shell.isSearchOpen}
						onOpenSearch={() => shell.setSearchOpen(true)}
						showHeader={shell.isNarrow}
						width={shell.isNarrow ? undefined : shell.sidebarWidth}
						onWidthChange={shell.isNarrow ? undefined : shell.updateSidebarWidth}
						maxWidth={shell.sidebarMaxWidth}
						onDraggingChange={shell.setPaneResizing}
						// 缩到最小宽一半以内松手就收起侧栏，与点收起按钮同一条路
						onDragCollapse={shell.toggleSidebar}
						onCollapse={shell.closeDrawer}
						isProjectsStale={session.isProjectsStale}
						onRefreshProjects={() => void session.refreshProjects()}
						onRenameProject={session.renameProject}
						onRemoveProject={session.removeProject}
						onRevealProject={session.revealProject}
						onRevealSessionFolder={session.revealSessionFolder}
						onRenameSession={session.renameSession}
						onDeleteSession={session.deleteSession}
						onOpenSettings={shell.openSettings}
						isSettingsOpen={shell.view === "settings"}
						hostStatus={
							host.isReconnecting
								? t("app.reconnecting")
								: host.host?.role === "viewer"
									? t("app.readOnly")
									: undefined
						}
						isOpen={shell.isDrawerOpen}
						onNavigate={shell.closeDrawer}
						hostSwitcher={
							<HostSwitcher
								localEndpoint={LOCAL_TARGET}
								localName={host.host?.hostName ?? t("app.localHost")}
								activeEndpoint={host.hostList.activeEndpoint}
								hosts={host.hostList.hosts}
								isOnline={host.isOnline}
								isReconnecting={host.isReconnecting}
								connectedEndpoints={host.connectedEndpoints}
								onConnect={host.selectHost}
								onDisconnect={host.disconnectHost}
								onAddHost={host.addHost}
								onRemoveHost={host.removeHost}
								onRenameHost={host.renameHost}
							/>
						}
					/>

					{/* 主区只有对话：消息流与输入区直接撑满这一列，不再有标签栏 */}
					<main className="main">{mainContent}</main>

					{hasPanelColumn ? (
						<RightPanel
							/*
							 * 宽展开期间不给宽度：那一列的宽度由样式按视口现算，拖动会把它改回
							 * 偏好宽。展开态本来也不需要拖动——它已经是「能给多宽就给多宽」。
							 */
							width={shell.isPanelExpanded ? undefined : shell.panelEffectiveWidth}
							onWidthChange={shell.isPanelExpanded ? undefined : (width) => shell.updatePanel({ width })}
							maxWidth={shell.panelMaxWidth}
							onDraggingChange={shell.setPaneResizing}
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
								listWidth={shell.workspaceListWidth}
								onListWidthChange={shell.updateWorkspaceListWidth}
							/>
						</RightPanel>
					) : null}

					<SessionSearch
						isOpen={shell.isSearchOpen}
						sessions={session.sessions}
						activeFile={session.activeFile}
						statuses={session.statuses}
						onClose={() => shell.setSearchOpen(false)}
						onSelect={session.selectSession}
					/>

					{shell.view === "settings" ? (
						<SettingsPage
							section={shell.settingsSection}
							onSectionChange={shell.setSettingsSection}
							onClose={shell.closeSettings}
							data={settingsData}
							onSettingsApplied={host.applySettings}
							onAppearancePreview={(appearance) => {
								applyAppearance(appearance);
							}}
							about={{
								appVersion: bridge.appVersion,
								runtime: `Electron ${bridge.platform}`,
								endpoint: host.endpoint,
							}}
							uiScale={bridge.platform === "web" ? undefined : shell.uiScale}
							onUiScaleChange={bridge.platform === "web" ? undefined : shell.changeUiScale}
							languageSetting={languageSetting}
							onLanguageChange={onLanguageChange}
							// 浏览器入口改不了主机配置，桌面与 SSH 通道可以
							canEdit={host.host?.canManage === true}
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
