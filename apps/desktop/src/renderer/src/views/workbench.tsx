/**
 * 主工作区。
 *
 * 三栏骨架、标签栏、右栏与各种弹窗的组装；状态都来自上层建好的几个域，这里只把
 * 它们摆到位并接上回调。
 */

import type { ChatView } from "@facet/client-core";
import { chatActivity } from "@facet/client-core";
import type { LanguageSetting } from "@facet/i18n";
import {
	ChangesPane,
	CodeThemeProvider,
	CreateProjectDialog,
	FilesPane,
	HostSwitcher,
	MainTabs,
	PanelTabs,
	PanelToggle,
	parseCommand,
	RightPanel,
	SessionSearch,
	SessionSidebar,
	type SettingsDataSource,
	SettingsPage,
	SidebarHeader,
	SidebarToggle,
	TrustDialog,
	useI18n,
} from "@facet/ui";
import { X } from "lucide-react";
import { type ReactNode, type RefObject, useMemo } from "react";
import { AppFrame } from "../app-frame.tsx";
import { bridge } from "../bridge.ts";
import type { Composer } from "../hooks/useComposer.ts";
import type { HostConnection } from "../hooks/useHostConnection.ts";
import type { MainTabs as MainTabsState } from "../hooks/useMainTabs.ts";
import type { SessionLifecycle } from "../hooks/useSessionLifecycle.ts";
import type { TerminalPanel } from "../hooks/useTerminalPanel.ts";
import type { Transcript } from "../hooks/useTranscript.ts";
import type { WorkspaceShell } from "../hooks/useWorkspaceShell.ts";
import { applyAppearance } from "../hooks/useWorkspaceShell.ts";
import { LOCAL_TARGET } from "../host-connection.ts";
import { useHostClient } from "../host-context.tsx";
import { toTabItems } from "../main-tabs.ts";
import { ChatArea } from "./chat-area.tsx";
import { DocumentPane } from "./document-pane.tsx";

export interface WorkbenchProps {
	/** 连接域 */
	host: HostConnection;
	/** 会话域 */
	session: SessionLifecycle;
	/** 外壳呈现状态 */
	shell: WorkspaceShell;
	/** 标签域 */
	tabs: MainTabsState;
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
	/** 关掉一个标签 */
	closeTab: (id: string) => void;
	/** 一次关掉多个标签 */
	closeTabs: (ids: readonly string[]) => void;
	/** 复制一段文本 */
	copyText: (text: string) => void;
	/** 输入框本身：引用之后要把光标放回它末尾 */
	composerInput: RefObject<HTMLTextAreaElement | null>;
	/** 开一个终端并摆好标签 */
	openTerminal: () => Promise<void>;
}

