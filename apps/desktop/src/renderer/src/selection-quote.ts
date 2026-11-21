/**
 * 引用对话正文相关的界面约定。
 *
 * 右键菜单落在 ui 包里，这里只给出「哪些文字可以引用」的标记与引用之后把光标放回
 * 输入框的动作。
 */

/** 允许引用的选区容器：落在它里面的文字，右键菜单才多出「引用」。 */
export const QUOTE_SOURCE_SELECTOR = "[data-quote-source]";

/**
 * 内容末尾的折叠选区。
 *
 * 一路走到最后一个叶子节点：富文本输入框的根元素底下还有段落、列表、引用块，把选区丢在
 * 根元素上并不落在任何一段文字里。空段落里只有一个换行占位元素，落在它后面即可。
 */
function rangeAtEnd(root: HTMLElement): Range {
	const range = document.createRange();
	let node: Node = root;
	while (node.lastChild !== null) {
		node = node.lastChild;
	}
	if (node === root) {
		range.setStart(root, 0);
	} else if (node.nodeType === Node.TEXT_NODE) {
		range.setStart(node, node.textContent?.length ?? 0);
	} else {
		range.setStartAfter(node);
	}
	range.collapse(true);
	return range;
}

/**
 * 把焦点与光标放到输入框末尾。
 *
 * 草稿由 React 渲染，引用刚写进草稿时 DOM 里还是旧内容，所以等这一帧提交完再落光标，
 * 用户接着往下写自己的问题。
 *
 * 输入框是富文本编辑器时没有 `setSelectionRange`：选区只能由 `Range` 折叠到内容末尾，
 * 编辑器随后把这个 DOM 选区同步回自己的状态。文本域那条旧路径留着，两种输入框共用同一份约定。
 */
export function placeCaretAtEnd(element: HTMLElement | null): void {
	if (element === null) {
		return;
	}
	element.focus();
	requestAnimationFrame(() => {
		if (element instanceof HTMLTextAreaElement) {
			element.setSelectionRange(element.value.length, element.value.length);
			return;
		}
		// `isContentEditable` 是浏览器才有的属性，jsdom 不实现它，所以属性也认
		if (!element.isContentEditable && element.getAttribute("contenteditable") !== "true") {
			return;
		}
		const selection = window.getSelection();
		if (selection === null) {
			return;
		}
		selection.removeAllRanges();
		selection.addRange(rangeAtEnd(element));
	});
}
