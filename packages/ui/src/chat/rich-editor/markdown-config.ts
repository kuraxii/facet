/**
 * 输入区富文本的节点、主题与 Markdown 口径。
 *
 * 输入区对外的真值始终是一段 Markdown：草稿、本地保存、发送请求与「主机确认后清空」的比较
 * 都用它。所以导入与导出必须稳定——同一份内容来回跑一次不能换一种写法，否则草稿会在用户
 * 没有改动的情况下自己变样，`onSent` 那套去空白相等的判定也会失准。
 *
 * 只认聊天里说得清的结构：行内粗体、斜体、行内代码，以及代码块、引用块、两种列表。
 * 标题被刻意排除：`#` 在聊天里更常是行首编号（`#12` 这类引用），自动变成标题会把原意改坏。
 */
import { $isCodeNode, CodeHighlightNode, CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import {
	$convertFromMarkdownString,
	$convertToMarkdownString,
	BOLD_ITALIC_STAR,
	BOLD_STAR,
	CODE,
	INLINE_CODE,
	ITALIC_STAR,
	ORDERED_LIST,
	QUOTE,
	type Transformer,
	UNORDERED_LIST,
} from "@lexical/markdown";
import { QuoteNode } from "@lexical/rich-text";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$isParagraphNode,
	$isTextNode,
	type EditorState,
	type EditorThemeClasses,
	type ElementNode,
	type LexicalEditor,
	type LexicalNode,
	type TextNode,
} from "lexical";
import { $createFileMentionNode, $isFileMentionNode, FileMentionNode } from "./file-mention-node.ts";
import { $createSlashCommandNode, SlashCommandNode } from "./slash-command-node.ts";

/**
 * 编辑器要注册的节点。
 *
 * 链接节点一并注册着，留给后面在输入区里认网址的余地；这一版没开链接转换，所以现在不会
 * 生成链接节点。
 */
export const COMPOSER_NODES = [
	CodeNode,
	CodeHighlightNode,
	QuoteNode,
	ListNode,
	ListItemNode,
	LinkNode,
	FileMentionNode,
	SlashCommandNode,
];

/**
 * 编辑器的样式类名。
 *
 * 结构性节点各给一个类名；粗体与斜体由浏览器原生的 `strong` / `em` 表现，免得同一段文字
 * 在不同主题下有两套观感。`codeHighlight` 里的键是 Prism 的 token 名，代码块高亮按它上色。
 */
export const COMPOSER_THEME: EditorThemeClasses = {
	paragraph: "composer-paragraph",
	quote: "composer-quote",
	code: "composer-code-block",
	codeHighlight: {
		atrule: "composer-token",
		"attr-name": "composer-token",
		boolean: "composer-token",
		builtin: "composer-token",
		"class-name": "composer-token-type",
		comment: "composer-token-comment",
		constant: "composer-token",
		deleted: "composer-token-deleted",
		function: "composer-token-function",
		important: "composer-token",
		inserted: "composer-token-added",
		keyword: "composer-token-keyword",
		number: "composer-token",
		operator: "composer-token",
		property: "composer-token",
		regex: "composer-token",
		selector: "composer-token",
		string: "composer-token-string",
		tag: "composer-token-keyword",
		"attr-value": "composer-token-string",
		url: "composer-token",
		variable: "composer-token",
		punctuation: "composer-token",
	},
	list: {
		ul: "composer-list",
		ol: "composer-list",
		listitem: "composer-list-item",
	},
	text: {
		code: "composer-inline-code",
	},
	link: "composer-link",
	fileMention: "composer-mention",
	slashCommand: "composer-command",
};

/**
 * 双向转换的转换器表。
 *
 * 顺序只在同类转换器之间有影响：代码块（多行）排在引用与列表之前，行内格式按
 * 「粗斜体 → 粗体 → 斜体」从长到短排，否则 `**x**` 会先被当成斜体吃掉一层星号。
 *
 * 胶囊不用转换器：文件胶囊的文本内容本来就是 `@完整路径`，命令胶囊是 `/命令名`，导出时
 * 按文本走；导入时分别由 `$restoreFileMentions` 与 `$restoreSlashCommands` 认回来。
 */
