/**
 * 输入区换行时的列表自动编号与退出。
 *
 * 纯字符串计算，不依赖编辑器实例：命中行首有序（`1. `）或无序（`- ` / `* `）列表前缀时，
 * 有正文则换行后自动续写递增序号或同款列表符，空列表项再按换行则清掉前缀退出列表。
 */

/** 有序列表前缀：可选缩进 + 数字 + 点 + 空格（保留原缩进与后续文本）。 */
const ORDERED_LIST_PREFIX = /^(\s*)(\d+)\.\s(.*)$/;

/** 无序列表前缀：可选缩进 + `-` 或 `*` + 空格。 */
const UNORDERED_LIST_PREFIX = /^(\s*)([-*])\s(.*)$/;

/** 对当前行执行一次替换后的文档局部编辑描述。 */
export interface ListNewlineEdit {
	/** 从行首算起要替换的字符数（清掉空前缀时等于行长，正常续行则是光标在行内的偏移） */
	readonly replaceFromLineOffset: number;
	readonly replaceToLineOffset: number;
	/** 插入的文本：退出列表时为空串，续行时为 `\n` + 下一行前缀 */
	readonly insert: string;
}

/**
 * 计算在列表行按换行键时应当应用的编辑；不处于列表行时返回 undefined（走普通换行）。
 */
export function computeListNewlineEdit(
	lineBeforeCaret: string,
	lineAfterCaret: string,
): ListNewlineEdit | undefined {
	const ordered = ORDERED_LIST_PREFIX.exec(lineBeforeCaret);
	if (ordered !== null) {
		const indent = ordered[1] ?? "";
		const numberText = ordered[2] ?? "1";
		const body = ordered[3] ?? "";
		if (body.length === 0 && lineAfterCaret.length === 0) {
			return {
				replaceFromLineOffset: 0,
				replaceToLineOffset: lineBeforeCaret.length,
				insert: "",
			};
		}
		const caretOffset = lineBeforeCaret.length;
		return {
			replaceFromLineOffset: caretOffset,
			replaceToLineOffset: caretOffset,
			insert: `\n${indent}${Number(numberText) + 1}. `,
		};
	}

	const unordered = UNORDERED_LIST_PREFIX.exec(lineBeforeCaret);
	if (unordered !== null) {
		const indent = unordered[1] ?? "";
		const marker = unordered[2] ?? "-";
		const body = unordered[3] ?? "";
		if (body.length === 0 && lineAfterCaret.length === 0) {
			return {
				replaceFromLineOffset: 0,
				replaceToLineOffset: lineBeforeCaret.length,
				insert: "",
			};
		}
		const caretOffset = lineBeforeCaret.length;
		return {
			replaceFromLineOffset: caretOffset,
			replaceToLineOffset: caretOffset,
			insert: `\n${indent}${marker} `,
		};
	}

	return undefined;
}
