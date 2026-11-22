/**
 * 输入区的富文本编辑器。
 *
 * 对外仍然是一个受控组件：`value` 是一段 Markdown，用户改完之后把新的 Markdown 交给
 * `onChange`。草稿、本地保存、发送协议与发送确认的比较都还是那段字符串，换掉的只是中间
 * 这层输入体验。
 *
 * 受控的要点是一份影子值：用户改出来的 Markdown 记在 `lastEmitted` 里，父级随后回传的
 * `value` 与它相等就不必再铺回编辑器；只有真正的外来改值（切换会话、清空草稿、引用正文、
 * 回退、重试、扩展写入）才会重新导入内容并把光标放到末尾。
 */

import type { SlashCommand } from "@facet/protocol";
import { $isCodeNode } from "@lexical/code";
import { PrismTokenizer, registerCodeHighlighting } from "@lexical/code-prism";
import { $generateNodesFromMarkdownString } from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { EditorRefPlugin } from "@lexical/react/LexicalEditorRefPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import {
	createEmptyHistoryState,
	HistoryPlugin,
	type HistoryState,
} from "@lexical/react/LexicalHistoryPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { $createQuoteNode, $isQuoteNode, type QuoteNode } from "@lexical/rich-text";
import {
	$createLineBreakNode,
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$insertNodes,
	$isElementNode,
	$isLineBreakNode,
	$isRangeSelection,
	$isRootNode,
	$isTextNode,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_LOW,
	COMMAND_PRIORITY_NORMAL,
	FORMAT_TEXT_COMMAND,
	KEY_ARROW_DOWN_COMMAND,
	KEY_ARROW_UP_COMMAND,
	KEY_BACKSPACE_COMMAND,
	KEY_ENTER_COMMAND,
	KEY_TAB_COMMAND,
	type LexicalEditor,
	type LexicalNode,
	mergeRegister,
	PASTE_COMMAND,
	type PasteCommandType,
	type RangeSelection,
} from "lexical";
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
import { isComposingKey } from "../../keys.ts";
import {
	type HistoryNavState,
	normalizeHistory,
	resetHistoryNav,
	stepHistoryDown,
	stepHistoryUp,
} from "../history-nav.ts";
import { FileMentionPlugin } from "./FileMentionPlugin.tsx";
import { $createFileMentionNode } from "./file-mention-node.ts";
import {
	$exportComposerMarkdown,
	$importComposerMarkdown,
	$restoreFileMentions,
	$restoreSlashCommands,
	CHAT_TRANSFORMERS,
	COMPOSER_NODES,
	COMPOSER_THEME,
	exportComposerMarkdown,
	importComposerMarkdown,
} from "./markdown-config.ts";
import { SlashCommandPlugin } from "./SlashCommandPlugin.tsx";

/** 发送相关的按键落点与状态：这些都在 `Composer` 里，编辑器只负责把按键送过去。 */
export interface ComposerKeyRoutes {
	/** 此刻能不能发送 */
	canSend: boolean;
	/** true 表示 Shift+回车才是发送键位 */
	shiftEnterToSend: boolean;
	/** 发出当前内容 */
	onSend: () => void;
}

/**
 * 输入区对外的命令式句柄。
 *
 * 引用正文这类动作要往编辑器里插结构（引用块 + 后面的新段落），字符串拼接再整份重载
 * 会把光标位置和撤销历史一起丢掉，所以这里直接把动作交给编辑器。
 */
export interface ComposerHandle {
	/** 聚焦输入区 */
	focus: () => void;
	/** 把一段文字做成引用块接到末尾，光标落到引用下方的新段落里 */
	appendQuote: (text: string) => void;
	/** 把光标放到内容末尾 */
	placeCaretAtEnd: () => void;
	/** 在光标处插一枚 `@文件` 胶囊，光标落在它后面的空格里 */
	insertMention: (filePath: string) => void;
}

