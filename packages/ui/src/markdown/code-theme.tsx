/**
 * 代码高亮配色的传递。
 *
 * 配色在设置里选，正文与代码块都要用，中间隔着好几层组件，用上下文一次给到位；
 * 没有宿主时按缺省的 GitHub 深色渲染，单独渲染一段正文也能工作。
 */

import type { CodeTheme } from "@facet/protocol";
import { createContext, type ReactNode, useContext } from "react";

/** 当前生效的代码高亮配色。 */
export interface CodeThemeValue {
	/** 设置里选中的那套配色 */
	theme: CodeTheme;
	/** 界面当前是不是深色，同一套配色按它取浅版或深版 */
	isDark: boolean;
}

/** 缺省配色。 */
const DEFAULT_CODE_THEME: CodeThemeValue = { theme: "github", isDark: true };

const CodeThemeContext = createContext<CodeThemeValue>(DEFAULT_CODE_THEME);

/** 向子树提供代码高亮配色。 */
export function CodeThemeProvider({
	value,
	children,
}: {
	value: CodeThemeValue;
	children: ReactNode;
}): ReactNode {
	return <CodeThemeContext.Provider value={value}>{children}</CodeThemeContext.Provider>;
}

/** 读当前代码高亮配色。 */
export function useCodeTheme(): CodeThemeValue {
	return useContext(CodeThemeContext);
}
