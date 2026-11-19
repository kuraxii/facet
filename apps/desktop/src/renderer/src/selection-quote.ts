/**
 * 引用对话正文相关的界面约定。
 *
 * 右键菜单落在 ui 包里，这里只给出「哪些文字可以引用」的标记与引用之后把光标放回
 * 输入框的动作。
 */

/** 允许引用的选区容器：落在它里面的文字，右键菜单才多出「引用」。 */
export const QUOTE_SOURCE_SELECTOR = "[data-quote-source]";

/**
 * 把焦点与光标放到输入框末尾。
 *
 * 草稿由 React 渲染，引用刚写进草稿时 DOM 里还是旧内容，所以等这一帧提交完再落光标，
 * 用户接着往下写自己的问题。
 */
export function placeCaretAtEnd(element: HTMLTextAreaElement | null): void {
	if (element === null) {
		return;
	}
	element.focus();
	requestAnimationFrame(() => {
		element.setSelectionRange(element.value.length, element.value.length);
	});
}
