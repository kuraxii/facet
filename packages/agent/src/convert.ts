/**
 * pi 的数据结构到 facet 类型的转换。
 *
 * 这里是唯一知道 pi 类型形状的地方，转换结果只含 JSON 可序列化的值，
 * 不携带提供方的不透明字段（签名、provider 专用元数据）。
 */
import type { AgentMessage as PiMessage } from "@earendil-works/pi-agent-core";
import type {
	ImageContent,
	Model,
	Usage as PiUsage,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "@earendil-works/pi-ai";
import type {
	AssistantMessage,
	ContentBlock,
	InputBlock,
	InputModality,
	Message,
	ModelInfo,
	Usage,
} from "@facet/protocol";

/**
 * pi 的消息联合。
 *
 * 上层 SDK 会通过声明合并补充 coding-agent 的角色，这里显式列出它们，
 * 避免依赖外部模块的类型增强顺序。
 */
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

/** 把混合内容压平成纯文本，图片块与空文本被丢弃。 */
function textOf(content: string | (TextContent | ImageContent)[]): string {
	if (typeof content === "string") {
		return content;
	}
	return content
		.map((block) => (block.type === "text" ? block.text : ""))
		.filter((text) => text.length > 0)
		.join("\n");
}

/** 转成用户可发送的内容块。空字符串不产生空文本块，避免界面上出现空行。 */
function toInputBlocks(content: string | (TextContent | ImageContent)[]): InputBlock[] {
	if (typeof content === "string") {
		return content.length > 0 ? [{ type: "text", text: content }] : [];
	}
	const blocks: InputBlock[] = [];
	for (const block of content) {
		if (block.type === "text") {
			blocks.push({ type: "text", text: block.text });
		} else if (block.type === "image") {
			blocks.push({ type: "image", data: block.data, mimeType: block.mimeType });
		}
	}
	return blocks;
}

/** 转成助手内容块，保留思考块与工具调用块。 */
function toContentBlocks(
	content: (TextContent | ImageContent | ThinkingContent | ToolCall)[],
): ContentBlock[] {
	const blocks: ContentBlock[] = [];
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

/** 用量转换。缺少推理 token 时补零，其余字段原样保留。 */
export function toUsage(usage: PiUsage): Usage {
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

/** 模型信息转换。输入模态收敛到文本与图片两种，其余取值丢弃。 */
export function toModelInfo(model: Model<any>): ModelInfo {
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

/** 助手消息转换。model 优先取提供方回报的实际响应模型，虚拟模型路由时与请求的模型不同。 */
function toAssistantMessage(message: Extract<PiMessage, { role: "assistant" }>): AssistantMessage {
	return {
		role: "assistant",
		content: toContentBlocks(message.content),
		provider: message.provider,
		model: message.responseModel ?? message.model,
		usage: toUsage(message.usage),
		stopReason: message.stopReason,
		errorMessage: message.errorMessage,
		timestamp: message.timestamp,
	};
}

/** 单条消息转换。未知角色降级为占位消息，保证扩展新增角色时不会中断事件流。 */
export function toMessage(message: PiMessageLike): Message {
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

export function toMessages(messages: readonly PiMessageLike[]): Message[] {
	return messages.map(toMessage);
}

/** 工具输出转换。内容不是数组时按空内容处理，工具实现可能省略 content 字段。 */
export function toToolOutput(result: { content?: unknown; details?: unknown; isError?: boolean }): {
	content: InputBlock[];
	details?: unknown;
	isError?: boolean;
} {
	const content = Array.isArray(result.content)
		? toInputBlocks(result.content as (TextContent | ImageContent)[])
		: [];
	return { content, details: result.details, isError: result.isError };
}
