/**
 * 配色方案的选择与解析。
 *
 * 配色是同一套语义色板的六种取值：一套浅色加五套深色。这里给出每套的显示名与色板，
 * 并负责把设置里的取值解析成实际生效的那套（system 按系统的深浅取向挑一边）。
 */
import { type CodeTheme, type ThemeMode, UI_THEMES, type UiTheme } from "@facet/protocol";

/** 一套配色的显示信息。 */
export interface UiThemeOption {
	/** 设置里保存的取值 */
	id: UiTheme;
	/** 设置页上的名称 */
	label: string;
	/** 色板上的代表色 */
	swatch: string;
	/** 是否为深色配色 */
	dark: boolean;
}

/** 设置页上的配色清单，浅色在前，其余按深浅排列。 */
export const UI_THEME_OPTIONS: readonly UiThemeOption[] = [
	{ id: "light", label: "浅色", swatch: "#ffffff", dark: false },
	{ id: "zinc", label: "Zinc", swatch: "#808080", dark: true },
	{ id: "midnight", label: "Midnight", swatch: "#4a6ba8", dark: true },
	{ id: "claude", label: "Claude", swatch: "#d97757", dark: true },
	{ id: "ghostty", label: "Ghostty", swatch: "#8caaee", dark: true },
	{ id: "pureBlack", label: "纯黑", swatch: "#000000", dark: true },
];

/** 设置里允许的取值，含跟随系统。 */
export const THEME_MODES: readonly ThemeMode[] = [...UI_THEMES, "system"];

/** 缺省的深色配色，切到浅色再切回来时用它。 */
export const DEFAULT_DARK_THEME: UiTheme = "zinc";

/** 这套配色是不是深色。 */
export function isDarkTheme(theme: UiTheme): boolean {
	return theme !== "light";
}

/**
 * 把设置里的取值解析成实际生效的配色。
 *
 * system 在系统偏浅时用浅色，否则用缺省深色；其余取值直接用。
 */
export function resolveUiTheme(mode: ThemeMode, prefersLight: boolean): UiTheme {
	if (mode === "system") {
		return prefersLight ? "light" : DEFAULT_DARK_THEME;
	}
	return mode;
}

/** 配色方案的显示名，界面上标注当前主题用。 */
export function uiThemeLabel(theme: UiTheme): string {
	return UI_THEME_OPTIONS.find((option) => option.id === theme)?.label ?? theme;
}

/** 一套代码高亮配色的显示信息。 */
export interface CodeThemeOption {
	/** 设置里保存的取值 */
	id: CodeTheme;
	/** 设置页上的名称 */
	label: string;
}

/** 设置页上的代码高亮清单。 */
export const CODE_THEME_OPTIONS: readonly CodeThemeOption[] = [
	{ id: "github", label: "GitHub" },
	{ id: "catppuccin", label: "Catppuccin" },
	{ id: "dracula", label: "Dracula" },
	{ id: "tokyo-night", label: "Tokyo Night" },
	{ id: "one", label: "One" },
	{ id: "nord", label: "Nord" },
	{ id: "gruvbox", label: "Gruvbox" },
	{ id: "solarized", label: "Solarized" },
];

/**
 * 代码高亮在 shiki 里的主题名。
 *
 * 只有明暗两版的配色（GitHub、Catppuccin、One、Gruvbox、Solarized）按界面深浅换版本，
 * 单版配色（Dracula、Tokyo Night、Nord）两边用同一份。
 */
export function codeThemeName(theme: CodeTheme, isDark: boolean): string {
	switch (theme) {
		case "github":
			return isDark ? "github-dark" : "github-light";
		case "catppuccin":
			return isDark ? "catppuccin-mocha" : "catppuccin-latte";
		case "dracula":
			return "dracula";
		case "tokyo-night":
			return "tokyo-night";
		case "one":
			return isDark ? "one-dark-pro" : "one-light";
		case "nord":
			return "nord";
		case "gruvbox":
			return isDark ? "gruvbox-dark-medium" : "gruvbox-light-medium";
		case "solarized":
			return isDark ? "solarized-dark" : "solarized-light";
	}
}
