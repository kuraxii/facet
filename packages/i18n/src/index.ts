import i18next, { type i18n } from "i18next";
import { resources, type TranslationKey } from "./resources.ts";

/** i18next 实例。 */
export type I18nInstance = i18n;

/** 翻译选项：只传插值与复数等信息，不参与键类型推导。 */
export type TranslateOptions = Record<string, unknown>;

/** 界面用的翻译函数。 */
export type Translate = (key: TranslationKey, options?: TranslateOptions) => string;

/**
 * 把 i18next 实例包成轻量的翻译函数。
 *
 * 组件只需要稳定的键联合类型与字符串返回值；i18next 自带的严格 TFunction 会在每个调用点
 * 展开大量条件类型，拖慢整个界面的类型检查。
 */
export function translate(instance: i18n): Translate {
	return (key, options) => instance.t(key as never, options as never) as unknown as string;
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
export {
	en,
	resources,
	type TranslationKey,
	type TranslationResources,
	zhCN,
} from "./resources.ts";

/**
 * 建一个同步初始化的 i18next 实例。
 *
 * 桌面主进程、渲染进程和 Web 都只读随构建产物打包的资源，不发起网络请求；`initAsync: false`
 * 让首帧之前就能拿到译文，避免先显示源语言再切换。
 */
export function createI18n(language: string): I18nInstance {
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
