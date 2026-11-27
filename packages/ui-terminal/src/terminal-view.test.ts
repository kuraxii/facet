/**
 * 终端主题与滚动条样式契约测试。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildXtermTheme, type TerminalAppearance } from "./terminal-view.tsx";

const SAMPLE_APPEARANCE: TerminalAppearance = {
	fontFamily: "monospace",
	fontSize: 13,
	lineHeight: 1.4,
	cursorBlink: false,
	scrollback: 5000,
	foreground: "#e6edf3",
	cursor: "#e6edf3",
	selection: "rgba(56, 139, 253, 0.3)",
	scrollbarWidth: 8,
	scrollbarThumb: "rgba(139, 148, 158, 0.4)",
	scrollbarThumbHover: "#8b949e",
};

describe("buildXtermTheme 与终端滚动条样式", () => {
	it("将 overviewRulerBorder 设为透明并同步滑块颜色", () => {
		const theme = buildXtermTheme(SAMPLE_APPEARANCE);
		expect(theme.background).toBe("rgba(0,0,0,0)");
		expect(theme.overviewRulerBorder).toBe("rgba(0,0,0,0)");
		expect(theme.scrollbarSliderBackground).toBe(SAMPLE_APPEARANCE.scrollbarThumb);
		expect(theme.scrollbarSliderHoverBackground).toBe(SAMPLE_APPEARANCE.scrollbarThumbHover);
		expect(theme.scrollbarSliderActiveBackground).toBe(SAMPLE_APPEARANCE.scrollbarThumbHover);
	});

	it("不再隐藏 xterm 6 滚动条且关闭无效的 viewport 纵向原生滚动条", () => {
		const css = readFileSync(join(import.meta.dirname, "terminal.css"), "utf8");
		expect(css).not.toMatch(/\.xterm-scrollable-element\s*>\s*\.scrollbar\s*\{[^}]*display\s*:\s*none/);
		expect(css).toMatch(/\.xterm-viewport\s*\{[^}]*overflow-y\s*:\s*hidden/);
		expect(css).toContain(".xterm-scrollable-element > .scrollbar.vertical > .slider");
	});
});