/** 富文本输入域的参数。 */
export interface ComposerEditorProps {
	/** 当前内容的 Markdown 写法 */
	value: string;
	/** 内容变化之后给出新的 Markdown */
	onChange: (value: string) => void;
	/** 占位符文案，同时作为输入域的 `aria-label` */
	placeholder: string;
	/** 发送的按键落点 */
	routes: ComposerKeyRoutes;
	/** 输入区可以触发的命令；`/` 面板从这里取候选 */
	commands?: readonly SlashCommand[];
	/** 选中一条界面自己处理的命令 */
	onRunCommand?: ((command: SlashCommand, args: string) => void) | undefined;
	/** 可 `@` 引用的文件：项目根下的相对路径。空列表时 `@` 不弹菜单 */
	mentionFiles?: readonly string[];
	/**
	 * 当前草稿的键（会话文件）。撤销栈按它分开保存，切走再切回来还能接着撤销；
	 * 不传时所有内容共用一份默认栈。
	 */
	draftKey?: string;
	/** 点 `@文件` 胶囊要打开的文件：给了它，胶囊才带可点的样子 */
	onOpenMentionFile?: ((filePath: string) => void) | undefined;
	/** 当前会话里用户发过的文字，从旧到新：`↑`/`↓` 按它回溯 */
	sentHistory?: readonly string[];
	/** 两处补全菜单挂载的容器：输入区外框。菜单挂在它下面才和输入框同处、等宽 */
	menuContainerRef?: RefObject<HTMLElement | null>;
	/** 命令式句柄：引用正文之类的动作从外面调它 */
	handleRef?: Ref<ComposerHandle>;
	/**
	 * 编辑器实例。要往输入区里程序化地写内容、或在编辑器上派发命令时用它；用例也靠它在
	 * jsdom 里模拟输入（jsdom 没有原生编辑，写不进字符）。
	 */
	editorRef?: RefObject<LexicalEditor | null>;
}

/** 从节点往上找最近的某类祖先（含节点自己）。 */
function $nearestAncestor<T extends LexicalNode>(
	node: LexicalNode,
	matches: (candidate: LexicalNode) => candidate is T,
): T | null {
	let current: LexicalNode | null = node;
	while (current !== null) {
		if (matches(current)) {
			return current;
		}
		current = current.getParent();
	}
	return null;
}

/** 引用块里光标之前的文字；块内的换行是 `LineBreakNode`，按 `\n` 计。 */
function $textBeforeCaret(quote: QuoteNode, selection: RangeSelection): string {
	const anchor = selection.anchor;
	const node = anchor.getNode();
	if (node.is(quote)) {
		// 光标落在引用本身：按子节点下标取它前面的内容
		return quote
			.getChildren()
			.slice(0, anchor.offset)
			.map((child) => child.getTextContent())
			.join("");
	}
	const head = node
		.getPreviousSiblings()
		.map((sibling) => sibling.getTextContent())
		.join("");
	return head + ($isTextNode(node) ? node.getTextContent().slice(0, anchor.offset) : "");
}

/** 引用块里光标之后的文字，用来判断光标是不是停在末尾的空行上。 */
function $textAfterCaret(quote: QuoteNode, selection: RangeSelection): string {
	const anchor = selection.anchor;
	const node = anchor.getNode();
	if (node.is(quote)) {
		return quote
			.getChildren()
			.slice(anchor.offset)
			.map((child) => child.getTextContent())
			.join("");
	}
	const rest = $isTextNode(node) ? node.getTextContent().slice(anchor.offset) : "";
	const tail = node
		.getNextSiblings()
		.map((sibling) => sibling.getTextContent())
		.join("");
	return rest + tail;
}

/**
 * 退出引用：收掉末尾那个空行记号，在引用后面另起一个普通段落。
 *
 * 末行那个换行只是「再按一次就出去」的记号，留着它会让引用竖线白白拖出一行。
 */
function $exitQuote(quote: QuoteNode): void {
	const last = quote.getLastChild();
	if (last !== null && $isLineBreakNode(last)) {
		last.remove();
	}
	const paragraph = $createParagraphNode();
	quote.insertAfter(paragraph);
	// 引用里一个字也没留下时整块一并收掉，不留一条空竖线
	if (quote.getTextContent().trim().length === 0) {
		quote.remove();
	}
	paragraph.selectEnd();
}

/**
 * 引用块里按换行键：先续一行接着写，光标已经站在引用末尾那道空行上时退出引用。
 *
 * 「末尾那道空行」的判据要看光标两侧：前面紧挨着一个换行、后面一个字都不剩。只看最后
 * 一个子节点是不是换行不够——光标停在前面某一行时也会命中。
 */
function $handleQuoteNewline(quote: QuoteNode, selection: RangeSelection): void {
	const tailLine = $textBeforeCaret(quote, selection).endsWith("\n");
	if (tailLine && $textAfterCaret(quote, selection).length === 0) {
		$exitQuote(quote);
		return;
	}
	selection.insertLineBreak();
}

/**
 * 换行键位上落在引用里的块级处理：续一行，或者站在末尾空行上退出引用。
 *
 * 返回 false 表示这一下交给编辑器默认行为。
 */
function $newlineInBlock(selection: RangeSelection): boolean {
	const quote = $nearestAncestor(selection.anchor.getNode(), $isQuoteNode);
	if (quote === null) {
		return false;
	}
	$handleQuoteNewline(quote, selection);
	return true;
}

