/**
 * 从 AgentSession 构建当前活动分支的精细上下文明细。
 *
 * 结合 pi-context-view（MIT，Copyright (c) Dmitry Makarov）的分支状态回放、
 * 分段拆解、工具定义统计与消息分类逻辑，直接输出 @facet/protocol 的纯 JSON 结构。
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getSystemMessageText, type SystemMessage, type Tool } from "@earendil-works/pi-ai";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai/utils/transcript";
import type { AgentSession, BuildSystemPromptOptions, ToolInfo } from "@earendil-works/pi-coding-agent";
import type {
	ContextBreakdown,
	ContextBreakdownCategory,
	ContextRequestCacheUsage,
	ContextUsage,
} from "@facet/protocol";
import { analyzePromptAndTools, type ToolMeasureSlice } from "./measure.ts";
import { classifyContextMessages, type ModelIdentity, resolveNextRequestModel } from "./messages.ts";

/** 运行期通过只读扩展钩子捕获的请求态覆盖信息（仅存在内存中）。 */
export interface ContextObserverState {
	/** `prepareLoadout` 隐藏的工具名列表，这些工具可被脚本调用但不发给模型 */
	hiddenTools: string[];
	/** 本轮是否由 `before_agent_start` 返回了整段强制系统提示词 */
	forcedPrompt: string | undefined;
}

/** 构造拆解结果所需的纯数据输入，便于单元测试不依赖真实 AgentSession。 */
export interface ContextBreakdownInput {
	readonly messages: readonly AgentMessage[];
	readonly systemPrompt: string;
	readonly allTools: readonly ToolInfo[];
	readonly activeToolNames: readonly string[];
	readonly systemPromptOptions?: BuildSystemPromptOptions;
	readonly model?: ModelIdentity;
	readonly reportedUsage?: ContextUsage;
	readonly compactions: number;
	readonly autoCompactReserveTokens?: number;
	readonly observer?: Readonly<ContextObserverState>;
	readonly homeDir?: string;
}

/** 从记录的工具声明或实时活跃工具中扣除被隐藏声明的工具。 */
function splitHiddenTools<T extends { readonly name: string }>(
	tools: readonly T[],
	hiddenTools: readonly string[],
): { readonly declared: T[]; readonly hiddenNames: string[] } {
	const hidden = new Set(hiddenTools);
	const declared: T[] = [];
	const hiddenNames: string[] = [];
	for (const tool of tools) {
		if (hidden.has(tool.name)) {
			hiddenNames.push(tool.name);
		} else {
			declared.push(tool);
		}
	}
	return { declared, hiddenNames };
}

/** 将回放出来的 `Tool[]` 声明与当前注册工具元数据关联，补充来源信息。 */
function replayedToolSlices(
	declarations: readonly Tool[],
	allTools: readonly ToolInfo[],
): ToolMeasureSlice[] {
	const registered = new Map(allTools.map((tool) => [tool.name, tool]));
	return declarations.map((tool) => {
		const meta = registered.get(tool.name);
		return {
			name: tool.name,
			description: tool.description,
			parametersJson: JSON.stringify(tool.parameters ?? {}),
			source: meta?.sourceInfo.source ?? "unattributed",
			sourcePath: meta?.sourceInfo.path,
		};
	});
}

/** 首轮尚未持久化系统消息时，直接按活跃工具名读取工具定义。 */
function liveToolSlices(
	allTools: readonly ToolInfo[],
	activeToolNames: readonly string[],
): ToolMeasureSlice[] {
	const byName = new Map(allTools.map((tool) => [tool.name, tool]));
	const slices: ToolMeasureSlice[] = [];
	for (const name of new Set(activeToolNames)) {
		const tool = byName.get(name);
		if (tool === undefined) {
			continue;
		}
		slices.push({
			name: tool.name,
			description: tool.description,
			parametersJson: JSON.stringify(tool.parameters ?? {}),
			source: tool.sourceInfo.source,
			sourcePath: tool.sourceInfo.path,
		});
	}
	return slices;
}

/** 取当前活动分支上最近一次有效助手回复的输入/缓存分布。 */
function latestAssistantCacheUsage(messages: readonly AgentMessage[]): ContextRequestCacheUsage | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== "assistant") {
			continue;
		}
		if (message.stopReason === "aborted" || message.stopReason === "error" || !message.usage) {
			continue;
		}
		const { input, output, cacheRead, cacheWrite, totalTokens } = message.usage;
		if ((totalTokens || input + output + cacheRead + cacheWrite) <= 0) {
			continue;
		}
		const rawReasoning = (message.usage as { reasoning?: unknown }).reasoning;
		const reasoning =
			typeof rawReasoning === "number" && Number.isFinite(rawReasoning) && rawReasoning >= 0
				? rawReasoning
				: 0;
		return { input, output, cacheRead, cacheWrite, reasoning };
	}
	return undefined;
}

