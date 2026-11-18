/**
 * 按键的共用判定。
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * 这一下按键是不是输入法组词过程里的。
 *
 * 用拼音、日文这类输入法时，Enter 用来选候选词，浏览器照常发 `keydown`：Chrome 会带
 * `isComposing`，少数老路径只给 `keyCode === 229`，两个都要看。组词期间把 Enter 当成提交，
 * 会把还没选完的半截文本发出去。
 */
export function isComposingKey(event: ReactKeyboardEvent | KeyboardEvent): boolean {
	const native = "nativeEvent" in event ? event.nativeEvent : event;
	return native.isComposing || native.keyCode === 229;
}
