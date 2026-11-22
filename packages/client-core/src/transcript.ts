/**
 * 渲染用的投影。
 *
 * 历史与实时两条链路产出的原始形状不同:历史是条目里的消息加独立的工具结果消息,
 * 实时是流式累积加上按调用 id 记录的工具状态。这里把两者归一成同一套渲染单元,
 * 判定规则只写一份,避免界面在两条链路上各写一遍。
 */
import type { ContentBlock, InputBlock, Message, StopReason, ToolOutput } from "@facet/protocol";
import type { ChatView, EntryView, StreamedPart, ToolCallView } from "./state.ts";

/** 工具调用在投影里的状态。skipped 表示这一轮被中止,调用没有被执行。 */
export type ToolPartStatus = "running" | "done" | "failed" | "skipped";

/** 正文。 */
export interface TextPart {
	kind: "text";
	/** 单元内的稳定标识,用于定位与渲染 */
	partId: string;
	text: string;
}

/** 思考过程。 */
export interface ThinkingPart {
	kind: "thinking";
	partId: string;
	text: string;
}

/** 一次工具调用,结果已经并入。 */
export interface ToolCallPart {
	kind: "toolCall";
	/** 单元内的稳定标识 */
	partId: string;
	callId: string;
	name: string;
	/** 调用参数,结构由工具决定 */
	input: unknown;
	status: ToolPartStatus;
	/** 输出文本,执行中可能为空 */
	output: string | undefined;
	/** 执行耗时,结束后才有 */
	durationMs: number | undefined;
	/** 工具的结构化结果,例如编辑工具带的补丁,由渲染侧决定怎么用 */
	details: unknown;
	/** 结果里的图片块,按原始顺序排列;文本在 output 里,图片在这里 */
	images: readonly ToolImage[];
}

/** 一张图片:base64 数据与媒体类型,消息与工具结果共用这一形状。 */
export interface MessageImage {
	/** base64 编码的图片数据 */
	data: string;
	/** 媒体类型,例如 image/png */
	mimeType: string;
}

/** 工具结果里的一张图片。 */
export type ToolImage = MessageImage;

/**
 * 消息里的一张图片。
 *
 * 用户随消息发出的截图、模型直接给出的图片都在这里。数据本来就是消息的一部分,渲染侧拼成
 * `data:` URL 即可,不必另开字段或走网络。
 */
export interface ImagePart extends MessageImage {
	kind: "image";
	/** 单元内的稳定标识 */
	partId: string;
}

/** 渲染单元里的一段内容。 */
export type Part = TextPart | ThinkingPart | ImagePart | ToolCallPart;

/** 一项渲染单元。 */
export interface TranscriptItem {
	/** message 为一条对话消息,tool 为游离的工具调用,error 为失败的回合,其余为分界 */
	kind: "message" | "tool" | "error" | "compaction" | "branch";
	/** 视图标识,历史消息带 e: 前缀 */
	id: string;
	/** 会话条目 id,历史消息与已写盘的实时消息才有 */
	entryId: string | undefined;
	/** 消息角色,分界项为空 */
	role: "user" | "assistant" | "system" | "tool" | undefined;
	/** 助手消息的终止原因;其余消息与分界项为空 */
	stopReason: StopReason | undefined;
	parts: readonly Part[];
	/** 是否仍在流式写入 */
	isStreaming: boolean;
	/** 这一条开始的时间,消息取自身时间戳;没有时间信息时为空 */
	startedAt: number | undefined;
	/**
	 * 这一条结束的时间。
	 *
	 * 助手消息的时间戳是调用开始,加上这一次调用的耗时才是结束;工具结果并进来时取两者的较晚者。
	 */
	endedAt: number | undefined;
}

/** 取工具输出的纯文本。 */
export function toolOutputText(output: ToolOutput | undefined): string | undefined {
	if (!output) {
		return undefined;
	}
	const text = output.content
		.map((block) => (block.type === "text" ? block.text : ""))
		.filter((block) => block.length > 0)
		.join("\n");
	return text.length > 0 ? text : undefined;
}

/** 取工具结果里的图片块,文本块不在这里。 */
function toolOutputImages(output: ToolOutput | undefined): ToolImage[] {
	if (!output) {
		return [];
	}
	return output.content
		.filter((block): block is Extract<InputBlock, { type: "image" }> => block.type === "image")
		.map((block) => ({ data: block.data, mimeType: block.mimeType }));
}

/** 内容块转成渲染段。 */
function blockPart(block: ContentBlock | InputBlock, index: number): Part | undefined {
	if (block.type === "text") {
		return { kind: "text", partId: `text:${index}`, text: block.text };
	}
	if (block.type === "thinking") {
		return { kind: "thinking", partId: `thinking:${index}`, text: block.thinking };
	}
	if (block.type === "image") {
		return { kind: "image", partId: `image:${index}`, data: block.data, mimeType: block.mimeType };
	}
	return undefined;
}

