/**
 * 界面组件的对外出口。
 *
 * 组件只消费数据侧的投影结果，不接触连接与状态归约，Web 端与桌面端共用同一套。
 */
export type { ComposerProps } from "./chat/Composer.tsx";
export { Composer } from "./chat/Composer.tsx";
export type { CreateProjectDialogProps } from "./chat/CreateProjectDialog.tsx";
export { CreateProjectDialog } from "./chat/CreateProjectDialog.tsx";
export type { QueueStripProps } from "./chat/QueueStrip.tsx";
export { QueueStrip } from "./chat/QueueStrip.tsx";
export type { SessionSidebarProps, ThemeName } from "./chat/SessionSidebar.tsx";
export { SessionSidebar } from "./chat/SessionSidebar.tsx";
export type {
	GroupKey,
	HostState,
	SessionDot,
	SidebarData,
	SidebarDevice,
	SidebarGroup,
	SidebarHost,
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
export type { MarkdownProps } from "./markdown/Markdown.tsx";
export { Markdown } from "./markdown/Markdown.tsx";
export type { DiffChunk, DisplayRow, ForkPoint, RowKind } from "./transcript/group.ts";
export { formatDuration, groupRows, metaSummary } from "./transcript/group.ts";
export { ArrowDownIcon, CloseIcon } from "./transcript/icons.tsx";
export type { ChatTranscriptProps } from "./transcript/rows.tsx";
export { ChatTranscript } from "./transcript/rows.tsx";
export { foldOutput, toolStatusText, toolTarget } from "./transcript/tool-text.ts";