/**
 * 外来改值时重新铺内容。
 *
 * 用布局效应而不是普通效应：切换会话时编辑器里还留着上一个会话的草稿，晚一帧就会让人看见
 * 一瞬旧内容。
 */
function ValueSyncPlugin({
	value,
	files,
	knownCommands,
	historyState,
	lastEmitted,
}: {
	value: string;
	/** 已知文件：铺内容时把命中它们的 `@路径` 还原成胶囊 */
	files: ReadonlySet<string>;
	/** 已知命令：铺内容时把文首命中它们的 `/命令` 还原成胶囊 */
	knownCommands: ReadonlySet<string>;
	/** 当前草稿的撤销栈：铺完内容要给它一个基线，见下 */
	historyState: HistoryState;
	lastEmitted: RefObject<string>;
}): null {
	const [editor] = useLexicalComposerContext();
	useLayoutEffect(() => {
		if (value !== lastEmitted.current) {
			lastEmitted.current = value;
			importComposerMarkdown(editor, value, files, knownCommands);
		}
		/*
		 * 给这份撤销栈一个基线。
		 *
		 * Lexical 只在撤销栈已经有「当前状态」时才会把上一步压栈：一份全新的栈里，第一笔
		 * 编辑是撤不掉的。同一个会话切走再切回来时这里正好是刚铺进来的那一份内容，把它记成
		 * 起点，第一笔编辑就撤得回去，也撤不出别的会话的东西——铺内容那一下本身带
		 * `HISTORIC_TAG`，不进栈。
		 */
		if (historyState.current === null) {
			historyState.current = { editor, editorState: editor.getEditorState() };
		}
	}, [editor, files, historyState, knownCommands, lastEmitted, value]);
	return null;
}

/**
 * 键盘与输入法。
 *
 * 命令都注册在 `COMMAND_PRIORITY_HIGH`：回车与 Tab 在富文本里都有默认行为（新建段落、
 * 挪焦点），候选菜单开着的时候必须先在这里看清楚再决定放不放行——菜单自己的键盘处理挂在
 * `COMMAND_PRIORITY_LOW` 上，这里返回 false 才轮得到它。方向键归历史回溯那一层（`↑`/`↓`
 * 在空输入框里翻已发消息），它自己也会给菜单让路。
 */
function KeyboardPlugin({
	routes,
	isTypeaheadOpen,
}: {
	routes: ComposerKeyRoutes;
	/** 候选菜单（`/` 或 `@`）开着：回车、方向键、Tab 与 Esc 都归它 */
	isTypeaheadOpen: boolean;
}): null {
	const [editor] = useLexicalComposerContext();
	/** 按键回调里读最新的一份路由，避免父级每次重渲染都重注册一遍命令 */
	const routesRef = useRef(routes);
	useEffect(() => {
		routesRef.current = routes;
	}, [routes]);

	useEffect(() => {
		return mergeRegister(
			editor.registerCommand<KeyboardEvent | null>(
				KEY_ENTER_COMMAND,
				(event) => {
					const current = routesRef.current;
					// 组词期间的回车是选词，既不是发送也不是选中候选
					const composing = event !== null && isComposingKey(event);
					// 菜单开着时回车是选中候选，放行给菜单；组词期间的回车谁也别接
					if (isTypeaheadOpen) {
						return composing;
					}
					if (composing || event === null) {
						return false;
					}
					const isSendCombo = current.shiftEnterToSend ? event.shiftKey : !event.shiftKey;
					if (isSendCombo) {
						// 发送键位即使此刻发不出去也不换行：空白内容不该因为按了回车多出一行
						event.preventDefault();
						if (current.canSend) {
							current.onSend();
						}
						return true;
					}
					// 换行键位落在引用里：续一行或退出引用，而不是插一个空行
					const selection = $getSelection();
					if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
						return false;
					}
					if ($newlineInBlock(selection)) {
						event.preventDefault();
						return true;
					}
					return false;
				},
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand<KeyboardEvent>(
				KEY_BACKSPACE_COMMAND,
				(event) => {
					const selection = $getSelection();
					if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
						return false;
					}
					// 只接「光标在最开头」那一下：块内的普通删除照常交给编辑器
					if (selection.anchor.offset !== 0) {
						return false;
					}
					const quote = $nearestAncestor(selection.anchor.getNode(), $isQuoteNode);
					// 空的引用块在开头退格：退化成普通段落
					if (quote === null || quote.getTextContent().trim().length > 0) {
						return false;
					}
					event.preventDefault();
					const paragraph = $createParagraphNode();
					quote.replace(paragraph);
					paragraph.selectStart();
					return true;
				},
				COMMAND_PRIORITY_LOW,
			),
			editor.registerCommand<KeyboardEvent>(
				KEY_TAB_COMMAND,
				(event) => {
					if (isComposingKey(event)) {
						return false;
					}
					// 菜单开着：无 Shift 的 Tab 选中当前候选，交给菜单；Shift+Tab 不选，
					// 接管这一下但不拦默认行为，键盘的反向焦点链照走
					if (isTypeaheadOpen) {
						return event.shiftKey;
					}
					// 代码块里 Tab 是缩进；其它地方放行，保住键盘的焦点链
					if ($indentInCode(event)) {
						event.preventDefault();
						return true;
					}
					return false;
				},
				COMMAND_PRIORITY_HIGH,
			),
			/*
			 * 行内样式不在输入区的语法范围里：`⌘/Ctrl+B`、`⌘/Ctrl+I`、`⌘/Ctrl+U` 与任何走
			 * `FORMAT_TEXT_COMMAND` 的路径都在这里吃掉（返回 true 表示已处理）。文字不会变粗，
			 * 草稿里也就不会出现"只有样式、没有字符"的那层格式——输入区显示的就是要发出去的
			 * 原文，切会话铺回来也还是它。
			 */
			editor.registerCommand(FORMAT_TEXT_COMMAND, () => true, COMMAND_PRIORITY_HIGH),
		);
	}, [editor, isTypeaheadOpen]);

	return null;
}

