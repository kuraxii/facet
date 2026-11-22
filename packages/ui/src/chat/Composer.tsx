/**
 * 输入区。
 *
 * 输入框、发送与停止，以及当前模型与思考档位两个芯片。模型芯片按提供方分组列出可选模型，
 * 思考芯片只列出当前模型支持的档位；两个芯片都能把当前选择存成新建会话的默认值。
 * 动作行右侧是上下文用量环与发送按钮，用量环点开有具体数值和手动压缩入口。
 * 待发的图片贴在输入框上沿，可以点添加按钮选、粘贴或直接拖进来。
 */
import type { ChatActivity } from "@facet/client-core";
import type { ContextUsage, ModelInfo, SlashCommand, ThinkingLevel } from "@facet/protocol";
import { Brain, FileUp, ImagePlus, Plus, X } from "lucide-react";
import { type Ref, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FACET_FILE_DRAG_MIME } from "../common/file-drag.ts";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";
import { ChevronIcon } from "../transcript/chevron.tsx";
import { SendIcon, StopIcon } from "../transcript/icons.tsx";
import { ContextRing, usageDetailText, usageLabel, usagePercentText } from "./ContextRing.tsx";
import { ComposerEditor, type ComposerHandle } from "./rich-editor/ComposerEditor.tsx";

/** 输入区里一张待发的图片。 */
export interface ComposerAttachment {
	/** 本次输入内的稳定标识，移除与预览都按它定位 */
	id: string;
	/** 文件名，来自选择窗口、粘贴或拖拽 */
	name: string;
	/** 预览地址，objectURL 或 data URL */
	previewUrl: string;
}

/** 一份文件列表里的文件。拖拽与粘贴给的列表里可能混着别的类型，收下之后交给宿主判断。 */
function pickedFiles(list: FileList | null | undefined): File[] {
	return [...(list ?? [])];
}

/** 输入区参数。 */
export interface ComposerProps {
	/** 输入内容 */
	value: string;
	/** 输入变化 */
	onChange: (value: string) => void;
	/** 发送当前内容 */
	onSend: () => void;
	/** 待发的图片，按添加顺序显示在输入框上方 */
	attachments?: readonly ComposerAttachment[];
	/** 打开系统的选图窗口 */
	onPickImages?: (() => void) | undefined;
	/** 加入一批图片：粘贴与拖拽都走这里 */
	onAddImages?: ((files: readonly File[]) => void) | undefined;
	/** 当前模型能否接收图片；不能时选图项置灰，拖拽与粘贴也不接 */
	canAddImages?: boolean;
	/** 移除一张待发图片 */
	onRemoveAttachment?: ((id: string) => void) | undefined;
	/** 有图片没被收下时给出的事实，例如文件名与大小上限 */
	attachmentNotice?: string | undefined;
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
	/**
	 * 输入区的命令式句柄。引用正文这类动作从外面把结构直接插进编辑器，光标随之落好，
	 * 不必把草稿拼成字符串再整份重载。
	 */
	ref?: Ref<ComposerHandle>;
	/** 可 `@` 引用的文件：项目根下的相对路径。空列表时 `@` 不弹菜单 */
	mentionFiles?: readonly string[];
	/**
	 * 当前草稿的键（会话文件）：撤销栈按它分开。不传时所有内容共用一份默认栈。
	 */
	draftKey?: string;
	/** 点 `@文件` 胶囊要打开的文件；给了它胶囊才带可点的样子 */
	onOpenMentionFile?: ((filePath: string) => void) | undefined;
	/** 当前会话里用户发过的文字，从旧到新：`↑`/`↓` 按它回溯 */
	sentHistory?: readonly string[];
}

