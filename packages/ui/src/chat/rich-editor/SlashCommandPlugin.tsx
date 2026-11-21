/**
 * `/命令` 补全。
 *
 * 在文档最开头打 `/` 会把后面这段当作查询，列出可触发的命令；选中之后，交给 pi 的命令换成
 * 一枚 `/名字` 胶囊（后面补一个空格，接着写参数），界面自己处理的那几条则清掉触发文本、
 * 直接执行。
 *
 * 触发位置卡得很死：只能是第一段的第一个子节点、光标停在它里面、并且这一段里光标之前只有
 * `/查询`。命令本来就只在文首生效（`parseCommand` 只看开头），放到第二行或代码块里长出一条
 * 面板，选完也不会有任何效果。也因此它和 `@文件` 补全不会同时弹：这边要求光标前是一整段
 * `/查询`（中间不夹空白），那边的 `@` 得紧跟在行首或空白之后，同一段文字不可能两边都成立。
 *
 * 菜单挂成 `.composer` 外框的直接子节点，与 `@文件` 菜单贴在同一处、共用 `OptionList`：
 * 浮在输入区正上方、与输入框等宽，不会被编辑区的滚动裁切。
 */

import type { SlashCommand } from "@facet/protocol";
import {
	LexicalTypeaheadMenuPlugin,
	MenuOption,
	type MenuRenderFn,
	type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import {
	$createTextNode,
	$getRoot,
	$getSelection,
	$isParagraphNode,
	$isRangeSelection,
	$isTextNode,
	type LexicalEditor,
	type TextNode,
} from "lexical";
import { type ReactNode, type RefObject, useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider.tsx";
import { type HoverTip, useHoverTip } from "../../tip.tsx";
import { filterCommands, isFacetCommand, SOURCE_LABEL_KEYS } from "../command-palette.ts";
import { OptionList } from "../OptionList.tsx";
import { $createSlashCommandNode } from "./slash-command-node.ts";

/** 光标前的 `/查询`：查询里没有空白，遇到空白就不再是命令。 */
export const SLASH_QUERY_PATTERN = /^\/([^\s]*)$/;

/**
 * 光标前的文本是不是一段命令查询。
 *
 * `leadOffset` 恒为 0：挂载点的位置由 CSS 定，这个偏移只被插件用来算查询在锚点里的起点，
 * 而这里查询就是从锚点开头开始的。
 */
export function slashTrigger(textBeforeCursor: string): MenuTextMatch | null {
	const match = SLASH_QUERY_PATTERN.exec(textBeforeCursor);
	if (match === null) {
		return null;
	}
	const query = match[1] ?? "";
	return { leadOffset: 0, matchingString: query, replaceableString: `/${query}` };
}

/**
 * 光标是不是停在「能打命令」的那一处：文档第一段的第一个子节点里、且不是行内代码。
 *
 * 第一个子节点是胶囊（已经选过一条命令）时也不成立：那时候光标在胶囊后面的空白里，
 * 再弹一次面板只会让人以为能连着选两条命令。
 */
function $caretAtCommandStart(): boolean {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
		return false;
	}
	if (selection.anchor.type !== "text") {
		return false;
	}
	const node = selection.anchor.getNode();
	// 行内代码里的 `/` 是命令行或路径
	if (!$isTextNode(node) || node.hasFormat("code") || node.getPreviousSibling() !== null) {
		return false;
	}
	const paragraph = node.getParent();
	return $isParagraphNode(paragraph) && $getRoot().getFirstChild()?.is(paragraph) === true;
}

/** 一条候选：一条命令。键用来源加名字，不同来源的同名命令不会撞键。 */
class SlashCommandOption extends MenuOption {
	/** 这条候选背后的命令 */
	readonly command: SlashCommand;

	constructor(command: SlashCommand) {
		super(`${command.source}:${command.name}`);
		this.command = command;
	}
}

/** 候选菜单的参数。 */
interface CommandMenuProps {
	/** 菜单挂载的容器：`.composer` 外框本身 */
	container: HTMLElement;
	/** 候选，已经按查询过滤好 */
	options: SlashCommandOption[];
	/** 键盘高亮的那一条 */
	selectedIndex: number | null;
	/** 选中一条 */
	onSelect: (option: SlashCommandOption) => void;
	/** 指针移上去时同步高亮 */
	onHighlight: (index: number) => void;
	/** 读屏用的名字 */
	label: string;
	/** 行的悬浮提示：命令来源写在提示里 */
	tip: HoverTip;
}

/** 候选菜单：行内容与 `/` 面板原来的四段一致，定位与滚动交给 `OptionList`。 */
function CommandMenu({
	container,
	options,
	selectedIndex,
	onSelect,
	onHighlight,
	label,
	tip,
}: CommandMenuProps): ReactNode {
	const { t } = useI18n();
	if (options.length === 0) {
		return null;
	}

	return createPortal(
		<>
			<OptionList
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
					...tip.handlers(option.command.origin),
				})}
				renderRow={(option) => (
					<>
						<span className="cmd-name">/{option.command.name}</span>
						{option.command.argumentHint === undefined ? null : (
							<span className="cmd-hint">{option.command.argumentHint}</span>
						)}
						<span className="cmd-desc">{option.command.description ?? ""}</span>
						<span className="cmd-source">{t(SOURCE_LABEL_KEYS[option.command.source])}</span>
					</>
				)}
			/>
			{tip.render()}
		</>,
		container,
	);
}