export const CHAT_TRANSFORMERS: Transformer[] = [
	CODE,
	QUOTE,
	UNORDERED_LIST,
	ORDERED_LIST,
	BOLD_ITALIC_STAR,
	BOLD_STAR,
	ITALIC_STAR,
	INLINE_CODE,
];

/** 文本里的 `@路径`：前面是行首或空白，后面到空白或另一个 `@` 为止。 */
const MENTION_PATTERN = /(^|\s)@([^\s@]+)/g;

/** 这个节点是不是落在代码块里。 */
function $isInsideCode(node: LexicalNode): boolean {
	let current: LexicalNode | null = node;
	while (current !== null) {
		if ($isCodeNode(current)) {
			return true;
		}
		current = current.getParent();
	}
	return false;
}

/** 照抄一份文字节点的格式，用来把一行拆成「命中的」与「没命中的」两段。 */
function $textPieceLike(source: TextNode, text: string): TextNode {
	const piece = $createTextNode(text);
	piece.setFormat(source.getFormat());
	piece.setStyle(source.getStyle());
	return piece;
}

/**
 * 把一段文字里命中已知文件的 `@路径` 换成胶囊。
 *
 * 只认 `files` 里有的路径：`@某个人`、`a@b.com` 这类保持普通文字。代码块与行内代码里
 * 一律不换——那里面 `@` 多半是装饰器或注释。
 */
function $mentionizeTextNode(node: TextNode, files: ReadonlySet<string>): void {
	if (node.hasFormat("code") || $isInsideCode(node)) {
		return;
	}
	const text = node.getTextContent();
	const parts: LexicalNode[] = [];
	let cursor = 0;
	for (const match of text.matchAll(MENTION_PATTERN)) {
		const path = match[2] ?? "";
		if (!files.has(path)) {
			continue;
		}
		const at = (match.index ?? 0) + (match[1] ?? "").length;
		if (at > cursor) {
			parts.push($textPieceLike(node, text.slice(cursor, at)));
		}
		parts.push($createFileMentionNode(path));
		cursor = at + 1 + path.length;
	}
	if (parts.length === 0) {
		return;
	}
	if (cursor < text.length) {
		parts.push($textPieceLike(node, text.slice(cursor)));
	}
	for (const part of parts) {
		node.insertBefore(part);
	}
	node.remove();
}

/**
 * 把整棵文档里命中已知文件的 `@路径` 还原成胶囊。
 *
 * 先收集再改：改的过程中会拆节点、换节点，边遍历边改会踩到已经离场的节点。
 */
export function $restoreFileMentions(files: ReadonlySet<string>): void {
	if (files.size === 0) {
		return;
	}
	const targets = $getRoot()
		.getAllTextNodes()
		.filter((node): node is TextNode => $isTextNode(node) && !$isFileMentionNode(node));
	for (const node of targets) {
		// 上一轮拆出来的片段也在收集结果里，已经离场的跳过
		if (node.isAttached()) {
			$mentionizeTextNode(node, files);
		}
	}
}

/** 段首的 `/命令名`：名字到空白或结尾为止，和 `parseCommand` 的切法一致。 */
const SLASH_PREFIX = /^\/([^\s]+)(?=\s|$)/;

/**
 * 把文首的 `/命令名` 还成胶囊。
 *
 * 只认文档第一段、且只有名字命中已知命令的那一处：`/usr/bin/env` 这类路径、`/foo` 这种
 * 正文里的斜杠、第二段之后的 `/cmd` 全都保持普通文字。命令只能在文首生效（`parseCommand`
 * 也只看开头），所以别处不该长成胶囊——否则它会显示成一条根本不会执行的命令。
 */
