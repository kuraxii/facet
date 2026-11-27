/**
 * 系统提示词分段、指令文件、Skills 与工具声明的纯拆解逻辑。
 *
 * 参考并裁剪自 pi-context-view（MIT，Copyright (c) Dmitry Makarov）。
 */
import type { ContextBreakdownCategory, ContextBreakdownItem } from "@facet/protocol";
import { findPromptSections, type PromptSection } from "./prompt-blocks.ts";

/** 工具定义切片，只保留估算与分组所需字段。 */
export interface ToolMeasureSlice {
	readonly name: string;
	readonly description: string;
	readonly parametersJson: string;
	/** 来源标记，例如 `builtin`、`npm:...`、`local` 或 `unattributed` */
	readonly source: string;
	/** 扩展入口路径或插件名，用于区分 MCP 工具 */
	readonly sourcePath?: string;
}

/** 已知的系统提示词内置分段名称映射。 */
const SECTION_LABELS: Readonly<Record<string, string>> = {
	tools: "Tools",
	rules: "Rules",
	docs: "Docs",
	addendum: "Addendum",
	cwd: "Current Dir",
};

/** 与 pi `estimateTokens` 一致的 `chars / 4` 向上取整估算。 */
export function textTokens(text: string): number {
	return charTokens(text.length);
}

/** 按字符数估算 token。 */
export function charTokens(chars: number): number {
	return Math.ceil(chars / 4);
}

/** 解码 Skill XML 中 pi 转义的实体。 */
function decodeXml(text: string): string {
	const entities: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
	};
	return text.replace(/&(amp|lt|gt|quot|apos);/g, (full, name: string) => entities[name] ?? full);
}

/** 将家目录前缀折叠为 `~`，保持路径展示紧凑。 */
function abbreviateHome(path: string, homeDir: string | undefined): string {
	if (homeDir === undefined || homeDir.length === 0) {
		return path;
	}
	if (path === homeDir) {
		return "~";
	}
	if (path.startsWith(`${homeDir}/`)) {
		return `~${path.slice(homeDir.length)}`;
	}
	return path;
}

/** 从 `project_context` 正文中抽出单个指令文件的原始内容。 */
function findContextFileContent(body: string, filePath: string): string | undefined {
	const open = `<project_instructions path="${filePath}">`;
	const close = "</project_instructions>";
	const startIdx = body.indexOf(open);
	if (startIdx === -1) {
		return undefined;
	}
	const closeIdx = body.indexOf(close, startIdx + open.length);
	if (closeIdx === -1) {
		return undefined;
	}
	let start = startIdx + open.length;
	let end = closeIdx;
	if (body.startsWith("\r\n", start)) {
		start += 2;
	} else if (body[start] === "\n") {
		start += 1;
	}
	if (body.slice(Math.max(start, end - 2), end) === "\r\n") {
		end -= 2;
	} else if (body[end - 1] === "\n") {
		end -= 1;
	}
	return body.slice(start, end);
}

/** 解析 `project_context` 分段内的各个 `AGENTS.md` / 指令文件。 */
function measureContextFiles(body: string, homeDir: string | undefined): ContextBreakdownItem[] {
	const items: ContextBreakdownItem[] = [];
	for (const match of body.matchAll(/<project_instructions path="([^"]+)">/g)) {
		const filePath = match[1];
		if (filePath === undefined) {
			continue;
		}
		const content = findContextFileContent(body, filePath);
		if (content === undefined) {
			continue;
		}
		items.push({
			id: `context-file:${filePath}`,
			label: abbreviateHome(filePath, homeDir),
			tokens: textTokens(content),
			detail: filePath,
		});
	}
	return items.sort((a, b) => b.tokens - a.tokens);
}

/** 解析 `skills` 分段内的各个 Skill 记录。 */
function measureSkills(body: string): ContextBreakdownItem[] {
	const pattern =
		/<skill>\s*<name>(.*?)<\/name>\s*<description>([\s\S]*?)<\/description>\s*<location>(.*?)<\/location>/g;
	const items: ContextBreakdownItem[] = [];
	for (const match of body.matchAll(pattern)) {
		const name = decodeXml(match[1] ?? "");
		const description = decodeXml(match[2] ?? "");
		const location = decodeXml(match[3] ?? "");
		const text = [name, description, location].join("\n");
		items.push({
			id: `skill:${name}`,
			label: name,
			tokens: textTokens(text),
			detail: location,
		});
	}
	return items.sort((a, b) => b.tokens - a.tokens);
}

