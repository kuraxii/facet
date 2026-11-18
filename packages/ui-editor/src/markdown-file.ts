/**
 * 哪些文件按 Markdown 处理。
 *
 * 预览与源码高亮共用这一份判定，不各写一套扩展名：`@codemirror/language-data` 登记的
 * 是 `md` / `markdown` / `mkd`，这里与之对齐。`.mdx` 不在其中——那是带 JSX 的方言，
 * 按 Markdown 渲染会改掉语义。
 */

/** 认作 Markdown 的扩展名，小写、不带点。 */
const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(["md", "markdown", "mkd"]);

/**
 * 路径是不是 Markdown。
 *
 * 路径按协议约定是斜杠分隔、相对项目根：只看最后一段的扩展名，大小写不敏感。
 * 没有扩展名，或以点开头且前面没有名字（`.md` 这种 dotfile）都不算。
 */
export function isMarkdownPath(path: string): boolean {
	const slash = path.lastIndexOf("/");
	const name = slash === -1 ? path : path.slice(slash + 1);
	const dot = name.lastIndexOf(".");
	if (dot <= 0) {
		return false;
	}
	return MARKDOWN_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
