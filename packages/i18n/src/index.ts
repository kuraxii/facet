import i18next, { type i18n } from "i18next";
import { resources, type TranslationResources } from "./resources.ts";

declare module "i18next" {
	interface CustomTypeOptions {
		defaultNS: "translation";
		resources: { translation: TranslationResources };
	}
}

export {
	DEFAULT_LANGUAGE_SETTING,
	LANGUAGE_SETTINGS,
	type LanguageSetting,
	normalizeSystemLanguage,
	readLanguageSetting,
	resolveLanguage,
	SUPPORTED_LANGUAGES,
	type SupportedLanguage,
} from "./language.ts";
export { en, resources, type TranslationResources, zhCN } from "./resources.ts";

/**
 * 建一个同步初始化的 i18next 实例。
 *
 * 桌面主进程、渲染进程和 Web 都只读随构建产物打包的资源，不发起网络请求；`initAsync: false`
 * 让首帧之前就能拿到译文，避免先显示源语言再切换。
 */
export function createI18n(language: string): i18n {
	const instance = i18next.createInstance();
	void instance.init({
		resources,
		lng: language,
		fallbackLng: "en",
		supportedLngs: ["en", "zh-CN"],
		initAsync: false,
		returnNull: false,
		interpolation: { escapeValue: false },
	});
	return instance;
}
