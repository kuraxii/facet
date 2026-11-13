/**
 * 对话面板的分行。
 *
 * 数据侧的投影一项对应一条消息,工具结果已经并进工具调用段。一次提问里模型会分多次调用,
 * 中间那些消息没有正文,只有思考与工具调用;把它们合成一行,面板的高度才与对话轮数相当。
 * 归类只看有没有正文:有正文的行是模型的答复,没有正文的行属于过程。
 */
import type { Part, ToolCallPart, TranscriptItem } from "@facet/client-core";
import { toolKind } from "./tool-text.ts";

/** 面板里一行的种类。 */
export type RowKind = "user" | "assistant" | "meta" | "diff" | "error" | "divider" | "fork";

/** 一轮结束处的分叉点。 */
export interface ForkPoint {
	/** 下一轮第一条用户消息的 entry.id；缺省表示最后一轮，分叉取会话叶子 */
	beforeEntryId: string | undefined;
	/** 最后一轮的分叉要等本轮结束才能用 */
	needsSettle: boolean;
}

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

/** 一行里各类动作的次数，过程行的标题按它生成。 */
export interface ToolCounts {
	/** 跑过的命令 */
	commands: number;
	/** 读过的文件 */
	reads: number;
	/** 改过的文件 */
	edits: number;
	/** 搜索次数 */
	searches: number;
	/** 归不进上面几类的工具调用 */
	others: number;
	/** 思考段数 */
	thoughts: number;
}

/** 计数全为零。 */
function emptyCounts(): ToolCounts {
	return { commands: 0, reads: 0, edits: 0, searches: 0, others: 0, thoughts: 0 };
}

/** 归类对应的计数键。 */
const COUNT_KEY = {
	command: "commands",
	read: "reads",
	edit: "edits",
	search: "searches",
	other: "others",
} as const;

/** 面板里的一行,由一项或多项渲染单元合成。 */
export interface DisplayRow {
	kind: RowKind;
	/** 行标识,取组内首项的标识,流式追加时不变 */
	id: string;
	/** 组成这一行的渲染单元,只有一个时也保留数组 */
	items: readonly TranscriptItem[];
	/** 分叉点,只有分叉行有 */
	fork: ForkPoint | undefined;
	/** 组内各类动作的次数,过程行的标题按它生成 */
	counts: ToolCounts;
	/** 这一轮的时长，只在收尾行上，回合结束后按起止时间定稿 */
	durationMs: number | undefined;
	/** 这一轮开始的时间，回合未结束时界面据此自己计时 */
	startedAt: number | undefined;
	/** 组内工具产生的文件改动,排在过程行之后 */
	diffs: readonly DiffChunk[];
	/** 这一行是否仍在增长 */
	isStreaming: boolean;
}

/** 组装中的过程行。 */
interface GroupDraft {
	items: TranscriptItem[];
	counts: ToolCounts;
	diffs: DiffChunk[];
	isStreaming: boolean;
}

