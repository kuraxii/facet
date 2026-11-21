import { describe, expect, it } from "vitest";
import { formatShortcut } from "./shortcuts.ts";

/**
 * 快捷键提示的写法。
 *
 * 界面上的提示必须与真实绑定同源，这里只钉住两件事：mac 与其它平台的写法，以及修饰键的
 * 顺序（主键永远在最后）。
 */
describe("快捷键提示", () => {
	it("其它平台用加号连接键名", () => {
		expect(formatShortcut(false, { mod: true, shift: true, key: "E" })).toBe("Ctrl+Shift+E");
		expect(formatShortcut(false, { mod: true, key: "`" })).toBe("Ctrl+`");
		expect(formatShortcut(false, { alt: true, key: "ArrowLeft" })).toBe("Alt+ArrowLeft");
	});

	it("mac 用连写的符号", () => {
		expect(formatShortcut(true, { mod: true, shift: true, key: "E" })).toBe("⌘⇧E");
		expect(formatShortcut(true, { mod: true, alt: true, key: "E" })).toBe("⌘⌥E");
	});

	it("只要主键时原样给出", () => {
		expect(formatShortcut(false, { key: "Escape" })).toBe("Escape");
	});
});
