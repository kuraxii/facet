import { createI18n, type SupportedLanguage } from "@facet/i18n";
import { type ReactNode, useContext, useEffect, useState } from "react";
import { I18nContext, I18nextProvider, useTranslation } from "react-i18next";

/** i18n 上下文参数。 */
export interface I18nProviderProps {
	/** 当前实际使用的语言 */
	language: SupportedLanguage;
	/** 页面内容 */
	children: ReactNode;
}

/**
 * 给界面提供 i18next 实例。
 *
 * 资源已经随构建产物打包，实例初始化不等待网络；语言切换沿用同一个实例，组件只重绘，
 * 不会重建整棵界面。
 */
export function I18nProvider({ language, children }: I18nProviderProps): React.JSX.Element {
	const [i18n] = useState(() => createI18n(language));
	useEffect(() => {
		if (i18n.language !== language) {
			void i18n.changeLanguage(language);
		}
	}, [i18n, language]);
	return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

/** 组件单独渲染时使用的中文实例，测试与预览不必每次套 Provider。 */
const fallbackI18n = createI18n("zh-CN");

/** 取当前语言与翻译函数。没有 Provider 时按缺省中文渲染。 */
export function useI18n(): ReturnType<typeof useTranslation> {
	const context = useContext(I18nContext);
	return useTranslation(undefined, context === undefined ? { i18n: fallbackI18n } : undefined);
}
