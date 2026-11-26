/**
 * `@文件` 补全。
 *
 * 打在行首或空白之后的 `@` 会把后面这段当作查询，列出当前工作区里匹配的文件；选中之后
 * 把 `@查询` 换成胶囊，并在后面补一个空格，接着写正文。代码块里不弹：
 * 那里面的 `@Override`、`@Component` 是装饰器，不是文件。
 *
 * 菜单挂成 `.composer` 外框的直接子节点，与 `/` 命令面板（`.cmd-pop`）贴在同一处：
 * 浮在输入区正上方、与输入框等宽，也因此不会被编辑区的滚动裁切。
 * 菜单开着的时候，输入区的键盘拦截要让出回车、方向键、Tab 与 Esc——它们在这里消费。
 */
import {
	LexicalTypeaheadMenuPlugin,
	MenuOption,
	type MenuRenderFn,
	type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import {
	$createTextNode,
	$getSelection,
	$isRangeSelection,
	type LexicalEditor,
	type LexicalNode,
	type TextNode,
} from "lexical";
import { type ReactNode, type RefObject, useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileSymbolIcon } from "../../common/FileSymbolIcon.tsx";
import { useI18n } from "../../i18n/I18nProvider.tsx";
import { OptionList } from "../OptionList.tsx";
import { $createFileMentionNode, fileBasename, fileDirname } from "./file-mention-node.ts";

/** 一次最多列几条候选：再多就得靠继续打字收窄，列表本身不滚。 */
export const MAX_MENTION_OPTIONS = 10;

/** 候选排序：文件名前缀命中优先，其次文件名包含，最后整条路径包含。 */
export function rankMentionFiles(files: readonly string[], query: string): string[] {
	const needle = query.trim().toLowerCase();
	const prefix: string[] = [];
	const nameHit: string[] = [];
	const pathHit: string[] = [];
	for (const path of files) {
		const name = fileBasename(path).toLowerCase();
		if (needle.length === 0 || name.startsWith(needle)) {
			prefix.push(path);
		} else if (name.includes(needle)) {
			nameHit.push(path);
		} else if (path.toLowerCase().includes(needle)) {
			pathHit.push(path);
		}
	}
	return [...prefix, ...nameHit, ...pathHit].slice(0, MAX_MENTION_OPTIONS);
}

/**
 * 光标前的 `@` 触发。
 *
 * 只认行首或空白之后的 `@`：`a@b.com` 这种邮箱里的不算。查询里允许出现 `/`（路径）和
 * `.`（扩展名），只到空白或第二个 `@` 为止。
 */
export function mentionTrigger(textBeforeCursor: string): MenuTextMatch | null {
	const match = /(^|\s)@([^\s@]*)$/.exec(textBeforeCursor);
	if (match === null) {
		return null;
	}
	const query = match[2] ?? "";
	return {
		leadOffset: (match.index ?? 0) + (match[1]?.length ?? 0),
		matchingString: query,
		replaceableString: `@${query}`,
	};
}

/** 光标是不是在代码块里：那里面 `@` 多半是装饰器或注释，不该弹补全。 */
function $isCaretInCode(): boolean {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) {
		return true;
	}
	let current: LexicalNode | null = selection.anchor.getNode();
	while (current !== null) {
		if (current.getType() === "code") {
			return true;
		}
		current = current.getParent();
	}
	return false;
}

/** 一条候选：一条文件路径。键用完整路径，同名文件不会撞键。 */
class FileMentionOption extends MenuOption {
	/** 项目根下的相对路径 */
	readonly path: string;

	constructor(path: string) {
		super(path);
		this.path = path;
	}
}

/** 候选菜单的参数。 */
interface MentionMenuProps {
	/** 菜单挂载的容器：`.composer` 外框本身 */
	container: HTMLElement;
	/** 候选，已经排好序 */
	options: FileMentionOption[];
	/** 键盘高亮的那一条 */
	selectedIndex: number | null;
	/** 选中一条 */
	onSelect: (option: FileMentionOption) => void;
	/** 指针移上去时同步高亮 */
	onHighlight: (index: number) => void;
	/** 读屏用的名字 */
	label: string;
}