/** 工具状态转成渲染段。流式期拿到的是累积的参数文本,不参与展示。 */
function toolPart(call: ToolCallView): ToolCallPart {
	return {
		kind: "toolCall",
		partId: `tool:${call.callId}`,
		callId: call.callId,
		name: call.toolName,
		input: call.input,
		status: call.isRunning ? "running" : call.isError ? "failed" : "done",
		output: toolOutputText(call.output),
		durationMs: call.durationMs,
		details: call.output?.details,
		images: toolOutputImages(call.output),
	};
}

/** 流式片段转成渲染段,按内容块下标排序。 */
function streamParts(streaming: Readonly<Record<number, StreamedPart>>): Part[] {
	return (
		Object.keys(streaming)
			.map(Number)
			.sort((left, right) => left - right)
			.map((index) => streaming[index])
			.filter((part): part is StreamedPart => part !== undefined)
			// 工具调用的增量是参数 JSON 片段，工具行在调用开始时才出现；这类增量不能当正文渲染，
			// 否则输入框里没写完的 `{"command": …` 会漏到 Markdown 里
			.filter((part) => part.kind !== "toolCall")
			.map((part, index) => {
				const kind = part.kind === "thinking" ? "thinking" : "text";
				return { kind, partId: `${kind}:${index}`, text: part.text } as Part;
			})
	);
}

/** 用户消息的正文段:文本按原样,图片单独成段,顺序跟内容块一致。 */
function userParts(entryView: EntryView): Part[] {
	const message = entryView.message;
	if (message === undefined || message.role !== "user") {
		return [];
	}
	return message.content
		.map((block, index) => blockPart(block, index))
		.filter((part): part is Part => part !== undefined);
}

/** 没有对应工具视图的一段调用。 */
function bareToolPart(
	block: Extract<ContentBlock, { type: "toolCall" }>,
	status: ToolPartStatus,
): ToolCallPart {
	return {
		kind: "toolCall",
		partId: `tool:${block.id}`,
		callId: block.id,
		name: block.name,
		input: block.arguments,
		status,
		output: undefined,
		durationMs: undefined,
		details: undefined,
		images: [],
	};
}

/** 正文与工具调用的排布:内容块按原顺序展开,工具调用位置即它在消息里的位置。 */
function assistantParts(entryView: EntryView, calls: Readonly<Record<string, ToolCallView>>): Part[] {
	const message = entryView.message;
	if (message === undefined || message.role !== "assistant") {
		return [];
	}
	const parts: Part[] = [];
	const blocks = message.content;
	for (const block of blocks) {
		if (block.type === "toolCall") {
			const call = calls[block.id];
			if (call) {
				parts.push(toolPart(call));
			} else if (message.stopReason === "aborted") {
				// 这一轮被中止:内容里的调用一条都没执行过,主机不会为它们发事件
				parts.push(bareToolPart(block, "skipped"));
			} else {
				// 主机还没发工具事件时的过渡状态,按已完成呈现
				parts.push(bareToolPart(block, "done"));
			}
			continue;
		}
		const part = blockPart(block, parts.length);
		if (part) {
			parts.push(part);
		}
	}
	// 流式期间内容块还没到,用累积的增量补上
	if (entryView.isStreaming && parts.length === 0) {
		parts.push(...streamParts(entryView.streaming));
	}
	return parts;
}

/** 把工具结果并回对应的工具调用段。找不到对应调用时原样返回。 */
function mergeToolResult(item: TranscriptItem, message: Message): TranscriptItem | undefined {
	if (message.role !== "toolResult") {
		return undefined;
	}
	const index = item.parts.findIndex((part) => part.kind === "toolCall" && part.callId === message.callId);
	const part = index < 0 ? undefined : item.parts[index];
	if (part?.kind !== "toolCall") {
		return undefined;
	}
	const next: ToolCallPart = {
		...part,
		status: message.isError ? "failed" : "done",
		output: toolOutputText({ content: message.content, details: message.details, isError: message.isError }),
		details: message.details,
		images: toolOutputImages({ content: message.content, details: message.details }),

		// 历史记录里带工具耗时,补进来才能在卡片上显示
		durationMs: message.durationMs ?? part.durationMs,
	};
	const parts = [...item.parts];
	parts[index] = next;
	const resultEnd = message.timestamp > 0 ? message.timestamp : undefined;
	const endedAt = resultEnd === undefined ? item.endedAt : Math.max(item.endedAt ?? resultEnd, resultEnd);
	return { ...item, parts, endedAt };
}

