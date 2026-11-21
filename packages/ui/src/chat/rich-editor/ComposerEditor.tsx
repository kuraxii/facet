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

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import {
	$createParagraphNode,
	$createTextNode,
	$insertNodes,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_NORMAL,
	type EditorThemeClasses,
	KEY_ARROW_DOWN_COMMAND,
	KEY_ARROW_UP_COMMAND,
	KEY_ENTER_COMMAND,
	KEY_ESCAPE_COMMAND,
	KEY_TAB_COMMAND,
	mergeRegister,
	PASTE_COMMAND,
	type PasteCommandType,
} from "lexical";
import {
	type ReactNode,
	type Ref,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { isComposingKey } from "../../keys.ts";
import {
	$importComposerMarkdown,
	CHAT_TRANSFORMERS,
	COMPOSER_NODES,
	exportComposerMarkdown,
	importComposerMarkdown,
} from "./markdown-config.ts";

/**
 * 编辑器的样式类名。
 *
 * 只给结构性节点取类名：粗体与斜体由浏览器原生的 `strong` / `em` 表现，免得同一段文字
 * 在不同主题下有两套观感。
 */
const COMPOSER_THEME: EditorThemeClasses = {
	paragraph: "composer-paragraph",
	quote: "composer-quote",
	code: "composer-code-block",
	list: {
		ul: "composer-list",
		ol: "composer-list",
		listitem: "composer-list-item",
	},
	text: {
		code: "composer-inline-code",
	},
	link: "composer-link",
};

/** 命令面板与会话状态的按键落点：这些状态都在 `Composer` 里，编辑器只负责把按键送过去。 */
export interface ComposerKeyRoutes {
	/** 命令候选面板此刻是否开着 */
	isPaletteOpen: boolean;
	/** 移动高亮项：+1 下移，-1 上移 */
	onPaletteMove: (step: 1 | -1) => void;
	/** 选中当前高亮项 */
	onPalettePick: () => void;
	/** 收起面板（Esc） */
	onPaletteClose: () => void;
	/** 此刻能不能发送 */
	canSend: boolean;
	/** true 表示 Shift+回车才是发送键位 */
	shiftEnterToSend: boolean;
	/** 发出当前内容 */
	onSend: () => void;
}

/** 富文本输入域的参数。 */
export interface ComposerEditorProps {
	/** 当前内容的 Markdown 写法 */
	value: string;
	/** 内容变化之后给出新的 Markdown */
	onChange: (value: string) => void;
	/** 占位符文案，同时作为输入域的 `aria-label` */
	placeholder: string;
	/** 命令面板与发送的按键落点 */
	routes: ComposerKeyRoutes;
	/** 输入域本身。引用之类的动作要把光标放回末尾，所以把它交给调用方。 */
	ref?: Ref<HTMLElement>;
}

/**
 * 外来改值时重新铺内容。
 *
 * 用布局效应而不是普通效应：切换会话时编辑器里还留着上一个会话的草稿，晚一帧就会让人看见
 * 一瞬旧内容。
 */
function ValueSyncPlugin({ value, lastEmitted }: { value: string; lastEmitted: RefObject<string> }): null {
	const [editor] = useLexicalComposerContext();
	useLayoutEffect(() => {
		if (value === lastEmitted.current) {
			return;
		}
		lastEmitted.current = value;
		importComposerMarkdown(editor, value);
	}, [editor, lastEmitted, value]);
	return null;
}

/** 面板开着时上下键只移动高亮，不动光标。 */
function movePalette(routes: RefObject<ComposerKeyRoutes>, event: KeyboardEvent, step: 1 | -1): boolean {
	if (isComposingKey(event) || !routes.current.isPaletteOpen) {
		return false;
	}
	event.preventDefault();
	routes.current.onPaletteMove(step);
	return true;
}

/**
 * 键盘与输入法。
 *
 * 命令都注册在 `COMMAND_PRIORITY_HIGH`：回车与方向键在富文本里自带默认行为（新建段落、
 * 列表内上下换条目、被编辑器吃掉），面板开着的时候必须先由这里接住，接不住再放行。
 */
function KeyboardPlugin({ routes }: { routes: ComposerKeyRoutes }): null {
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
					// 组词期间的回车是选词，不是发送，也不是选中命令
					if (event !== null && isComposingKey(event)) {
						return false;
					}
					if (current.isPaletteOpen) {
						// 面板开着时回车与 Tab 都是「选中这一条」，Shift+回车仍然是换行
						if (event !== null && !event.shiftKey) {
							event.preventDefault();
							current.onPalettePick();
							return true;
						}
						return false;
					}
					if (event === null) {
						return false;
					}
					const isSendCombo = current.shiftEnterToSend ? event.shiftKey : !event.shiftKey;
					if (!isSendCombo) {
						return false;
					}
					// 发送键位即使此刻发不出去也不换行：空白内容不该因为按了回车多出一行
					event.preventDefault();
					if (current.canSend) {
						current.onSend();
					}
					return true;
				},
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand<KeyboardEvent>(
				KEY_ARROW_UP_COMMAND,
				(event) => movePalette(routesRef, event, -1),
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand<KeyboardEvent>(
				KEY_ARROW_DOWN_COMMAND,
				(event) => movePalette(routesRef, event, 1),
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand<KeyboardEvent>(
				KEY_TAB_COMMAND,
				(event) => {
					if (isComposingKey(event)) {
						return false;
					}
					const current = routesRef.current;
					// Shift+Tab 是反向遍历焦点，任何时候都交给浏览器
					if (!current.isPaletteOpen || event.shiftKey) {
						return false;
					}
					event.preventDefault();
					current.onPalettePick();
					return true;
				},
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand<KeyboardEvent>(
				KEY_ESCAPE_COMMAND,
				(event) => {
					const current = routesRef.current;
					if (!current.isPaletteOpen) {
						return false;
					}
					event.preventDefault();
					current.onPaletteClose();
					return true;
				},
				COMMAND_PRIORITY_HIGH,
			),
		);
	}, [editor]);

	return null;
}