/** 归一化系统消息内容文本。 */
function systemContentText(content: SystemMessage["content"]): string {
	return typeof content === "string" ? content : content.map((block) => block.text).join("\n");
}

/** 纯计算入口：根据投影消息与工具状态生成 `ContextBreakdown`。 */
export function computeContextBreakdown(input: ContextBreakdownInput): ContextBreakdown {
	const hiddenList =
		input.observer?.forcedPrompt !== undefined
			? input.observer.hiddenTools
			: (input.systemPromptOptions?.hiddenTools ?? input.observer?.hiddenTools ?? []);

	const replayedBase = getCurrentSystemMessage(
		input.messages as Parameters<typeof getCurrentSystemMessage>[0],
	);
	const forcedPrompt = input.observer?.forcedPrompt;

	let promptCategories: ContextBreakdownCategory[];
	let hiddenNames: string[];

	if (replayedBase === undefined) {
		const tools = splitHiddenTools(liveToolSlices(input.allTools, input.activeToolNames), hiddenList);
		hiddenNames = tools.hiddenNames;
		promptCategories = analyzePromptAndTools({
			systemPrompt: forcedPrompt ?? input.systemPrompt,
			tools: tools.declared,
			customSections: input.systemPromptOptions?.sections,
			forcedPrompt: forcedPrompt !== undefined,
			homeDir: input.homeDir,
		});
	} else {
		const tools = splitHiddenTools(
			replayedToolSlices(replayedBase.toolsAdded ?? [], input.allTools),
			hiddenList,
		);
		hiddenNames = tools.hiddenNames;
		const promptText = forcedPrompt ?? getSystemMessageText(replayedBase);
		promptCategories = analyzePromptAndTools({
			systemPrompt: promptText,
			tools: tools.declared,
			...(forcedPrompt === undefined
				? {
						replayed: {
							content: systemContentText(replayedBase.content),
							sections: replayedBase.sections ?? {},
						},
					}
				: {}),
			forcedPrompt: forcedPrompt !== undefined,
			homeDir: input.homeDir,
		});
	}

	const nextModel = resolveNextRequestModel(input.model, input.messages);
	const messageCategories = classifyContextMessages(input.messages, nextModel);
	const categories = [...promptCategories, ...messageCategories].filter((category) => category.tokens > 0);
	const estimatedTokens = categories.reduce((sum, category) => sum + category.tokens, 0);
	const latestRequestUsage = latestAssistantCacheUsage(input.messages);

	return {
		contextWindow: input.reportedUsage?.contextWindow ?? 0,
		reportedTokens: input.reportedUsage?.tokens ?? null,
		reportedPercent: input.reportedUsage?.percent ?? null,
		estimatedTokens,
		categories,
		hiddenTools: hiddenNames,
		compactions: input.compactions,
		...(forcedPrompt !== undefined ? { forcedPrompt: true } : {}),
		...(input.autoCompactReserveTokens !== undefined
			? { autoCompactReserveTokens: input.autoCompactReserveTokens }
			: {}),
		...(latestRequestUsage !== undefined ? { latestRequestUsage } : {}),
	};
}

/** 从真实的 `AgentSession` 读取当前分支投影与工具元数据并构建 `ContextBreakdown`。 */
export function buildContextBreakdown(
	session: AgentSession,
	observer?: Readonly<ContextObserverState>,
): ContextBreakdown {
	const projection = session.sessionManager.buildSessionProjection();
	const branch = session.sessionManager.getBranch();
	const compactions = branch.filter((entry) => entry.type === "compaction").length;
	const compactionSettings = session.settingsManager.getCompactionSettings(session.model);
	const systemPromptOptions = session.createReplacedSessionContext().getSystemPromptOptions();
	const model = session.model
		? { provider: session.model.provider, api: session.model.api, id: session.model.id }
		: undefined;

	return computeContextBreakdown({
		messages: projection.messages,
		systemPrompt: session.systemPrompt,
		allTools: session.getAllTools(),
		activeToolNames: session.getActiveToolNames(),
		systemPromptOptions,
		model,
		reportedUsage: session.getContextUsage(),
		compactions,
		autoCompactReserveTokens: compactionSettings.enabled ? compactionSettings.reserveTokens : undefined,
		observer,
		homeDir: process.env.HOME,
	});
}