/**
 * 投影缓存。
 *
 * 条目视图对象只在它自己变化时换新，因此可以拿它当缓存键：没变的条目沿用上一次的
 * 渲染单元，行组件就能跳过重渲染。缓存跟着一条对话通道的视图走，会话切换或历史重装
 * 之后条目对象全部换新，旧条目自然失效。
 */
export interface TranscriptCache {
	/** 条目视图 → 渲染单元（工具结果尚未合并） */
	readonly entries: WeakMap<EntryView, CachedItem>;
	/** 工具结果条目 → 并入目标与合并后的单元，目标没变就复用 */
	readonly merges: WeakMap<EntryView, { readonly target: TranscriptItem; readonly item: TranscriptItem }>;
}

/** 缓存的渲染单元，以及重建它依赖的工具视图。 */
interface CachedItem {
	/** 渲染单元；这条条目不占行时为空 */
	readonly item: TranscriptItem | undefined;
	/** 构建时读到的工具视图，其中任一换了对象就要重建 */
	readonly sources: readonly (ToolCallView | undefined)[];
}

/** 建一份投影缓存。 */
export function createTranscriptCache(): TranscriptCache {
	return { entries: new WeakMap(), merges: new WeakMap() };
}

/**
 * 把对话视图投影成渲染单元。
 *
 * 历史消息与实时消息的标识不同,条目 id 从标识里还原;工具调用按调用 id 与结果配对,
 * 配不上的单独成项,不静默丢弃。传入 cache 时未变的条目沿用上一次的单元。
 */
export function toTranscript(view: ChatView, cache?: TranscriptCache): TranscriptItem[] {
	const store = cache ?? createTranscriptCache();
	const items: TranscriptItem[] = [];
	const merged = new Map<string, number>();
	for (const entryView of view.items) {
		const message = entryView.message;
		if (message?.role === "toolResult") {
			const targetIndex = merged.get(message.callId);
			const target = targetIndex === undefined ? undefined : items[targetIndex];
			const patched = target === undefined ? undefined : mergedItem(entryView, target, store);
			if (patched !== undefined && targetIndex !== undefined) {
				items[targetIndex] = patched;
				continue;
			}
			items.push({
				kind: "message",
				id: entryView.id,
				entryId: entryView.entry?.id,
				role: "tool",
				stopReason: undefined,
				parts: [orphanToolPart(message)],
				isStreaming: entryView.isStreaming,
				startedAt: timestampOf(message),
				endedAt: timestampOf(message),
			});
			continue;
		}
		const item = entryItem(entryView, view, store);
		if (item === undefined) {
			continue;
		}
		const index = items.length;
		items.push(item);
		for (const part of item.parts) {
			if (part.kind === "toolCall") {
				merged.set(part.callId, index);
			}
		}
	}

	// 消息里还没出现的工具调用,单独成项排在末尾
	const referenced = new Set(merged.keys());
	for (const call of Object.values(view.toolCalls)) {
		if (referenced.has(call.callId)) {
			continue;
		}
		items.push({
			kind: "tool",
			id: `tool:${call.callId}`,
			entryId: undefined,
			role: "tool",
			stopReason: undefined,
			parts: [toolPart(call)],
			isStreaming: call.isRunning,
			startedAt: undefined,
			endedAt: undefined,
		});
	}
	return items;
}

/** 消息上的 Unix 毫秒时间戳,没有则为空。 */
function timestampOf(message: Message): number | undefined {
	return message.timestamp > 0 ? message.timestamp : undefined;
}

/** 条目里引用到的工具视图。工具输出变化时，引用到的视图换新，单元随之重建。 */
function callSources(
	entryView: EntryView,
	calls: Readonly<Record<string, ToolCallView>>,
): (ToolCallView | undefined)[] {
	const message = entryView.message;
	if (message === undefined || message.role !== "assistant") {
		return [];
	}
	const sources: (ToolCallView | undefined)[] = [];
	for (const block of message.content) {
		if (block.type === "toolCall") {
			sources.push(calls[block.id]);
		}
	}
	return sources;
}