/** 光标在它那个顶层块里是不是首行/末行。 */
interface LineEdges {
	/** 块内光标之前没有换行：这一行是块的首行 */
	first: boolean;
	/** 块内光标之后没有换行：这一行是块的末行 */
	last: boolean;
}

/** 直接挂在根下的那个块：段落、引用、代码块各算一个。 */
function $topLevelBlock(node: LexicalNode): LexicalNode | null {
	let current: LexicalNode | null = node;
	while (current !== null) {
		const parent = current.getParent();
		if (parent === null) {
			return null;
		}
		if ($isRootNode(parent)) {
			return current;
		}
		current = parent;
	}
	return null;
}

/**
 * 光标在它那个块里的首/末行。
 *
 * 块内的换行是 `LineBreakNode`（`getTextContent()` 里是 `\n`），把光标之前与之后的那两截
 * 文字收起来数换行就够了：前面没有换行就是首行，后面没有就是末行。顺序无关紧要，这里只问
 * 「有没有」。
 */
function $lineEdges(): LineEdges | null {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
		return null;
	}
	const anchor = selection.anchor;
	const node = anchor.getNode();
	const block = $topLevelBlock(node);
	if (block === null) {
		return null;
	}
	const head: string[] = [];
	const tail: string[] = [];
	let current: LexicalNode = node;
	let isAnchor = true;
	while (!current.is(block)) {
		if (isAnchor) {
			if ($isTextNode(current)) {
				const text = current.getTextContent();
				head.push(text.slice(0, anchor.offset));
				tail.push(text.slice(anchor.offset));
			} else if ($isElementNode(current)) {
				const children = current.getChildren();
				head.push(
					children
						.slice(0, anchor.offset)
						.map((child) => child.getTextContent())
						.join(""),
				);
				tail.push(
					children
						.slice(anchor.offset)
						.map((child) => child.getTextContent())
						.join(""),
				);
			}
			isAnchor = false;
		}
		head.push(...current.getPreviousSiblings().map((sibling) => sibling.getTextContent()));
		tail.push(...current.getNextSiblings().map((sibling) => sibling.getTextContent()));
		const parent = current.getParent();
		if (parent === null) {
			return null;
		}
		current = parent;
	}
	return {
		first: !head.join("").includes("\n"),
		last: !tail.join("").includes("\n"),
	};
}

/**
 * 光标是不是在整篇的第一行（或最后一行）。
 *
 * 除了块内位置，还要求光标所在的块就是根下的第一个（最后一个）块：第二段的开头在块内也是
 * 「首行」，但那时 `↑` 该先把光标挪到上一段去，而不是翻历史。
 */
function $caretAtDocumentEdge(edge: "first" | "last"): boolean {
	const edges = $lineEdges();
	if (edges === null) {
		return false;
	}
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) {
		return false;
	}
	const block = $topLevelBlock(selection.anchor.getNode());
	if (block === null) {
		return false;
	}
	const root = $getRoot();
	const edgeBlock = edge === "first" ? root.getFirstChild() : root.getLastChild();
	return block.is(edgeBlock) && (edge === "first" ? edges.first : edges.last);
}

/** 最多留几个会话的撤销栈：再多的从最久没碰过的那份开始丢。 */
const DRAFT_HISTORY_LIMIT = 50;