/** 读出粘贴事件里的剪贴板；不是剪贴板事件时为空。 */
function pastedData(event: PasteCommandType): DataTransfer | null {
	if (!("clipboardData" in event)) {
		return null;
	}
	return event.clipboardData ?? null;
}

/** 把一段纯文本按行铺进光标处，每行一个段落。 */
function $insertPlainText(text: string): void {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	$insertNodes(
		lines.map((line) => {
			const paragraph = $createParagraphNode();
			if (line.length > 0) {
				paragraph.append($createTextNode(line));
			}
			return paragraph;
		}),
	);
}

/**
 * 纯文本粘贴。
 *
 * 从浏览器或文档里复制的内容带着字号、背景色、行内样式，直接落进编辑器会把输入区染得
 * 花花绿绿；输入区只认自己的样式，所以一律按纯文本插入。
 *
 * 剪贴板里有文件时什么都不做：图片附件的入口在输入区容器上（拖拽与粘贴都走同一处），
 * 编辑器不该把图片当文字吃掉。
 */
function PlainPastePlugin(): null {
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
				$insertPlainText(text);
				return true;
			},
			COMMAND_PRIORITY_NORMAL,
		);
	}, [editor]);

	return null;
}

/** 富文本输入域。 */
export function ComposerEditor({
	value,
	onChange,
	placeholder,
	routes,
	ref,
}: ComposerEditorProps): ReactNode {
	/** 最近一次与外界对齐过的 Markdown；初值取挂载时的内容，首屏不必再导入一次 */
	const lastEmitted = useRef(value);

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
			$importComposerMarkdown(value);
		},
	}));

	const handleChange = useCallback(
		(markdown: string) => {
			if (markdown === lastEmitted.current) {
				return;
			}
			lastEmitted.current = markdown;
			onChange(markdown);
		},
		[onChange],
	);

	return (
		<LexicalComposer initialConfig={initialConfig}>
			<RichTextPlugin
				contentEditable={
					<ContentEditable
						ref={ref as Ref<HTMLDivElement>}
						className="composer-editor"
						aria-label={placeholder}
						aria-multiline="true"
						spellCheck={false}
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
			<HistoryPlugin />
			<ListPlugin />
			<MarkdownShortcutPlugin transformers={CHAT_TRANSFORMERS} />
			<OnChangePlugin
				ignoreSelectionChange
				onChange={(state) => handleChange(exportComposerMarkdown(state))}
			/>
			<ValueSyncPlugin value={value} lastEmitted={lastEmitted} />
			<KeyboardPlugin routes={routes} />
			<PlainPastePlugin />
		</LexicalComposer>
	);
}
