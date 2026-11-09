/**
 * 语法高亮。
 *
 * 用一个共享的 shiki 实例,按需加载语言,先把常用语言预热,其余第一次出现时再加载。
 * 流式期间同一块代码会被反复要求分词,结果按「语言 + 主题 + 代码」缓存,避免每帧重算。
 */
import { createHighlighter, type Highlighter } from "shiki";

/** 深色主题名。 */
export const CODE_DARK_THEME = "vitesse-dark";

/** 浅色主题名。 */
export const CODE_LIGHT_THEME = "vitesse-light";

/** 预热语言。表外的语言第一次用到时再加载,加载期间按纯文本显示。 */
const PRELOAD_LANGS = [
	"shellscript",
	"typescript",
	"javascript",
	"tsx",
	"json",
	"yaml",
	"markdown",
	"python",
	"rust",
	"go",
	"diff",
	"html",
	"css",
	"sql",
];

/** 一个高亮片段。 */
export interface HighlightToken {
	/** 文本内容 */
	text: string;
	/** 该片段的颜色,主题没有给色时为空 */
	color: string | undefined;
}

/** 一行高亮结果。 */
export interface HighlightLine {
	tokens: readonly HighlightToken[];
}

/** 分词缓存上限,超过后整体清空。 */
const MAX_CACHE = 400;

const cache = new Map<string, readonly HighlightLine[]>();
let highlighter: Promise<Highlighter> | undefined;

/** 取共享的高亮器,不存在时创建。 */
export function getHighlighter(): Promise<Highlighter> {
	highlighter ??= createHighlighter({
		themes: [CODE_DARK_THEME, CODE_LIGHT_THEME],
		langs: PRELOAD_LANGS,
	});
	return highlighter;
}

/**
 * 把代码分词成按行的颜色片段。
 *
 * 高亮器还没就绪、语言不认识、或者分词抛错时返回 undefined,调用方退回纯文本显示,
 * 保证流式期间任何时刻都有内容可看。
 */
export function highlightLines(
	instance: Highlighter,
	code: string,
	language: string,
	theme: string,
): readonly HighlightLine[] | undefined {
	const key = `${theme}\u0000${language}\u0000${code}`;
	const cached = cache.get(key);
	if (cached) {
		return cached;
	}
	let result: readonly HighlightLine[] | undefined;
	try {
		const { tokens } = instance.codeToTokens(code, {
			lang: language as never,
			theme,
		});
		result = tokens.map((line) => ({
			tokens: line.map((token) => ({ text: token.content, color: token.color })),
		}));
	} catch {
		result = undefined;
	}
	if (result) {
		if (cache.size > MAX_CACHE) {
			cache.clear();
		}
		cache.set(key, result);
	}
	return result;
}
