/**
 * 渲染用的投影。
 *
 * 历史与实时两条链路产出的原始形状不同:历史是条目里的消息加独立的工具结果消息,
 * 实时是流式累积加上按调用 id 记录的工具状态。这里把两者归一成同一套渲染单元,
 * 判定规则只写一份,避免界面在两条链路上各写一遍。
 */
import type { ContentBlock, InputBlock, Message, ToolOutput } from "@facet/protocol";
import { historyEntryId } from "./message-id.ts";
import type { ChatView, MessageView, StreamedPart, ToolCallView } from "./state.ts";

/** 工具调用在投影里的状态。 */
export type ToolPartStatus = "running" | "done" | "failed";

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
	parts: readonly Part[];
	/** 是否仍在流式写入 */
	isStreaming: boolean;
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
	};
}

/** 流式片段转成渲染段,按内容块下标排序。 */
function streamParts(streaming: Readonly<Record<number, StreamedPart>>): Part[] {
	return Object.keys(streaming)
		.map(Number)
		.sort((left, right) => left - right)
		.map((index) => streaming[index])
		.filter((part): part is StreamedPart => part !== undefined)
		.map((part, index) => {
			const kind = part.kind === "thinking" ? "thinking" : "text";
			return { kind, partId: `${kind}:${index}`, text: part.text } as Part;
		});
}

/** 用户消息的正文段。图片没有可读文本,占一个标记。 */
function userParts(message: MessageView): Part[] {
	if (message.message.role !== "user") {
		return [];
	}
	return message.message.content.map((block, index) =>
		block.type === "text"
			? { kind: "text" as const, partId: `text:${index}`, text: block.text }
			: { kind: "text" as const, partId: `text:${index}`, text: `[图片 ${block.mimeType}]` },
	);
}

/** 正文与工具调用的排布:内容块按原顺序展开,工具调用位置即它在消息里的位置。 */
function assistantParts(message: MessageView, calls: Readonly<Record<string, ToolCallView>>): Part[] {
	if (message.message.role !== "assistant") {
		return [];
	}
	const parts: Part[] = [];
	const blocks = message.message.content;
	for (const block of blocks) {
		if (block.type === "toolCall") {
			const call = calls[block.id];
			parts.push(
				call
					? toolPart(call)
					: {
							kind: "toolCall",
							partId: `tool:${block.id}`,
							callId: block.id,
							name: block.name,
							input: block.arguments,
							status: "done",
							output: undefined,
							durationMs: undefined,
							details: undefined,
						},
			);
			continue;
		}
		const part = blockPart(block, parts.length);
		if (part) {
			parts.push(part);
		}
	}
	// 流式期间内容块还没到,用累积的增量补上
	if (message.isStreaming && parts.length === 0) {
		parts.push(...streamParts(message.streaming));
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
	};
	const parts = [...item.parts];
	parts[index] = next;
	return { ...item, parts };
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
	for (const message of view.messages) {
		const base: TranscriptItem = {
			kind: "message",
			id: message.id,
			entryId: historyEntryId(message.id),
			role: message.message.role === "toolResult" ? "tool" : roleOf(message.message),
			parts: [],
			isStreaming: message.isStreaming,
		};

		if (message.message.role === "toolResult") {
			const targetIndex = merged.get(message.message.callId);
			const target = targetIndex === undefined ? undefined : items[targetIndex];
			const patched = target ? mergeToolResult(target, message.message) : undefined;
			if (patched && targetIndex !== undefined) {
				items[targetIndex] = patched;
				continue;
			}
			items.push({ ...base, parts: [orphanToolPart(message.message)] });
			continue;
		}

		if (message.message.role === "compactionSummary") {
			items.push({
				...base,
				kind: "compaction",
				role: undefined,
				parts: [{ kind: "text", partId: "text:0", text: message.message.summary }],
			});
			continue;
		}
		if (message.message.role === "branchSummary") {
			items.push({
				...base,
				kind: "branch",
				role: undefined,
				parts: [{ kind: "text", partId: "text:0", text: message.message.summary }],
			});
			continue;
		}
		if (message.message.role === "bashExecution") {
			items.push({
				...base,
				role: "tool",
				parts: [{ kind: "text", partId: "text:0", text: commandText(message.message) }],
			});
			continue;
		}
		if (message.message.role === "custom") {
			if (message.message.display) {
				items.push({
					...base,
					role: "system",
					parts: [{ kind: "text", partId: "text:0", text: message.message.content }],
				});
			}
			continue;
		}
		if (message.message.role === "system" || message.message.role === "unknown") {
			continue;
		}

		if (message.message.role === "assistant" && message.message.stopReason === "error") {
			items.push({
				...base,
				kind: "error",
				parts: [{ kind: "text", partId: "text:0", text: message.message.errorMessage ?? "运行出错" }],
			});
			continue;
		}

		const parts =
			message.message.role === "assistant" ? assistantParts(message, view.toolCalls) : userParts(message);
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
			parts: [toolPart(call)],
			isStreaming: call.isRunning,
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
		durationMs: undefined,
		details: message.details,
	};
}

/** 命令记录拼成一段文本。 */
function commandText(message: Message & { role: "bashExecution" }): string {
	const header = `$ ${message.command}`;
	const tail = message.cancelled ? "（已取消）" : message.truncated ? "（输出已截断）" : "";
	return `${header}\n${message.output}${tail}`;
}