/**
 * 候选菜单。
 *
 * 挂成 `.composer` 的直接子节点，和 `/` 命令面板（`.cmd-pop`）同一套定位：贴在输入区外框
 * 正上方、与输入框等宽。挂在编辑器外面才不会被 `.composer-editor` 的 `overflow-y` 裁掉，
 * 也就用不着跟着光标算坐标、更不用翻转。行与高亮跟随滚动都交给 `OptionList`。
 */
function MentionMenu({
	container,
	options,
	selectedIndex,
	onSelect,
	onHighlight,
	label,
}: MentionMenuProps): ReactNode {
	if (options.length === 0) {
		return null;
	}

	return createPortal(
		<OptionList
			className="composer-mention-pop"
			label={label}
			items={options}
			keyOf={(option) => option.key}
			activeIndex={selectedIndex}
			onHighlight={onHighlight}
			onPick={onSelect}
			rowProps={(option, { index }) => ({
				// 与 LexicalMenu 写在根节点上的 `aria-activedescendant` 同名
				id: `typeahead-item-${index}`,
				ref: option.setRefElement,
				// 别把焦点从输入区抢走：选区还在编辑器里，选中候选才有地方落
				onMouseDown: (event) => event.preventDefault(),
			})}
			renderRow={(option) => (
				<>
					<FileSymbolIcon name={option.path} className="cmd-file-icon" />
					<span className="cmd-name">{fileBasename(option.path)}</span>
					<span className="cmd-desc">{fileDirname(option.path)}</span>
				</>
			)}
		/>,
		container,
	);
}

/** `@文件` 补全的参数。 */
export interface FileMentionPluginProps {
	/** 可引用的文件：项目根下的相对路径 */
	files: readonly string[];
	/** 菜单开合：输入区据此让出回车、方向键、Tab 与 Esc */
	onOpenChange?: ((open: boolean) => void) | undefined;
	/** 菜单挂载的容器（`.composer` 外框）；没有它就没有定位参照，菜单不渲染 */
	menuContainerRef?: RefObject<HTMLElement | null> | undefined;
}

/** `@文件` 补全。 */
export function FileMentionPlugin({
	files,
	onOpenChange,
	menuContainerRef,
}: FileMentionPluginProps): ReactNode {
	const { t } = useI18n();
	const [query, setQuery] = useState<string | null>(null);

	const options = useMemo(
		() => (query === null ? [] : rankMentionFiles(files, query).map((path) => new FileMentionOption(path))),
		[files, query],
	);

	/** 触发：`@` 在行首或空白之后，且光标不在代码里。 */
	const triggerFn = useCallback((text: string, _editor: LexicalEditor) => {
		if ($isCaretInCode()) {
			return null;
		}
		return mentionTrigger(text);
	}, []);

	/** 选中：把 `@查询` 换成胶囊，后面补一个空格，光标落在空格之后。 */
	const onSelectOption = useCallback(
		(option: FileMentionOption, textNodeContainingQuery: TextNode | null, closeMenu: () => void) => {
			if (textNodeContainingQuery !== null) {
				const mention = $createFileMentionNode(option.path);
				textNodeContainingQuery.replace(mention);
				const space = $createTextNode(" ");
				mention.insertAfter(space);
				space.select();
			}
			closeMenu();
		},
		[],
	);

	const menuRenderFn = useCallback<MenuRenderFn<FileMentionOption>>(
		// 不用插件给的光标锚点：菜单挂在输入区外框里，位置由 CSS 定
		(_anchorElementRef, { options: shown, selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
			const container = menuContainerRef?.current;
			if (container === null || container === undefined) {
				return null;
			}
			return (
				<MentionMenu
					container={container}
					options={shown}
					selectedIndex={selectedIndex}
					onSelect={selectOptionAndCleanUp}
					onHighlight={setHighlightedIndex}
					label={t("composer.fileMentionList")}
				/>
			);
		},
		[menuContainerRef, t],
	);

	return (
		<LexicalTypeaheadMenuPlugin<FileMentionOption>
			triggerFn={triggerFn}
			options={options}
			onQueryChange={setQuery}
			onSelectOption={onSelectOption}
			onOpen={() => onOpenChange?.(true)}
			onClose={() => onOpenChange?.(false)}
			menuRenderFn={menuRenderFn}
		/>
	);
}
