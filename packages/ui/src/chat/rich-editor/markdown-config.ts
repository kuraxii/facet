/**
 * 输入区富文本的 Markdown 口径。
 *
 * 输入区对外的真值始终是一段 Markdown：草稿、本地保存、发送请求与「主机确认后清空」的比较
 * 都用它。所以导入与导出必须稳定——同一份内容来回跑一次不能换一种写法，否则草稿会在用户
 * 没有改动的情况下自己变样，`onSent` 那套去空白相等的判定也会失准。
 *
 * 只认聊天里说得清的结构：行内粗体、斜体、行内代码，以及代码块、引用块、两种列表。
 * 标题被刻意排除：`#` 在聊天里更常是行首编号（`#12` 这类引用），自动变成标题会把原意改坏。
 */
import { CodeHighlightNode, CodeNode } from "@lexical/code";
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
	$getRoot,
	type EditorState,
	type ElementNode,
	type LexicalEditor,
} from "lexical";

/**
 * 编辑器要注册的节点。
 *
 * 链接节点一并注册着，留给后面在输入区里认网址的余地；这一版没开链接转换，所以现在不会
 * 生成链接节点。
 */
export const COMPOSER_NODES = [CodeNode, CodeHighlightNode, QuoteNode, ListNode, ListItemNode, LinkNode];

/**
 * 双向转换的转换器表。
 *
 * 顺序只在同类转换器之间有影响：代码块（多行）排在引用与列表之前，行内格式按
 * 「粗斜体 → 粗体 → 斜体」从长到短排，否则 `**x**` 会先被当成斜体吃掉一层星号。
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
 * 必须在一次 `editor.update` 里调用。
 */
export function $importComposerMarkdown(markdown: string): void {
	const root = $getRoot();
	root.clear();
	if (markdown.trim().length > 0) {
		$convertFromMarkdownString(markdown, CHAT_TRANSFORMERS, root, true);
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
export function importComposerMarkdown(editor: LexicalEditor, markdown: string): void {
	editor.update(() => $importComposerMarkdown(markdown), {
		tag: COMPOSER_EXTERNAL_TAG,
		discrete: true,
	});
}
