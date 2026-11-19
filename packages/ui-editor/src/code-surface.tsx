/**
 * 代码面。
 *
 * 用 CodeMirror 6 画只读或可编辑的文件内容：行号、语法高亮、括号匹配、搜索面板与折叠。
 * 语言按文件名推断，语言包按需加载，加载期间先按纯文本显示；语言与只读都放在 compartment
 * 里，切文件或切换编辑态时只重配这两样，不重建整个编辑器。
 *
 * 选区一律由 CM6 的 `drawSelection()` 画；双击选词由这里自己补一次派发，原因见
 * `wordRangeAt` 那一组函数与 `EditorView.domEventHandlers` 里的注释。
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
	bracketMatching,
	foldGutter,
	HighlightStyle,
	indentOnInput,
	LanguageDescription,
	syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { editorTheme, readEditorPalette } from "./editor-theme.ts";
import { isMarkdownPath } from "./markdown-file.ts";
import { wordRangeAt } from "./word.ts";

/**
 * 双击选词。
 *
 * CM6 自己那条双击路径（`mousedown` 里按 `event.detail === 2` 取词）在 6.43.15 上不生效：
 * 词被浏览器选中、DOM 选区也有，但 CM6 没有派发选区，而 `drawSelection()` 把原生选区涂成了
 * 透明，画面上等于没选中。这里在 `dblclick` 上自己算一次词的范围并派发，选区仍由
 * `drawSelection()` 画（多行铺满、圆角一致）。
 *
 * 三击（整行）与拖选走的是 CM6 自己的路径，不受影响。
 */
const doubleClickSelection = EditorView.domEventHandlers({
	dblclick: (event, view) => {
		const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
		if (pos === null) {
			return false;
		}
		const line = view.state.doc.lineAt(pos);
		const range = wordRangeAt(line.text, pos - line.from);
		if (range === undefined) {
			return false;
		}
		view.dispatch({
			selection: EditorSelection.range(line.from + range.from, line.from + range.to),
			userEvent: "select.pointer",
		});
		return true;
	},
});

/** 语法着色：只挑几类常用的 token，颜色取自界面的语义色。 */
const HIGHLIGHT_STYLE = HighlightStyle.define([
	{ tag: [tags.keyword, tags.modifier], color: "var(--acc)" },
	{ tag: [tags.string, tags.special(tags.string)], color: "var(--ok)" },
	{ tag: [tags.number, tags.bool, tags.null], color: "var(--warn)" },
	{ tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--t3)", fontStyle: "italic" },
	{ tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--t1)" },
	{ tag: [tags.typeName, tags.className, tags.namespace], color: "var(--warn)" },
	{ tag: [tags.tagName, tags.attributeName], color: "var(--acc)" },
	{ tag: [tags.propertyName, tags.variableName], color: "var(--t2)" },
	{ tag: [tags.operator, tags.punctuation], color: "var(--t2)" },
	{ tag: [tags.heading, tags.strong], color: "var(--t1)", fontWeight: "600" },
	{ tag: tags.link, color: "var(--acc)", textDecoration: "underline" },
	{ tag: tags.invalid, color: "var(--err)" },
	// Markdown：让标记符退成底噪，结构本身（行内代码、斜体、引用、链接地址）各自成形。
	// 标记符一并淡掉是 Markdown 看着像纯文本的主因：`#`、`**`、`>` 与正文同色时整段是灰墙。
	{ tag: tags.processingInstruction, color: "var(--t3)" },
	{ tag: tags.monospace, color: "var(--markdown-code-text)" },
	{ tag: tags.emphasis, fontStyle: "italic" },
	{ tag: tags.strikethrough, color: "var(--t3)", textDecoration: "line-through" },
	{ tag: tags.quote, color: "var(--t3)" },
	{ tag: tags.url, color: "var(--t3)" },
	{ tag: tags.labelName, color: "var(--t3)" },
	{ tag: tags.contentSeparator, color: "var(--t3)" },
]);

/**
 * Markdown 的语言支持。
 *
 * `language-data` 里登记的那条是无参 `markdown()`，只认严格 CommonMark：表格、任务列表
 * 这类 GFM 结构不出结构高亮，围栏代码块里的内容也不会按语言着色。这里自己登记一条，
 * 把 GFM 与「按 info 串找语言」都打开；扩展名与 `isMarkdownPath` 认的保持一致。
 */
const MARKDOWN = LanguageDescription.of({
	name: "Markdown",
	extensions: ["md", "markdown", "mkd"],
	load: () =>
		import("@codemirror/lang-markdown").then((module) =>
			module.markdown({ base: module.markdownLanguage, codeLanguages: languages }),
		),
});

