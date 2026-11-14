/**
 * 输入区。
 *
 * 输入框、发送与停止，以及当前模型与思考档位两个芯片。模型芯片按提供方分组列出可选模型，
 * 思考芯片只列出当前模型支持的档位；两个芯片都能把当前选择存成新建会话的默认值。
 * 动作行右侧是上下文用量环与发送按钮，用量环点开有具体数值和手动压缩入口。
 * 附件与引用还没有实现，按钮保持可见但不可点。
 */
import type { ChatActivity } from "@facet/client-core";
import type { ContextUsage, ModelInfo, SlashCommand, ThinkingLevel } from "@facet/protocol";
import { Brain, FileUp, ImagePlus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronIcon } from "../transcript/chevron.tsx";
import { SendIcon, StopIcon } from "../transcript/icons.tsx";
import { ContextRing, usageDetailText, usageLabel, usagePercentText } from "./ContextRing.tsx";
import { commandQuery, filterCommands, isFacetCommand, SOURCE_LABELS } from "./command-palette.ts";

/** 输入区参数。 */
export interface ComposerProps {
	/** 输入内容 */
	value: string;
	/** 输入变化 */
	onChange: (value: string) => void;
	/** 发送当前内容 */
	onSend: () => void;
	/** 停止运行 */
	onStop: () => void;
	/** 对话此刻的状态 */
	activity: ChatActivity;
	/** 当前模型 */
	model: ModelInfo | undefined;
	/** 当前思考档位 */
	thinkingLevel: ThinkingLevel | undefined;
	/** 当前模型可选的档位 */
	thinkingLevels?: readonly ThinkingLevel[];
	/** 可选模型，按提供方分组展示；缺省时模型芯片只展示 */
	models?: readonly ModelInfo[];
	/** 提供方是否已配置凭证，键为提供方 id */
	providerAuth?: Readonly<Record<string, boolean>>;
	/** 切换当前会话的模型 */
	onModelChange?: (model: ModelInfo) => void;
	/** 切换当前会话的思考档位 */
	onThinkingLevelChange?: (level: ThinkingLevel) => void;
	/** 发送键位：true 表示 Shift+回车发送 */
	shiftEnterToSend?: boolean;
	/** 现在能不能发送：断开、只读、压缩中、停止中等情况下给出 true，按钮禁用，不额外显示说明 */
	isBlocked?: boolean | undefined;
	/** 是否允许停止；连接断开或只读时为 false。 */
	canStop?: boolean;
	/** 上下文用量，未估算出来时为空 */
	contextUsage?: ContextUsage | undefined;
	/** 是否正在压缩上下文 */
	isCompacting?: boolean;
	/** 能否手动压缩，这一轮在跑时不能 */
	canCompact?: boolean;
	/** 手动压缩上下文 */
	onCompact?: () => void;
	/** 输入区可以触发的命令 */
	commands?: readonly SlashCommand[];
	/** 选中一条界面自己处理的命令 */
	onRunCommand?: (command: SlashCommand, args: string) => void;
}

/** 模型芯片的显示文本。 */
function modelLabel(model: ModelInfo | undefined): string {
	if (!model) {
		return "无模型";
	}
	return model.name.trim().length > 0 ? model.name : model.id;
}

/** 思考档位的中文说明。 */
/** 思考档位的显示名：直接用档位本身的取值，只把首字母大写 */
const LEVEL_LABELS: Record<ThinkingLevel, string> = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "XHigh",
	max: "Max",
};

