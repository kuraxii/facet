/**
 * 对话消息分类与 token 计量。
 *
 * 参考并裁剪自 pi-context-view（MIT，Copyright (c) Dmitry Makarov）。
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { convertToLlm, estimateTokens } from "@earendil-works/pi-coding-agent";
import type { ContextBreakdownCategory, ContextBreakdownItem } from "@facet/protocol";
import { charTokens } from "./measure.ts";

/** 用于判定 pi 跨模型思考重放的身份字段。 */
export interface ModelIdentity {
	readonly provider: string;
	readonly api: string;
	readonly id: string;
}

const VIRTUAL_MODEL_API = "pi-virtual";

/** 提取纯文本预览或内容长度；与 pi `convertToLlm` 一致。 */
function transformedTokens(message: AgentMessage): number | undefined {
	const converted = convertToLlm([message])[0];
	return converted === undefined ? undefined : estimateTokens(converted);
}

/** 判定助手消息是否与目标模型同源，不同源的 thinking 会在请求前被 pi 丢弃。 */
function isSameModel(
	message: { provider: string; api: string; model: string },
	model: ModelIdentity,
): boolean {
	return message.provider === model.provider && message.api === model.api && message.model === model.id;
}

/** 解析下一次请求将使用的模型身份（虚拟模型路由取最近一条有效助手回复）。 */
export function resolveNextRequestModel(
	selected: ModelIdentity | undefined,
	messages: readonly AgentMessage[],
): ModelIdentity | undefined {
	if (selected === undefined) {
		return undefined;
	}
	if (selected.api !== VIRTUAL_MODEL_API) {
		return { provider: selected.provider, api: selected.api, id: selected.id };
	}
	const latest = messages.findLast(
		(message) =>
			message.role === "assistant" && message.stopReason !== "error" && message.stopReason !== "aborted",
	);
	if (latest?.role !== "assistant") {
		return undefined;
	}
	return { provider: latest.provider, api: latest.api, id: latest.model };
}

/** 计算单条助手消息里的思考块 token，优先取模型实际回报的 `usage.reasoning`。 */
function assistantThinkingTokens(message: Extract<AgentMessage, { role: "assistant" }>): number {
	let visibleChars = 0;
	let signatureChars = 0;
	for (const block of message.content) {
		if (block.type === "thinking") {
			visibleChars += block.thinking.length;
			const sig = (block as { thinkingSignature?: unknown }).thinkingSignature;
			if (typeof sig === "string") {
				signatureChars += sig.length;
			}
		} else if (block.type === "toolCall") {
			const sig = (block as { thoughtSignature?: unknown }).thoughtSignature;
			if (typeof sig === "string") {
				signatureChars += sig.length;
			}
		}
	}
	const visibleTokens = visibleChars > 0 ? charTokens(visibleChars) : 0;
	const visibleOnly = message.api === "openai-completions";
	if (visibleOnly) {
		return visibleTokens;
	}
	const rawReasoning = (message.usage as { reasoning?: unknown } | undefined)?.reasoning;
	const reported =
		typeof rawReasoning === "number" && Number.isFinite(rawReasoning) && rawReasoning >= 0
			? rawReasoning
			: undefined;
	if (reported !== undefined) {
		return Math.max(visibleTokens, reported);
	}
	if (visibleTokens === 0 && signatureChars > 0) {
		return charTokens(signatureChars);
	}
	return visibleTokens;
}

/** 将 Map 聚合转换为按 token 降序排列的明细项列表。 */
function mapToSortedItems(
	prefix: string,
	map: ReadonlyMap<string, { tokens: number; count: number }>,
): ContextBreakdownItem[] {
	return [...map.entries()]
		.filter(([, entry]) => entry.tokens > 0)
		.map(([label, entry]) => ({
			id: `${prefix}:${label}`,
			label,
			tokens: entry.tokens,
			count: entry.count,
		}))
		.sort((a, b) => b.tokens - a.tokens);
}

/** 累加 Map 计数器。 */
function addGroupedTokens(
	map: Map<string, { tokens: number; count: number }>,
	key: string,
	tokens: number,
): void {
	const current = map.get(key) ?? { tokens: 0, count: 0 };
	current.tokens += tokens;
	current.count += 1;
	map.set(key, current);
}

/**
 * 将当前活动分支上的非系统消息分类计量。
 *
 * `system` 消息已由系统提示词分段重放，这里跳过以免重复计算。
 */
