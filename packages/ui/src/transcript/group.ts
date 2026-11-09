/**
 * 对话面板的分行。
 *
 * 数据侧的投影一项对应一条消息,工具结果已经并进工具调用段。一次提问里模型会分多次调用,
 * 中间那些消息没有正文,只有思考与工具调用;把它们合成一行,面板的高度才与对话轮数相当。
 * 归类只看有没有正文:有正文的行是模型的答复,没有正文的行属于过程。
 */
import type { Part, ToolCallPart, TranscriptItem } from "@facet/client-core";

/** 面板里一行的种类。 */
export type RowKind = "user" | "assistant" | "meta" | "diff" | "error" | "divider";

/** 一次文件改动,来自带补丁的工具结果。 */
export interface DiffChunk {
	/** 产生这次改动的工具调用 id */
	callId: string;
	/** 工具名,例如 edit */
	toolName: string;
	/** 补丁涉及的文件,按补丁里出现的顺序去重 */
	files: readonly string[];
	/** unified diff 原文 */
	patch: string;
	/** 新增行数 */
	added: number;
	/** 删除行数 */
	removed: number;
}

/** 面板里的一行,由一项或多项渲染单元合成。 */
export interface DisplayRow {
	kind: RowKind;
	/** 行标识,取组内首项的标识,流式追加时不变 */
	id: string;
	/** 组成这一行的渲染单元,只有一个时也保留数组 */
	items: readonly TranscriptItem[];
	/** 分叉目标的消息标识,只有用户行有 */
	forkTarget: string | undefined;
	/** 组内工具调用次数,过程行的摘要素材 */
	toolCount: number;
	/** 组内思考段数 */
	thinkingCount: number;
	/** 组内工具耗时合计,没有计时信息时为空 */
	durationMs: number | undefined;
	/** 组内工具产生的文件改动,排在过程行之后 */
	diffs: readonly DiffChunk[];
	/** 这一行是否仍在增长 */
	isStreaming: boolean;
}

/** 组装中的过程行。 */
interface GroupDraft {
	items: TranscriptItem[];
	toolCount: number;
	thinkingCount: number;
	durationMs: number;
	hasDuration: boolean;
	diffs: DiffChunk[];
	isStreaming: boolean;
}

function createGroup(): GroupDraft {
	return {
		items: [],
		toolCount: 0,
		thinkingCount: 0,
		durationMs: 0,
		hasDuration: false,
		diffs: [],
		isStreaming: false,
	};
}

/** 是否含正文。正文是过程行的边界。 */
function hasText(parts: readonly Part[]): boolean {
	return parts.some((part) => part.kind === "text" && part.text.trim().length > 0);
}

function thinkCount(parts: readonly Part[]): number {
	return parts.filter((part) => part.kind === "thinking").length;
}

function toolParts(parts: readonly Part[]): ToolCallPart[] {
	return parts.filter((part): part is ToolCallPart => part.kind === "toolCall");
}

/** 从 unified diff 里取文件名。兼容 a/ b/ 前缀与新增文件。 */
function filesOfPatch(patch: string): string[] {
	const files: string[] = [];
	for (const line of patch.split("\n")) {
		if (!line.startsWith("+++ ")) {
			continue;
		}
		const raw = line.slice(4).trim();
		if (raw === "/dev/null") {
			continue;
		}
		const path = raw.startsWith("b/") ? raw.slice(2) : raw;
		if (!files.includes(path)) {
			files.push(path);
		}
	}
	return files;
}

/** 统计补丁的增删行数,文件头不计入。 */
function countLines(patch: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of patch.split("\n")) {
		if (line.startsWith("+++ ") || line.startsWith("--- ")) {
			continue;
		}
		if (line.startsWith("+")) {
			added += 1;
		} else if (line.startsWith("-")) {
			removed += 1;
		}
	}
	return { added, removed };
}

/** 工具段里带的补丁转成一次文件改动。没有补丁时返回空。 */
function diffOf(part: ToolCallPart): DiffChunk | undefined {
	const details = part.details as { patch?: unknown } | undefined;
	const patch = details?.patch;
	if (typeof patch !== "string" || patch.length === 0) {
		return undefined;
	}
	const { added, removed } = countLines(patch);
	return { callId: part.callId, toolName: part.name, files: filesOfPatch(patch), patch, added, removed };
}

