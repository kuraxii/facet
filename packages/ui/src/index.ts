/**
 * 界面组件的对外出口。
 *
 * 组件只消费数据侧的投影结果，不接触连接与状态归约，Web 端与桌面端共用同一套。
 */
export type { ChatOutlineProps } from "./chat/ChatOutline.tsx";
export { ChatOutline } from "./chat/ChatOutline.tsx";
export type { ComposerProps } from "./chat/Composer.tsx";
export { Composer } from "./chat/Composer.tsx";
export type { CreateProjectDialogProps } from "./chat/CreateProjectDialog.tsx";
export { CreateProjectDialog } from "./chat/CreateProjectDialog.tsx";
export type { OutlinePrompt } from "./chat/chat-outline.ts";
export { outlinePrompts } from "./chat/chat-outline.ts";
export type { EmptyStateProps } from "./chat/EmptyState.tsx";
export { EmptyState } from "./chat/EmptyState.tsx";
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
	HostState,
	SessionDot,
	SidebarData,
	SidebarGroup,
	SidebarHost,
	SidebarHostStatus,
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
export { formatDuration, groupRows, metaSummary } from "./transcript/group.ts";
export { ArrowDownIcon } from "./transcript/icons.tsx";
export type { ChatTranscriptProps } from "./transcript/rows.tsx";
export { ChatTranscript } from "./transcript/rows.tsx";
export { foldOutput, toolStatusText, toolTarget } from "./transcript/tool-text.ts";