/** 模型芯片的显示文本。 */
function modelLabel(model: ModelInfo | undefined, noModel: string): string {
	if (!model) {
		return noModel;
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
	attachments = [],
	onPickImages,
	onAddImages,
	canAddImages = true,
	onRemoveAttachment,
	attachmentNotice,
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
	ref,
	mentionFiles,
	draftKey,
	onOpenMentionFile,
	sentHistory,
}: ComposerProps) {
	const { t } = useI18n();
	// 一排按钮共用一份悬浮提示：谁被悬停就贴谁
	const tip = useHoverTip();

	// 运行中发送走排队，插入当前轮次；压缩、停止中与连接断开时不接受新输入。
	// 只有图片没有文字也算一条要发的内容。
	const canSend =
		isBlocked !== true &&
		(value.trim().length > 0 || attachments.length > 0) &&
		(activity === "idle" || activity === "running");
	const isQueuing = activity === "running";
	/** 这一轮还在跑且没内容要发时，按钮换成停止；有内容时按钮换回发送（排队）。 */
	const showsStop = activity !== "idle" && !canSend;
	const [openMenu, setOpenMenu] = useState<"model" | "level" | "attach" | "context" | undefined>(undefined);
	/** 有文件悬在输入区上方，界面据此给出可投放的样子 */
	const [isDropping, setIsDropping] = useState(false);
	/** 输入区外框：`@` 与 `/` 两处补全菜单都挂在它下面 */
	const boxRef = useRef<HTMLDivElement>(null);
	/** 编辑器句柄的内部引用：拖进来的文件要落到光标处，不经过外面那一份 */
	const editorHandle = useRef<ComposerHandle | null>(null);
	const handleRef = useCallback(
		(handle: ComposerHandle | null) => {
			editorHandle.current = handle;
			if (typeof ref === "function") {
				ref(handle);
			} else if (ref !== null && ref !== undefined) {
				ref.current = handle;
			}
		},
		[ref],
	);
	const modelRef = useDismiss(openMenu === "model", () => setOpenMenu(undefined));
	const attachRef = useDismiss(openMenu === "attach", () => setOpenMenu(undefined));
	const levelRef = useDismiss(openMenu === "level", () => setOpenMenu(undefined));
	const contextRef = useDismiss(openMenu === "context", () => setOpenMenu(undefined));
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
	/** 这一路能不能接图片：宿主给了入口、且当前模型收图片 */
	const acceptsImages = onAddImages !== undefined && canAddImages;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: 拖拽与粘贴是浏览器原生行为，这块只做事件委托，不承担键盘操作
		<div
			ref={boxRef}
			className={isDropping ? "composer is-drop" : "composer"}
			onDragOver={(event) => {
				// 文件树拖来的一枚引用与系统拖来的图片是两条路：前者不受「能不能收图」限制
				const isReference = event.dataTransfer.types.includes(FACET_FILE_DRAG_MIME);
				const isImage = acceptsImages && event.dataTransfer.types.includes("Files");
				if (!isReference && !isImage) {
					return;
				}
				// 不拦下 dragover 的话浏览器会当成「打开这个文件」，drop 也不会触发
				event.preventDefault();
				setIsDropping(true);
			}}
			onDragLeave={() => setIsDropping(false)}
			onDrop={(event) => {
				const filePath = event.dataTransfer.getData(FACET_FILE_DRAG_MIME);
				if (filePath.length > 0) {
					event.preventDefault();
					setIsDropping(false);
					editorHandle.current?.insertMention(filePath);
					return;
				}
				if (!acceptsImages) {
					return;
				}
				const files = pickedFiles(event.dataTransfer.files);
				setIsDropping(false);
				if (files.length === 0) {
					return;
				}
				event.preventDefault();
				onAddImages?.(files);
			}}
			onPaste={(event) => {
				if (onAddImages === undefined || !canAddImages) {
					return;
				}
				const files = pickedFiles(event.clipboardData.files);
				if (files.length === 0) {
					// 剪贴板里没有图片，交回给输入框自己处理文字
					return;
				}
				event.preventDefault();
				onAddImages(files);
			}}
		>
			{attachments.length === 0 ? null : (
				<div className="composer-files">
					{attachments.map((item) => (
						<figure className="att" key={item.id}>
							<img src={item.previewUrl} alt={item.name} />
							{onRemoveAttachment === undefined ? null : (
								<button
									type="button"
									className="att-x"
									aria-label={t("composer.removeImage", { name: item.name })}
									onClick={() => onRemoveAttachment(item.id)}
								>
									<X size={ICON_SIZE.sm} />
								</button>
							)}
						</figure>
					))}
				</div>
			)}
			{attachmentNotice === undefined ? null : <p className="composer-note">{attachmentNotice}</p>}
			<ComposerEditor
				handleRef={handleRef}
				mentionFiles={mentionFiles}
				commands={commands}
				onRunCommand={onRunCommand}
				draftKey={draftKey}
				onOpenMentionFile={onOpenMentionFile}
				sentHistory={sentHistory}
				menuContainerRef={boxRef}
				value={value}
				placeholder={
					isQueuing
						? t("composer.queuedPlaceholder")
						: sendsOnEnter
							? t("composer.sendPlaceholder")
							: t("composer.shiftEnterPlaceholder")
				}
				onChange={onChange}
				routes={{ canSend, shiftEnterToSend, onSend }}
			/>
			<div className="composer-row">
				<div className="chip-wrap" ref={attachRef}>
					<button
						type="button"
						className="ib"
						aria-label={t("composer.add")}
						{...tip.handlers(t("composer.addImageOrFile"))}
						aria-expanded={openMenu === "attach"}
						onClick={() => setOpenMenu(openMenu === "attach" ? undefined : "attach")}
					>
						<Plus size={ICON_SIZE.lg} />
					</button>
					{openMenu === "attach" ? (
						// biome-ignore lint/a11y/useSemanticElements: 浮层里是一组按钮，用不到 fieldset 的表单语义
						<div className="chip-pop is-attach" role="group" aria-label={t("composer.addContent")}>
							<button
								type="button"
								className="chip-pop-item is-row"
								disabled={onPickImages === undefined || !canAddImages}
								onClick={() => {
									if (onPickImages === undefined || !canAddImages) {
										return;
									}
									setOpenMenu(undefined);
									onPickImages();
								}}
							>
								<ImagePlus size={ICON_SIZE.md} />
								<span className="ell">{t("composer.addImage")}</span>
							</button>
							<button type="button" className="chip-pop-item is-row" role="menuitem" disabled>
								<FileUp size={ICON_SIZE.md} />
								<span className="ell">{t("composer.uploadFile")}</span>
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
						{...tip.handlers(canPickModel ? t("composer.switchModel") : t("composer.currentModel"))}
					>
						{modelLabel(model, t("composer.noModel"))}
						{canPickModel ? <ChevronIcon isOpen={openMenu === "model"} /> : null}
					</button>
					{openMenu === "model" ? (
						// biome-ignore lint/a11y/useSemanticElements: 浮层里是一组按钮，用不到 fieldset 的表单语义
						<div className="chip-pop" role="group" aria-label={t("composer.chooseModel")}>
							{grouped.map(([provider, items]) => (
								<div key={provider} className="chip-pop-group">
									<p className="chip-pop-head">
										<span>{provider}</span>
										{providerAuth?.[provider] === false ? (
											<span className="chip-pop-note">{t("composer.noCredentials")}</span>
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
							{(models ?? []).length === 0 ? (
								<p className="chip-pop-empty">{t("composer.noModels")}</p>
							) : null}
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
						{...tip.handlers(canPickLevel ? t("composer.switchThinking") : t("composer.currentThinking"))}
						aria-label={t("composer.thinkingLevel", {
							level: thinkingLevel === undefined ? t("composer.defaultLevel") : LEVEL_LABELS[thinkingLevel],
						})}
					>
						<Brain size={ICON_SIZE.md} />
						{thinkingLevel === undefined ? t("composer.defaultLevel") : LEVEL_LABELS[thinkingLevel]}
						{canPickLevel ? <ChevronIcon isOpen={openMenu === "level"} /> : null}
					</button>
					{openMenu === "level" ? (
						// biome-ignore lint/a11y/useSemanticElements: 浮层里是一组按钮，用不到 fieldset 的表单语义
						<div className="chip-pop" role="group" aria-label={t("composer.chooseThinking")}>
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
							aria-label={usageLabel(contextUsage, t)}
							{...tip.handlers(usageLabel(contextUsage, t))}
						>
							<ContextRing usage={contextUsage} />
						</button>
						{openMenu === "context" ? (
							// biome-ignore lint/a11y/useSemanticElements: 浮层是说明加一个按钮，用不到 fieldset 的表单语义
							<div className="chip-pop is-context" role="group" aria-label={t("composer.contextUsage")}>
								<p className="ctx-pop-title">{t("composer.contextWindow")}</p>
								<p className="ctx-pop-value">
									{isCompacting
										? t("composer.compacting")
										: (usagePercentText(contextUsage, t) ?? t("composer.noData"))}
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
									>
										{t("composer.compact")}
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
							aria-label={activity === "stopping" ? t("composer.stopping") : t("composer.stop")}
							{...tip.handlers(activity === "stopping" ? t("composer.stopping") : t("composer.stopTurn"))}
						>
							<StopIcon size={ICON_SIZE.lg} />
						</button>
					) : (
						<button
							type="button"
							className="send"
							aria-label={isQueuing ? t("composer.queue") : t("composer.send")}
							{...tip.handlers(isQueuing ? t("composer.insertTurn") : undefined)}
							onClick={onSend}
							disabled={!canSend}
						>
							<SendIcon size={ICON_SIZE.lg} />
						</button>
					)}
				</span>
			</div>
			{tip.render()}
		</div>
	);
}