export function classifyContextMessages(
	messages: readonly AgentMessage[],
	nextRequestModel: ModelIdentity | undefined,
): ContextBreakdownCategory[] {
	let userTokens = 0;
	let userCount = 0;
	let assistantTextTokens = 0;
	let assistantTextCount = 0;
	let thinkingTokens = 0;
	let thinkingCount = 0;
	const toolCallGroups = new Map<string, { tokens: number; count: number }>();
	const toolResultGroups = new Map<string, { tokens: number; count: number }>();
	let bashTokens = 0;
	let bashCount = 0;
	const customGroups = new Map<string, { tokens: number; count: number }>();
	let compactedTokens = 0;
	let compactedCount = 0;

	for (const message of messages) {
		switch (message.role) {
			case "system":
				break;
			case "user":
				userTokens += estimateTokens(message);
				userCount += 1;
				break;
			case "assistant": {
				let textChars = 0;
				for (const block of message.content) {
					if (block.type === "text") {
						textChars += block.text.length;
					} else if (block.type === "toolCall") {
						const args = JSON.stringify(block.arguments ?? {});
						addGroupedTokens(toolCallGroups, block.name, charTokens(block.name.length + args.length));
					}
				}
				if (textChars > 0) {
					assistantTextTokens += charTokens(textChars);
					assistantTextCount += 1;
				}
				if (nextRequestModel === undefined || isSameModel(message, nextRequestModel)) {
					const t = assistantThinkingTokens(message);
					if (t > 0) {
						thinkingTokens += t;
						thinkingCount += 1;
					}
				}
				break;
			}
			case "toolResult": {
				const tokens = estimateTokens(message);
				addGroupedTokens(toolResultGroups, message.toolName, tokens);
				break;
			}
			case "bashExecution": {
				const tokens = transformedTokens(message);
				// `!!` 排除出上下文的命令执行不发给模型
				if (tokens !== undefined && tokens > 0) {
					bashTokens += tokens;
					bashCount += 1;
				}
				break;
			}
			case "custom": {
				const tokens = transformedTokens(message);
				if (tokens !== undefined && tokens > 0) {
					addGroupedTokens(customGroups, message.customType, tokens);
				}
				break;
			}
			case "compactionSummary":
			case "branchSummary": {
				const tokens = transformedTokens(message) ?? 0;
				if (tokens > 0) {
					compactedTokens += tokens;
					compactedCount += 1;
				}
				break;
			}
		}
	}

	const categories: ContextBreakdownCategory[] = [];
	if (userTokens > 0) {
		categories.push({
			id: "user-messages",
			tokens: userTokens,
			items: [{ id: "user-messages:all", label: "User", tokens: userTokens, count: userCount }],
		});
	}
	if (assistantTextTokens > 0) {
		categories.push({
			id: "assistant-messages",
			tokens: assistantTextTokens,
			items: [
				{
					id: "assistant-messages:all",
					label: "Assistant",
					tokens: assistantTextTokens,
					count: assistantTextCount,
				},
			],
		});
	}
	if (thinkingTokens > 0) {
		categories.push({
			id: "assistant-thinking",
			tokens: thinkingTokens,
			items: [
				{
					id: "assistant-thinking:all",
					label: "Thinking",
					tokens: thinkingTokens,
					count: thinkingCount,
				},
			],
		});
	}

	const toolCallItems = mapToSortedItems("tool-call", toolCallGroups);
	if (toolCallItems.length > 0) {
		categories.push({
			id: "tool-calls",
			tokens: toolCallItems.reduce((sum, item) => sum + item.tokens, 0),
			items: toolCallItems,
		});
	}

	const toolOutputItems = mapToSortedItems("tool-result", toolResultGroups);
	if (bashTokens > 0) {
		toolOutputItems.push({
			id: "bash-executions",
			label: "bash (direct)",
			tokens: bashTokens,
			count: bashCount,
		});
		toolOutputItems.sort((a, b) => b.tokens - a.tokens);
	}
	if (toolOutputItems.length > 0) {
		categories.push({
			id: "tool-output",
			tokens: toolOutputItems.reduce((sum, item) => sum + item.tokens, 0),
			items: toolOutputItems,
		});
	}

	const customItems = mapToSortedItems("custom", customGroups);
	if (customItems.length > 0) {
		categories.push({
			id: "extensions",
			tokens: customItems.reduce((sum, item) => sum + item.tokens, 0),
			items: customItems,
		});
	}

	if (compactedTokens > 0) {
		categories.push({
			id: "compacted-data",
			tokens: compactedTokens,
			items: [
				{
					id: "compacted-data:summary",
					label: "Summary",
					tokens: compactedTokens,
					count: compactedCount,
				},
			],
		});
	}

	return categories;
}
