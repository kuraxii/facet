/**
 * 界面组件的对外出口。
 *
 * 组件只消费数据侧的投影结果，不接触连接与状态归约，Web 端与桌面端共用同一套。
 */

export type { ChatOutlineProps } from "./chat/ChatOutline.tsx";
export { ChatOutline } from "./chat/ChatOutline.tsx";
export type { ComposerAttachment, ComposerProps } from "./chat/Composer.tsx";
export { Composer } from "./chat/Composer.tsx";
export type { ContextRingProps, UsageLevel } from "./chat/ContextRing.tsx";
export { ContextRing, formatTokens, usageLabel, usageLevel } from "./chat/ContextRing.tsx";
export type { CreateProjectDialogProps } from "./chat/CreateProjectDialog.tsx";
export { CreateProjectDialog } from "./chat/CreateProjectDialog.tsx";
export type { OutlinePrompt } from "./chat/chat-outline.ts";
export { outlinePrompts } from "./chat/chat-outline.ts";
export {
	filterCommands,
	isFacetCommand,
	parseCommand,
	SOURCE_LABEL_KEYS,
} from "./chat/command-palette.ts";
export type { EmptyStateProps } from "./chat/EmptyState.tsx";
export { EmptyState } from "./chat/EmptyState.tsx";
export { ExtensionPromptCard } from "./chat/ExtensionPromptCard.tsx";
export type { HostSwitcherProps } from "./chat/HostSwitcher.tsx";
export { HostSwitcher } from "./chat/HostSwitcher.tsx";
export type { HostListState, HostListStorage, SavedHost } from "./chat/host-list.ts";
export {
	endpointLabel,
	hasEndpoint,
	normalizeEndpoint,
	readHostList,
	writeHostList,
} from "./chat/host-list.ts";
export type { ProviderDialogProps } from "./chat/ProviderDialog.tsx";
export { ProviderDialog } from "./chat/ProviderDialog.tsx";
export type { QueueStripProps } from "./chat/QueueStrip.tsx";
export { QueueStrip } from "./chat/QueueStrip.tsx";
export { appendQuote, quoteBlock } from "./chat/quote.ts";
export type { ComposerHandle } from "./chat/rich-editor/ComposerEditor.tsx";
export type { SessionSearchProps } from "./chat/SessionSearch.tsx";
export { SessionSearch } from "./chat/SessionSearch.tsx";
export type { SessionSidebarProps } from "./chat/SessionSidebar.tsx";
export { SessionSidebar } from "./chat/SessionSidebar.tsx";
export type {
	SettingsDataSource,
	SettingsPageProps,
	SettingsSection,
} from "./chat/SettingsPage.tsx";
export { SettingsPage } from "./chat/SettingsPage.tsx";
export type { SshPasswordDialogProps } from "./chat/SshPasswordDialog.tsx";
export { SshPasswordDialog } from "./chat/SshPasswordDialog.tsx";
export type { SidebarHeaderProps } from "./chat/sidebar-header.tsx";
export { SidebarHeader } from "./chat/sidebar-header.tsx";
export type {
	GroupKey,
	SidebarData,
	SidebarGroup,
	SidebarProject,
	SidebarSession,
} from "./chat/sidebar-model.ts";
export {
	baseName,
	buildSidebar,
	groupSessions,
	samePath,
	sessionTitle,
	shortTime,
} from "./chat/sidebar-model.ts";
export {
	clampSidebarWidth,
	readSidebarWidth,
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	SIDEBAR_WIDTH_BOUNDS,
	type SidebarStorage,
	writeSidebarWidth,
} from "./chat/sidebar-state.ts";
export type { TrustDialogProps } from "./chat/TrustDialog.tsx";
export { TrustDialog } from "./chat/TrustDialog.tsx";
export {
	DEFAULT_UI_SCALE,
	normalizeUiScale,
	stepUiScale,
	UI_SCALE_STEPS,
} from "./chat/ui-scale.ts";
export type { ScrollRestore, StickToBottom } from "./chat/use-stick-to-bottom.ts";
export { useStickToBottom } from "./chat/use-stick-to-bottom.ts";
export { FACET_FILE_DRAG_MIME } from "./common/file-drag.ts";
export type { ScrollAreaProps } from "./common/scroll-area.tsx";
export { ScrollArea, ScrollRow } from "./common/scroll-area.tsx";
export type { SelectOption, SelectProps } from "./common/select.tsx";
export { Select } from "./common/select.tsx";
export { GitGraphLanes, GRAPH_ROW_HEIGHT, LANE_GAP } from "./git/git-graph-lanes.tsx";
export type {
	GitGraphCommit,
	GitGraphLayout,
	GitGraphLink,
	GitGraphRow,
} from "./git/git-graph-layout.ts";
export { layoutGitGraph } from "./git/git-graph-layout.ts";
export type { GitGraphListProps } from "./git/git-graph-list.tsx";
export { GitGraphList } from "./git/git-graph-list.tsx";
export type { GitPatchProps } from "./git/git-patch.tsx";
export { GitPatch } from "./git/git-patch.tsx";
export type { GitRefsProps } from "./git/git-refs.tsx";
export { GitRefs } from "./git/git-refs.tsx";
export type { ChangeMarkProps, ChangeStatusLabelKey } from "./git/git-status-mark.tsx";
export { ChangeMark, changeStatusLabelKey } from "./git/git-status-mark.tsx";
export type { I18nProviderProps, I18nValue } from "./i18n/I18nProvider.tsx";
export { I18nProvider, useI18n } from "./i18n/I18nProvider.tsx";
export { LAYOUT_PX, SHELL_DATA_ATTRS } from "./layout/layout-contract.ts";
export type { CodeBlockShape } from "./markdown/code-block-state.ts";
export { shouldShowCodeBlock } from "./markdown/code-block-state.ts";
export { extractLangToken, PLAIN, resolveCodeLang } from "./markdown/code-lang.ts";
export type { CodeThemeValue } from "./markdown/code-theme.tsx";
export { CodeThemeProvider, useCodeTheme } from "./markdown/code-theme.tsx";
export type { MarkdownProps } from "./markdown/Markdown.tsx";
export { Markdown } from "./markdown/Markdown.tsx";
export type { ChangesDocumentProps } from "./panel/changes-document.tsx";
export { ChangesDocument } from "./panel/changes-document.tsx";
export type { ChangesPaneProps } from "./panel/changes-pane.tsx";
export { ChangesPane } from "./panel/changes-pane.tsx";
export type { FileTreeStorage } from "./panel/file-tree-state.ts";
export {
	clampFileTreeWidth,
	EDITOR_KEEP_WIDTH,
	FILE_TREE_DEFAULT_WIDTH,
	FILE_TREE_MAX_WIDTH,
	FILE_TREE_MIN_WIDTH,
	FILE_TREE_WIDTH_BOUNDS,
	fileTreeMaxWidth,
	readFileTreeWidth,
	writeFileTreeWidth,
} from "./panel/file-tree-state.ts";
export type { FilesPaneProps } from "./panel/files-pane.tsx";
export { FilesPane } from "./panel/files-pane.tsx";
export type { PaneResizerProps } from "./panel/pane-resizer.tsx";
export { PaneResizer } from "./panel/pane-resizer.tsx";
export type { PaneWidthBounds } from "./panel/pane-width.ts";
export { clampPaneWidth } from "./panel/pane-width.ts";
export type { PanelStorage, RightPanelState, RightPanelTab } from "./panel/panel-state.ts";
export {
	clampPanelWidth,
	closePanelTab,
	DEFAULT_PANEL_STATE,
	normalizePanelState,
	openPanelTab,
	PANEL_DEFAULT_WIDTH,
	PANEL_MIN_WIDTH,
	PANEL_TABS,
	PANEL_WIDTH_BOUNDS,
	readPanelState,
	writePanelState,
} from "./panel/panel-state.ts";
export type { RightPanelProps } from "./panel/right-panel.tsx";
export { RightPanel } from "./panel/right-panel.tsx";
export type { ShortcutChord } from "./panel/shortcuts.ts";
export { formatShortcut } from "./panel/shortcuts.ts";
export { PanelToggle, SidebarToggle } from "./panel/top-bar.tsx";
export type { WorkspaceLauncherProps } from "./panel/workspace-launcher.tsx";
export { WorkspaceLauncher } from "./panel/workspace-launcher.tsx";
export type { WorkspaceListStorage } from "./panel/workspace-list-state.ts";
export {
	clampWorkspaceListWidth,
	readWorkspaceListWidth,
	WORKSPACE_DETAIL_KEEP_WIDTH,
	WORKSPACE_LIST_DEFAULT_WIDTH,
	WORKSPACE_LIST_MAX_WIDTH,
	WORKSPACE_LIST_MIN_WIDTH,
	WORKSPACE_LIST_WIDTH_BOUNDS,
	workspaceListMaxWidth,
	writeWorkspaceListWidth,
} from "./panel/workspace-list-state.ts";
export type { WorkspaceSplitProps, WorkspaceSplitView } from "./panel/workspace-split.tsx";
export { WORKSPACE_SPLIT_WIDE_WIDTH_PX, WorkspaceSplit } from "./panel/workspace-split.tsx";
export type {
	WorkspaceTabBarProps,
	WorkspaceTabId,
	WorkspaceTabItem,
} from "./panel/workspace-tab-bar.tsx";
export { WorkspaceTabBar } from "./panel/workspace-tab-bar.tsx";
export type { WorkspaceTabMenuProps } from "./panel/workspace-tab-menu.tsx";
export { WorkspaceTabMenu } from "./panel/workspace-tab-menu.tsx";
export type { TextMenuProps } from "./text-menu.tsx";
export { TextMenu } from "./text-menu.tsx";
export type { CodeThemeOption, UiThemeOption } from "./theme.ts";
export {
	CODE_THEME_OPTIONS,
	codeThemeName,
	DEFAULT_DARK_THEME,
	isDarkTheme,
	resolveUiTheme,
	THEME_MODES,
	UI_THEME_OPTIONS,
	uiThemeLabel,
} from "./theme.ts";
export { useHoverTip } from "./tip.tsx";
export type { Toast, ToastInput, ToastLevel } from "./toast.ts";
export {
	dismissToast,
	expireToasts,
	pushToast,
	shiftToastExpiry,
	TOAST_LIMIT,
	toastDuration,
} from "./toast.ts";
export type { ToastHostProps } from "./toast-host.tsx";
export { ToastHost } from "./toast-host.tsx";
export type { DisplayRow, ForkPoint, RowKind } from "./transcript/group.ts";
export { formatDuration, groupLabel, groupRows, turnDurationText } from "./transcript/group.ts";
export { ArrowDownIcon } from "./transcript/icons.tsx";
export type { ChatTranscriptProps } from "./transcript/rows.tsx";
export { ChatTranscript } from "./transcript/rows.tsx";
export { foldOutput, toolStatusText, toolTarget } from "./transcript/tool-text.ts";