/** `/命令` 补全的参数。 */
export interface SlashCommandPluginProps {
	/** 可触发的命令 */
	commands: readonly SlashCommand[];
	/** 选中一条界面自己处理的命令 */
	runCommand?: ((command: SlashCommand, args: string) => void) | undefined;
	/** 菜单开合：输入区据此让出回车、方向键、Tab 与 Esc */
	onOpenChange?: ((open: boolean) => void) | undefined;
	/** 菜单挂载的容器（`.composer` 外框）；没有它就没有定位参照，菜单不渲染 */
	menuContainerRef?: RefObject<HTMLElement | null> | undefined;
}

/** `/命令` 补全。 */
export function SlashCommandPlugin({
	commands,
	runCommand,
	onOpenChange,
	menuContainerRef,
}: SlashCommandPluginProps): ReactNode {
	const { t } = useI18n();
	const tip = useHoverTip();
	const [query, setQuery] = useState<string | null>(null);

	const options = useMemo(
		() => (query === null ? [] : filterCommands(commands, query).map((item) => new SlashCommandOption(item))),
		[commands, query],
	);

	/** 触发：光标在文档最开头、查询是一段命令名，且至少有一条候选。 */
	const triggerFn = useCallback(
		(text: string, _editor: LexicalEditor) => {
			const match = slashTrigger(text);
			if (match === null || !$caretAtCommandStart()) {
				return null;
			}
			// 一条候选都没有时不弹空框：回车仍然是回车，Esc 也不该被菜单吃掉
			return filterCommands(commands, match.matchingString).length === 0 ? null : match;
		},
		[commands],
	);

	/**
	 * 选中：界面自己处理的命令清掉触发文本就地执行；交给 pi 的换成胶囊加一个空格。
	 *
	 * 清掉触发文本之后编辑器是空的，`OnChangePlugin` 会把空串交给外层，草稿跟着清空——
	 * 这就是「执行完不留痕迹」的来源，不必再单独发一次清空。
	 */
	const onSelectOption = useCallback(
		(option: SlashCommandOption, textNodeContainingQuery: TextNode | null, closeMenu: () => void) => {
			if (textNodeContainingQuery !== null) {
				if (isFacetCommand(option.command)) {
					textNodeContainingQuery.remove();
					runCommand?.(option.command, "");
				} else {
					const capsule = $createSlashCommandNode(option.command.name);
					textNodeContainingQuery.replace(capsule);
					const space = $createTextNode(" ");
					capsule.insertAfter(space);
					space.select();
				}
			}
			closeMenu();
		},
		[runCommand],
	);

	const menuRenderFn = useCallback<MenuRenderFn<SlashCommandOption>>(
		// 不用插件给的光标锚点：菜单挂在输入区外框里，位置由 CSS 定
		(_anchorElementRef, { options: shown, selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
			const container = menuContainerRef?.current;
			if (container === null || container === undefined) {
				return null;
			}
			return (
				<CommandMenu
					container={container}
					options={shown}
					selectedIndex={selectedIndex}
					onSelect={selectOptionAndCleanUp}
					onHighlight={setHighlightedIndex}
					label={t("composer.commandList")}
					tip={tip}
				/>
			);
		},
		[menuContainerRef, t, tip],
	);

	return (
		<LexicalTypeaheadMenuPlugin<SlashCommandOption>
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
