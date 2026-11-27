/**
 * ACP 协议事件与配置结构的纯函数转换器。
 *
 * 将 ACP v1 的 `SessionUpdate`、权限请求、模式/动态配置项与输入内容块转换为 Facet 协议的
 * 纯 JSON 数据结构，同时支持 `session/load` 历史重放与实时流式回合两种模式，不碰进程与定时器。
 */
import type {
	ContentBlock as AcpContentBlock,
	PermissionOption as AcpPermissionOption,
	RequestPermissionRequest as AcpRequestPermissionRequest,
	SessionConfigOption as AcpSessionConfigOption,
	SessionModeState as AcpSessionModeState,
	SessionUpdate as AcpSessionUpdate,
	ToolCallContent as AcpToolCallContent,
} from "@agentclientprotocol/sdk";
import type {
	AcpConfigOption,
	AcpConfigOptionChoice,
	AcpModeState,
	AssistantMessage,
	ContentBlock,
	Entry,
	ImageBlock,
	InputBlock,
	Message,
	SessionEvent,
	SlashCommand,
	ToolOutput,
	UiPrompt,
	UserMessage,
} from "@facet/protocol";

const EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	reasoning: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** 将 ACP 的 SessionModeState 转换为 Facet 协议类型。 */
export function toAcpModeState(raw: AcpSessionModeState | null | undefined): AcpModeState | undefined {
	if (raw === null || raw === undefined) {
		return undefined;
	}
	return {
		currentModeId: raw.currentModeId,
		availableModes: raw.availableModes.map((mode) => ({
			id: mode.id,
			name: mode.name,
			...(mode.description === null || mode.description === undefined
				? {}
				: { description: mode.description }),
		})),
	};
}

/** 将 ACP 的 SessionConfigOption 数组转换为 Facet 协议类型。 */
export function toAcpConfigOptions(
	raw: readonly AcpSessionConfigOption[] | null | undefined,
): AcpConfigOption[] {
	if (raw === null || raw === undefined) {
		return [];
	}
	const result: AcpConfigOption[] = [];
	for (const item of raw) {
		if (item.type === "boolean") {
			result.push({
				id: item.id,
				name: item.name,
				...(item.description === null || item.description === undefined
					? {}
					: { description: item.description }),
				...(item.category === null || item.category === undefined ? {} : { category: item.category }),
				currentValue: item.currentValue ? "true" : "false",
				options: [
					{ value: "true", name: "On" },
					{ value: "false", name: "Off" },
				],
			});
			continue;
		}
		const choices: AcpConfigOptionChoice[] = [];
		for (const opt of item.options) {
			if ("group" in opt) {
				for (const member of opt.options) {
					choices.push({
						value: member.value,
						name: member.name,
						group: opt.name,
						...(member.description === null || member.description === undefined
							? {}
							: { description: member.description }),
					});
				}
			} else {
				choices.push({
					value: opt.value,
					name: opt.name,
					...(opt.description === null || opt.description === undefined
						? {}
						: { description: opt.description }),
				});
			}
		}
		result.push({
			id: item.id,
			name: item.name,
			...(item.description === null || item.description === undefined
				? {}
				: { description: item.description }),
			...(item.category === null || item.category === undefined ? {} : { category: item.category }),
			currentValue: item.currentValue,
			options: choices,
		});
	}
	return result;
}

/** 将用户文本与图片附件编码为 ACP `session/prompt` 内容块。 */
export function toAcpPromptBlocks(
	text: string,
	images: readonly ImageBlock[] | undefined,
	supportsImages: boolean,
): AcpContentBlock[] {
	const blocks: AcpContentBlock[] = [];
	if (text.length > 0) {
		blocks.push({ type: "text", text });
	}
	if (supportsImages && images !== undefined) {
		for (const img of images) {
			blocks.push({ type: "image", data: img.data, mimeType: img.mimeType });
		}
	}
	if (blocks.length === 0) {
		blocks.push({ type: "text", text: "" });
	}
	return blocks;
}

/** 从单个 ACP ContentBlock 提取纯文本或图片块。 */
function toInputBlock(block: AcpContentBlock): InputBlock | undefined {
	if (block.type === "text") {
		return { type: "text", text: block.text };
	}
	if (block.type === "image") {
		return { type: "image", data: block.data, mimeType: block.mimeType };
	}
	if (block.type === "resource_link") {
		return { type: "text", text: block.title ? `${block.title} (${block.uri})` : block.uri };
	}
	if (block.type === "resource") {
		const res = block.resource;
		if ("text" in res) {
			return { type: "text", text: res.text };
		}
	}
	return undefined;
}

