/**
 * 快捷键提示的写法。
 *
 * 界面里展示的提示必须与真的绑定一致（见 `apps/desktop/.../views/host-workspace.tsx`），
 * 所以两边共用同一组键位定义：这里只管把一组修饰键拼成平台上的写法。
 */

/** 一条快捷键：修饰键 + 主键。 */
export interface ShortcutChord {
	/** 平台主修饰键：mac 上是 ⌘，其它平台是 Ctrl */
	mod?: boolean;
	/** Shift */
	shift?: boolean;
	/** Alt */
	alt?: boolean;
	/** 主键：单个字母、符号或 `\`` */
	key: string;
}

/**
 * 拼成界面上展示的提示。
 *
 * mac 用连写的符号（`⌘⇧E`），其它平台用加号连接的键名（`Ctrl+Shift+E`）；单键（如反引号）
 * 也一样走这里，平台之间只有修饰键的写法不同。
 */
export function formatShortcut(isMac: boolean, chord: ShortcutChord): string {
	const parts: string[] = [];
	if (chord.mod === true) parts.push(isMac ? "⌘" : "Ctrl");
	if (chord.shift === true) parts.push(isMac ? "⇧" : "Shift");
	if (chord.alt === true) parts.push(isMac ? "⌥" : "Alt");
	parts.push(chord.key);
	return parts.join(isMac ? "" : "+");
}
