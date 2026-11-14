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

/** 工具结果里的一张图片。 */
export interface ToolImage {
	/** base64 编码的图片数据 */
	data: string;
	/** 媒体类型,例如 image/png */
	mimeType: string;
}

/** 渲染单元里的一段内容。 */
export type Part = TextPart | ThinkingPart | ToolCallPart;

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

/** 用户消息的正文段。图片没有可读文本,占一个标记。 */
function userParts(entryView: EntryView): Part[] {
	const message = entryView.message;
	if (message === undefined || message.role !== "user") {
		return [];
	}
	return message.content.map((block, index) =>
		block.type === "text"
			? { kind: "text" as const, partId: `text:${index}`, text: block.text }
			: { kind: "text" as const, partId: `text:${index}`, text: `[图片 ${block.mimeType}]` },
	);
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
 * 把对话视图投影成渲染单元。
 *
 * 历史消息与实时消息的标识不同,条目 id 从标识里还原;工具调用按调用 id 与结果配对,
 * 配不上的单独成项,不静默丢弃。
 */
export function toTranscript(view: ChatView): TranscriptItem[] {
	const items: TranscriptItem[] = [];
	const merged = new Map<string, number>();
	for (const entryView of view.items) {
		const entry = entryView.entry;
		if (entry?.kind === "compaction" || entry?.kind === "branch_summary") {
			const timestamp = Date.parse(entry.timestamp);
			const time = Number.isFinite(timestamp) ? timestamp : undefined;
			items.push({
				kind: entry.kind === "compaction" ? "compaction" : "branch",
				id: entryView.id,
				entryId: entry.id,
				role: undefined,
				stopReason: undefined,
				parts: [{ kind: "text", partId: "text:0", text: entry.summary ?? "" }],
				isStreaming: false,
				startedAt: time,
				endedAt: time,
			});
			continue;
		}
		if (entryView.message === undefined) {
			continue;
		}
		const startedAt = entryView.message.timestamp > 0 ? entryView.message.timestamp : undefined;
		const callDuration = entryView.message.role === "assistant" ? (entryView.message.durationMs ?? 0) : 0;
		const base: TranscriptItem = {
			kind: "message",
			id: entryView.id,
			entryId: entryView.entry?.id,
			role: entryView.message.role === "toolResult" ? "tool" : roleOf(entryView.message),
			stopReason: entryView.message.role === "assistant" ? entryView.message.stopReason : undefined,
			parts: [],
			isStreaming: entryView.isStreaming,
			startedAt,
			endedAt: startedAt === undefined ? undefined : startedAt + callDuration,
		};

		if (entryView.message.role === "toolResult") {
			const targetIndex = merged.get(entryView.message.callId);
			const target = targetIndex === undefined ? undefined : items[targetIndex];
			const patched = target ? mergeToolResult(target, entryView.message) : undefined;
			if (patched && targetIndex !== undefined) {
				items[targetIndex] = patched;
				continue;
			}
			items.push({ ...base, parts: [orphanToolPart(entryView.message)] });
			continue;
		}

		if (entryView.message.role === "compactionSummary") {
			items.push({
				...base,
				kind: "compaction",
				role: undefined,
				parts: [{ kind: "text", partId: "text:0", text: entryView.message.summary }],
			});
			continue;
		}
		if (entryView.message.role === "branchSummary") {
			items.push({
				...base,
				kind: "branch",
				role: undefined,
				parts: [{ kind: "text", partId: "text:0", text: entryView.message.summary }],
			});
			continue;
		}
		if (entryView.message.role === "bashExecution") {
			items.push({
				...base,
				role: "tool",
				parts: [{ kind: "text", partId: "text:0", text: commandText(entryView.message) }],
			});
			continue;
		}
		if (entryView.message.role === "custom") {
			if (entryView.message.display) {
				items.push({
					...base,
					role: "system",
					parts: [{ kind: "text", partId: "text:0", text: entryView.message.content }],
				});
			}
			continue;
		}
		if (entryView.message.role === "system" || entryView.message.role === "unknown") {
			continue;
		}

		if (entryView.message.role === "assistant" && entryView.message.stopReason === "error") {
			items.push({
				...base,
				kind: "error",
				parts: [{ kind: "text", partId: "text:0", text: entryView.message.errorMessage ?? "运行出错" }],
			});
			continue;
		}

		const parts =
			entryView.message.role === "assistant"
				? assistantParts(entryView, view.toolCalls)
				: userParts(entryView);
		// 流刚开始就被打断的中止消息没有内容,不占一行
		if (entryView.message.role === "assistant" && parts.length === 0) {
			continue;
		}
		const index = items.length;
		items.push({ ...base, parts });
		for (const part of parts) {
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
	const tail = message.cancelled ? "（已取消）" : message.truncated ? "（输出已截断）" : "";
	return `${header}\n${message.output}${tail}`;
}
