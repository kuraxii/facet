/**
 * 配色层的测试。
 *
 * 两件事：解析出来的是不是预期的那套配色；七套配色的 CSS 变量集合是否一致，
 * 少写一个变量会让某个主题下的元素透明或继承错误的颜色。
 */
import { readFileSync } from "node:fs";
import { CODE_THEMES, UI_THEMES } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import {
	CODE_THEME_OPTIONS,
	codeThemeName,
	DEFAULT_DARK_THEME,
	isDarkTheme,
	resolveUiTheme,
	THEME_MODES,
	UI_THEME_OPTIONS,
} from "./theme.ts";

describe("resolveUiTheme", () => {
	it("系统偏浅时跟随系统取浅色，否则取缺省深色", () => {
		expect(resolveUiTheme("system", true)).toBe("light");
		expect(resolveUiTheme("system", false)).toBe(DEFAULT_DARK_THEME);
	});

	it("具体配色原样使用，不受系统取向影响", () => {
		expect(resolveUiTheme("claude", true)).toBe("claude");
		expect(resolveUiTheme("light", false)).toBe("light");
	});
});

describe("配色清单", () => {
	it("清单覆盖设置里允许的全部取值，浅色只有一套", () => {
		const ids = UI_THEME_OPTIONS.map((option) => option.id);
		expect([...ids].sort()).toEqual([...UI_THEMES].sort());
		expect(UI_THEME_OPTIONS.filter((option) => !option.dark)).toHaveLength(1);
		expect(THEME_MODES).toContain("system");
	});

	it("深浅判定与色板的 dark 标记一致", () => {
		for (const option of UI_THEME_OPTIONS) {
			expect(isDarkTheme(option.id)).toBe(option.dark);
		}
	});

	it("代码配色清单覆盖全部取值", () => {
		expect(CODE_THEME_OPTIONS.map((option) => option.id).sort()).toEqual([...CODE_THEMES].sort());
	});
});

describe("codeThemeName", () => {
	it("有浅深两版的配色按界面深浅取版本", () => {
		expect(codeThemeName("github", true)).toBe("github-dark");
		expect(codeThemeName("github", false)).toBe("github-light");
		expect(codeThemeName("gruvbox", true)).toBe("gruvbox-dark-medium");
		expect(codeThemeName("gruvbox", false)).toBe("gruvbox-light-medium");
	});

	it("单版配色两边用同一份", () => {
		expect(codeThemeName("dracula", true)).toBe(codeThemeName("dracula", false));
		expect(codeThemeName("nord", true)).toBe(codeThemeName("nord", false));
		expect(codeThemeName("tokyo-night", true)).toBe(codeThemeName("tokyo-night", false));
	});
});

describe("theme.css", () => {
	const css = readFileSync(new URL("./styles/theme.css", import.meta.url), "utf8");

	/** 取某个选择器块里声明的变量名。 */
	function variablesIn(selector: string): string[] {
		const start = css.indexOf(selector);
		expect(start).toBeGreaterThanOrEqual(0);
		const open = css.indexOf("{", start);
		const close = css.indexOf("\n}", open);
		const body = css.slice(open, close);
		return [...body.matchAll(/(--[a-z0-9-]+):/g)].map((match) => match[1] ?? "").sort();
	}

	it("每套配色都有对应的样式块", () => {
		for (const theme of UI_THEMES) {
			const selector = `:root[data-theme="${theme}"]`;
			expect(css.includes(selector), `缺少 ${selector}`).toBe(true);
		}
	});

	it("各套配色声明的变量完全一致", () => {
		const reference = variablesIn(':root,\n:root[data-theme="paseo"]');
		expect(reference.length).toBeGreaterThan(20);
		for (const theme of UI_THEMES) {
			expect(variablesIn(`:root[data-theme="${theme}"]`), theme).toEqual(reference);
		}
	});
});
