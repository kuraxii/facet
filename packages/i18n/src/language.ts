/** 界面语言的存储值。`auto` 跟随系统，其余值是明确的用户选择。 */
export const LANGUAGE_SETTINGS = ["auto", "en", "zh-CN"] as const;

/** 用户可选的语言设置。 */
export type LanguageSetting = (typeof LANGUAGE_SETTINGS)[number];

/** 实际渲染使用的语言。 */
export const SUPPORTED_LANGUAGES = ["en", "zh-CN"] as const;

/** 实际渲染使用的语言。 */
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** 没有记录时的语言设置：先跟随系统。 */
export const DEFAULT_LANGUAGE_SETTING: LanguageSetting = "auto";

/** 语言设置不是可选值时视为没有记录。 */
export function readLanguageSetting(value: unknown): LanguageSetting | undefined {
	return typeof value === "string" && (LANGUAGE_SETTINGS as readonly string[]).includes(value)
		? (value as LanguageSetting)
		: undefined;
}

/**
 * 把系统语言收成当前支持的语言。
 *
 * 目前只有简体中文一份中文资源，所有中文区域都落到 `zh-CN`；英文区域落到 `en`，
 * 其余语言回退到源语言 `en`。
 */
export function normalizeSystemLanguage(locale: string): SupportedLanguage {
	const normalized = locale.trim().toLowerCase().replaceAll("_", "-");
	if (normalized === "zh" || normalized.startsWith("zh-")) {
		return "zh-CN";
	}
	return "en";
}

/**
 * 解析最终使用的语言。
 *
 * 用户的明确选择优先；`auto` 才读取系统语言。这个函数同时供桌面主进程和 Web 使用，
 * 保证原生弹窗与页面首帧采用同一套规则。
 */
export function resolveLanguage(
	setting: LanguageSetting | undefined,
	systemLocale: string,
): SupportedLanguage {
	if (setting === "en" || setting === "zh-CN") {
		return setting;
	}
	return normalizeSystemLanguage(systemLocale);
}