/** 从记录的 `sections` 映射定位各段在拼接文本中的范围。 */
function locateReplayedSections(state: {
	readonly content: string;
	readonly sections: Readonly<Record<string, string | null>>;
}): PromptSection[] {
	const located: PromptSection[] = [];
	let offset = state.content.length;
	for (const [name, text] of Object.entries(state.sections)) {
		if (text === null) {
			continue;
		}
		const start = offset + (offset > 0 && text.length > 0 ? 2 : 0);
		const end = start + text.length;
		offset = end;
		if (name === "preamble") {
			continue;
		}
		const open = `<${name}>`;
		const close = `</${name}>`;
		const wrapped = text.startsWith(open) && text.endsWith(close);
		let bodyStart = wrapped ? start + open.length : start;
		let bodyEnd = wrapped ? end - close.length : end;
		if (wrapped && text[open.length] === "\n") {
			bodyStart += 1;
		}
		if (wrapped && text[text.length - close.length - 1] === "\n") {
			bodyEnd -= 1;
		}
		located.push({
			name,
			start,
			end,
			body: { start: bodyStart - 1, end: Math.max(bodyStart, bodyEnd) },
		});
	}
	return located;
}

/**
 * 利用累计字符数差分把父项总 token 分配给各子段，保证子项之和精确等于父项总数。
 */
function allocatePartTokens(
	parts: readonly { id: string; label: string; text: string }[],
): ContextBreakdownItem[] {
	let chars = 0;
	let allocated = 0;
	return parts
		.filter((part) => part.text.length > 0)
		.map((part) => {
			chars += part.text.length;
			const cumulative = charTokens(chars);
			const tokens = cumulative - allocated;
			allocated = cumulative;
			return { id: part.id, label: part.label, tokens };
		});
}

/** 收集未被 XML 分段包裹的扩展追加文本区间。 */
function collectUnwrappedAdditions(
	prompt: string,
	start: number,
	sections: readonly PromptSection[],
): string {
	const excluded = sections.map((section) => ({ start: section.start, end: section.end }));
	const chunks: string[] = [];
	let cursor = start;
	for (const span of excluded) {
		if (span.start > cursor) {
			const gap = prompt.slice(cursor, span.start).trim();
			if (gap.length > 0) {
				chunks.push(gap);
			}
		}
		cursor = Math.max(cursor, span.end);
	}
	if (cursor < prompt.length) {
		const tail = prompt.slice(cursor).trim();
		if (tail.length > 0) {
			chunks.push(tail);
		}
	}
	return chunks.join("\n\n");
}

/** 判定工具是否属于 MCP 来源。 */
function isMcpTool(tool: ToolMeasureSlice): boolean {
	return /(^|[^a-z])mcp([^a-z]|$)/i.test(`${tool.source} ${tool.sourcePath ?? ""}`);
}

/** 单个工具定义的估算 token：名称、描述与参数 JSON Schema。 */
function toolDefinitionTokens(tool: ToolMeasureSlice): number {
	const heading = `${tool.name}: ${tool.description}\n`;
	return textTokens(`${heading}${tool.parametersJson}`);
}

/**
 * 拆解系统提示词（Preamble / 分段 / 指令文件 / Skills）与声明给模型的工具定义。
 *
 * 工具简介与规则文本已计入 `system-prompt`，工具分类只计算随请求发送的工具定义（name /
 * description / parameters JSON Schema），避免同一段描述被重复计算两次。
 */