/** 模型键。 */
function modelKey(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

/** 点浮层外面时关掉。 */
function useDismiss(isOpen: boolean, close: () => void): React.RefObject<HTMLDivElement | null> {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onPointerDown = (event: PointerEvent) => {
			const node = ref.current;
			if (node !== null && event.target instanceof Node && node.contains(event.target)) {
				return;
			}
			close();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [isOpen, close]);
	return ref;
}

export function Composer({
	value,
	onChange,
	onSend,
	onStop,
	activity,
	model,
	thinkingLevel,
	thinkingLevels,
	models,
	providerAuth,
	onModelChange,
	onThinkingLevelChange,
	shiftEnterToSend = false,
	isBlocked,
	canStop = activity === "running",
	contextUsage,
	isCompacting = false,
	canCompact = true,
	onCompact,
	commands,
	onRunCommand,
}: ComposerProps) {
	// 运行中发送走排队，插入当前轮次；压缩、停止中与连接断开时不接受新输入
	const canSend =
		isBlocked !== true && value.trim().length > 0 && (activity === "idle" || activity === "running");
	const isQueuing = activity === "running";
	/** 这一轮还在跑且没内容要发时，按钮换成停止；有内容时按钮换回发送（排队）。 */
	const showsStop = activity !== "idle" && !canSend;
	const [openMenu, setOpenMenu] = useState<"model" | "level" | "attach" | "context" | undefined>(undefined);
	const modelRef = useDismiss(openMenu === "model", () => setOpenMenu(undefined));
	const attachRef = useDismiss(openMenu === "attach", () => setOpenMenu(undefined));
	const levelRef = useDismiss(openMenu === "level", () => setOpenMenu(undefined));
	const contextRef = useDismiss(openMenu === "context", () => setOpenMenu(undefined));
	/** 命令列表里高亮的那一条 */
	const [commandIndex, setCommandIndex] = useState(0);
	/** 用户按 Esc 关掉列表之后，输入内容没变就不再弹出来 */
	const [isCommandClosed, setCommandClosed] = useState(false);

	/** 现在要列出的候选：只在开头打命令且还没写参数时出现 */
	const query = commandQuery(value);
	const matches = useMemo(
		() => (query === undefined || isCommandClosed ? [] : filterCommands(commands ?? [], query)),
		[commands, isCommandClosed, query],
	);
	const isPaletteOpen = matches.length > 0;
	const highlighted = matches[Math.min(commandIndex, matches.length - 1)];

	/** 选中一条候选：界面自己处理的直接执行，交给 pi 的填进输入框等用户补参数。 */
	const pickCommand = useCallback(
		(command: SlashCommand): void => {
			if (isFacetCommand(command)) {
				onRunCommand?.(command, "");
				onChange("");
			} else {
				onChange(`/${command.name} `);
			}
			setCommandClosed(true);
			setCommandIndex(0);
		},
		[onChange, onRunCommand],
	);

	// 没有给出可选模型时退化成只展示的芯片
	const canPickModel = models !== undefined && onModelChange !== undefined;
	const levels =
		thinkingLevels === undefined || thinkingLevels.length === 0 ? (["off"] as const) : thinkingLevels;
	const canPickLevel = onThinkingLevelChange !== undefined;

	/** 按提供方把模型分组，供菜单展示。 */
	const grouped = useMemo(() => {
		const groups = new Map<string, ModelInfo[]>();
		for (const item of models ?? []) {
			const list = groups.get(item.provider);
			if (list === undefined) {
				groups.set(item.provider, [item]);
			} else {
				list.push(item);
			}
		}
		return [...groups.entries()];
	}, [models]);

	/** 回车发送还是换行随设置走。 */
	const sendsOnEnter = !shiftEnterToSend;

	return (
		<div className="composer">
			<textarea
				rows={2}
				value={value}
				placeholder={
					isQueuing
						? "输入消息,回车插入当前轮次"
						: sendsOnEnter
							? "输入消息,回车发送"
							: "输入消息,Shift+回车发送"
				}
				onChange={(event) => {
					onChange(event.target.value);
					setCommandClosed(false);
					setCommandIndex(0);
				}}
				onKeyDown={(event) => {
					if (isPaletteOpen) {
						if (event.key === "ArrowDown" || event.key === "ArrowUp") {
							event.preventDefault();
							const step = event.key === "ArrowDown" ? 1 : -1;
							setCommandIndex((current) => (current + step + matches.length) % matches.length);
							return;
						}
						if (
							(event.key === "Enter" || event.key === "Tab") &&
							highlighted !== undefined &&
							!event.shiftKey
						) {
							event.preventDefault();
							pickCommand(highlighted);
							return;
						}
						if (event.key === "Escape") {
							event.preventDefault();
							setCommandClosed(true);
							return;
						}
					}
					if (event.key !== "Enter") {
						return;
					}
					const isSendCombo = sendsOnEnter ? !event.shiftKey : event.shiftKey;
					if (!isSendCombo) {
						return;
					}
					event.preventDefault();
					if (canSend) {
						onSend();
					}
				}}
			/>
			{isPaletteOpen ? (
				<div className="cmd-pop" role="listbox" aria-label="命令">
					{matches.map((command, index) => (
						<button
							key={`${command.source}:${command.name}`}
							type="button"
							role="option"
							aria-selected={index === Math.min(commandIndex, matches.length - 1)}
							className={index === Math.min(commandIndex, matches.length - 1) ? "cmd-row is-on" : "cmd-row"}
							title={command.origin}
							onMouseEnter={() => setCommandIndex(index)}
							onClick={() => pickCommand(command)}
						>
							<span className="cmd-name">/{command.name}</span>
							{command.argumentHint === undefined ? null : (
								<span className="cmd-hint">{command.argumentHint}</span>
							)}
							<span className="cmd-desc">{command.description ?? ""}</span>
							<span className="cmd-source">{SOURCE_LABELS[command.source]}</span>
						</button>
					))}
				</div>
			) : null}
			<div className="composer-row">
				<div className="chip-wrap" ref={attachRef}>
					<button
						type="button"
						className="ib"
						aria-label="添加"
						title="添加图片或文件"
						aria-expanded={openMenu === "attach"}
						onClick={() => setOpenMenu(openMenu === "attach" ? undefined : "attach")}
					>
						<Plus size={16} strokeWidth={1.5} />
					</button>
					{openMenu === "attach" ? (
						<div className="chip-pop is-attach" role="menu" aria-label="添加内容">
							<button
								type="button"
								className="chip-pop-item is-row"
								role="menuitem"
								disabled
								title="尚未接入"
							>
								<ImagePlus size={14} strokeWidth={1.5} />
								<span className="ell">添加图片</span>
							</button>
							<button
								type="button"
								className="chip-pop-item is-row"
								role="menuitem"
								disabled
								title="尚未接入"
							>
								<FileUp size={14} strokeWidth={1.5} />
								<span className="ell">上传文件</span>
							</button>
						</div>
					) : null}
				</div>

				<div className="chip-wrap" ref={modelRef}>
					<button
						type="button"
						className="chip"
						onClick={() => setOpenMenu(openMenu === "model" ? undefined : "model")}
						disabled={!canPickModel}
						aria-expanded={openMenu === "model"}
						title={canPickModel ? "切换模型" : "当前模型"}
					>
						{modelLabel(model)}
						{canPickModel ? <ChevronIcon isOpen={openMenu === "model"} /> : null}
					</button>
					{openMenu === "model" ? (
						<div className="chip-pop" role="dialog" aria-label="选择模型">
							{grouped.map(([provider, items]) => (
								<div key={provider} className="chip-pop-group">
									<p className="chip-pop-head">
										<span>{provider}</span>
										{providerAuth?.[provider] === false ? (
											<span className="chip-pop-note">未配置凭证</span>
										) : null}
									</p>
									{items.map((item) => {
										// 没有凭证的提供方下的模型选不了，选中也无法真正切换
										const usable = providerAuth?.[item.provider] !== false;
										const isCurrent = model !== undefined && modelKey(model) === modelKey(item);
										return (
											<button
												type="button"
												key={modelKey(item)}
												className={isCurrent ? "chip-pop-item is-on" : "chip-pop-item"}
												disabled={!usable}
												title={usable ? item.id : "这个提供方还没有配置凭证"}
												onClick={() => {
													onModelChange?.(item);
													setOpenMenu(undefined);
												}}
											>
												<span className="ell">{item.name}</span>
												<span className="chip-pop-meta mono">{item.id}</span>
											</button>
										);
									})}
								</div>
							))}
							{(models ?? []).length === 0 ? <p className="chip-pop-empty">没有可选的模型</p> : null}
						</div>
					) : null}
				</div>

				<div className="chip-wrap" ref={levelRef}>
					<button
						type="button"
						className="chip"
						onClick={() => setOpenMenu(openMenu === "level" ? undefined : "level")}
						disabled={!canPickLevel}
						aria-expanded={openMenu === "level"}
						title={canPickLevel ? "切换思考档位" : "当前思考档位"}
						aria-label={`思考档位 ${thinkingLevel === undefined ? "默认" : LEVEL_LABELS[thinkingLevel]}`}
					>
						<Brain size={13} strokeWidth={1.5} />
						{thinkingLevel === undefined ? "默认" : LEVEL_LABELS[thinkingLevel]}
						{canPickLevel ? <ChevronIcon isOpen={openMenu === "level"} /> : null}
					</button>
					{openMenu === "level" ? (
						<div className="chip-pop" role="dialog" aria-label="选择思考档位">
							{levels.map((level) => (
								<button
									type="button"
									key={level}
									className={level === thinkingLevel ? "chip-pop-item is-on" : "chip-pop-item"}
									onClick={() => {
										onThinkingLevelChange?.(level);
										setOpenMenu(undefined);
									}}
								>
									<span>{LEVEL_LABELS[level]}</span>
								</button>
							))}
						</div>
					) : null}
				</div>

				<span className="composer-send">
					<span className="chip-wrap" ref={contextRef}>
						<button
							type="button"
							className="ctx-chip"
							onClick={() => setOpenMenu(openMenu === "context" ? undefined : "context")}
							aria-expanded={openMenu === "context"}
							aria-label={usageLabel(contextUsage)}
							title={usageLabel(contextUsage)}
						>
							<ContextRing usage={contextUsage} />
						</button>
						{openMenu === "context" ? (
							<div className="chip-pop is-context" role="dialog" aria-label="上下文用量">
								<p className="ctx-pop-title">上下文窗口</p>
								<p className="ctx-pop-value">
									{isCompacting ? "正在压缩…" : (usagePercentText(contextUsage) ?? "暂无数据")}
								</p>
								{isCompacting || usageDetailText(contextUsage) === null ? null : (
									<p className="ctx-pop-detail">{usageDetailText(contextUsage)}</p>
								)}
								{onCompact === undefined ? null : (
									<button
										type="button"
										className="ctx-pop-action"
										onClick={() => {
											onCompact();
											setOpenMenu(undefined);
										}}
										disabled={!canCompact || isCompacting}
										title={
											isCompacting
												? "正在压缩"
												: canCompact
													? "把较早的历史压成摘要，腾出上下文"
													: "等这一轮结束再压缩"
										}
									>
										压缩上下文
									</button>
								)}
							</div>
						) : null}
					</span>
					{/*
					 * 发送与停止共用一个按钮：有内容要发时是发送（运行中就是排队），
					 * 没有内容而这一轮还在跑时是停止。位置与尺寸不变，两者互相替换。
					 */}
					{showsStop ? (
						<button
							type="button"
							className="send is-stop"
							onClick={onStop}
							disabled={!canStop || activity === "stopping"}
							aria-label={activity === "stopping" ? "停止中" : "停止"}
							title={activity === "stopping" ? "正在停止" : "停止这一轮"}
						>
							<StopIcon size={15} />
						</button>
					) : (
						<button
							type="button"
							className="send"
							aria-label={isQueuing ? "排队" : "发送"}
							title={isQueuing ? "插入当前轮次" : undefined}
							onClick={onSend}
							disabled={!canSend}
						>
							<SendIcon size={16} />
						</button>
					)}
				</span>
			</div>
		</div>
	);
}