export function $restoreSlashCommands(known: ReadonlySet<string>): void {
	if (known.size === 0) {
		return;
	}
	const paragraph = $getRoot().getFirstChild();
	if (!$isParagraphNode(paragraph)) {
		return;
	}
	const head = paragraph.getFirstChild();
	// 行内代码里的 `/` 是命令行或路径，不是命令
	if (!$isTextNode(head) || head.hasFormat("code")) {
		return;
	}
	const text = head.getTextContent();
	const match = SLASH_PREFIX.exec(text);
	const name = match?.[1];
	if (match === null || name === undefined || !known.has(name)) {
		return;
	}
	const capsule = $createSlashCommandNode(name);
	head.insertBefore(capsule);
	const rest = text.slice(match[0].length);
	// 名字后面还有内容（参数、正文）时照原格式留在胶囊之后
	if (rest.length > 0) {
		head.insertBefore($textPieceLike(head, rest));
	}
	head.remove();
}

/**
 * 从当前编辑状态导出 Markdown。
 *
 * 空编辑态（只剩一个空段落）导出空串：草稿为空时不该往本地保存里写一个换行。
 * 末尾的空行照实导出：用户按下换行却没接着写时，草稿要跟上他的输入，不能在下一趟导入时
 * 悄悄少掉一行。发送时 `useComposer` 本来就会 `trim()`，尾部空白不会进消息。
 * 必须在一个读取上下文里调用；对外的 `exportComposerMarkdown` 负责这件事。
 */
export function $exportComposerMarkdown(root: ElementNode = $getRoot()): string {
	// 只有空段落（或空列表、空引用这类没有文字的容器）时按空内容处理
	if (root.getTextContent().trim().length === 0) {
		return "";
	}
	return $convertToMarkdownString(CHAT_TRANSFORMERS, root, true);
}

/** 导出 Markdown，供界面与用例共用。读取之外不改动任何状态。 */
export function exportComposerMarkdown(state: EditorState): string {
	return state.read(() => $exportComposerMarkdown());
}

/**
 * 把一段 Markdown 铺进根节点。
 *
 * 保留单个换行（`shouldPreserveNewLines`）：旧的纯文本草稿是一段字符串，引用块也是逐行
 * `> ` 拼出来的，不保换行会把它们粘成一整段的段落，等于改写了用户已经写好的内容。
 * 铺完再把命中 `files` 的 `@路径` 与文首命中 `knownCommands` 的 `/命令` 还原成胶囊。
 * 必须在一次 `editor.update` 里调用。
 */
export function $importComposerMarkdown(
	markdown: string,
	files: ReadonlySet<string> = new Set(),
	knownCommands: ReadonlySet<string> = new Set(),
): void {
	const root = $getRoot();
	root.clear();
	if (markdown.trim().length > 0) {
		$convertFromMarkdownString(markdown, CHAT_TRANSFORMERS, root, true);
		$restoreSlashCommands(knownCommands);
		$restoreFileMentions(files);
	}
	// 根节点没有子节点时浏览器给不出光标位置，空内容也留一个空段落
	if (root.getChildrenSize() === 0) {
		root.append($createParagraphNode());
	}
	root.selectEnd();
}

/**
 * 外部写入用的更新标签：调试与 DevTools 里能认出「这条变化不是用户敲的」。
 *
 * 判断要不要回调 `onChange` 不靠它，靠 `ComposerEditor` 维护的 Markdown 影子值。
 */
export const COMPOSER_EXTERNAL_TAG = "facet-composer-external";

/**
 * 外部改值：整份替换编辑器内容并把光标放到末尾。
 *
 * 走 `discrete`：外部写入之后，同一个交互里紧接着的动作（把光标放回末尾、比较草稿、
 * 判断能不能发送）都要立刻看到新内容，不能等一次批量提交。
 */
export function importComposerMarkdown(
	editor: LexicalEditor,
	markdown: string,
	files: ReadonlySet<string> = new Set(),
	knownCommands: ReadonlySet<string> = new Set(),
): void {
	editor.update(() => $importComposerMarkdown(markdown, files, knownCommands), {
		tag: COMPOSER_EXTERNAL_TAG,
		discrete: true,
	});
}
