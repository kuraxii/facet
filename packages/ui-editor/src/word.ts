/**
 * 双击选词用的词边界。
 *
 * 只在「一行文本 + 行内偏移」上算，不碰编辑器状态，用例直接喂字符串。
 */

/** 一个词的范围，偏移相对这一行的行首。 */
export interface WordRange {
	/** 词的起点 */
	from: number;
	/** 词的终点（不含） */
	to: number;
}

/** 算不算「词里的字符」：字母、数字、下划线，汉字也算字母。 */
function isWordChar(char: string | undefined): boolean {
	return char !== undefined && /[\p{L}\p{N}_]/u.test(char);
}

/**
 * 双击位置所在的那个词。
 *
 * 点在词的右半边空白里（行尾、标点之后）时往左退一格再去算，这样双击 `foo.` 的句点也
 * 能选到 `foo`。位置上没有词时返回 `undefined`。
 */
export function wordRangeAt(text: string, offset: number): WordRange | undefined {
	let index = Math.min(Math.max(offset, 0), text.length);
	// 落在词尾右侧的空白或标点上时，取左边那个词
	if (!isWordChar(text[index]) && isWordChar(text[index - 1])) {
		index -= 1;
	}
	if (!isWordChar(text[index])) {
		return undefined;
	}
	let from = index;
	let to = index + 1;
	while (from > 0 && isWordChar(text[from - 1])) {
		from -= 1;
	}
	while (to < text.length && isWordChar(text[to])) {
		to += 1;
	}
	return { from, to };
}