/** 没给草稿键时用的那一份撤销栈。 */
const DEFAULT_DRAFT_KEY = "facet.composer.default";

/**
 * 按草稿键取撤销栈。
 *
 * 一个会话一份 `HistoryState`：切走再切回来，撤销/重做还在原处。键在 `Map` 里的顺序就是
 * 淘汰顺序——用过就挪到队尾，超限时从队首丢；被丢掉的会话再切回来等于开一段新历史。
 *
 * 这份缓存故意放在渲染里维护：它只负责「同一个键拿到同一个对象」，与 React 的状态无关；
 * 挪进 `useEffect` 反而会让第一帧拿到别的实例，撤销栈与渲染出来的内容对不上。
 */
function useDraftHistoryState(draftKey: string | undefined): HistoryState {
	const states = useRef(new Map<string, HistoryState>());
	const key = draftKey ?? DEFAULT_DRAFT_KEY;
	const existing = states.current.get(key);
	if (existing !== undefined) {
		states.current.delete(key);
		states.current.set(key, existing);
		return existing;
	}
	const created = createEmptyHistoryState();
	states.current.set(key, created);
	for (const oldest of states.current.keys()) {
		if (states.current.size <= DRAFT_HISTORY_LIMIT) {
			break;
		}
		states.current.delete(oldest);
	}
	return created;
}

/** 历史回溯要用的东西：浏览态住在编辑器外层，铺内容与「这次不是用户改的」也由外层判定。 */
interface HistoryNavBridge {
	/** 已发消息，已去重，从旧到新 */
	history: readonly string[];
	/** 浏览态 */
	state: RefObject<HistoryNavState>;
	/** 正在铺的是回溯的结果：它带来的那一次 `onChange` 不算用户动手 */
	imported: RefObject<string | null>;
}

/**
 * `↑` / `↓` 的历史回溯。
 *
 * 判定顺序有讲究：浮层开着方向键就是选候选的，组词期间是输入法在选词，选中了文字是在调整
 * 选区——这三种都不许接管。剩下的才看位置：空输入框里 `↑` 直接翻最近一条；已经在浏览态里
 * 时，光标得走到块的首行（末行）才继续翻，否则先把光标在消息内部挪上去。
 */
function HistoryNavPlugin({
	bridge,
	files,
	knownCommands,
	isTypeaheadOpen,
}: {
	bridge: HistoryNavBridge;
	files: ReadonlySet<string>;
	knownCommands: ReadonlySet<string>;
	/** 候选菜单开着：方向键归它 */
	isTypeaheadOpen: boolean;
}): null {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		/** 把一条历史铺进编辑器，并记下「这一次不是用户改的」。 */
		const apply = (text: string): void => {
			bridge.imported.current = text;
			$importComposerMarkdown(text, files, knownCommands);
		};

		return mergeRegister(
			editor.registerCommand<KeyboardEvent>(
				KEY_ARROW_UP_COMMAND,
				(event) => {
					// 浮层开着：组词里的方向键要吞掉（它是输入法的），其余归浮层
					if (isTypeaheadOpen) {
						return isComposingKey(event);
					}
					if (isComposingKey(event)) {
						return false;
					}
					const text = $exportComposerMarkdown();
					const state = bridge.state.current;
					// 没在浏览态且已经写了字：这一下还是普通的光标上移
					if (state.index === null && text.trim().length > 0) {
						return false;
					}
					if (state.index !== null && !$caretAtDocumentEdge("first")) {
						return false;
					}
					const step = stepHistoryUp(state, bridge.history, text);
					if (step.text === null) {
						return false;
					}
					event.preventDefault();
					bridge.state.current = step.state;
					apply(step.text);
					return true;
				},
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand<KeyboardEvent>(
				KEY_ARROW_DOWN_COMMAND,
				(event) => {
					if (isTypeaheadOpen) {
						return isComposingKey(event);
					}
					if (isComposingKey(event) || bridge.state.current.index === null) {
						return false;
					}
					if (!$caretAtDocumentEdge("last")) {
						return false;
					}
					const step = stepHistoryDown(bridge.state.current, bridge.history);
					if (step.text === null) {
						return false;
					}
					event.preventDefault();
					bridge.state.current = step.state;
					apply(step.text);
					return true;
				},
				COMMAND_PRIORITY_HIGH,
			),
		);
	}, [bridge, editor, files, isTypeaheadOpen, knownCommands]);

	return null;
}

/** 代码块里按一次 Tab 缩进多少格。 */
const CODE_INDENT = "  ";

/**
 * 代码块里 Tab 缩进、Shift+Tab 反缩进。
 *
 * 只在「光标落在代码块里、且没有选中多行」时接：选中多行的那种整段缩进是代码缩进自己的
 * 一套，交给它；代码块之外一律放行，键盘的焦点链不能被输入区吃掉。
 */