/** 把一项的内容累计进过程行。 */
function absorb(draft: GroupDraft, item: TranscriptItem): void {
	draft.items.push(item);
	draft.thinkingCount += thinkCount(item.parts);
	draft.isStreaming = draft.isStreaming || item.isStreaming;
	for (const part of toolParts(item.parts)) {
		draft.toolCount += 1;
		draft.isStreaming = draft.isStreaming || part.status === "running";
		if (part.durationMs !== undefined) {
			draft.durationMs += part.durationMs;
			draft.hasDuration = true;
		}
		const diff = diffOf(part);
		if (diff) {
			draft.diffs.push(diff);
		}
	}
}

/** 过程行定稿。没有思考也没有工具调用时不成行。 */
function metaRow(draft: GroupDraft): DisplayRow | undefined {
	const first = draft.items[0];
	if (!first || (draft.toolCount === 0 && draft.thinkingCount === 0)) {
		return undefined;
	}
	return {
		kind: "meta",
		id: first.id,
		items: draft.items,
		forkTarget: undefined,
		toolCount: draft.toolCount,
		thinkingCount: draft.thinkingCount,
		durationMs: draft.hasDuration ? draft.durationMs : undefined,
		diffs: draft.diffs,
		isStreaming: draft.isStreaming,
	};
}

/** 一次文件改动单独成行。 */
function diffRow(diff: DiffChunk): DisplayRow {
	return {
		kind: "diff",
		id: `diff:${diff.callId}`,
		items: [],
		forkTarget: undefined,
		toolCount: 0,
		thinkingCount: 0,
		durationMs: undefined,
		diffs: [diff],
		isStreaming: false,
	};
}

/** 单项成一行。答复行保留它自己带的文件改动,其余行不带。 */
function singleton(item: TranscriptItem, kind: RowKind): DisplayRow {
	const draft = createGroup();
	absorb(draft, item);
	return {
		kind,
		id: item.id,
		items: [item],
		forkTarget: kind === "user" ? item.id : undefined,
		toolCount: draft.toolCount,
		thinkingCount: draft.thinkingCount,
		durationMs: draft.hasDuration ? draft.durationMs : undefined,
		diffs: kind === "assistant" ? draft.diffs : [],
		isStreaming: item.isStreaming,
	};
}

/**
 * 把渲染单元聚合成面板行。
 *
 * 顺序保持与消息一致:用户消息与带正文的答复各自成行,夹在中间的无正文项并入同一过程行。
 * 文件改动统一排在这一轮答复的正文之后;没有正文的回合里,改动行跟在过程行后面收尾。
 * 系统提示与压缩、分支摘要都是一行说明。
 */
export function groupRows(items: readonly TranscriptItem[]): DisplayRow[] {
	const rows: DisplayRow[] = [];
	let group: GroupDraft | undefined;
	let pending: DiffChunk[] = [];

	/** 过程行定稿,它的改动行留到正文之后。 */
	const flush = (): void => {
		if (!group) {
			return;
		}
		const row = metaRow(group);
		if (row) {
			rows.push(row);
			pending.push(...row.diffs);
		}
		group = undefined;
	};

	const flushDiffs = (): void => {
		rows.push(...pending.map(diffRow));
		pending = [];
	};

	for (const item of items) {
		if (item.kind === "compaction" || item.kind === "branch" || item.role === "system") {
			flush();
			flushDiffs();
			rows.push(singleton(item, "divider"));
			continue;
		}
		if (item.kind === "error") {
			flush();
			flushDiffs();
			rows.push(singleton(item, "error"));
			continue;
		}
		if (item.role === "user") {
			flush();
			flushDiffs();
			rows.push(singleton(item, "user"));
			continue;
		}
		if (item.role === "assistant" && hasText(item.parts)) {
			flush();
			const row = singleton(item, "assistant");
			const own = row.diffs;
			rows.push({ ...row, diffs: [] }, ...pending.map(diffRow), ...own.map(diffRow));
			pending = [];
			continue;
		}
		group ??= createGroup();
		absorb(group, item);
	}
	flush();
	flushDiffs();
	return rows;
}

/** 过程行的摘要文字。 */
export function metaSummary(row: DisplayRow): string {
	const parts: string[] = [];
	if (row.thinkingCount > 0) {
		parts.push(`思考 ${row.thinkingCount} 段`);
	}
	if (row.toolCount > 0) {
		parts.push(`工具 ${row.toolCount} 次`);
	}
	if (row.durationMs !== undefined) {
		parts.push(formatDuration(row.durationMs));
	}
	return parts.length > 0 ? parts.join(" · ") : "过程";
}

/** 毫秒转成便于阅读的时长。 */
export function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${Math.round(ms)} 毫秒`;
	}
	if (ms < 60_000) {
		return `${(ms / 1000).toFixed(1)} 秒`;
	}
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	return `${minutes} 分 ${seconds} 秒`;
}
