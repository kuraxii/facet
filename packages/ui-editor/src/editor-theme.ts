/**
 * 代码面的配色。
 *
 * 颜色全部取自根节点的 CSS 变量，所以七套主题切换时编辑器跟着变；语法色用界面已有的强调、
 * 成功、警告等语义色，不引入第二套调色板。
 */
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** 从根节点读一个变量的值。 */
function readVar(name: string, fallback: string): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return value.length > 0 ? value : fallback;
}

/** 编辑器的视觉令牌。 */
export interface EditorPalette {
	/** 背景 */
	background: string;
	/** 正文 */
	foreground: string;
	/** 次要文本，行号与空状态用它 */
	muted: string;
	/** 强调色，选中与光标 */
	accent: string;
	/** 选区底色 */
	selection: string;
	/** 当前行底色 */
	activeLine: string;
	/** 等宽字体栈 */
	monoFont: string;
	/** 字号 */
	fontSize: string;
}

/** 现读一份令牌。 */
export function readEditorPalette(): EditorPalette {
	return {
		background: readVar("--bg", "#18181b"),
		foreground: readVar("--t1", "#fafafa"),
		muted: readVar("--t3", "#71717a"),
		accent: readVar("--acc", "#fafafa"),
		selection: readVar("--surface3", "#3f3f46"),
		activeLine: readVar("--surface2", "#27272a"),
		monoFont: readVar("--font-editor", readVar("--font-mono", "ui-monospace, monospace")),
		fontSize: readVar("--editor-size", "13px"),
	};
}

/** 编辑器的样式。 */
export function editorTheme(palette: EditorPalette): Extension {
	return EditorView.theme(
		{
			"&": {
				height: "100%",
				backgroundColor: palette.background,
				color: palette.foreground,
				fontFamily: palette.monoFont,
				fontSize: palette.fontSize,
			},
			".cm-scroller": {
				fontFamily: palette.monoFont,
				lineHeight: "1.55",
				overflow: "auto",
			},
			".cm-content": { padding: "6px 0" },
			".cm-gutters": {
				backgroundColor: palette.background,
				border: "none",
				color: palette.muted,
			},
			".cm-activeLine": { backgroundColor: palette.activeLine },
			".cm-activeLineGutter": { backgroundColor: palette.activeLine },
			"&.cm-focused .cm-cursor": { borderLeftColor: palette.accent },
			"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
				backgroundColor: palette.selection,
			},
			".cm-selectionMatch": { backgroundColor: palette.activeLine },
			".cm-searchMatch": {
				backgroundColor: palette.activeLine,
				outline: `1px solid ${palette.accent}`,
			},
			".cm-panels": {
				backgroundColor: palette.activeLine,
				color: palette.foreground,
			},
			".cm-panels input, .cm-panels button": {
				color: palette.foreground,
				fontFamily: palette.monoFont,
			},
		},
		{ dark: true },
	);
}