function createGroup(): GroupDraft {
	return { items: [], counts: emptyCounts(), diffs: [], isStreaming: false };
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

/** 只取出思考段的那一项,其余段留在原来的行里。 */
function thinkingOnly(item: TranscriptItem): TranscriptItem | undefined {
	const parts = item.parts.filter((part) => part.kind === "thinking");
	if (parts.length === 0) {
		return undefined;
	}
	return { ...item, parts };
}

/** 去掉思考段之后的那一项。 */
function withoutThinking(item: TranscriptItem): TranscriptItem {
	return { ...item, parts: item.parts.filter((part) => part.kind !== "thinking") };
}

/** 把一项的内容累计进过程行。 */
function absorb(draft: GroupDraft, item: TranscriptItem): void {
	draft.items.push(item);
	draft.counts.thoughts += thinkCount(item.parts);
	draft.isStreaming = draft.isStreaming || item.isStreaming;
	for (const part of toolParts(item.parts)) {
		draft.counts[COUNT_KEY[toolKind(part.name).category]] += 1;
		draft.isStreaming = draft.isStreaming || part.status === "running";
		const diff = diffOf(part);
		if (diff) {
			draft.diffs.push(diff);
		}
	}
}

/** 过程行定稿。没有思考也没有工具调用时不成行。 */
function metaRow(draft: GroupDraft): DisplayRow | undefined {
	const first = draft.items[0];
	if (
		!first ||
		draft.counts.commands +
			draft.counts.reads +
			draft.counts.edits +
			draft.counts.searches +
			draft.counts.others +
			draft.counts.thoughts ===
			0
	) {
		return undefined;
	}
	return {
		kind: "meta",
		id: first.id,
		items: draft.items,
		fork: undefined,
		counts: draft.counts,
		// 时长写在收尾行上,不用工具耗时之和
		durationMs: undefined,
		startedAt: undefined,
		diffs: draft.diffs,
		isStreaming: draft.isStreaming,
	};
}

/** 一轮的文件改动合成一行,标识取第一条改动,后续追加不改标识。 */
function diffRow(diffs: readonly DiffChunk[]): DisplayRow | undefined {
	const first = diffs[0];
	if (!first) {
		return undefined;
	}
	return {
		kind: "diff",
		id: `diff:${first.callId}`,
		items: [],
		fork: undefined,
		counts: emptyCounts(),
		durationMs: undefined,
		startedAt: undefined,
		diffs,
		isStreaming: false,
	};
}

/** 一轮收尾行：分叉入口与这一轮的时长。标识按下一轮的起始项固定,流式追加时不变。 */
function forkRow(
	id: string,
	fork: ForkPoint,
	timing: { durationMs: number | undefined; startedAt: number | undefined },
): DisplayRow {
	return {
		kind: "fork",
		id,
		items: [],
		fork,
		counts: emptyCounts(),
		durationMs: timing.durationMs,
		startedAt: timing.startedAt,
		diffs: [],
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
		fork: undefined,
		counts: draft.counts,
		durationMs: undefined,
		startedAt: undefined,
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
	/** 这一轮的开始时间与已见到的结束时间,用来算过程行上的工作时间 */
	let turnStart: number | undefined;
	let turnEnd: number | undefined;
	/** 这一轮的时长,收尾行创建时带上 */
	let turnDuration: number | undefined;
	/** 还在跑的这一轮的开始时间,收尾行据此自己计时 */
	let turnRunningFrom: number | undefined;
	/** 这一轮最后是否仍在增长 */
	let turnStreaming = false;
	/** 本轮已经输出的行数,为 0 时不产生分叉行 */
	let turnRows = 0;

	/** 记录一条的时间范围。 */
	const track = (item: TranscriptItem): void => {
		if (turnStart === undefined && item.startedAt !== undefined) {
			turnStart = item.startedAt;
		}
		if (item.endedAt !== undefined && (turnEnd === undefined || item.endedAt > turnEnd)) {
			turnEnd = item.endedAt;
		}
		turnStreaming = turnStreaming || item.isStreaming;
	};

	/** 定下这一轮的时长,收尾行创建时取它;还在跑的这一轮不写时长,改交给界面计时。 */
	const settleTurn = (): void => {
		// 这一轮已经收过尾了（答复行到了之后再遇到下一轮的开头），不要覆盖已定下的时长
		if (turnStart === undefined && turnEnd === undefined) {
			return;
		}
		if (turnStreaming) {
			turnDuration = undefined;
			turnRunningFrom = turnStart;
			return;
		}
		turnDuration =
			turnStart === undefined || turnEnd === undefined ? undefined : Math.max(0, turnEnd - turnStart);
		turnRunningFrom = undefined;
	};

	/** 一轮结束:补时长并清空计时。 */
	const endTurn = (): void => {
		settleTurn();
		turnStart = undefined;
		turnEnd = undefined;
		turnStreaming = false;
	};

	/** 过程行定稿,它的改动行留到正文之后。 */
	const flush = (): void => {
		if (!group) {
			return;
		}
		const row = metaRow(group);
		if (row) {
			rows.push(row);
			turnRows += 1;
			pending.push(...row.diffs);
		}
		group = undefined;
	};

	const flushDiffs = (): void => {
		const row = diffRow(pending);
		if (row) {
			rows.push(row);
			turnRows += 1;
		}
		pending = [];
	};

	for (const item of items) {
		if (item.kind === "compaction" || item.kind === "branch" || item.role === "system") {
			flush();
			endTurn();
			flushDiffs();
			// 压缩与分支摘要是一道分界,不在它们前面放分叉点
			turnRows = 0;
			rows.push(singleton(item, "divider"));
			continue;
		}
		if (item.kind === "error") {
			flush();
			track(item);
			endTurn();
			flushDiffs();
			rows.push(singleton(item, "error"));
			turnRows += 1;
			continue;
		}
		if (item.role === "user") {
			flush();
			endTurn();
			flushDiffs();
			// 上一轮已经结束,这一轮还没开始:在这里放这一轮的分叉点
			if (turnRows > 0 && item.entryId !== undefined) {
				rows.push(
					forkRow(
						`fork:${item.id}`,
						{ beforeEntryId: item.entryId, needsSettle: false },
						{
							durationMs: turnDuration,
							startedAt: turnRunningFrom,
						},
					),
				);
			}
			turnDuration = undefined;
			turnRows = 0;
			track(item);
			rows.push(singleton(item, "user"));
			turnRows += 1;
			continue;
		}
		if (item.role === "assistant" && hasText(item.parts)) {
			// 这一轮已经有过程内容时,答复消息里的思考也归过程,答复行只留正文;
			// 只有思考加正文的回合没有过程可言,思考仍留在答复行里。
			const moved = group ? thinkingOnly(item) : undefined;
			if (moved && group) {
				absorb(group, moved);
			}
			flush();
			track(item);
			// 答复行到了,这一轮的时间可以定稿
			endTurn();
			const row = singleton(moved ? withoutThinking(item) : item, "assistant");
			rows.push({ ...row, diffs: [] });
			turnRows += 1;
			pending.push(...row.diffs);
			flushDiffs();
			continue;
		}
		track(item);
		group ??= createGroup();
		absorb(group, item);
	}
	flush();
	endTurn();
	flushDiffs();
	// 最后一轮的分叉点取会话叶子,要等这一轮结束才能用;还在跑时界面上自己计时
	if (turnRows > 0) {
		rows.push(
			forkRow(
				"fork:end",
				{ beforeEntryId: undefined, needsSettle: true },
				{
					durationMs: turnDuration,
					startedAt: turnRunningFrom,
				},
			),
		);
	}
	return rows;
}

/**
 * 过程行的标题：这一组做了哪些事，按次数归类。
 *
 * 只有一类时直接说这一类，多类用「和」连起来；只有思考时是「已思考」。
 */
export function groupLabel(row: DisplayRow): string {
	const { counts } = row;
	const parts: string[] = [];
	if (counts.edits > 0) {
		parts.push(`编辑了 ${counts.edits} 个文件`);
	}
	if (counts.commands > 0) {
		parts.push(`运行了 ${counts.commands} 个命令`);
	}
	if (counts.reads > 0) {
		parts.push(`读取了 ${counts.reads} 个文件`);
	}
	if (counts.searches > 0) {
		parts.push(`搜索了 ${counts.searches} 次`);
	}
	if (counts.others > 0) {
		parts.push(`使用了 ${counts.others} 个其他工具`);
	}
	if (parts.length === 0) {
		return counts.thoughts > 0 ? "已思考" : "";
	}
	if (parts.length === 1) {
		return parts[0] as string;
	}
	return `${parts.slice(0, -1).join("，")}和${parts.at(-1)}`;
}

/**
 * 这一轮的工作时长，例如「工作了 3m 16s」。
 *
 * 回合结束后用主机记录的起止时间；还在跑的时候由界面自己计时，调用方每秒传一次当前时间。
 */
export function turnDurationText(row: DisplayRow, now?: number): string {
	const text =
		row.durationMs !== undefined
			? formatDuration(row.durationMs)
			: row.startedAt === undefined || now === undefined
				? ""
				: formatDuration(Math.max(0, now - row.startedAt));
	return text.length === 0 ? "" : `工作了 ${text}`;
}

/** 毫秒转成 paseo 那种短写法：7s、3m 16s、1h 5m。 */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) {
		return "0s";
	}
	const totalSeconds = ms / 1000;
	if (totalSeconds < 60) {
		return `${Math.floor(totalSeconds)}s`;
	}
	const totalMinutes = Math.floor(totalSeconds / 60);
	if (totalMinutes < 60) {
		const seconds = Math.floor(totalSeconds) % 60;
		return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
	}
	const hours = Math.floor(totalMinutes / 60);
	const restMinutes = totalMinutes % 60;
	return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`;
}
