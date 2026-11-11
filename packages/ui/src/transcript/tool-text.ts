/**
 * 工具调用的一句话说明。
 *
 * 卡片头部只放一个短摘要,让同一轮里十几次调用可以整列扫过去。
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

/** 取工具调用的参数摘要。 */
export function toolTarget(input: unknown): string {
	if (typeof input === "string") {
		return shorten(input);
	}
	if (typeof input !== "object" || input === null) {
		return "";
	}
	const record = input as Record<string, unknown>;
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