function $indentInCode(event: KeyboardEvent): boolean {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
		return false;
	}
	const caret = selection.anchor.getNode();
	if ($nearestAncestor(caret, $isCodeNode) === null) {
		return false;
	}
	if (!event.shiftKey) {
		selection.insertText(CODE_INDENT);
		return true;
	}
	$outdentCodeLine(caret, selection);
	return true;
}

/** 撤掉当前代码行行首最多两格空格；光标跟着往前挪。 */
function $outdentCodeLine(caret: LexicalNode, selection: RangeSelection): void {
	if (!$isTextNode(caret)) {
		return;
	}
	// 一行是若干个文本节点：往前走，直到撞上换行或行首
	let first: LexicalNode = caret;
	while (true) {
		const previous = first.getPreviousSibling();
		if (previous === null || $isLineBreakNode(previous)) {
			break;
		}
		first = previous;
	}
	if (!$isTextNode(first)) {
		return;
	}
	const text = first.getTextContent();
	const strip = text.startsWith(CODE_INDENT) ? CODE_INDENT.length : text.startsWith(" ") ? 1 : 0;
	if (strip === 0) {
		return;
	}
	const offset = first.is(caret) ? Math.max(0, selection.anchor.offset - strip) : 0;
	first.setTextContent(text.slice(strip));
	if (first.is(caret)) {
		first.select(offset, offset);
	}
}

/** 读出粘贴事件里的剪贴板；不是剪贴板事件时为空。 */
function pastedData(event: PasteCommandType): DataTransfer | null {
	if (!("clipboardData" in event)) {
		return null;
	}
	return event.clipboardData ?? null;
}

/**
 * 把一段纯文本铺进光标处。
 *
 * 走的是和"切会话恢复草稿"同一个解析器：四类结构件（围栏代码块、引用块、`@文件`、`/命令`）
 * 该长成什么样就长成什么样，其余字符原样留着。这样贴一段提示词进来、把光标移走再切回来，
 * 两次看到的是同一份东西——粘贴不该是唯一一条"只当文字"的岔路。
 */
function $insertPastedText(
	text: string,
	files: ReadonlySet<string>,
	knownCommands: ReadonlySet<string>,
): void {
	// 先把 Windows 换行归一：导入侧按 `\n` 切行，留着 `\r` 会跑进正文
	const nodes = $generateNodesFromMarkdownString(text.replace(/\r\n?/g, "\n"), CHAT_TRANSFORMERS, true);
	$insertNodes(nodes);
	$restoreSlashCommands(knownCommands);
	$restoreFileMentions(files);
}

/**
 * 粘贴。
 *
 * 只取剪贴板里的 `text/plain`：从浏览器或文档里复制的内容带着字号、背景色、行内样式，
 * 直接落进编辑器会把输入区染得花花绿绿；输入区只认自己的样式。
 *
 * 剪贴板里有文件时什么都不做：图片附件的入口在输入区容器上（拖拽与粘贴都走同一处），
 * 编辑器不该把图片当文字吃掉。
 */
function PlainPastePlugin({
	files,
	knownCommands,
}: {
	/** 已知文件：贴进来的 `@路径` 命中它们时落成胶囊，与恢复草稿同一套判定 */
	files: ReadonlySet<string>;
	/** 已知命令：贴进来的文首 `/命令` 命中它们时落成胶囊 */
	knownCommands: ReadonlySet<string>;
}): null {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		return editor.registerCommand<PasteCommandType>(
			PASTE_COMMAND,
			(event) => {
				const data = pastedData(event);
				if (data === null || data.files.length > 0) {
					return false;
				}
				const text = data.getData("text/plain");
				if (text.length === 0) {
					return false;
				}
				event.preventDefault();
				$insertPastedText(text, files, knownCommands);
				return true;
			},
			COMMAND_PRIORITY_NORMAL,
		);
	}, [editor, files, knownCommands]);

	return null;
}

