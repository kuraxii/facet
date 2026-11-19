/**
 * 引用：把对话里选中的一段文字做成 Markdown 引用块，接到草稿末尾。
 *
 * 只做字符串拼接，不碰 DOM 与草稿状态，界面与用例共用同一份规则。
 */

/** 一段文字做成引用块：逐行前面加 `> `，空行只留 `>`，行尾空白去掉。 */
export function quoteBlock(text: string): string {
	const lines = text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/\s+$/, ""));
	// 选中的内容前后常带空行（跨段落选时尤其明显），去掉之后引用块不会挂一串空 `>`
	while (lines.length > 0 && (lines[0] ?? "").length === 0) {
		lines.shift();
	}
	while (lines.length > 0 && (lines[lines.length - 1] ?? "").length === 0) {
		lines.pop();
	}
	return lines.map((line) => (line.length === 0 ? ">" : `> ${line}`)).join("\n");
}

/**
 * 把选中的文字接进草稿。
 *
 * 草稿为空时引用块自成一段；否则空一行接在草稿后面，用户接着在它下面写自己的问题。
 * 没有可引用的内容（全是空白）时草稿原样返回。
 */
export function appendQuote(draft: string, text: string): string {
	const block = quoteBlock(text);
	if (block.length === 0) {
		return draft;
	}
	const head = draft.trimEnd();
	return head.length === 0 ? block : `${head}\n\n${block}`;
}
