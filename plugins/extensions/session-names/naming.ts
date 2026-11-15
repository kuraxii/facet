import type { ExtensionUIContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatModelSpec, parseModelSpec, type SessionNamesConfig, saveConfig } from "./config.ts";

/** A resolved, authenticated chat model from the registry. */
export type AnyModel = Parameters<ModelRegistry["complete"]>[0];

/** Minimal context shared by the command handler and the automatic naming hook. */
export interface NameFlowContext {
	hasUI: boolean;
	ui?: ExtensionUIContext;
	modelRegistry: ModelRegistry;
	signal?: AbortSignal;
}

/** Extract plain text from a string or content block array. */
export function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (typeof part === "string") {
			parts.push(part);
		} else if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
			parts.push((part as { text: string }).text);
		}
	}
	return parts.join("\n").trim();
}

/** Pick the configured chat model, or ask the user to choose one and persist it. */
export async function resolveModel(ctx: NameFlowContext, config: SessionNamesConfig): Promise<AnyModel> {
	const available = await ctx.modelRegistry.getAvailableOfType("chat", undefined, {
		signal: ctx.signal,
	});

	const spec = parseModelSpec(config.model);
	if (spec) {
		const match = available.find((model) => model.provider === spec.provider && model.id === spec.modelId);
		if (match) return match;
	}

	if (available.length === 0) {
		throw new Error(
			"No chat model is available (credentials are not ready), so a session name cannot be generated. Set `model` in ~/.pi/agent/session-names.json and configure that model's credentials.",
		);
	}

	const labels = available.map((model) => formatModelSpec(model));
	const chosen = await pickModelLabel(ctx, labels);
	if (chosen === undefined) {
		throw new Error(
			"No session-name model was selected. Configure `model` in ~/.pi/agent/session-names.json and try again.",
		);
	}

	const match = available.find((model) => formatModelSpec(model) === chosen.trim());
	if (match === undefined) {
		throw new Error(`Unknown selected model: ${chosen}. Set provider/modelId directly in the config.`);
	}
	saveConfig({ model: formatModelSpec(match) });
	return match;
}

async function pickModelLabel(ctx: NameFlowContext, labels: string[]): Promise<string | undefined> {
	if (ctx.hasUI && ctx.ui !== undefined) {
		return ctx.ui.select("No valid session-name model is configured. Choose one:", labels, {
			signal: ctx.signal,
		});
	}
	return undefined;
}

/**
 * Generate one name per input, batching model calls and falling back to one call
 * per item. The returned array aligns with `items`; failed entries are null.
 */
export async function generateNames(
	modelRegistry: ModelRegistry,
	model: AnyModel,
	items: string[],
	config: SessionNamesConfig,
	signal?: AbortSignal,
	onBatch?: (done: number, total: number) => void,
): Promise<(string | null)[]> {
	const BATCH_SIZE = 10;
	const out: (string | null)[] = new Array(items.length).fill(null);
	for (let i = 0; i < items.length; i += BATCH_SIZE) {
		const chunk = items.slice(i, i + BATCH_SIZE);
		const names = await generateChunk(modelRegistry, model, chunk, config, signal);
		for (let j = 0; j < names.length; j++) {
			const name = names[j];
			if (name) out[i + j] = name;
		}
		onBatch?.(Math.min(i + BATCH_SIZE, items.length), items.length);
	}
	return out;
}

async function generateChunk(
	modelRegistry: ModelRegistry,
	model: AnyModel,
	chunk: string[],
	config: SessionNamesConfig,
	signal?: AbortSignal,
): Promise<(string | null)[]> {
	if (chunk.length === 1) {
		return [await generateOne(modelRegistry, model, chunk[0] as string, config, signal)];
	}

	const viaTool = await generateChunkViaTool(modelRegistry, model, chunk, config, signal);
	if (viaTool !== null) return viaTool;

	// Fallback 1: free-text JSON for providers that cannot call tools.
	try {
		const res = await modelRegistry.complete(
			model,
			{
				systemPrompt: config.summaryPrompt,
				messages: [{ role: "user", content: buildBatchPrompt(chunk), timestamp: Date.now() }],
			},
			{ signal, maxTokens: 200 + chunk.length * 40 },
		);
		const parsed = parseJsonArray(contentToText(res.content));
		if (parsed !== null && parsed.length === chunk.length) {
			return parsed.map((name) => normalizeName(name, config.maxNameLength));
		}
	} catch {
		// Fall through to per-item calls.
	}

	// Fallback 2: one request per item.
	const out: (string | null)[] = [];
	for (const text of chunk) {
		out.push(await generateOne(modelRegistry, model, text, config, signal));
	}
	return out;
}