/** 三栏工作区。 */
export function Workbench(props: WorkbenchProps): ReactNode {
	const {
		host,
		session,
		shell,
		tabs,
		terminal,
		composer,
		transcript,
		languageSetting,
		onLanguageChange,
		openedSessionId,
		closeTab,
		closeTabs,
		copyText,
		openTerminal,
		composerInput,
	} = props;
	const { t } = useI18n();
	const client = useHostClient();
	const sessionView = client.sessionView();
	const chat: ChatView | undefined = client.chatView();
	const activity = chatActivity(sessionView);
	const sessionCwd: string | undefined = sessionView?.state.cwd;
	const canUseTerminal = host.host?.capabilities.includes("terminal") ?? false;
	const providerAuth = host.catalog.auth;
	const tabItems = useMemo(
		() =>
			toTabItems(
				tabs.tabs,
				terminal.terminals,
				{ session: sessionView, openedSessionId, summaries: session.sessions },
				{
					untitled: t("sidebar.untitled"),
					changes: t("mainTabs.changes"),
					diff: t("mainTabs.diff"),
					commit: (sha) => t("mainTabs.commit", { sha }),
					newTerminal: t("terminal.newTerminal"),
				},
			),
		[openedSessionId, session.sessions, sessionView, t, tabs.tabs, terminal.terminals],
	);
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
	const activeTab = tabs.tabs.find((item) => item.id === tabs.activeTabId);
	const fileTab = activeTab?.kind === "file" ? activeTab : undefined;
	const errorBar =
		session.sessionError === undefined ? null : (
			<div className="session-error">
				<span className="session-error-text">{session.sessionError.message}</span>
				<button type="button" className="btn" onClick={session.sessionError.retry}>
					{t("common.retry")}
				</button>
				<button
					type="button"
					className="ib"
					aria-label={t("app.closeNotice")}
					onClick={() => session.setSessionError(undefined)}
				>
					<X size={12} strokeWidth={1.5} />
				</button>
			</div>
		);
	const chatArea =
		sessionView === undefined ? null : (
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
			/>
		);
	const panelTabs = <PanelTabs tab={shell.panel.tab} onTabChange={shell.setPanelTab} />;
	/*
	 * 右栏开关与分页放在哪一格，看右列此刻有没有宽度：有就占右栏那一格（与正文列对齐），
	 * 没有（右栏收起、中档被预算折起、窄档整列不存在）就贴在中间那格右端，仍在窗口按钮左侧。
	 *
	 * 开关的展开态看的是「此刻看不看得见」，不是意图位：中档被预算折起时点一下就是要把它
	 * 调出来，而不是把意图位关掉。
	 */
	const bandPanelControls = (
		<>
			{/* 窄档抽屉开着时这个开关留在原地（被盖住）：关掉之后焦点要还给它 */}
			<PanelToggle
				isOpen={shell.isNarrow ? shell.isPanelDrawerOpen : shell.panelVisible}
				onToggle={shell.togglePanel}
			/>
			{shell.isNarrow || !shell.panel.open ? null : panelTabs}
		</>
	);
	/* 窄档抽屉的顶头：分页与关闭按钮都在这一条 36px 里 */
	const panelDrawerHead = (
		<>
			<PanelToggle isOpen onToggle={shell.closeDrawer} />
			{panelTabs}
		</>
	);
	const hasPanelColumn = shell.panelVisible && !shell.isNarrow;
	/* 窄档看抽屉，平铺看预算判定的结果 */
	const renderPanel = shell.isNarrow ? shell.isPanelDrawerOpen : shell.panelVisible;
	/* 窄档与右栏收起时，开关都留在中格（抽屉开着时它被遮罩盖住） */
	const showBandPanelControls = !hasPanelColumn;
	return (
		<CodeThemeProvider value={shell.codeTheme}>
			<AppFrame
				sidebarWidth={`${shell.sidebarWidth}px`}
				panelWidth={`${shell.panel.width}px`}
				sidebarVisible={shell.sidebarVisible}
				panelVisible={shell.panelVisible}
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
							 * 侧栏展开时开关在它自己的头部里，收起之后才回到主区左上角。
							 * 窄档抽屉开着时这个开关留在原地（被抽屉与遮罩盖住）：抽屉关掉之后
							 * 焦点要还给它，元素不能在打开期间就被卸载掉。
							 */}
							{shell.isNarrow ? (
								<SidebarToggle isOpen={false} onToggle={shell.toggleSidebar} />
							) : shell.isSidebarOpen ? null : (
								<SidebarToggle isOpen={false} onToggle={shell.toggleSidebar} />
							)}
							{showBandPanelControls ? (
								<>
									<span className="chrome-spacer" />
									{bandPanelControls}
								</>
							) : null}
						</div>
						{hasPanelColumn ? <div className="chrome-slot is-panel is-open">{bandPanelControls}</div> : null}
					</>
				}
			>
				<div className={shell.className}>
					{shell.isDrawerOpen || shell.isPanelDrawerOpen ? (
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

					<main className="main">
						<MainTabs
							tabs={tabItems}
							activeId={tabs.activeTabId}
							onSelect={tabs.selectTab}
							onClose={closeTab}
							onCloseTabs={closeTabs}
							onCopyText={copyText}
							onReorder={tabs.reorderTabs}
							onCreateTerminal={() => void openTerminal()}
							canCreateTerminal={canUseTerminal}
						/>
						<div className="main-tab-content" id="main-tab-content">
							<DocumentPane
								host={host}
								session={session}
								tabs={tabs}
								terminal={terminal}
								sessionView={sessionView}
								emptyCreateCwd={emptyCreateCwd}
								errorBar={errorBar}
								chat={chatArea}
							/>
						</div>
					</main>

					{renderPanel ? (
						<RightPanel
							width={shell.isNarrow ? undefined : shell.panel.width}
							onWidthChange={shell.isNarrow ? undefined : (width) => shell.updatePanel({ width })}
							maxWidth={shell.panelMaxWidth}
							onDraggingChange={shell.setPaneResizing}
							head={shell.isNarrow ? panelDrawerHead : undefined}
						>
							{shell.panel.tab === "changes" ? (
								<ChangesPane
									status={tabs.changes.status}
									error={tabs.changes.error}
									onRefresh={() => void tabs.refreshChanges({ force: true })}
									onOpenDiff={(file) => {
										if (sessionCwd !== undefined) {
											tabs.openDiff(sessionCwd, file);
										}
									}}
									commits={tabs.commits.data}
									commitsLoading={tabs.commits.isLoading}
									commitsError={tabs.commits.error}
									onCommitPress={(commit) => {
										if (sessionCwd !== undefined) {
											tabs.openCommit(sessionCwd, commit);
										}
									}}
								/>
							) : tabs.fileError === undefined ? (
								<FilesPane
									loadDirectory={(path) =>
										sessionCwd === undefined
											? Promise.reject(new Error(t("app.noSession")))
											: client.listDirectory(sessionCwd, path)
									}
									onOpenFile={(path) => {
										if (sessionCwd !== undefined) {
											void tabs.openFile(sessionCwd, path);
										}
									}}
									selectedPath={
										fileTab !== undefined && fileTab.cwd === sessionCwd ? fileTab.path : undefined
									}
								/>
							) : (
								<p className="chg-note is-error">
									{tabs.fileError}
									<button type="button" className="chg-retry" onClick={tabs.clearFileError}>
										{t("editor.backToDirectory")}
									</button>
								</p>
							)}
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
