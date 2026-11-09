/**
 * 界面组件的对外出口。
 *
 * 组件只消费数据侧的投影结果，不接触连接与状态归约，Web 端与桌面端共用同一套。
 */
export type { DiffChunk, DisplayRow, RowKind } from "./transcript/group.ts";
export { formatDuration, groupRows, metaSummary } from "./transcript/group.ts";
export { ChatTranscript, type ChatTranscriptProps, toolSummary } from "./transcript/rows.tsx";
