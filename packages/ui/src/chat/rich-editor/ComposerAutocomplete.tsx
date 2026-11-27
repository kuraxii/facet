/**
 * 输入区的 `@文件` 与 `/命令` 补全浮层。
 *
 * 复用 `OptionList` 并挂在 `.composer` 外框上（与输入域等宽、不被滚动裁切），只接收
 * 从编辑器提取出的当前触发匹配与选区信息，在选中后回调把原文片段替换成胶囊文本。
 */
import type { SlashCommand } from "@facet/protocol";
import {
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { FileSymbolIcon } from "../../common/FileSymbolIcon.tsx";
import { useI18n } from "../../i18n/I18nProvider.tsx";
import { useHoverTip } from "../../tip.tsx";
import { filterCommands, isFacetCommand, SOURCE_LABEL_KEYS } from "../command-palette.ts";
import { OptionList } from "../OptionList.tsx";
import { fileBasename, fileDirname, rankMentionFiles, type TriggerMatch } from "./composer-triggers.ts";

/** 当前激活的补全类型与触发区间。 */
export type ActiveAutocomplete =
	| { readonly kind: "command"; readonly match: TriggerMatch }
	| { readonly kind: "mention"; readonly match: TriggerMatch }
	| null;

/** 供编辑器键盘拦截调用的补全控制句柄。 */
export interface AutocompleteHandle {
	/** 当前是否有候选浮层正在展示 */
	readonly isOpen: boolean;
	/** 上下移动高亮 */
	moveSelection: (delta: -1 | 1) => void;
	/** 确认选中当前高亮项 */
	confirmSelection: () => boolean;
	/** 关闭当前触发（直到光标或文档再次变化） */
	dismiss: () => void;
}

export interface ComposerAutocompleteProps {
	/** 当前检测到的触发状态 */
	trigger: ActiveAutocomplete;
	/** 可用命令列表 */
	commands: readonly SlashCommand[];
	/** 可用文件列表 */
	mentionFiles: readonly string[];
	/** 挂载浮层的容器（`.composer` 外框） */
	menuContainerRef?: RefObject<HTMLElement | null> | undefined;
	/** 执行内置命令 */
	onRunCommand?: ((command: SlashCommand, args: string) => void) | undefined;
	/** 将文档区间的触发文本替换为选中的文本 */
	onApplyText: (from: number, to: number, insert: string) => void;
	/** 控制句柄 */
	handleRef: RefObject<AutocompleteHandle | null>;
}

/** `@文件` 与 `/命令` 补全浮层。 */
export function ComposerAutocomplete({
	trigger,
	commands,
	mentionFiles,
	menuContainerRef,
	onRunCommand,
	onApplyText,
	handleRef,
}: ComposerAutocompleteProps): ReactNode {
	const { t } = useI18n();
	const tip = useHoverTip();
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [dismissedKey, setDismissedKey] = useState<string | null>(null);

	const triggerKey = trigger === null ? null : `${trigger.kind}:${trigger.match.from}:${trigger.match.query}`;

	const commandOptions = useMemo(() => {
		if (trigger?.kind !== "command") {
			return [];
		}
		return filterCommands(commands, trigger.match.query);
	}, [commands, trigger]);

	const mentionOptions = useMemo(() => {
		if (trigger?.kind !== "mention") {
			return [];
		}
		return rankMentionFiles(mentionFiles, trigger.match.query);
	}, [mentionFiles, trigger]);

	const count = trigger?.kind === "command" ? commandOptions.length : mentionOptions.length;
	const isOpen = trigger !== null && count > 0 && dismissedKey !== triggerKey;

	// 每次触发内容变化时把高亮复位到第一条，并在非同类触发时清掉关闭记忆
	useEffect(() => {
		setSelectedIndex(0);
		if (triggerKey === null) {
			setDismissedKey(null);
		} else if (dismissedKey !== null && dismissedKey !== triggerKey) {
			setDismissedKey(null);
		}
	}, [dismissedKey, triggerKey]);

	const activeIndex = count === 0 ? 0 : Math.min(selectedIndex, count - 1);

	const pickCommand = useCallback(
		(command: SlashCommand): void => {
			if (trigger?.kind !== "command") {
				return;
			}
			if (isFacetCommand(command)) {
				onApplyText(trigger.match.from, trigger.match.to, "");
				onRunCommand?.(command, "");
				return;
			}
			onApplyText(trigger.match.from, trigger.match.to, `/${command.name} `);
		},
		[onApplyText, onRunCommand, trigger],
	);

	const pickMention = useCallback(
		(filePath: string): void => {
			if (trigger?.kind !== "mention") {
				return;
			}
			onApplyText(trigger.match.from, trigger.match.to, `@${filePath} `);
		},
		[onApplyText, trigger],
	);

	useImperativeHandle(
		handleRef,
		() => ({
			isOpen,
			moveSelection: (delta) => {
				if (count === 0) {
					return;
				}
				setSelectedIndex((current) => (current + delta + count) % count);
			},
			confirmSelection: () => {
				if (!isOpen || trigger === null) {
					return false;
				}
				if (trigger.kind === "command") {
					const chosen = commandOptions[activeIndex];
					if (chosen === undefined) {
						return false;
					}
					pickCommand(chosen);
					return true;
				}
				const chosen = mentionOptions[activeIndex];
				if (chosen === undefined) {
					return false;
				}
				pickMention(chosen);
				return true;
			},
			dismiss: () => {
				setDismissedKey(triggerKey);
			},
		}),
		[
			isOpen,
			count,
			activeIndex,
			commandOptions,
			mentionOptions,
			trigger,
			triggerKey,
			pickCommand,
			pickMention,
		],
	);

	const container = menuContainerRef?.current;
	if (!isOpen || trigger === null || container === null || container === undefined) {
		return null;
	}

	if (trigger.kind === "command") {
		return createPortal(
			<>
				<OptionList
					label={t("composer.commandList")}
					items={commandOptions}
					keyOf={(command) => `${command.source}:${command.name}`}
					activeIndex={activeIndex}
					onHighlight={setSelectedIndex}
					onPick={(command) => pickCommand(command)}
					rowProps={(command, { index }) => ({
						id: `typeahead-item-${index}`,
						onMouseDown: (event) => event.preventDefault(),
						...tip.handlers(command.origin),
					})}
					renderRow={(command) => (
						<>
							<span className="cmd-name">/{command.name}</span>
							{command.argumentHint === undefined ? null : (
								<span className="cmd-hint">{command.argumentHint}</span>
							)}
							<span className="cmd-desc">{command.description ?? ""}</span>
							<span className="cmd-source">{t(SOURCE_LABEL_KEYS[command.source])}</span>
						</>
					)}
				/>
				{tip.render()}
			</>,
			container,
		);
	}

	return createPortal(
		<OptionList
			className="composer-mention-pop"
			label={t("composer.fileMentionList")}
			items={mentionOptions}
			keyOf={(path) => path}
			activeIndex={activeIndex}
			onHighlight={setSelectedIndex}
			onPick={(path) => pickMention(path)}
			rowProps={(_path, { index }) => ({
				id: `typeahead-item-${index}`,
				onMouseDown: (event) => event.preventDefault(),
			})}
			renderRow={(path) => (
				<>
					<FileSymbolIcon name={path} className="cmd-file-icon" />
					<span className="cmd-name">{fileBasename(path)}</span>
					<span className="cmd-desc">{fileDirname(path)}</span>
				</>
			)}
		/>,
		container,
	);
}
