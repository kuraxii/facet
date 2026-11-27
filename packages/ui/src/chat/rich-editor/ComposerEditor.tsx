/**
 * 基于 CodeMirror 6 的聊天输入区编辑器。
 *
 * 底层真值始终是纯文本字符串，不渲染复杂 Markdown 块、不转义任何字符；仅将文首 `/命令`
 * 与文中 `@文件` 渲染为原子胶囊装饰，并在行首有序/无序列表按下换行时自动续写编号或退出。
 */
import { Compartment, type EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SlashCommand } from "@facet/protocol";
import {
	type ReactNode,
	type Ref,
	type RefObject,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { type HistoryNavState, normalizeHistory, resetHistoryNav } from "../history-nav.ts";
import {
	type ActiveAutocomplete,
	type AutocompleteHandle,
	ComposerAutocomplete,
} from "./ComposerAutocomplete.tsx";
import { setDecorationConfig } from "./composer-decorations.ts";
import {
	type ComposerEditorRuntime,
	type ComposerKeyRoutes,
	contentAttributesFor,
	createComposerEditorState,
	detectAutocomplete,
} from "./composer-extensions.ts";
import { appendQuoteText } from "./composer-triggers.ts";

export type { ComposerKeyRoutes } from "./composer-extensions.ts";

/** 输入区对外的命令式句柄。 */
export interface ComposerHandle {
	/** 聚焦输入区 */
	focus: () => void;
	/** 把一段文字做成引用拼到末尾，光标落到新一行 */
	appendQuote: (text: string) => void;
	/** 把光标放到内容末尾 */
	placeCaretAtEnd: () => void;
	/** 在光标处插一枚 `@文件` 胶囊文本，光标落在它后面的空格里 */
	insertMention: (filePath: string) => void;
}

/** 输入域参数。 */
export interface ComposerEditorProps {
	/** 当前内容文本 */
	value: string;
	/** 内容变化后给出最新文本 */
	onChange: (value: string) => void;
	/** 占位符文案，同时作为输入域的 `aria-label` */
	placeholder: string;
	/** 发送按键落点 */
	routes: ComposerKeyRoutes;
	/** 输入区可以触发的命令 */
	commands?: readonly SlashCommand[];
	/** 选中一条界面自己处理的命令 */
	onRunCommand?: ((command: SlashCommand, args: string) => void) | undefined;
	/** 可 `@` 引用的文件路径 */
	mentionFiles?: readonly string[];
	/** 当前草稿的键（会话文件），撤销栈按它隔离保存 */
	draftKey?: string;
	/** 点 `@文件` 胶囊时打开对应文件 */
	onOpenMentionFile?: ((filePath: string) => void) | undefined;
	/** 当前会话里已发消息，从旧到新：`↑`/`↓` 按它回溯 */
	sentHistory?: readonly string[];
	/** 补全菜单挂载容器（`.composer` 外框） */
	menuContainerRef?: RefObject<HTMLElement | null>;
	/** 对外命令式句柄 */
	handleRef?: Ref<ComposerHandle>;
	/** 底层 EditorView 实例，供单测或程序化交互使用 */
	editorRef?: RefObject<EditorView | null>;
}

const DRAFT_HISTORY_LIMIT = 50;
const DEFAULT_DRAFT_KEY = "facet.composer.default";
const EMPTY_COMMANDS: readonly SlashCommand[] = [];
const EMPTY_FILES: readonly string[] = [];
const EMPTY_HISTORY: readonly string[] = [];

function sameAutocomplete(a: ActiveAutocomplete, b: ActiveAutocomplete): boolean {
	if (a === b) {
		return true;
	}
	if (a === null || b === null || a.kind !== b.kind) {
		return false;
	}
	return a.match.from === b.match.from && a.match.to === b.match.to && a.match.query === b.match.query;
}

/** 聊天输入区编辑器。 */
export function ComposerEditor({
	value,
	onChange,
	placeholder,
	routes,
	commands = EMPTY_COMMANDS,
	onRunCommand,
	mentionFiles = EMPTY_FILES,
	draftKey,
	onOpenMentionFile,
	sentHistory = EMPTY_HISTORY,
	menuContainerRef,
	handleRef,
	editorRef,
}: ComposerEditorProps): ReactNode {
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const stateCacheRef = useRef(new Map<string, EditorState>());
	const activeDraftKeyRef = useRef(draftKey ?? DEFAULT_DRAFT_KEY);
	const lastEmittedRef = useRef(value);
	const importedHistoryRef = useRef<string | null>(null);
	const navStateRef = useRef<HistoryNavState>(resetHistoryNav());
	const autocompleteRef = useRef<AutocompleteHandle | null>(null);
	const contentAttrsSlot = useRef(new Compartment());
	/** 从文件树拖拽插进来的文件引用，即使尚未出现在 mentionFiles 里也保持胶囊显示 */
	const extraFilesRef = useRef(new Set<string>());

	const [trigger, setTrigger] = useState<ActiveAutocomplete>(null);

	const files = useMemo(() => {
		if (extraFilesRef.current.size === 0) {
			return new Set(mentionFiles);
		}
		return new Set([...mentionFiles, ...extraFilesRef.current]);
	}, [mentionFiles]);
	const knownCommands = useMemo(() => new Set(commands.map((command) => command.name)), [commands]);
	const normalizedHistory = useMemo(() => normalizeHistory(sentHistory), [sentHistory]);

	const refreshTrigger = useCallback(
		(
			state: EditorState,
			nextFiles: ReadonlySet<string>,
			nextCommands: ReadonlySet<string>,
			hasFiles: boolean,
			hasCommands: boolean,
		) => {
			const next = detectAutocomplete(state, nextFiles, nextCommands, hasFiles, hasCommands);
			setTrigger((current) => (sameAutocomplete(current, next) ? current : next));
		},
		[],
	);

	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	const runtimeRef = useRef<ComposerEditorRuntime>({
		routes,
		files,
		knownCommands,
		hasFiles: mentionFiles.length > 0,
		hasCommands: commands.length > 0,
		history: normalizedHistory,
		onOpenMentionFile,
		onDocChange: (nextText) => {
			if (nextText === lastEmittedRef.current) {
				return;
			}
			lastEmittedRef.current = nextText;
			if (nextText === importedHistoryRef.current) {
				importedHistoryRef.current = null;
			} else {
				navStateRef.current = resetHistoryNav();
			}
			onChangeRef.current(nextText);
		},
		onStateChange: (state, docChanged, selectionSet) => {
			stateCacheRef.current.set(activeDraftKeyRef.current, state);
			if (docChanged || selectionSet) {
				const cur = runtimeRef.current;
				refreshTrigger(state, cur.files, cur.knownCommands, cur.hasFiles, cur.hasCommands);
			}
		},
	});
	runtimeRef.current.routes = routes;
	runtimeRef.current.files = files;
	runtimeRef.current.knownCommands = knownCommands;
	runtimeRef.current.hasFiles = mentionFiles.length > 0;
	runtimeRef.current.hasCommands = commands.length > 0;
	runtimeRef.current.history = normalizedHistory;
	runtimeRef.current.onOpenMentionFile = onOpenMentionFile;

	// 挂载唯一 EditorView 实例，并按会话 key 缓存撤销栈
	// biome-ignore lint/correctness/useExhaustiveDependencies: 视图只在挂载时创建一次，后续通过 dispatch/setState 同步
	useLayoutEffect(() => {
		const host = hostRef.current;
		if (host === null) {
			return;
		}
		const initialKey = draftKey ?? DEFAULT_DRAFT_KEY;
		activeDraftKeyRef.current = initialKey;
		const initialState = createComposerEditorState({
			docText: value,
			placeholder,
			clickable: onOpenMentionFile !== undefined,
			contentAttrsSlot: contentAttrsSlot.current,
			runtimeRef,
			autocompleteRef,
			navStateRef,
			importedHistoryRef,
		});
		stateCacheRef.current.set(initialKey, initialState);
		const view = new EditorView({ state: initialState, parent: host });
		viewRef.current = view;
		if (editorRef !== undefined) {
			editorRef.current = view;
		}
		return () => {
			if (editorRef !== undefined) {
				editorRef.current = null;
			}
			viewRef.current = null;
			view.destroy();
		};
	}, []);

	// 切换草稿键时切换或创建对应会话的 EditorState（保留各自撤销栈）
	// biome-ignore lint/correctness/useExhaustiveDependencies: 仅在 draftKey 切换时换状态；同会话 value 变化由下方同步效应接管
	useLayoutEffect(() => {
		const view = viewRef.current;
		if (view === null) {
			return;
		}
		const nextKey = draftKey ?? DEFAULT_DRAFT_KEY;
		if (activeDraftKeyRef.current === nextKey) {
			return;
		}
		activeDraftKeyRef.current = nextKey;
		navStateRef.current = resetHistoryNav();
		importedHistoryRef.current = null;
		lastEmittedRef.current = value;

		const cache = stateCacheRef.current;
		const existing = cache.get(nextKey);
		let nextState: EditorState;
		if (existing !== undefined && existing.doc.toString() === value) {
			cache.delete(nextKey);
			cache.set(nextKey, existing);
			nextState = existing;
		} else {
			nextState = createComposerEditorState({
				docText: value,
				placeholder,
				clickable: onOpenMentionFile !== undefined,
				contentAttrsSlot: contentAttrsSlot.current,
				runtimeRef,
				autocompleteRef,
				navStateRef,
				importedHistoryRef,
			});
			cache.set(nextKey, nextState);
			for (const oldest of cache.keys()) {
				if (cache.size <= DRAFT_HISTORY_LIMIT) {
					break;
				}
				cache.delete(oldest);
			}
		}
		view.setState(nextState);
		view.dispatch({
			effects: [
				setDecorationConfig.of({ files, knownCommands }),
				contentAttrsSlot.current.reconfigure(
					EditorView.contentAttributes.of(contentAttributesFor(placeholder, onOpenMentionFile !== undefined)),
				),
			],
		});
		refreshTrigger(view.state, files, knownCommands, mentionFiles.length > 0, commands.length > 0);
	}, [draftKey]);

	// 同一会话下的外部改值同步进文档
	useLayoutEffect(() => {
		const view = viewRef.current;
		if (view === null || value === lastEmittedRef.current) {
			return;
		}
		lastEmittedRef.current = value;
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: value },
			selection: { anchor: value.length },
			annotations: Transaction.addToHistory.of(false),
		});
	}, [value]);

	// 占位符、点击态或目录/命令清单变化时重配视图扩展
	useEffect(() => {
		const view = viewRef.current;
		if (view === null) {
			return;
		}
		view.dispatch({
			effects: [
				setDecorationConfig.of({ files, knownCommands }),
				contentAttrsSlot.current.reconfigure(
					EditorView.contentAttributes.of(contentAttributesFor(placeholder, onOpenMentionFile !== undefined)),
				),
			],
		});
		refreshTrigger(view.state, files, knownCommands, mentionFiles.length > 0, commands.length > 0);
	}, [
		commands.length,
		files,
		knownCommands,
		mentionFiles.length,
		onOpenMentionFile,
		placeholder,
		refreshTrigger,
	]);

	const applyAutocompleteText = useCallback((from: number, to: number, insert: string) => {
		const view = viewRef.current;
		if (view === null) {
			return;
		}
		view.dispatch({
			changes: { from, to, insert },
			selection: { anchor: from + insert.length },
			userEvent: "input.complete",
		});
	}, []);

	useImperativeHandle(
		handleRef,
		() => ({
			focus: () => viewRef.current?.focus(),
			placeCaretAtEnd: () => {
				const view = viewRef.current;
				if (view === null) {
					return;
				}
				view.focus();
				view.dispatch({ selection: { anchor: view.state.doc.length } });
			},
			appendQuote: (text: string) => {
				const view = viewRef.current;
				if (view === null) {
					return;
				}
				view.focus();
				const next = appendQuoteText(view.state.doc.toString(), text);
				view.dispatch({
					changes: { from: 0, to: view.state.doc.length, insert: next },
					selection: { anchor: next.length },
					userEvent: "input",
				});
			},
			insertMention: (filePath: string) => {
				const view = viewRef.current;
				if (view === null) {
					return;
				}
				extraFilesRef.current.add(filePath);
				const mergedFiles = new Set([...runtimeRef.current.files, filePath]);
				runtimeRef.current.files = mergedFiles;
				view.focus();
				const text = `@${filePath} `;
				const sel = view.state.selection.main;
				view.dispatch({
					changes: { from: sel.from, to: sel.to, insert: text },
					selection: { anchor: sel.from + text.length },
					effects: setDecorationConfig.of({
						files: mergedFiles,
						knownCommands: runtimeRef.current.knownCommands,
					}),
					userEvent: "input",
				});
			},
		}),
		[],
	);

	return (
		<>
			<div ref={hostRef} className="composer-cm-host" />
			{value.length === 0 ? (
				<div className="composer-placeholder" aria-hidden="true">
					{placeholder}
				</div>
			) : null}
			<ComposerAutocomplete
				trigger={trigger}
				commands={commands}
				mentionFiles={mentionFiles}
				menuContainerRef={menuContainerRef}
				onRunCommand={onRunCommand}
				onApplyText={applyAutocompleteText}
				handleRef={autocompleteRef}
			/>
		</>
	);
}
