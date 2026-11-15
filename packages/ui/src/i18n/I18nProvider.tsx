import {
	createI18n,
	type I18nInstance,
	type SupportedLanguage,
	type Translate,
	translate,
} from "@facet/i18n";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";

/** i18n 上下文参数。 */
export interface I18nProviderProps {
	/** 当前实际使用的语言 */
	language: SupportedLanguage;
	/** 页面内容 */
	children: ReactNode;
}

/** 组件拿到的语言与翻译函数。 */
export interface I18nValue {
	/** 当前语言的翻译函数 */
	t: Translate;
	/** 当前 i18next 实例，主要用于读取语言 */
	i18n: I18nInstance;
	/** 当前生效的语言 */
	language: string;
}

const I18nContext = createContext<I18nInstance | undefined>(undefined);

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
	return <I18nContext.Provider value={i18n}>{children}</I18nContext.Provider>;
}

/** 组件单独渲染时使用的中文实例，测试与预览不必每次套 Provider。 */
const fallbackI18n = createI18n("zh-CN");
const fallbackT = translate(fallbackI18n);

/** 取当前语言与翻译函数。没有 Provider 时按缺省中文渲染。 */
export function useI18n(): I18nValue {
	const instance = useContext(I18nContext) ?? fallbackI18n;
	const subscribe = useCallback(
		(onChange: () => void) => {
			instance.on("languageChanged", onChange);
			return () => instance.off("languageChanged", onChange);
		},
		[instance],
	);
	const language = useSyncExternalStore(
		subscribe,
		() => instance.language,
		() => instance.language,
	);
	const t = useMemo(() => (instance === fallbackI18n ? fallbackT : translate(instance)), [instance]);
	return { t, i18n: instance, language };
}
