/**
 * 围栏语言标记归一。
 *
 * 模型写的语言标记五花八门:`bash`、`sh`、`py`、`python{.line-numbers}`、`ts:app.ts`,
 * 流式期间还会出现 `pyt` 这种半截词。这里统一成 shiki 认识的语言 id,表外的一律按纯文本处理。
 */
import { bundledLanguages } from "shiki";

/** 兜底语言标记,不做高亮。 */
export const PLAIN = "plaintext";

/** 常见写法到 shiki 语言 id 的映射。 */
const ALIASES: Record<string, string> = {
	sh: "shellscript",
	bash: "shellscript",
	shell: "shellscript",
	zsh: "shellscript",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	ts: "typescript",
	py: "python",
	rs: "rust",
	golang: "go",
	yml: "yaml",
	md: "markdown",
	"c++": "cpp",
	"c#": "csharp",
	cs: "csharp",
	ps1: "powershell",
	docker: "dockerfile",
	text: PLAIN,
	txt: PLAIN,
	plain: PLAIN,
};

/**
 * 从围栏的 info string 取语言标记。
 *
 * 只取第一段,再去掉 `:` 与 `{` 之后的内容:`python{.line-numbers}` 取 `python`,
 * `ts:app.ts` 取 `ts`,`python title=x` 取 `python`。
 */
export function extractLangToken(info: string | null | undefined): string {
	const first = (info ?? "").trim().split(/\s+/)[0] ?? "";
	return (first.split(/[:{]/)[0] ?? "").toLowerCase();
}

/** 把 info string 解析成 shiki 语言 id,不认识的按纯文本。 */
export function resolveCodeLang(info: string | null | undefined): string {
	const token = extractLangToken(info);
	if (token.length === 0) {
		return PLAIN;
	}
	const id = ALIASES[token] ?? token;
	if (id === PLAIN) {
		return PLAIN;
	}
	return Object.hasOwn(bundledLanguages, id) ? id : PLAIN;
}