/** 将 ACP 工具调用内容转换为 Facet 的 `ToolOutput`。 */
export function toAcpToolOutput(
	content: readonly AcpToolCallContent[] | null | undefined,
	rawOutput?: unknown,
	isError?: boolean,
): ToolOutput {
	const blocks: InputBlock[] = [];
	if (content !== null && content !== undefined) {
		for (const item of content) {
			if (item.type === "content") {
				const mapped = toInputBlock(item.content);
				if (mapped !== undefined) {
					blocks.push(mapped);
				}
			} else if (item.type === "diff") {
				const header = item.path;
				const oldPart = item.oldText ?? "";
				blocks.push({
					type: "text",
					text: `${header}\n--- before\n${oldPart}\n+++ after\n${item.newText}`,
				});
			} else if (item.type === "terminal") {
				blocks.push({ type: "text", text: `[terminal: ${item.terminalId}]` });
			}
		}
	}
	if (blocks.length === 0 && rawOutput !== undefined && rawOutput !== null) {
		const text = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput, null, 2);
		if (text.length > 0) {
			blocks.push({ type: "text", text });
		}
	}
	return {
		content: blocks,
		...(rawOutput === undefined ? {} : { details: rawOutput }),
		...(isError ? { isError: true } : {}),
	};
}

/** 将 ACP `session/request_permission` 转换为 Facet `UiPrompt` 与 optionId 映射表。 */
export function permissionPromptFromAcp(
	requestId: string,
	request: AcpRequestPermissionRequest,
): { prompt: UiPrompt; labelToOptionId: Map<string, string>; options: AcpPermissionOption[] } {
	const labelToOptionId = new Map<string, string>();
	const labels: string[] = [];
	for (const option of request.options) {
		let label = option.name;
		if (labelToOptionId.has(label)) {
			label = `${option.name} (${option.optionId})`;
		}
		labelToOptionId.set(label, option.optionId);
		labels.push(label);
	}
	const titleParts = [request.toolCall.title ?? request.toolCall.name ?? "Permission"];
	if (request.toolCall.kind) {
		titleParts.unshift(`[${request.toolCall.kind}]`);
	}
	return {
		prompt: {
			requestId,
			title: titleParts.join(" "),
			kind: "select",
			options: labels,
		},
		labelToOptionId,
		options: [...request.options],
	};
}

interface ActiveToolRecord {
	callId: string;
	toolName: string;
	input: unknown;
	output: ToolOutput;
	status: "pending" | "in_progress" | "completed" | "failed";
}

/**
 * 单个 ACP 会话的消息流与历史条目构建器。
 *
 * 负责维护重放/实时消息的状态拼接与 `Entry` 列表生成，纯内存运算，便于独立单测。
 */
export class AcpStreamBuilder {
	private readonly backendId: string;
	private readonly entriesList: Entry[] = [];
	private nextEntrySeq = 1;
	private currentAssistant: AssistantMessage | undefined;
	private currentUser: UserMessage | undefined;
	private activeTools = new Map<string, ActiveToolRecord>();
	private currentCommands: SlashCommand[] = [];
	private currentTitle: string | undefined;

	constructor(backendId: string) {
		this.backendId = backendId;
	}

	/** 返回当前只读历史条目列表。 */
	get entries(): readonly Entry[] {
		return this.entriesList;
	}

	/** 提取迄今收到的可用命令。 */
	get commands(): readonly SlashCommand[] {
		return this.currentCommands;
	}

	/** 提取会话信息里回报的标题。 */
	get title(): string | undefined {
		return this.currentTitle;
	}

	/** 首条用户消息的简短摘要。 */
	firstUserText(): string {
		for (const entry of this.entriesList) {
			if (entry.kind === "message" && entry.message?.role === "user") {
				const text = entry.message.content
					.filter((b): b is { type: "text"; text: string } => b.type === "text")
					.map((b) => b.text)
					.join("")
					.trim();
				if (text.length > 0) {
					return text.slice(0, 120);
				}
			}
		}
		return "";
	}

	/** 在用户发起一条真实回合时落入用户条目（供分页与本地实时一致性）。 */
	recordUserTurn(text: string, images?: readonly ImageBlock[], timestamp = Date.now()): Entry {
		const content: InputBlock[] = [];
		if (text.length > 0) {
			content.push({ type: "text", text });
		}
		if (images !== undefined) {
			content.push(...images);
		}
		const message: UserMessage = { role: "user", content, timestamp };
		return this.appendEntry(message, timestamp);
	}

