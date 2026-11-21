/**
 * 工作区工具快捷键的判定。
 *
 * 提示与真实绑定同源，所以这里既钉键位，也钉「修饰键必须恰好对上」——多按一个 Shift 就
 * 不该抢走别的绑定。
 */
import { describe, expect, it } from "vitest";
import { WORKSPACE_SHORTCUTS, workspaceShortcutLabel, workspaceShortcutOf } from "./workspace-shortcuts.ts";

/** 造一个只有判定用得到的字段的键盘事件。 */
function key(key: string, modifiers: { mod?: boolean; shift?: boolean; alt?: boolean } = {}): KeyboardEvent {
	return {
		key,
		ctrlKey: modifiers.mod === true,
		metaKey: false,
		shiftKey: modifiers.shift === true,
		altKey: modifiers.alt === true,
	} as KeyboardEvent;
}

describe("工作区快捷键", () => {
	it("三件工具各自的键位都能认出来", () => {
		expect(workspaceShortcutOf(key("E", { mod: true, shift: true }))).toBe("files");
		expect(workspaceShortcutOf(key("G", { mod: true, shift: true }))).toBe("changes");
		expect(workspaceShortcutOf(key("`", { mod: true }))).toBe("terminal");
	});

	it("主键不区分大小写（按住 Shift 时浏览器给大写）", () => {
		expect(workspaceShortcutOf(key("e", { mod: true, shift: true }))).toBe("files");
	});

	it("修饰键必须恰好对上：多按或少按都不算", () => {
		expect(workspaceShortcutOf(key("E", { mod: true }))).toBeUndefined();
		expect(workspaceShortcutOf(key("E", { shift: true }))).toBeUndefined();
		expect(workspaceShortcutOf(key("`", { mod: true, shift: true }))).toBeUndefined();
		expect(workspaceShortcutOf(key("E", { mod: true, shift: true, alt: true }))).toBeUndefined();
	});

	it("没按修饰键的普通按键不算", () => {
		expect(workspaceShortcutOf(key("e"))).toBeUndefined();
		expect(workspaceShortcutOf(key("k", { mod: true }))).toBeUndefined();
	});

	it("提示按平台写，与键位表同源", () => {
		expect(workspaceShortcutLabel("files", false)).toBe("Ctrl+Shift+E");
		expect(workspaceShortcutLabel("terminal", true)).toBe("⌘`");
		expect(Object.keys(WORKSPACE_SHORTCUTS)).toEqual(["files", "changes", "terminal"]);
	});
});