/** 两次引用是否指向同一批工具视图。 */
function sameSources(
	left: readonly (ToolCallView | undefined)[],
	right: readonly (ToolCallView | undefined)[],
): boolean {
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

/** 把工具结果并入目标单元，同一个结果条目重复处理时复用上一次的结果。 */
function mergedItem(
	entryView: EntryView,
	target: TranscriptItem,
	cache: TranscriptCache,
): TranscriptItem | undefined {
	const message = entryView.message;
	if (message === undefined) {
		return undefined;
	}
	const cached = cache.merges.get(entryView);
	if (cached !== undefined && cached.target === target) {
		return cached.item;
	}
	const item = mergeToolResult(target, message);
	if (item !== undefined) {
		cache.merges.set(entryView, { target, item });
	}
	return item;
}

/** 取一条条目的渲染单元，条目与它引用的工具视图都没变时沿用缓存。 */
function entryItem(entryView: EntryView, view: ChatView, cache: TranscriptCache): TranscriptItem | undefined {
	const sources = callSources(entryView, view.toolCalls);
	const cached = cache.entries.get(entryView);
	if (cached !== undefined && sameSources(cached.sources, sources)) {
		return cached.item;
	}
	const item = buildEntryItem(entryView, view);
	cache.entries.set(entryView, { item, sources });
	return item;
}

/** 按条目类型造出渲染单元。不占行的条目返回 undefined。 */
function buildEntryItem(entryView: EntryView, view: ChatView): TranscriptItem | undefined {
	const entry = entryView.entry;
	if (entry?.kind === "compaction" || entry?.kind === "branch_summary") {
		const timestamp = Date.parse(entry.timestamp);
		const time = Number.isFinite(timestamp) ? timestamp : undefined;
		return {
			kind: entry.kind === "compaction" ? "compaction" : "branch",
			id: entryView.id,
			entryId: entry.id,
			role: undefined,
			stopReason: undefined,
			parts: [{ kind: "text", partId: "text:0", text: entry.summary ?? "" }],
			isStreaming: false,
			startedAt: time,
			endedAt: time,
		};
	}
	const message = entryView.message;
	if (message === undefined) {
		return undefined;
	}
	const startedAt = timestampOf(message);
	const callDuration = message.role === "assistant" ? (message.durationMs ?? 0) : 0;
	const base: TranscriptItem = {
		kind: "message",
		id: entryView.id,
		entryId: entryView.entry?.id,
		role: message.role === "toolResult" ? "tool" : roleOf(message),
		stopReason: message.role === "assistant" ? message.stopReason : undefined,
		parts: [],
		isStreaming: entryView.isStreaming,
		startedAt,
		endedAt: startedAt === undefined ? undefined : startedAt + callDuration,
	};

	if (message.role === "compactionSummary") {
		return {
			...base,
			kind: "compaction",
			role: undefined,
			parts: [{ kind: "text", partId: "text:0", text: message.summary }],
		};
	}
	if (message.role === "branchSummary") {
		return {
			...base,
			kind: "branch",
			role: undefined,
			parts: [{ kind: "text", partId: "text:0", text: message.summary }],
		};
	}
	if (message.role === "bashExecution") {
		return { ...base, role: "tool", parts: [{ kind: "text", partId: "text:0", text: commandText(message) }] };
	}
	if (message.role === "custom") {
		if (!message.display) {
			return undefined;
		}
		return { ...base, role: "system", parts: [{ kind: "text", partId: "text:0", text: message.content }] };
	}
	if (message.role === "system" || message.role === "unknown") {
		return undefined;
	}
	if (message.role === "assistant" && message.stopReason === "error") {
		return {
			...base,
			kind: "error",
			parts: [{ kind: "text", partId: "text:0", text: message.errorMessage ?? "Run failed" }],
		};
	}
	const parts =
		message.role === "assistant" ? assistantParts(entryView, view.toolCalls) : userParts(entryView);
	// 流刚开始就被打断的中止消息没有内容,不占一行
	if (message.role === "assistant" && parts.length === 0) {
		return undefined;
	}
	return { ...base, parts };
}

/** 消息角色映射到渲染角色,工具结果与命令记录统一算 tool。 */
function roleOf(message: Message): TranscriptItem["role"] {
	if (message.role === "assistant") {
		return "assistant";
	}
	if (message.role === "user") {
		return "user";
	}
	return "system";
}

/** 游离的工具结果。它的调用没有出现在任何消息里,保留下来供排查。 */
function orphanToolPart(message: Message & { role: "toolResult" }): ToolCallPart {
	return {
		kind: "toolCall",
		partId: `tool:${message.callId}`,
		callId: message.callId,
		name: message.toolName,
		input: undefined,
		status: message.isError ? "failed" : "done",
		output: toolOutputText({ content: message.content, details: message.details, isError: message.isError }),
		durationMs: message.durationMs,
		details: message.details,
		images: toolOutputImages({ content: message.content, details: message.details }),
	};
}

/** 命令记录拼成一段文本。 */
function commandText(message: Message & { role: "bashExecution" }): string {
	const header = `$ ${message.command}`;
	const tail = message.cancelled ? " (cancelled)" : message.truncated ? " (output truncated)" : "";
	return `${header}\n${message.output}${tail}`;
}