	/**
	 * 消费一条 ACP `SessionUpdate`；`replay = true` 表示正在 `session/load` 重放，
	 * 只重建 `entries`，不输出实时流事件。
	 */
	applyUpdate(update: AcpSessionUpdate, options: { replay: boolean; timestamp?: number }): SessionEvent[] {
		const ts = options.timestamp ?? Date.now();
		const events: SessionEvent[] = [];

		switch (update.sessionUpdate) {
			case "user_message_chunk": {
				this.flushAssistant(options.replay, events, ts);
				const block = toInputBlock(update.content);
				if (block !== undefined) {
					if (this.currentUser === undefined) {
						this.currentUser = { role: "user", content: [block], timestamp: ts };
					} else {
						const last = this.currentUser.content[this.currentUser.content.length - 1];
						if (last?.type === "text" && block.type === "text") {
							last.text += block.text;
						} else {
							this.currentUser.content.push(block);
						}
					}
				}
				break;
			}
			case "agent_message_chunk":
			case "agent_thought_chunk": {
				this.flushUser(options.replay, events, ts);
				const isThought = update.sessionUpdate === "agent_thought_chunk";
				const text =
					update.content.type === "text"
						? update.content.text
						: toInputBlock(update.content)?.type === "text"
							? (toInputBlock(update.content) as { type: "text"; text: string }).text
							: "";
				if (text.length === 0) {
					break;
				}
				if (this.currentAssistant === undefined) {
					this.currentAssistant = {
						role: "assistant",
						content: [],
						provider: this.backendId,
						model: this.backendId,
						usage: { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } },
						stopReason: options.replay ? "stop" : "pending",
						timestamp: ts,
					};
					if (!options.replay) {
						events.push({ type: "message_start", message: cloneMessage(this.currentAssistant) });
					}
				}
				const targetType = isThought ? "thinking" : "text";
				let partIndex = this.currentAssistant.content.length - 1;
				const last = this.currentAssistant.content[partIndex];
				if (last !== undefined && last.type === targetType) {
					if (last.type === "thinking") {
						last.thinking += text;
					} else if (last.type === "text") {
						last.text += text;
					}
				} else {
					const block: ContentBlock = isThought
						? { type: "thinking", thinking: text, redacted: false }
						: { type: "text", text };
					this.currentAssistant.content.push(block);
					partIndex = this.currentAssistant.content.length - 1;
				}
				if (!options.replay) {
					events.push({
						type: "message_delta",
						contentIndex: partIndex,
						kind: isThought ? "thinking" : "text",
						delta: text,
					});
				}
				break;
			}
			case "tool_call": {
				this.flushUser(options.replay, events, ts);
				this.ensureAssistantForTool(options.replay, events, ts);
				const toolName = update.name ?? update.title ?? update.kind ?? "tool";
				const input = update.rawInput ?? (update.title ? { title: update.title } : {});
				const output = toAcpToolOutput(update.content, update.rawOutput, update.status === "failed");
				const record: ActiveToolRecord = {
					callId: update.toolCallId,
					toolName,
					input,
					output,
					status: update.status ?? "pending",
				};
				this.activeTools.set(update.toolCallId, record);
				if (this.currentAssistant !== undefined) {
					this.currentAssistant.content.push({
						type: "toolCall",
						id: update.toolCallId,
						name: toolName,
						arguments:
							typeof input === "object" && input !== null ? (input as Record<string, unknown>) : { input },
					});
				}
				if (!options.replay) {
					events.push({
						type: "tool_start",
						callId: record.callId,
						toolName: record.toolName,
						input: record.input,
					});
					if (record.status === "completed" || record.status === "failed") {
						events.push({
							type: "tool_end",
							callId: record.callId,
							toolName: record.toolName,
							output: record.output,
							isError: record.status === "failed",
						});
					}
				}
				break;
			}
			case "tool_call_update": {
				const existing = this.activeTools.get(update.toolCallId);
				const toolName = update.name ?? update.title ?? existing?.toolName ?? "tool";
				const nextStatus = update.status ?? existing?.status ?? "in_progress";
				const nextOutput =
					update.content !== undefined || update.rawOutput !== undefined
						? toAcpToolOutput(update.content, update.rawOutput, nextStatus === "failed")
						: (existing?.output ?? { content: [] });
				const updated: ActiveToolRecord = {
					callId: update.toolCallId,
					toolName,
					input: update.rawInput ?? existing?.input ?? {},
					output: nextOutput,
					status: nextStatus,
				};
				this.activeTools.set(update.toolCallId, updated);
				if (!options.replay) {
					if (existing === undefined) {
						events.push({
							type: "tool_start",
							callId: updated.callId,
							toolName: updated.toolName,
							input: updated.input,
						});
					}
					if (nextStatus === "completed" || nextStatus === "failed") {
						events.push({
							type: "tool_end",
							callId: updated.callId,
							toolName: updated.toolName,
							output: updated.output,
							isError: nextStatus === "failed",
						});
					} else {
						events.push({
							type: "tool_update",
							callId: updated.callId,
							toolName: updated.toolName,
							output: updated.output,
						});
					}
				}
				break;
			}
			case "available_commands_update": {
				this.currentCommands = update.availableCommands.map((cmd) => ({
					name: cmd.name,
					description: cmd.description,
					source: "extension",
					handler: "pi",
				}));
				break;
			}
			case "config_option_update": {
				events.push({
					type: "acp_state",
					configOptions: toAcpConfigOptions(update.configOptions),
				});
				break;
			}
			case "current_mode_update": {
				events.push({
					type: "acp_state",
					mode: { currentModeId: update.currentModeId, availableModes: [] },
				});
				break;
			}
			case "session_info_update": {
				if (typeof update.title === "string" && update.title.trim().length > 0) {
					this.currentTitle = update.title.trim();
					events.push({ type: "name", name: this.currentTitle });
				}
				break;
			}
			case "notice": {
				const level = update.severity === "error" || update.severity === "warning" ? update.severity : "info";
				const message =
					update.description !== null && update.description !== undefined && update.description.length > 0
						? `${update.title}\n${update.description}`
						: update.title;
				events.push({ type: "notice", level, message });
				break;
			}
			default:
				break;
		}

