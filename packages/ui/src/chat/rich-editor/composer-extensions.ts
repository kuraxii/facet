/**
 * CodeMirror 6 输入区扩展装配：快捷键、换行列表续写、历史回溯、纯文本粘贴与点击胶囊。
 */
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { type Compartment, EditorState, Prec, Transaction } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import type { RefObject } from "react";
import { isComposingKey } from "../../keys.ts";
import { type HistoryNavState, stepHistoryDown, stepHistoryUp } from "../history-nav.ts";
import type { ActiveAutocomplete, AutocompleteHandle } from "./ComposerAutocomplete.tsx";
import { composerDecorationsExtension } from "./composer-decorations.ts";
import { mentionTrigger, slashTrigger } from "./composer-triggers.ts";
import { computeListNewlineEdit } from "./list-continuation.ts";

/** 发送键位路由。 */
export interface ComposerKeyRoutes {
	/** 此刻能不能发送 */
	canSend: boolean;
	/** true 表示 Shift+回车才是发送键位 */
	shiftEnterToSend: boolean;
	/** 发出当前内容 */
	onSend: () => void;
}

/** `ComposerEditor` 供 CM6 回调读取的动态上下文快照。 */
export interface ComposerEditorRuntime {
	routes: ComposerKeyRoutes;
	files: ReadonlySet<string>;
	knownCommands: ReadonlySet<string>;
	hasFiles: boolean;
	hasCommands: boolean;
	history: readonly string[];
	onOpenMentionFile: ((filePath: string) => void) | undefined;
	onDocChange: (nextText: string) => void;
	onStateChange: (state: EditorState, docChanged: boolean, selectionSet: boolean) => void;
}

/** 供编辑器创建 `EditorState` 时传入的可变引用与隔间。 */
export interface CreateComposerStateInput {
	readonly docText: string;
	readonly placeholder: string;
	readonly clickable: boolean;
	readonly contentAttrsSlot: Compartment;
	readonly runtimeRef: RefObject<ComposerEditorRuntime>;
	readonly autocompleteRef: RefObject<AutocompleteHandle | null>;
	readonly navStateRef: RefObject<HistoryNavState>;
	readonly importedHistoryRef: RefObject<string | null>;
}

export function detectAutocomplete(
	state: EditorState,
	files: ReadonlySet<string>,
	knownCommands: ReadonlySet<string>,
	hasFiles: boolean,
	hasCommands: boolean,
): ActiveAutocomplete {
	const sel = state.selection.main;
	if (!sel.empty) {
		return null;
	}
	const head = sel.head;
	if (hasCommands) {
		const match = slashTrigger(state.sliceDoc(0, head), head, knownCommands);
		if (match !== null) {
			return { kind: "command", match };
		}
	}
	if (hasFiles) {
		const line = state.doc.lineAt(head);
		const match = mentionTrigger(line.text.slice(0, head - line.from), head);
		if (match !== null && (match.query.length === 0 || files.size > 0)) {
			return { kind: "mention", match };
		}
	}
	return null;
}

export function contentAttributesFor(placeholder: string, clickable: boolean): Record<string, string> {
	return {
		class: clickable ? "composer-editor is-mention-clickable" : "composer-editor",
		"aria-label": placeholder,
		"aria-multiline": "true",
		spellcheck: "false",
	};
}

function handleAutocompleteKey(event: KeyboardEvent, ac: AutocompleteHandle): boolean {
	if (event.key === "ArrowUp") {
		event.preventDefault();
		ac.moveSelection(-1);
		return true;
	}
	if (event.key === "ArrowDown") {
		event.preventDefault();
		ac.moveSelection(1);
		return true;
	}
	if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
		event.preventDefault();
		return ac.confirmSelection();
	}
	if (event.key === "Escape") {
		event.preventDefault();
		ac.dismiss();
		return true;
	}
	return false;
}

