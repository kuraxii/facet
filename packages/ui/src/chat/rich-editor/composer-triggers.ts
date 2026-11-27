/**
 * 输入区的纯文本触发判定、装饰范围计算与引用拼接。
 *
 * 所有内容与草稿保持一致：仅将文首命中的 `/命令` 与文中命中的 `@路径` 标出为装饰范围，
 * 绝不修改或转义底层字符。
 */

/** 一条胶囊补全触发区间。 */
export interface TriggerMatch {
	/** 替换起点（文档绝对偏移，含 `@` 或 `/`） */
	readonly from: number;
	/** 替换终点（光标偏移） */
	readonly to: number;
	/** 不含前导符号的查询串 */
	readonly query: string;
}

/** 一处原子胶囊在文档中的覆盖范围。 */
export type ComposerDecorationRange =
	| { readonly kind: "command"; readonly from: number; readonly to: number; readonly name: string }
	| { readonly kind: "mention"; readonly from: number; readonly to: number; readonly filePath: string };

/** 路径的最后一段，也就是文件名。 */
export function fileBasename(filePath: string): string {
	const cut = filePath.lastIndexOf("/");
	return cut < 0 ? filePath : filePath.slice(cut + 1);
}

/** 路径去掉最后一段之后的部分；根目录下的文件为空串。 */
export function fileDirname(filePath: string): string {
	const cut = filePath.lastIndexOf("/");
	return cut < 0 ? "" : filePath.slice(0, cut);
}

/** 一次最多列几条文件候选。 */
export const MAX_MENTION_OPTIONS = 10;

/** 文件候选排序：文件名前缀命中优先，其次文件名包含，最后整条路径包含。 */
export function rankMentionFiles(files: readonly string[], query: string): string[] {
	const needle = query.trim().toLowerCase();
	const prefix: string[] = [];
	const nameHit: string[] = [];
	const pathHit: string[] = [];
	for (const path of files) {
		const name = fileBasename(path).toLowerCase();
		if (needle.length === 0 || name.startsWith(needle)) {
			prefix.push(path);
		} else if (name.includes(needle)) {
			nameHit.push(path);
		} else if (path.toLowerCase().includes(needle)) {
			pathHit.push(path);
		}
	}
	return [...prefix, ...nameHit, ...pathHit].slice(0, MAX_MENTION_OPTIONS);
}

/**
 * 光标前 `@文件` 触发：只认行首或空白之后的 `@`，避免 `a@b.com` 误弹。
 */
export function mentionTrigger(textBeforeCaret: string, caretOffset: number): TriggerMatch | null {
	const match = /(^|\s)@([^\s@]*)$/.exec(textBeforeCaret);
	if (match === null) {
		return null;
	}
	const query = match[2] ?? "";
	const leadingSpace = match[1]?.length ?? 0;
	const from = caretOffset - textBeforeCaret.length + (match.index ?? 0) + leadingSpace;
	return { from, to: caretOffset, query };
}

/**
 * 文首 `/命令` 触发：只在文档最开头 `/query` 处触发（后面一旦出现空白即结束查询）。
 */
export function slashTrigger(
	docBeforeCaret: string,
	caretOffset: number,
	knownCommands: ReadonlySet<string>,
): TriggerMatch | null {
	if (docBeforeCaret.includes("\n")) {
		return null;
	}
	const match = /^\/([^\s]*)$/.exec(docBeforeCaret);
	if (match === null) {
		return null;
	}
	const query = match[1] ?? "";
	// 已经选成已知命令胶囊并紧挨着光标时，不需再弹面板；但继续删改或输入可再次触发
	if (knownCommands.has(query) && caretOffset === match[0].length) {
		// 仅当后续已经跟空白或已经作为胶囊完成时才跳过——这里刚输入 `/name` 本身仍允许按前缀提示或回车直接确认
	}
	return { from: 0, to: caretOffset, query };
}

/** 行首/空白后的 `@路径` 匹配。 */
const MENTION_PATTERN = /(^|\s)@([^\s@]+)/g;

/** 文首 `/命令名` 匹配（后面必须紧跟空白或文末，与 `parseCommand` 切法一致）。 */
const SLASH_PREFIX = /^\/([^\s]+)(?=\s|$)/;

/**
 * 计算整篇纯文本草稿中需要渲染成胶囊装饰的所有区间，按起点升序且互不重叠。
 */
export function findDecorations(
	docText: string,
	files: ReadonlySet<string>,
	knownCommands: ReadonlySet<string>,
): ComposerDecorationRange[] {
	const result: ComposerDecorationRange[] = [];

	if (knownCommands.size > 0) {
		const slash = SLASH_PREFIX.exec(docText);
		const name = slash?.[1];
		// 只有文首后紧跟空白才说明命令已经落定成胶囊，避免用户还在输入 `/comp` 时就把字吞成胶囊
		if (
			slash !== null &&
			name !== undefined &&
			knownCommands.has(name) &&
			docText.length > slash[0].length &&
			/\s/.test(docText[slash[0].length] ?? "")
		) {
			result.push({ kind: "command", from: 0, to: slash[0].length, name });
		}
	}

	if (files.size > 0) {
		for (const match of docText.matchAll(MENTION_PATTERN)) {
			const filePath = match[2] ?? "";
			if (!files.has(filePath)) {
				continue;
			}
			const from = (match.index ?? 0) + (match[1]?.length ?? 0);
			const to = from + 1 + filePath.length;
			const first = result[0];
			if (first !== undefined && from < first.to) {
				continue;
			}
			result.push({ kind: "mention", from, to, filePath });
		}
	}

	return result;
}

/**
 * 把一段引用内容格式化为纯文本 `> ...` 块并接到现有草稿末尾，末尾带换行留出输入位置。
 */
export function appendQuoteText(existing: string, rawQuote: string): string {
	const quoteBlock = rawQuote
		.replace(/\r\n?/g, "\n")
		.replace(/\s+$/, "")
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
	if (existing.trim().length === 0) {
		return `${quoteBlock}\n`;
	}
	const separator = existing.endsWith("\n") ? "" : "\n";
	return `${existing}${separator}${quoteBlock}\n`;
}