async function generateOne(
	modelRegistry: ModelRegistry,
	model: AnyModel,
	text: string,
	config: SessionNamesConfig,
	signal?: AbortSignal,
): Promise<string | null> {
	try {
		const res = await modelRegistry.complete(
			model,
			{
				systemPrompt: config.summaryPrompt,
				messages: [
					{
						role: "user",
						content: `First user message:\n\n${text.slice(0, 2000)}\n\nReturn only the session name, without JSON, quotes, punctuation, or explanation.`,
						timestamp: Date.now(),
					},
				],
			},
			{ signal, maxTokens: 100 },
		);
		return normalizeName(contentToText(res.content), config.maxNameLength);
	} catch {
		return null;
	}
}

function buildBatchPrompt(chunk: string[]): string {
	const body = chunk.map((text, index) => `${index + 1}. ${text.slice(0, 600)}`).join("\n\n");
	return `Generate one concise session name for each of the ${chunk.length} first user messages below. Return only a JSON string array in input order, for example ["Name one","Name two"].\n\n${body}`;
}

/** Parse a JSON string array, accepting fenced code blocks and surrounding text. */
export function parseJsonArray(text: string): string[] | null {
	if (!text) return null;
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const body = fenced?.[1] ?? text;
	const arrayMatch = body.match(/\[[\s\S]*\]/);
	if (!arrayMatch) return null;
	try {
		const value = JSON.parse(arrayMatch[0]);
		if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
			return value;
		}
	} catch {
		// Fall through.
	}
	return null;
}

const SUGGEST_TOOL_NAME = "suggest_session_names";
const MAX_TOOL_ATTEMPTS = 3;

const suggestTool = {
	name: SUGGEST_TOOL_NAME,
	description:
		"Generate one session name for each numbered first user message below. Return exactly N names through this tool, in input order. Each name must be one concise sentence.",
	parameters: Type.Object({
		names: Type.Array(Type.String({ description: "Session names in input order" }), { minItems: 1 }),
	}),
};

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string");
}

/**
 * Tool-call generation: the model must call `suggest_session_names`. Invalid
 * arguments or a wrong count trigger a retry with the failure reason attached.
 */
async function generateChunkViaTool(
	modelRegistry: ModelRegistry,
	model: AnyModel,
	chunk: string[],
	config: SessionNamesConfig,
	signal?: AbortSignal,
): Promise<(string | null)[] | null> {
	const messages: Array<{ role: "user"; content: string; timestamp: number }> = [
		{ role: "user", content: buildBatchPrompt(chunk), timestamp: Date.now() },
	];
	for (let attempt = 1; attempt <= MAX_TOOL_ATTEMPTS; attempt++) {
		try {
			const res = await modelRegistry.complete(
				model,
				{
					systemPrompt: `${config.summaryPrompt}\n\nYou must call ${SUGGEST_TOOL_NAME} with all session names in one call. Do not return text outside the tool call.`,
					tools: [suggestTool],
					messages,
				},
				{ signal, maxTokens: 200 + chunk.length * 40 },
			);
			const block = (res.content ?? []).find(
				(content) => content.type === "toolCall" && content.name === SUGGEST_TOOL_NAME,
			);
			const args = block?.type === "toolCall" ? (block.arguments as { names?: unknown }) : undefined;
			const names = isStringArray(args?.names) ? args.names : undefined;
			if (names !== undefined && names.length === chunk.length) {
				return names.map((name) => normalizeName(name, config.maxNameLength));
			}
			const reason =
				block === undefined
					? `the model did not call ${SUGGEST_TOOL_NAME}`
					: !isStringArray(args?.names)
						? "the tool arguments did not match the schema (names must be a non-empty string array)"
						: `the model returned ${names?.length ?? 0} names but ${chunk.length} were expected`;
			if (attempt < MAX_TOOL_ATTEMPTS) {
				messages.push({
					role: "user",
					content: `The previous attempt failed: ${reason}. Call ${SUGGEST_TOOL_NAME} again with exactly ${chunk.length} names in input order.`,
					timestamp: Date.now(),
				});
				continue;
			}
			return null;
		} catch {
			if (attempt < MAX_TOOL_ATTEMPTS) continue;
			return null;
		}
	}
	return null;
}

/** Strip wrapping quotes, list markers, and line breaks, then cap the length. */
export function normalizeName(raw: string, maxLength: number): string | null {
	let name = raw
		.trim()
		.replace(/^["'`「『“]+|["'`」』”]+$/g, "")
		.trim()
		.replace(/[\r\n]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	name = name.replace(/^[-*•·]\s*/, "").trim();
	if (!name) return null;
	return name.slice(0, maxLength);
}