function handleEnterKey(event: KeyboardEvent, view: EditorView, routes: ComposerKeyRoutes): boolean {
	const isSendCombo = routes.shiftEnterToSend ? event.shiftKey : !event.shiftKey;
	if (isSendCombo) {
		event.preventDefault();
		if (!event.repeat && routes.canSend) {
			routes.onSend();
		}
		return true;
	}
	event.preventDefault();
	const sel = view.state.selection.main;
	if (sel.empty) {
		const line = view.state.doc.lineAt(sel.head);
		const before = line.text.slice(0, sel.head - line.from);
		const after = line.text.slice(sel.head - line.from);
		const listEdit = computeListNewlineEdit(before, after);
		if (listEdit !== undefined) {
			const from = line.from + listEdit.replaceFromLineOffset;
			const to = line.from + listEdit.replaceToLineOffset;
			view.dispatch({
				changes: { from, to, insert: listEdit.insert },
				selection: { anchor: from + listEdit.insert.length },
				userEvent: "input",
			});
			return true;
		}
	}
	view.dispatch(view.state.replaceSelection("\n"), { userEvent: "input" });
	return true;
}

function handleHistoryArrow(
	event: KeyboardEvent,
	view: EditorView,
	input: Pick<CreateComposerStateInput, "runtimeRef" | "navStateRef" | "importedHistoryRef">,
): boolean {
	if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
		return false;
	}
	const docText = view.state.doc.toString();
	const sel = view.state.selection.main;
	const nav = input.navStateRef.current;
	const historyList = input.runtimeRef.current.history;

	const step =
		event.key === "ArrowUp"
			? (nav.index === null && docText.trim().length > 0) ||
				(nav.index !== null && view.state.doc.lineAt(sel.head).number !== 1)
				? undefined
				: stepHistoryUp(nav, historyList, docText)
			: nav.index === null || view.state.doc.lineAt(sel.head).number !== view.state.doc.lines
				? undefined
				: stepHistoryDown(nav, historyList);

	if (step === undefined || step.text === null) {
		return false;
	}
	event.preventDefault();
	input.navStateRef.current = step.state;
	input.importedHistoryRef.current = step.text;
	view.dispatch({
		changes: { from: 0, to: docText.length, insert: step.text },
		selection: { anchor: step.text.length },
		annotations: Transaction.addToHistory.of(false),
	});
	return true;
}

/** 创建一个完整配置好的 CM6 `EditorState`。 */
export function createComposerEditorState(input: CreateComposerStateInput): EditorState {
	const runtime = input.runtimeRef.current;
	return EditorState.create({
		doc: input.docText,
		selection: { anchor: input.docText.length },
		extensions: [
			history(),
			drawSelection(),
			keymap.of([...defaultKeymap, ...historyKeymap]),
			EditorView.lineWrapping,
			input.contentAttrsSlot.of(
				EditorView.contentAttributes.of(contentAttributesFor(input.placeholder, input.clickable)),
			),
			composerDecorationsExtension({ files: runtime.files, knownCommands: runtime.knownCommands }),
			Prec.highest(
				EditorView.domEventHandlers({
					keydown: (event, view) => {
						if (view.composing || isComposingKey(event)) {
							return false;
						}
						const ac = input.autocompleteRef.current;
						if (ac?.isOpen) {
							return handleAutocompleteKey(event, ac);
						}
						if (event.key === "Enter") {
							return handleEnterKey(event, view, input.runtimeRef.current.routes);
						}
						if (event.key === "ArrowUp" || event.key === "ArrowDown") {
							return handleHistoryArrow(event, view, input);
						}
						return false;
					},
					paste: (event, view) => {
						const data = event.clipboardData;
						if (data === null || data.files.length > 0) {
							return false;
						}
						const text = data.getData("text/plain");
						if (text.length === 0) {
							return false;
						}
						event.preventDefault();
						view.dispatch(view.state.replaceSelection(text.replace(/\r\n?/g, "\n")), {
							userEvent: "input.paste",
						});
						return true;
					},
					click: (event, view) => {
						const open = input.runtimeRef.current.onOpenMentionFile;
						if (open === undefined || !(event.target instanceof HTMLElement)) {
							return false;
						}
						const filePath = event.target.closest<HTMLElement>(".composer-mention")?.dataset.filePath;
						if (filePath !== undefined && view.state.selection.main.empty) {
							open(filePath);
						}
						return false;
					},
				}),
			),
			EditorView.updateListener.of((update) => {
				input.runtimeRef.current.onStateChange(update.state, update.docChanged, update.selectionSet);
				if (update.docChanged) {
					input.runtimeRef.current.onDocChange(update.state.doc.toString());
				}
			}),
		],
	});
}