		return events;
	}

	/** 结束一次重放或实时回合，提交尚未落盘的用户/助手/工具条目。 */
	finishTurn(options: { replay: boolean; aborted?: boolean; timestamp?: number }): SessionEvent[] {
		const ts = options.timestamp ?? Date.now();
		const events: SessionEvent[] = [];
		this.flushUser(options.replay, events, ts);
		this.flushAssistant(options.replay, events, ts, options.aborted);
		this.activeTools.clear();
		return events;
	}

	private ensureAssistantForTool(replay: boolean, events: SessionEvent[], ts: number): void {
		if (this.currentAssistant !== undefined) {
			return;
		}
		this.currentAssistant = {
			role: "assistant",
			content: [],
			provider: this.backendId,
			model: this.backendId,
			usage: { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } },
			stopReason: replay ? "stop" : "pending",
			timestamp: ts,
		};
		if (!replay) {
			events.push({ type: "message_start", message: cloneMessage(this.currentAssistant) });
		}
	}

	private flushUser(replay: boolean, events: SessionEvent[], ts: number): void {
		if (this.currentUser === undefined) {
			return;
		}
		const entry = this.appendEntry(this.currentUser, ts);
		this.currentUser = undefined;
		if (!replay) {
			events.push({ type: "entry_committed", entry });
		}
	}

	private flushAssistant(replay: boolean, events: SessionEvent[], ts: number, aborted = false): void {
		if (this.currentAssistant === undefined) {
			return;
		}
		const finalized: AssistantMessage = {
			...this.currentAssistant,
			stopReason: aborted ? "aborted" : "stop",
		};
		this.currentAssistant = undefined;
		if (!replay) {
			events.push({ type: "message_end", message: finalized });
		}
		const entry = this.appendEntry(finalized, ts);
		if (!replay) {
			events.push({ type: "entry_committed", entry });
		}
		for (const tool of this.activeTools.values()) {
			const toolMessage: Message = {
				role: "toolResult",
				callId: tool.callId,
				toolName: tool.toolName,
				content: tool.output.content,
				...(tool.output.details === undefined ? {} : { details: tool.output.details }),
				isError: tool.status === "failed",
				timestamp: ts,
			};
			const toolEntry = this.appendEntry(toolMessage, ts);
			if (!replay) {
				events.push({ type: "entry_committed", entry: toolEntry });
			}
		}
		if (!replay) {
			events.push({ type: "turn_end", message: finalized, toolResults: [] });
		}
	}

	private appendEntry(message: Message, ts: number): Entry {
		const parentId = this.entriesList[this.entriesList.length - 1]?.id ?? null;
		const id = `acp-e${this.nextEntrySeq}`;
		this.nextEntrySeq += 1;
		const entry: Entry = {
			id,
			parentId,
			kind: "message",
			timestamp: new Date(ts).toISOString(),
			message,
		};
		this.entriesList.push(entry);
		return entry;
	}
}

function cloneMessage(message: AssistantMessage): AssistantMessage {
	return {
		...message,
		content: message.content.map((block) => ({ ...block })),
	};
}
