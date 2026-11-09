/**
 * 界面组件的对外出口。
 *
 * 组件只消费数据侧的投影结果，不接触连接与状态归约，Web 端与桌面端共用同一套。
 */
export type { ComposerProps } from "./chat/Composer.tsx";
export { Composer } from "./chat/Composer.tsx";
export type { SessionSidebarProps } from "./chat/SessionSidebar.tsx";
export { filterSessions, SessionSidebar } from "./chat/SessionSidebar.tsx";
export type { DiffChunk, DisplayRow, RowKind } from "./transcript/group.ts";
export { formatDuration, groupRows, metaSummary } from "./transcript/group.ts";
export type { MarkdownProps } from "./transcript/Markdown.tsx";
export { Markdown } from "./transcript/Markdown.tsx";
export type { ChatTranscriptProps } from "./transcript/rows.tsx";
export { ChatTranscript } from "./transcript/rows.tsx";
export { foldOutput, toolStatusText, toolTarget } from "./transcript/tool-text.ts";