export interface CodeSurfaceProps {
	/** 文件内容 */
	text: string;
	/** 文件名，用来推断语言 */
	path: string;
	/** 只读 */
	readOnly?: boolean;
	/** 内容变动，编辑态给 */
	onChange?: (text: string) => void;
	/** 编辑器就绪，宿主可以拿它做定位 */
	onReady?: (view: EditorView) => void;
	/** Mod+S 保存，编辑态给 */
	onSaveShortcut?: () => void;
}

/** 按文件名找语言，找不到时按纯文本。 */
function languageFor(path: string): LanguageDescription | null {
	if (isMarkdownPath(path)) {
		return MARKDOWN;
	}
	return LanguageDescription.matchFilename(languages, path);
}

export function CodeSurface({
	text,
	path,
	readOnly = true,
	onChange,
	onReady,
	onSaveShortcut,
}: CodeSurfaceProps) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView | undefined>(undefined);
	/** 语言与只读各占一个隔间，换内容时不重建视图 */
	const languageSlot = useRef(new Compartment());
	const readOnlySlot = useRef(new Compartment());
	const themeSlot = useRef(new Compartment());
	/** 内容与回调只在建视图时读一次 */
	const initialText = useRef(text);
	/** 建视图时的只读状态，后续切换走隔间 */
	const initialReadOnly = useRef(readOnly);
	const changeHandler = useRef(onChange);
	changeHandler.current = onChange;
	const readyHandler = useRef(onReady);
	readyHandler.current = onReady;
	const saveHandler = useRef(onSaveShortcut);
	saveHandler.current = onSaveShortcut;

	useEffect(() => {
		const element = host.current;
		if (element === null) {
			return;
		}
		const created = new EditorView({
			parent: element,
			state: EditorState.create({
				doc: initialText.current,
				extensions: [
					lineNumbers(),
					history(),
					drawSelection(),
					doubleClickSelection,
					indentOnInput(),
					bracketMatching(),
					foldGutter(),
					syntaxHighlighting(HIGHLIGHT_STYLE),
					themeSlot.current.of(editorTheme(readEditorPalette())),
					readOnlySlot.current.of([
						EditorState.readOnly.of(initialReadOnly.current),
						EditorView.editable.of(!initialReadOnly.current),
					]),
					languageSlot.current.of([]),
					EditorView.lineWrapping,
					keymap.of([
						{
							key: "Mod-s",
							preventDefault: true,
							run: () => {
								saveHandler.current?.();
								return true;
							},
						},
						...searchKeymap,
						indentWithTab,
						...defaultKeymap,
						...historyKeymap,
					]),
					EditorView.updateListener.of((update) => {
						if (update.docChanged) {
							changeHandler.current?.(update.state.doc.toString());
						}
					}),
				],
			}),
		});
		view.current = created;
		readyHandler.current?.(created);
		const onZoom = (): void => {
			created.requestMeasure();
		};
		window.addEventListener("facet:zoom-changed", onZoom);
		// 字体与字号是 CSS 变量，CodeMirror 不会自己跟着变，换外观时重配一次主题
		const onAppearance = (): void => {
			created.dispatch({ effects: themeSlot.current.reconfigure(editorTheme(readEditorPalette())) });
			created.requestMeasure();
		};
		window.addEventListener("facet:appearance-changed", onAppearance);
		return () => {
			window.removeEventListener("facet:zoom-changed", onZoom);
			window.removeEventListener("facet:appearance-changed", onAppearance);
			created.destroy();
			view.current = undefined;
		};
		// 视图只建一次：内容、语言与只读都通过事务与隔间更新，不重建编辑器
	}, []);

	// 内容被外部替换（重新加载、切文件）时整体换一次文档
	useEffect(() => {
		const current = view.current;
		if (current === undefined || current.state.doc.toString() === text) {
			return;
		}
		current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: text } });
	}, [text]);

	// 换文件时按文件名加载语言包，加载完插进语言隔间
	useEffect(() => {
		const description = languageFor(path);
		if (description === null) {
			view.current?.dispatch({ effects: languageSlot.current.reconfigure([]) });
			return;
		}
		let cancelled = false;
		void description.load().then(
			(support) => {
				if (!cancelled) {
					view.current?.dispatch({ effects: languageSlot.current.reconfigure(support) });
				}
			},
			() => undefined,
		);
		return () => {
			cancelled = true;
		};
	}, [path]);

	// 只读与编辑来回切时只重配这一个隔间
	useEffect(() => {
		view.current?.dispatch({
			effects: readOnlySlot.current.reconfigure([
				EditorState.readOnly.of(readOnly),
				EditorView.editable.of(!readOnly),
			]),
		});
	}, [readOnly]);

	return <div className="code-surface" ref={host} />;
}