/** 富文本输入域。 */
export function ComposerEditor({
	value,
	onChange,
	placeholder,
	routes,
	commands = [],
	onRunCommand,
	mentionFiles = [],
	draftKey,
	onOpenMentionFile,
	sentHistory = [],
	menuContainerRef,
	handleRef,
	editorRef,
}: ComposerEditorProps): ReactNode {
	/** 最近一次与外界对齐过的 Markdown；初值取挂载时的内容，首屏不必再导入一次 */
	const lastEmitted = useRef(value);
	/** 当前草稿的撤销栈：每个会话一份，切回来还能接着撤销 */
	const historyState = useDraftHistoryState(draftKey);
	/** `↑`/`↓` 的浏览态 */
	const navState = useRef<HistoryNavState>(resetHistoryNav());
	/** 正在铺的那段是历史回溯的结果：它带来的 `onChange` 不算用户动手 */
	const importedHistory = useRef<string | null>(null);
	const history = useMemo(() => normalizeHistory(sentHistory), [sentHistory]);
	/** 三样东西都稳定：插件不必每敲一个字就重装一遍命令 */
	const navBridge = useMemo(() => ({ history, state: navState, imported: importedHistory }), [history]);

	// 换草稿就把浏览态清掉：上一个会话翻到一半的位次，与新会话的历史没有关系
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在换草稿时清一次，两个 ref 不在依赖里
	useEffect(() => {
		navState.current = resetHistoryNav();
		importedHistory.current = null;
	}, [draftKey]);
	/** `@` 文件菜单与 `/` 命令菜单各自的开合；任一开着，键盘就归它 */
	const [isMentionOpen, setMentionOpen] = useState(false);
	const [isCommandOpen, setCommandOpen] = useState(false);
	const isTypeaheadOpen = isMentionOpen || isCommandOpen;
	/** 已知文件，铺内容时把命中它们的 `@路径` 还原成胶囊 */
	const files = useMemo(() => new Set(mentionFiles), [mentionFiles]);
	/** 已知命令，铺内容时把文首命中它们的 `/命令` 还原成胶囊 */
	const knownCommands = useMemo(() => new Set(commands.map((command) => command.name)), [commands]);

	/**
	 * 初始内容同步铺进来：等一次效应落下去会让人看见一瞬空编辑框。
	 * 配置只读一次，所以用 `useState` 的惰性初值固定住挂载那一刻的内容。
	 */
	const [initialConfig] = useState(() => ({
		namespace: "facet-composer",
		nodes: COMPOSER_NODES,
		theme: COMPOSER_THEME,
		onError: (error: Error) => {
			// 编辑器自己恢复不了的错误不该炸掉整个界面：报到控制台，输入区继续可用
			console.error(error);
		},
		editorState: () => {
			$importComposerMarkdown(value, files, knownCommands);
		},
	}));

	const handleChange = useCallback(
		(markdown: string) => {
			if (markdown === lastEmitted.current) {
				return;
			}
			lastEmitted.current = markdown;
			// 回溯铺进来的这一趟不算用户动手，否则按完 `↓` 就再也翻不动了；
			// 其余任何改动都结束浏览态，别拿旧消息盖掉他刚写的东西
			if (markdown === importedHistory.current) {
				importedHistory.current = null;
			} else {
				navState.current = resetHistoryNav();
			}
			onChange(markdown);
		},
		[onChange],
	);

	return (
		<LexicalComposer initialConfig={initialConfig}>
			<RichTextPlugin
				contentEditable={
					<ContentEditable
						// 胶囊可点时给出指针与悬停提示，不可点时保持文字的手感
						className={
							onOpenMentionFile === undefined ? "composer-editor" : "composer-editor is-mention-clickable"
						}
						aria-label={placeholder}
						aria-multiline="true"
						spellCheck={false}
						onClick={(event) => {
							if (onOpenMentionFile === undefined) {
								return;
							}
							const target = event.target;
							if (!(target instanceof HTMLElement)) {
								return;
							}
							const filePath = target.closest<HTMLElement>(".composer-mention")?.dataset.filePath;
							// 正在拖选文字时不跳走：那一下的目的是选内容
							const selection = window.getSelection();
							if (filePath === undefined || (selection !== null && !selection.isCollapsed)) {
								return;
							}
							onOpenMentionFile(filePath);
						}}
					/>
				}
				// 占位符与 `aria-label` 说的是同一句话，读屏只念一次
				placeholder={
					<div className="composer-placeholder" aria-hidden="true">
						{placeholder}
					</div>
				}
				ErrorBoundary={LexicalErrorBoundary}
			/>
			{/* 撤销栈按草稿分开：切走再切回来，还能接着撤销自己那一份 */}
			<HistoryPlugin externalHistoryState={historyState} />
			<CodeHighlightPlugin />
			<MarkdownShortcutPlugin transformers={CHAT_TRANSFORMERS} />
			<OnChangePlugin
				ignoreSelectionChange
				onChange={(state) => handleChange(exportComposerMarkdown(state))}
			/>
			<ValueSyncPlugin
				value={value}
				files={files}
				knownCommands={knownCommands}
				historyState={historyState}
				lastEmitted={lastEmitted}
			/>
			<KeyboardPlugin routes={routes} isTypeaheadOpen={isTypeaheadOpen} />
			<HistoryNavPlugin
				bridge={navBridge}
				files={files}
				knownCommands={knownCommands}
				isTypeaheadOpen={isTypeaheadOpen}
			/>
			<PlainPastePlugin files={files} knownCommands={knownCommands} />
			{mentionFiles.length === 0 ? null : (
				<FileMentionPlugin
					files={mentionFiles}
					onOpenChange={setMentionOpen}
					menuContainerRef={menuContainerRef}
				/>
			)}
			{commands.length === 0 ? null : (
				<SlashCommandPlugin
					commands={commands}
					runCommand={onRunCommand}
					onOpenChange={setCommandOpen}
					menuContainerRef={menuContainerRef}
				/>
			)}
			{handleRef === undefined ? null : <HandlePlugin handleRef={handleRef} />}
			{editorRef === undefined ? null : <EditorRefPlugin editorRef={editorRef} />}
		</LexicalComposer>
	);
}

