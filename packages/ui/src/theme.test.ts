// @vitest-environment node
// 这份用例直接读仓库里的 CSS 文件，要有真实的文件系统与 `file:` URL。
/**
 * 配色层的测试。
 *
 * 三件事：解析出来的是不是预期的那套配色；三套配色的语义键集是否完全一致（少写一个变量会让
 * 某个主题下的元素透明或继承错误的颜色）；`theme.css` 里定义的每个变量在全仓是否真的有人读
 * （没人读的色彩变量等于一份要一直维护的死配置）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
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
		const reference = variablesIn(':root,\n:root[data-theme="dark"]');
		expect(reference.length).toBeGreaterThan(20);
		for (const theme of UI_THEMES) {
			expect(variablesIn(`:root[data-theme="${theme}"]`), theme).toEqual(reference);
		}
	});

	it("每个色彩变量在全仓都有人读，没有死配置", () => {
		// 变量名出现在 `:root` 那一份声明里不算被引用：要的是 `var(--x)` 或者脚本里的读名字
		const readers = sourceFiles().map((file) => readFileSync(file, "utf8"));
		for (const name of variablesIn(':root,\n:root[data-theme="dark"]')) {
			const pattern = new RegExp(`${name}(?![\\w-])`);
			expect(
				readers.some((source) => pattern.test(source)),
				`${name} 在 theme.css 之外没有任何引用`,
			).toBe(true);
		}
	});
});

/** 仓库根：`packages/ui/src/theme.test.ts` 往上四层。 */
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

/**
 * 全仓的样式与脚本文件，`theme.css` 自己没有算进来。
 *
 * 只看源码：构建产物（`out` / `dist`）里留着上一版的样式，算进来等于什么都没检查。
 */
function sourceFiles(): string[] {
	const found: string[] = [];
	const walk = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "out") {
				continue;
			}
			const full = join(directory, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			if (!/\.(?:css|ts|tsx)$/.test(entry.name)) {
				continue;
			}
			const path = relative(REPO_ROOT, full).split(sep).join("/");
			if (path !== "packages/ui/src/styles/theme.css") {
				found.push(full);
			}
		}
	};
	for (const root of ["packages", "apps"]) {
		walk(join(REPO_ROOT, root));
	}
	return found;
}
