/**
 * 代码面。
 *
 * 用 CodeMirror 6 画只读或可编辑的文件内容：行号、语法高亮、括号匹配、当前行、搜索面板与
 * 折叠。语言按文件名推断，语言包按需加载，加载期间先按纯文本显示；语言与只读都放在
 * compartment 里，切文件或切换编辑态时只重配这两样，不重建整个编辑器。
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
import { Compartment, EditorState } from "@codemirror/state";
import {
	drawSelection,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { editorTheme, readEditorPalette } from "./editor-theme.ts";

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
]);

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
}

/** 按文件名找语言，找不到时按纯文本。 */
function languageFor(path: string): LanguageDescription | null {
	return LanguageDescription.matchFilename(languages, path);
}

export function CodeSurface({ text, path, readOnly = true, onChange, onReady }: CodeSurfaceProps) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView | undefined>(undefined);
	/** 语言与只读各占一个隔间，换内容时不重建视图 */
	const languageSlot = useRef(new Compartment());
	const readOnlySlot = useRef(new Compartment());
	/** 内容与回调只在建视图时读一次 */
	const initialText = useRef(text);
	/** 建视图时的只读状态，后续切换走隔间 */
	const initialReadOnly = useRef(readOnly);
	const changeHandler = useRef(onChange);
	changeHandler.current = onChange;
	const readyHandler = useRef(onReady);
	readyHandler.current = onReady;

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
					highlightActiveLineGutter(),
					history(),
					drawSelection(),
					indentOnInput(),
					bracketMatching(),
					foldGutter(),
					highlightActiveLine(),
					syntaxHighlighting(HIGHLIGHT_STYLE),
					editorTheme(readEditorPalette()),
					readOnlySlot.current.of([
						EditorState.readOnly.of(initialReadOnly.current),
						EditorView.editable.of(!initialReadOnly.current),
					]),
					languageSlot.current.of([]),
					EditorView.lineWrapping,
					keymap.of([...searchKeymap, indentWithTab, ...defaultKeymap, ...historyKeymap]),
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
		return () => {
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