/**
 * 命令式句柄。
 *
 * 句柄要在 `LexicalComposer` 里面才拿得到编辑器，所以单开一层插件。`appendQuote` 走
 * `discrete` 更新：写进节点之后立刻是一次完整提交，`OnChangePlugin` 随之同步外部草稿，
 * 不需要再等一帧去挪光标——这也是它替代「字符串拼接 + `requestAnimationFrame`」的原因。
 */
function HandlePlugin({ handleRef }: { handleRef: Ref<ComposerHandle> }): null {
	const [editor] = useLexicalComposerContext();
	useImperativeHandle(
		handleRef,
		() => ({
			focus: () => {
				editor.focus();
			},
			placeCaretAtEnd: () => {
				// 先聚焦再选末尾：`focus()` 会先恢复上一次的选区，反过来的话光标会被拽回去
				editor.focus();
				editor.update(() => $getRoot().selectEnd(), { discrete: true });
			},
			appendQuote: (text: string) => {
				editor.focus();
				editor.update(() => $appendQuoteBlock(text), { discrete: true });
			},
			insertMention: (filePath: string) => {
				editor.focus();
				editor.update(() => $insertMentionAtCaret(filePath), { discrete: true });
			},
		}),
		[editor],
	);
	return null;
}

/**
 * 在光标处插一枚 `@文件` 胶囊，后面跟一个空格。
 *
 * 拖文件进来和 `@` 补全选一条是同一件事，落下来的样子也该一样：胶囊在前、空格在后、
 * 光标停在空格之后，接着写正文。
 */
function $insertMentionAtCaret(filePath: string): void {
	const mention = $createFileMentionNode(filePath);
	const space = $createTextNode(" ");
	const selection = $getSelection();
	if ($isRangeSelection(selection)) {
		selection.insertNodes([mention]);
		mention.insertAfter(space);
		space.select();
		return;
	}
	// 没有选区时（例如刚切进来还没点过）接到文档末尾
	const paragraph = $createParagraphNode().append(mention, space);
	$getRoot().append(paragraph);
	space.select();
}

/**
 * 一段文字做成引用块接到文档末尾。
 *
 * 逐行文本、行间是换行节点；后面跟一个空段落并选中它，光标直接落在引用下方，用户接着
 * 写自己的问题。文档里只有一个空段落时先清掉，引用块自成一篇。
 */
function $appendQuoteBlock(text: string): void {
	const root = $getRoot();
	const onlyEmpty =
		root.getChildrenSize() === 1 && (root.getFirstChild()?.getTextContent().trim().length ?? 0) === 0;
	if (onlyEmpty) {
		root.clear();
	}
	const quote = $createQuoteNode();
	const lines = text.replace(/\r\n?/g, "\n").replace(/\s+$/, "").split("\n");
	lines.forEach((line, index) => {
		if (index > 0) {
			quote.append($createLineBreakNode());
		}
		if (line.length > 0) {
			quote.append($createTextNode(line));
		}
	});
	root.append(quote);
	const paragraph = $createParagraphNode();
	root.append(paragraph);
	paragraph.select();
}

/**
 * 代码块的词法高亮：Prism 分词，颜色由主题里 `codeHighlight` 那些类给出。
 *
 * `defaultLanguage` 置空是必须的：默认会把它补成 `javascript` 并写进节点的 language，
 * 草稿是 Markdown 真值，一个没有语言的 ``` 围栏被补上语言就等于改写了用户的原文。
 * 想上色就在围栏上写语言（```ts），那条语言本来就属于草稿。
 */
function CodeHighlightPlugin(): null {
	const [editor] = useLexicalComposerContext();
	useEffect(() => registerCodeHighlighting(editor, { ...PrismTokenizer, defaultLanguage: null }), [editor]);
	return null;
}
