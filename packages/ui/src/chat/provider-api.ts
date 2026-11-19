/**
 * 提供方的接口协议。
 *
 * 取值与 pi 目录里的 `api` 字段一致，改名会让已保存的配置失效；显示名只在界面上用。
 */
import type { Translate } from "@facet/i18n";

/** 一个可选的接口协议。 */
export interface ApiOption {
	/** 写进配置的值 */
	value: string;
	/** 没有翻译键时的显示名，技术名词保留英文原词 */
	label: string;
	/** 需要翻译的显示名 */
	labelKey?: "providerForm.apiOpenAICompatible";
}

/** 全部可选协议，顺序即下拉里的顺序。 */
export const API_OPTIONS: readonly ApiOption[] = [
	{
		value: "openai-completions",
		label: "OpenAI compatible (chat completions)",
		labelKey: "providerForm.apiOpenAICompatible",
	},
	{ value: "openai-responses", label: "OpenAI Responses" },
	{ value: "anthropic-messages", label: "Anthropic Messages" },
	{ value: "google-generative-ai", label: "Google Generative AI" },
	{ value: "mistral-conversations", label: "Mistral Conversations" },
];

/** 取一个协议的显示名。 */
export function apiOptionLabel(option: ApiOption, t: Translate): string {
	return option.labelKey === undefined ? option.label : t(option.labelKey);
}
