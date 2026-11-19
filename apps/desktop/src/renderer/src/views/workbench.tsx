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
import { type ReactNode, useMemo } from "react";
import { AppFrame } from "../app-frame.tsx";
import type { Composer } from "../hooks/useComposer.ts";
import type { HostConnection } from "../hooks/useHostConnection.ts";
import type { MainTabs as MainTabsState } from "../hooks/useMainTabs.ts";
import type { SessionLifecycle } from "../hooks/useSessionLifecycle.ts";
import type { TerminalPanel } from "../hooks/useTerminalPanel.ts";
import type { Transcript } from "../hooks/useTranscript.ts";
import type { WorkspaceShell } from "../hooks/useWorkspaceShell.ts";
import { applyAppearance } from "../hooks/useWorkspaceShell.ts";
import { LOCAL_TARGET } from "../host-connection.ts";
import { toTabItems } from "../main-tabs.ts";
import { bridge, client } from "../runtime.ts";
import { WindowControls } from "../WindowControls.tsx";
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
	} = props;
	const { t } = useI18n();
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
			setProviderBaseUrl: (providerId, baseUrl) => client.setProviderBaseUrl(providerId, baseUrl),
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
		[host.refreshCatalog],
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
			/>
		);
	return (
		<CodeThemeProvider value={shell.codeTheme}>
			<AppFrame
				sidebarWidth={shell.isSidebarOpen && !shell.isNarrow ? `${shell.sidebarWidth}px` : "0px"}
				panelWidth={shell.panel.open ? `${shell.panel.width}px` : "0px"}
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
							{/* 侧栏展开时开关在它自己的头部里，收起之后才回到主区左上角 */}
							{shell.isNarrow ? (
								shell.isDrawerOpen ? null : (
									<SidebarToggle isOpen={false} onToggle={shell.toggleSidebar} />
								)
							) : shell.isSidebarOpen ? null : (
								<SidebarToggle isOpen={false} onToggle={shell.toggleSidebar} />
							)}
						</div>
						<div
							className={
								shell.panel.open ? "chrome-slot is-panel is-open" : "chrome-slot is-panel is-compact"
							}
						>
							<PanelToggle
								isOpen={shell.panel.open}
								onToggle={() => shell.updatePanel({ open: !shell.panel.open })}
							/>
							{shell.panel.open ? (
								<PanelTabs tab={shell.panel.tab} onTabChange={(tab) => shell.updatePanel({ tab })} />
							) : null}
							<span className="chrome-spacer" />
							{shell.windowControls === undefined ? null : <WindowControls controls={shell.windowControls} />}
						</div>
					</>
				}
			>
				<div className={shell.className}>
					{shell.isDrawerOpen ? (
						<button
							type="button"
							className="sb-backdrop"
							aria-label={t("app.closeSidebar")}
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
								onConnect={(next) => void host.selectHost(next)}
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

					{shell.panel.open ? (
						<RightPanel
							width={shell.isNarrow ? undefined : shell.panel.width}
							onWidthChange={shell.isNarrow ? undefined : (width) => shell.updatePanel({ width })}
						>
							{shell.panel.tab === "changes" ? (
								<ChangesPane
									status={tabs.changes.status}
									isLoading={tabs.changes.isLoading}
									error={tabs.changes.error}
									onRefresh={() => void tabs.refreshChanges()}
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
