import type { AgentMessage as PiMessage } from "@earendil-works/pi-agent-core";
import type {
	ImageContent,
	Model,
	TextContent,
	ThinkingContent,
	ToolCall,
	Usage,
} from "@earendil-works/pi-ai";
import type {
	AgentAssistantMessage,
	AgentContentBlock,
	AgentInputBlock,
	AgentMessage,
	AgentModelInfo,
	AgentUsage,
	InputModality,
} from "./types.ts";

type PiMessageLike =
	| PiMessage
	| {
			role: "bashExecution";
			command: string;
			output: string;
			exitCode: number | undefined;
			cancelled: boolean;
			truncated: boolean;
			fullOutputPath?: string;
			timestamp: number;
	  }
	| {
			role: "custom";
			customType: string;
			content: string | (TextContent | ImageContent)[];
			display: boolean;
			details?: unknown;
			timestamp: number;
	  }
	| { role: "branchSummary"; summary: string; fromId: string | null; timestamp: number }
	| { role: "compactionSummary"; summary: string; tokensBefore: number; timestamp: number };

function textOf(content: string | (TextContent | ImageContent)[]): string {
	if (typeof content === "string") {
		return content;
	}
	return content
		.map((block) => (block.type === "text" ? block.text : ""))
		.filter((text) => text.length > 0)
		.join("\n");
}

function toInputBlocks(content: string | (TextContent | ImageContent)[]): AgentInputBlock[] {
	if (typeof content === "string") {
		return content.length > 0 ? [{ type: "text", text: content }] : [];
	}
	const blocks: AgentInputBlock[] = [];
	for (const block of content) {
		if (block.type === "text") {
			blocks.push({ type: "text", text: block.text });
		} else if (block.type === "image") {
			blocks.push({ type: "image", data: block.data, mimeType: block.mimeType });
		}
	}
	return blocks;
}

function toContentBlocks(
	content: (TextContent | ImageContent | ThinkingContent | ToolCall)[],
): AgentContentBlock[] {
	const blocks: AgentContentBlock[] = [];
	for (const block of content) {
		if (block.type === "text") {
			blocks.push({ type: "text", text: block.text });
		} else if (block.type === "image") {
			blocks.push({ type: "image", data: block.data, mimeType: block.mimeType });
		} else if (block.type === "thinking") {
			blocks.push({ type: "thinking", thinking: block.thinking, redacted: block.redacted === true });
		} else if (block.type === "toolCall") {
			blocks.push({ type: "toolCall", id: block.id, name: block.name, arguments: block.arguments });
		}
	}
	return blocks;
}

export function toAgentUsage(usage: Usage): AgentUsage {
	return {
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		reasoning: usage.reasoning ?? 0,
		totalTokens: usage.totalTokens,
		cost: {
			input: usage.cost.input,
			output: usage.cost.output,
			cacheRead: usage.cost.cacheRead,
			cacheWrite: usage.cost.cacheWrite,
			total: usage.cost.total,
		},
	};
}

export function toAgentModelInfo(model: Model<any>): AgentModelInfo {
	return {
		provider: model.provider,
		id: model.id,
		name: model.name,
		api: model.api,
		reasoning: model.reasoning,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		input: model.input.filter(
			(modality): modality is InputModality => modality === "text" || modality === "image",
		),
		cost: {
			input: model.cost.input,
			output: model.cost.output,
			cacheRead: model.cost.cacheRead,
			cacheWrite: model.cost.cacheWrite,
		},
	};
}

function toAssistantMessage(message: Extract<PiMessage, { role: "assistant" }>): AgentAssistantMessage {
	return {
		role: "assistant",
		content: toContentBlocks(message.content),
		provider: message.provider,
		model: message.responseModel ?? message.model,
		usage: toAgentUsage(message.usage),
		stopReason: message.stopReason,
		errorMessage: message.errorMessage,
		timestamp: message.timestamp,
	};
}

export function toAgentMessage(message: PiMessageLike): AgentMessage {
	switch (message.role) {
		case "system":
			return { role: "system", content: textOf(message.content), timestamp: message.timestamp };
		case "user":
			return { role: "user", content: toInputBlocks(message.content), timestamp: message.timestamp };
		case "assistant":
			return toAssistantMessage(message);
		case "toolResult":
			return {
				role: "toolResult",
				callId: message.toolCallId,
				toolName: message.toolName,
				content: toInputBlocks(message.content),
				details: message.details,
				isError: message.isError,
				timestamp: message.timestamp,
			};
		case "bashExecution":
			return {
				role: "bashExecution",
				command: message.command,
				output: message.output,
				exitCode: message.exitCode,
				cancelled: message.cancelled,
				truncated: message.truncated,
				fullOutputPath: message.fullOutputPath,
				timestamp: message.timestamp,
			};
		case "custom":
			return {
				role: "custom",
				customType: message.customType,
				content: textOf(message.content),
				display: message.display,
				details: message.details,
				timestamp: message.timestamp,
			};
		case "branchSummary":
			return {
				role: "branchSummary",
				summary: message.summary,
				fromId: message.fromId,
				timestamp: message.timestamp,
			};
		case "compactionSummary":
			return {
				role: "compactionSummary",
				summary: message.summary,
				tokensBefore: message.tokensBefore,
				timestamp: message.timestamp,
			};
		default:
			return {
				role: "unknown",
				rawRole: String((message as { role: unknown }).role),
				timestamp: Number((message as { timestamp?: unknown }).timestamp ?? Date.now()),
			};
	}
}

export function toAgentMessages(messages: readonly PiMessageLike[]): AgentMessage[] {
	return messages.map(toAgentMessage);
}

export function toAgentToolOutput(result: { content?: unknown; details?: unknown; isError?: boolean }): {
	content: AgentInputBlock[];
	details?: unknown;
	isError?: boolean;
} {
	const content = Array.isArray(result.content)
		? toInputBlocks(result.content as (TextContent | ImageContent)[])
		: [];
	return { content, details: result.details, isError: result.isError };
}