export function analyzePromptAndTools(input: {
	readonly systemPrompt: string;
	readonly tools: readonly ToolMeasureSlice[];
	readonly replayed?: {
		readonly content: string;
		readonly sections: Readonly<Record<string, string | null>>;
	};
	readonly customSections?: Readonly<Record<string, string>>;
	readonly forcedPrompt?: boolean;
	readonly homeDir?: string;
}): ContextBreakdownCategory[] {
	const categories: ContextBreakdownCategory[] = [];
	const { systemPrompt, replayed, customSections, forcedPrompt, homeDir } = input;

	const rawSections =
		replayed !== undefined && forcedPrompt !== true
			? locateReplayedSections(replayed)
			: findPromptSections(systemPrompt);

	const seenNames = new Set<string>();
	const sections = rawSections.filter((section) => {
		if (seenNames.has(section.name)) {
			return false;
		}
		seenNames.add(section.name);
		return true;
	});

	if (sections.length === 0) {
		const tokens = textTokens(systemPrompt);
		if (tokens > 0) {
			categories.push({ id: "system-prompt", tokens });
		}
	} else {
		const preambleEnd = sections[0]?.start ?? systemPrompt.length;
		const preambleText = systemPrompt.slice(0, preambleEnd).trimEnd();
		const promptParts: Array<{ id: string; label: string; text: string }> = [];
		if (preambleText.length > 0) {
			promptParts.push({ id: "base-prompt:preamble", label: "Preamble", text: preambleText });
		}

		let contextFileItems: ContextBreakdownItem[] = [];
		let skillItems: ContextBreakdownItem[] = [];

		for (const section of sections) {
			const body = systemPrompt.slice(section.body.start + 1, section.body.end);
			const overridden = Boolean(customSections?.[section.name]);
			if (!overridden && section.name === "project_context" && body.includes("<project_instructions path=")) {
				contextFileItems = measureContextFiles(body, homeDir);
				continue;
			}
			if (!overridden && section.name === "skills" && body.includes("<available_skills>")) {
				const parsed = measureSkills(body);
				if (parsed.length > 0) {
					skillItems = parsed;
					continue;
				}
			}
			const start =
				(section.name === "tools" || section.name === "rules") && systemPrompt[section.body.start] === "\n"
					? section.body.start
					: section.body.start + 1;
			const label = SECTION_LABELS[section.name] ?? section.name;
			promptParts.push({
				id: `base-prompt:${section.name}`,
				label,
				text: systemPrompt.slice(start, section.body.end),
			});
		}

		const additions = collectUnwrappedAdditions(systemPrompt, preambleEnd, sections);
		if (additions.length > 0) {
			promptParts.push({
				id: "base-prompt:additions",
				label: "Extension Additions",
				text: additions,
			});
		}

		const promptItems = allocatePartTokens(promptParts);
		const promptTokens = textTokens(promptParts.map((part) => part.text).join(""));
		if (promptTokens > 0) {
			categories.push({
				id: "system-prompt",
				tokens: promptTokens,
				...(promptItems.length > 1 ? { items: promptItems } : {}),
			});
		}

		if (contextFileItems.length > 0) {
			categories.push({
				id: "context-files",
				tokens: contextFileItems.reduce((sum, item) => sum + item.tokens, 0),
				items: contextFileItems,
			});
		}

		if (skillItems.length > 0) {
			categories.push({
				id: "skills",
				tokens: skillItems.reduce((sum, item) => sum + item.tokens, 0),
				items: skillItems,
			});
		}
	}

	const builtIn: ContextBreakdownItem[] = [];
	const custom: ContextBreakdownItem[] = [];
	const mcp: ContextBreakdownItem[] = [];

	for (const tool of input.tools) {
		const item: ContextBreakdownItem = {
			id: `tool:${tool.source}:${tool.name}`,
			label: tool.name,
			tokens: toolDefinitionTokens(tool),
			...(tool.source === "builtin" ? {} : { detail: tool.sourcePath ?? tool.source }),
		};
		if (tool.source === "builtin") {
			builtIn.push(item);
		} else if (isMcpTool(tool)) {
			mcp.push(item);
		} else {
			custom.push(item);
		}
	}

	if (builtIn.length > 0) {
		builtIn.sort((a, b) => b.tokens - a.tokens);
		categories.push({
			id: "built-in-tools",
			tokens: builtIn.reduce((sum, item) => sum + item.tokens, 0),
			items: builtIn,
		});
	}
	if (custom.length > 0) {
		custom.sort((a, b) => b.tokens - a.tokens);
		categories.push({
			id: "custom-tools",
			tokens: custom.reduce((sum, item) => sum + item.tokens, 0),
			items: custom,
		});
	}
	if (mcp.length > 0) {
		mcp.sort((a, b) => b.tokens - a.tokens);
		categories.push({
			id: "mcp-tools",
			tokens: mcp.reduce((sum, item) => sum + item.tokens, 0),
			items: mcp,
		});
	}

	return categories;
}
