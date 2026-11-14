/**
 * 工具调用的一句话说明。
 *
 * 一行只放一个短摘要,让同一轮里十几次调用可以整列扫过去。
 * 参数结构由工具决定,这里按常见字段取,取不到就退回空串。
 */

/** 摘要在头部可占的最大字符数。 */
const MAX_TARGET = 48;

/** 依次尝试的参数字段,前面的更具体。 */
const TARGET_KEYS = [
	"command",
	"path",
	"file_path",
	"filePath",
	"file",
	"pattern",
	"query",
	"url",
	"name",
	"task",
	"description",
	"prompt",
] as const;

function shorten(value: string): string {
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length > MAX_TARGET ? `${flat.slice(0, MAX_TARGET)}…` : flat;
}

/** 脚本类工具的正文摘要：取第一行有内容、且不是注释的行。 */
function codeSummary(code: string): string {
	for (const line of code.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.startsWith("//")) {
			continue;
		}
		return shorten(trimmed);
	}
	return "";
}

/** 取工具调用的参数摘要。 */
export function toolTarget(input: unknown): string {
	if (typeof input === "string") {
		return shorten(input);
	}
	if (typeof input !== "object" || input === null) {
		return "";
	}
	const record = input as Record<string, unknown>;
	// 脚本类工具的参数整段是代码，取第一行有内容的当摘要
	if (typeof record.code === "string") {
		const summary = codeSummary(record.code);
		if (summary.length > 0) {
			return summary;
		}
	}
	for (const key of TARGET_KEYS) {
		const value = record[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return shorten(value);
		}
	}
	return "";
}

/**
 * 工具卡片右侧的状态文字。
 *
 * 成功与失败只靠颜色和边框区分,不再写字;文字位置留给耗时。执行中仍写出「执行中」,
 * 因为它不是结论,还需要一个明确的进行时状态;未执行也写出来,它不是执行结果。
 */
export function toolStatusText(
	status: "running" | "done" | "failed" | "skipped",
	durationMs: number | undefined,
): string {
	if (status === "running") {
		return "执行中";
	}
	if (status === "skipped") {
		return "未执行";
	}
	if (durationMs === undefined) {
		return "";
	}
	if (durationMs < 1000) {
		return `${Math.round(durationMs)}ms`;
	}
	return `${(durationMs / 1000).toFixed(1)}s`;
}

/**
 * 长输出截断成可折叠的一段。
 *
 * 先按行数判断,再按字符数兜底,二者任一超出就只显示开头。
 */
export function foldOutput(
	output: string,
	maxLines = 12,
	maxChars = 1400,
): {
	preview: string;
	hiddenLines: number;
} {
	const lines = output.split("\n");
	if (lines.length > maxLines) {
		return { preview: lines.slice(0, maxLines).join("\n"), hiddenLines: lines.length - maxLines };
	}
	if (output.length > maxChars) {
		const preview = output.slice(0, maxChars);
		return { preview, hiddenLines: output.slice(maxChars).split("\n").length };
	}
	return { preview: output, hiddenLines: 0 };
}

/**
 * 脚本类工具的完整代码。
 *
 * `codemode` 的参数是一个 `code` 字段,展开时要看整段脚本,行上的摘要只取第一行。
 */
export function scriptCode(input: unknown): string | undefined {
	if (typeof input !== "object" || input === null) {
		return undefined;
	}
	const code = (input as { code?: unknown }).code;
	if (typeof code !== "string" || code.trim().length === 0) {
		return undefined;
	}
	// 只去掉首尾的空行，代码自身的缩进保留
	return code.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
}

/**
 * 脚本类工具的返回正文。
 *
 * 结果文本由运行器包了一层前置信息(`Script completed` / `Wall time …` / `Output:`),
 * 展开后先给代码再给返回内容,这层前置信息没有信息量,一并去掉。
 */
export function scriptBody(output: string): string {
	const lines = output.split("\n");
	const head = lines[0]?.trim() ?? "";
	if (head !== "Script completed" && head !== "Script failed") {
		return output;
	}
	const marker = lines.findIndex((line) => line.trim() === "Output:");
	const body = marker < 0 ? lines.slice(1) : lines.slice(marker + 1);
	while (body.length > 0 && (body[0] ?? "").trim() === "") {
		body.shift();
	}
	return body.join("\n");
}

/** 工具的归类,决定行首图标与过程行标题里算进哪一项。 */
export type ToolCategory = "command" | "read" | "edit" | "search" | "other";

/** 工具的短名与归类。 */
export interface ToolKind {
	/** 行里显示的短名,例如 Shell、Read；认不出的工具用原名 */
	label: string;
	/** 归类 */
	category: ToolCategory;
}

/** 认识的名字对应的短名与归类；没列出的按其他工具处理。 */
const KINDS: Readonly<Record<string, { label: string; category: ToolCategory }>> = {
	bash: { label: "Shell", category: "command" },
	exec: { label: "Shell", category: "command" },
	read: { label: "Read", category: "read" },
	write: { label: "Write", category: "edit" },
	edit: { label: "Edit", category: "edit" },
	multiedit: { label: "Edit", category: "edit" },
	grep: { label: "Grep", category: "search" },
	glob: { label: "Glob", category: "search" },
	search_context: { label: "Search", category: "search" },
	web_search: { label: "Search", category: "search" },
	fetch_content: { label: "Fetch", category: "other" },
	source_check: { label: "Check", category: "other" },
	get_search_content: { label: "Search", category: "search" },
	// 脚本类工具：一行的参数就是整段代码，摘要取第一行有内容的
	codemode: { label: "Codemode", category: "command" },
};

/** 取工具的短名与归类；认不出的工具原样显示名字。 */
export function toolKind(name: string): ToolKind {
	const known = KINDS[name.toLowerCase()];
	return known === undefined ? { label: name, category: "other" } : known;
}
