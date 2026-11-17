/**
 * 对话面板的分行。
 *
 * 数据侧的投影一项对应一条消息,工具结果已经并进工具调用段。一次提问里模型会分多次调用,
 * 中间那些消息没有正文,只有思考与工具调用;把它们合成一行,面板的高度才与对话轮数相当。
 * 归类只看有没有正文:有正文的行是模型的答复,没有正文的行属于过程。
 */
import type { Part, ToolCallPart, TranscriptItem } from "@facet/client-core";
import { createI18n, type Translate, translate } from "@facet/i18n";
import { toolKind } from "./tool-text.ts";

/** 面板里一行的种类。 */
export type RowKind = "user" | "assistant" | "meta" | "error" | "divider" | "fork";

/** 一轮结束处的分叉点。 */
export interface ForkPoint {
	/** 下一轮第一条用户消息的 entry.id；缺省表示最后一轮，分叉取会话叶子 */
	beforeEntryId: string | undefined;
	/** 最后一轮的分叉要等本轮结束才能用 */
	needsSettle: boolean;
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

/** 没有 Provider 时的中文译文，测试与纯函数调用使用。 */
const fallbackI18n = createI18n("zh-CN");
const fallbackT = translate(fallbackI18n);

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
	/** 这一行是否仍在增长 */
	isStreaming: boolean;
}

/** 组装中的过程行。 */
interface GroupDraft {
	items: TranscriptItem[];
	counts: ToolCounts;
	isStreaming: boolean;
}

function createGroup(): GroupDraft {
	return { items: [], counts: emptyCounts(), isStreaming: false };
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
		isStreaming: draft.isStreaming,
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
		isStreaming: item.isStreaming,
	};
}

/**
 * 复用上一帧的行对象。
 *
 * 分组每帧都会重建，内容没变的行沿用上一帧的对象，行组件才能按对象身份跳过重渲染；
 * 流式期间只有最后那几行会真的变化。
 */
export function reuseRows(previous: readonly DisplayRow[], next: DisplayRow[]): DisplayRow[] {
	return next.map((row, index) => {
		const before = previous[index];
		return before !== undefined && sameRow(before, row) ? before : row;
	});
}

/** 两行是否完全一样：种类、标志、计数与组成它的项目都要对齐。 */
function sameRow(left: DisplayRow, right: DisplayRow): boolean {
	if (left === right) {
		return true;
	}
	if (left.kind !== right.kind || left.id !== right.id || left.isStreaming !== right.isStreaming) {
		return false;
	}
	if (left.durationMs !== right.durationMs || left.startedAt !== right.startedAt) {
		return false;
	}
	if (!sameFork(left.fork, right.fork) || !sameCounts(left.counts, right.counts)) {
		return false;
	}
	return sameItems(left.items, right.items);
}

function sameFork(left: ForkPoint | undefined, right: ForkPoint | undefined): boolean {
	if (left === undefined || right === undefined) {
		return left === right;
	}
	return left.beforeEntryId === right.beforeEntryId && left.needsSettle === right.needsSettle;
}

function sameCounts(left: ToolCounts, right: ToolCounts): boolean {
	return (
		left.commands === right.commands &&
		left.reads === right.reads &&
		left.edits === right.edits &&
		left.searches === right.searches &&
		left.others === right.others &&
		left.thoughts === right.thoughts
	);
}

/** 行内项目逐项比对象身份：投影没变时它就是同一个对象。 */
function sameItems(left: readonly TranscriptItem[], right: readonly TranscriptItem[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

/**
 * 把渲染单元聚合成面板行。
 *
 * 顺序保持与消息一致:用户消息与带正文的答复各自成行,夹在中间的无正文项并入同一过程行。
 * 文件改动统一排在这一轮答复的正文之后;没有正文的回合里,改动行跟在过程行后面收尾。
 * 系统提示与压缩、分支摘要都是一行说明。
 */
export function groupRows(
	items: readonly TranscriptItem[],
	options: { running?: boolean } = {},
): DisplayRow[] {
	const rows: DisplayRow[] = [];
	let group: GroupDraft | undefined;
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
		}
		group = undefined;
	};

	for (const item of items) {
		if (item.kind === "compaction" || item.kind === "branch" || item.role === "system") {
			flush();
			endTurn();
			// 压缩与分支摘要是一道分界,不在它们前面放分叉点
			turnRows = 0;
			rows.push(singleton(item, "divider"));
			continue;
		}
		if (item.kind === "error") {
			flush();
			track(item);
			endTurn();
			rows.push(singleton(item, "error"));
			turnRows += 1;
			continue;
		}
		if (item.role === "user") {
			flush();
			endTurn();
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
			rows.push(singleton(moved ? withoutThinking(item) : item, "assistant"));
			turnRows += 1;
			continue;
		}
		track(item);
		group ??= createGroup();
		absorb(group, item);
	}
	// 会话仍在推进时最后一轮不算结束：中间可能没有流式项（两次模型调用之间、工具执行期间），
	// 只看 isStreaming 会把时长提前定死，计时随之停住，下一段输出再跳一大截。
	// 过程行的标题同样按这个信号保持呼吸，否则中间那段会静下来。
	if (options.running === true) {
		turnStreaming = true;
		if (group !== undefined) {
			group.isStreaming = true;
		}
	}
	flush();
	endTurn();
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
export function groupLabel(row: DisplayRow, t: Translate = fallbackT): string {
	const { counts } = row;
	const parts: string[] = [];
	if (counts.edits > 0) {
		parts.push(t("transcript.group.edits", { count: counts.edits }));
	}
	if (counts.commands > 0) {
		parts.push(t("transcript.group.commands", { count: counts.commands }));
	}
	if (counts.reads > 0) {
		parts.push(t("transcript.group.reads", { count: counts.reads }));
	}
	if (counts.searches > 0) {
		parts.push(t("transcript.group.searches", { count: counts.searches }));
	}
	if (counts.others > 0) {
		parts.push(t("transcript.group.others", { count: counts.others }));
	}
	if (parts.length === 0) {
		return counts.thoughts > 0 ? t("transcript.group.thought") : "";
	}
	if (parts.length === 1) {
		return parts[0] as string;
	}
	const last = parts.at(-1) as string;
	return `${parts.slice(0, -1).join(t("transcript.listSeparator"))}${t("transcript.listConjunction")}${last}`;
}

/**
 * 这一轮的工作时长，例如「工作了 3m 16s」。
 *
 * 回合结束后用主机记录的起止时间；还在跑的时候由界面自己计时，调用方每秒传一次当前时间。
 */
export function turnDurationText(row: DisplayRow, now?: number, t: Translate = fallbackT): string {
	const text =
		row.durationMs !== undefined
			? formatDuration(row.durationMs)
			: row.startedAt === undefined || now === undefined
				? ""
				: formatDuration(Math.max(0, now - row.startedAt));
	return text.length === 0 ? "" : t("transcript.duration", { duration: text });
}

/** 是否有还在计时的回合；有结束时间或没有开始时间的行不参与。 */
export function isTurnTimingLive(rows: readonly DisplayRow[]): boolean {
	return rows.some((row) => row.durationMs === undefined && row.startedAt !== undefined);
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
