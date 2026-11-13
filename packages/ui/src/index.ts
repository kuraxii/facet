/**
 * 界面组件的对外出口。
 *
 * 组件只消费数据侧的投影结果，不接触连接与状态归约，Web 端与桌面端共用同一套。
 */

export type { ChatOutlineProps } from "./chat/ChatOutline.tsx";
export { ChatOutline } from "./chat/ChatOutline.tsx";
export type { ComposerProps } from "./chat/Composer.tsx";
export { Composer } from "./chat/Composer.tsx";
export type { ContextRingProps, UsageLevel } from "./chat/ContextRing.tsx";
export { ContextRing, formatTokens, usageLabel, usageLevel } from "./chat/ContextRing.tsx";
export type { CreateProjectDialogProps } from "./chat/CreateProjectDialog.tsx";
export { CreateProjectDialog } from "./chat/CreateProjectDialog.tsx";
export type { OutlinePrompt } from "./chat/chat-outline.ts";
export { outlinePrompts } from "./chat/chat-outline.ts";
export {
	commandQuery,
	filterCommands,
	isFacetCommand,
	parseCommand,
	SOURCE_LABELS,
} from "./chat/command-palette.ts";
export type { EmptyStateProps } from "./chat/EmptyState.tsx";
export { EmptyState } from "./chat/EmptyState.tsx";
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
export type { ProviderFormProps } from "./chat/ProviderForm.tsx";
export { ProviderForm } from "./chat/ProviderForm.tsx";
export type { QueueStripProps } from "./chat/QueueStrip.tsx";
export { QueueStrip } from "./chat/QueueStrip.tsx";
export type { SessionSidebarProps, ThemeName } from "./chat/SessionSidebar.tsx";
export { SessionSidebar } from "./chat/SessionSidebar.tsx";
export type {
	SettingsDataSource,
	SettingsPageProps,
	SettingsSection,
} from "./chat/SettingsPage.tsx";
export { SettingsPage } from "./chat/SettingsPage.tsx";
export type {
	GroupKey,
	SessionDot,
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
export type { TrustDialogProps } from "./chat/TrustDialog.tsx";
export { TrustDialog } from "./chat/TrustDialog.tsx";
export type { StickToBottom } from "./chat/use-stick-to-bottom.ts";
export { useStickToBottom } from "./chat/use-stick-to-bottom.ts";
export type { CodeBlockShape } from "./markdown/code-block-state.ts";
export { shouldShowCodeBlock } from "./markdown/code-block-state.ts";
export { extractLangToken, PLAIN, resolveCodeLang } from "./markdown/code-lang.ts";
export type { CodeThemeValue } from "./markdown/code-theme.tsx";
export { CodeThemeProvider, useCodeTheme } from "./markdown/code-theme.tsx";
export type { MarkdownProps } from "./markdown/Markdown.tsx";
export { Markdown } from "./markdown/Markdown.tsx";
export type { ChangesPaneProps } from "./panel/changes-pane.tsx";
export { ChangesPane } from "./panel/changes-pane.tsx";
export type { FilesPaneProps } from "./panel/files-pane.tsx";
export { FilesPane } from "./panel/files-pane.tsx";
export type { PanelStorage, RightPanelState, RightPanelTab } from "./panel/panel-state.ts";
export {
	clampPanelWidth,
	DEFAULT_PANEL_STATE,
	PANEL_DEFAULT_WIDTH,
	PANEL_MAX_WIDTH,
	PANEL_MIN_WIDTH,
	readPanelState,
	writePanelState,
} from "./panel/panel-state.ts";
export type { RightPanelProps } from "./panel/right-panel.tsx";
export { RightPanel } from "./panel/right-panel.tsx";
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
export type { DiffChunk, DisplayRow, ForkPoint, RowKind } from "./transcript/group.ts";
export { formatDuration, groupLabel, groupRows, turnDurationText } from "./transcript/group.ts";
export { ArrowDownIcon } from "./transcript/icons.tsx";
export type { ChatTranscriptProps } from "./transcript/rows.tsx";
export { ChatTranscript } from "./transcript/rows.tsx";
export { foldOutput, toolStatusText, toolTarget } from "./transcript/tool-text.ts";
