/**
 * 外观设置写到根节点。
 *
 * 主题、字体与字号通过 CSS 变量下发，正文、代码块与差异视图都读同一组变量；减少动效时
 * 根节点带 `data-motion="reduced"`，样式据此关掉过渡。
 */
import type { FacetSettings } from "@facet/protocol";
import { resolveUiTheme } from "@facet/ui";

/** 系统是否偏浅色。 */
export function prefersLight(): boolean {
	return window.matchMedia("(prefers-color-scheme: light)").matches;
}

export function applyAppearance(appearance: FacetSettings["appearance"]): void {
	const root = document.documentElement;
	root.dataset.theme = resolveUiTheme(appearance.theme, prefersLight());
	root.dataset.motion = appearance.reducedMotion ? "reduced" : "full";
	root.dataset.liveMotion = appearance.liveMotion;
	// 对话导航的所有尺寸都是 `--outline-scale` 的倍数，百分比在这里换算成倍数
	root.style.setProperty("--outline-scale", String(appearance.outlineScale / 100));
	// 界面字体与正文字号固定；整体大小由窗口缩放控制。
	// 空串表示用样式表里的缺省栈：这里把内联值去掉，`:root` 的默认值就生效；
	// 编辑器与终端的字体在样式表里默认跟着代码字体走
	const applyFont = (name: string, value: string): void => {
		const trimmed = value.trim();
		if (trimmed.length > 0) {
			root.style.setProperty(name, trimmed);
			return;
		}
		root.style.removeProperty(name);
	};
	applyFont("--font-mono", appearance.codeFont);
	applyFont("--font-editor", appearance.editorFont);
	applyFont("--font-terminal", appearance.terminalFont);
	root.style.setProperty("--editor-size", `${appearance.editorFontSize}px`);
	root.style.setProperty("--terminal-size", `${appearance.terminalFontSize}px`);
	// 编辑器与终端读的是计算后的变量值，换外观时要显式告诉它们重新取
	window.dispatchEvent(new Event("facet:appearance-changed"));
}
