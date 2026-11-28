/**
 * 输入区。
 *
 * 输入框、发送与停止，以及当前模型与思考档位两个芯片。模型芯片按提供方分组列出可选模型，
 * 思考芯片只列出当前模型支持的档位；两个芯片都能把当前选择存成新建会话的默认值。
 * 动作行右侧是上下文用量环与发送按钮，用量环点开有具体数值和手动压缩入口。
 * 待发的图片贴在输入框上沿，可以点添加按钮选、粘贴或直接拖进来。
 */
import type { ChatActivity } from "@facet/client-core";
import {
	type AcpConfigOption,
	type AcpModeState,
	type AgentCapabilities,
	type ContextBreakdown,
	type ContextUsage,
	type Message,
	type ModelInfo,
	PI_AGENT_CAPABILITIES,
	type SessionStats,
	type SlashCommand,
	type ThinkingLevel,
} from "@facet/protocol";
import { Brain, FileUp, ImagePlus, Plus, X } from "lucide-react";
import { type ReactNode, type Ref, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FACET_FILE_DRAG_MIME } from "../common/file-drag.ts";
import { IconButton } from "../common/IconButton.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { useImagePreview } from "../image/image-preview.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";
import { ChevronIcon } from "../transcript/chevron.tsx";
import { SendIcon, StopIcon } from "../transcript/icons.tsx";
import { AcpConfigChips } from "./AcpConfigChips.tsx";
import { ContextPopover } from "./ContextPopover.tsx";
import { ContextRing, usageLabel, usagePercentShort } from "./ContextRing.tsx";
import { ComposerEditor, type ComposerHandle } from "./rich-editor/ComposerEditor.tsx";
import { SessionStatsChip } from "./SessionStatsPopover.tsx";

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
	/**
	 * 有一条发送已经发出、还没被主机确认（或在编码图片）。
	 *
	 * 与 `isBlocked` 分开：它不代表“不能发”，只是“这一条还在路上”。两条入口（按钮与回车）
	 * 都读 `canSend`，锁在这里就能一起生效，且按钮仍是发送（只是不可点），不会变成停止。
	 */
	isSending?: boolean | undefined;
	/** 是否允许停止；连接断开或只读时为 false。 */
	canStop?: boolean;
	/** 上下文用量，未估算出来时为空 */
	contextUsage?: ContextUsage | undefined;
	/** 按需加载当前活动分支的上下文明细 */
	onLoadContextDetails?: (() => Promise<ContextBreakdown>) | undefined;
	/** 全会话累计统计（含已被压缩掉的历史） */
	sessionStats?: SessionStats | undefined;
	/** 已加载的消息列表，用于在 UI 层计算 tok/s 速度 */
	sessionMessages?: readonly Message[];
	/** 流式输出中的字符总量，用于实时估算生成速度 */
	streamingChars?: number;
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
	/** 当前会话代理后端支持的能力集合，缺省按 Pi 完整能力 */
	capabilities?: AgentCapabilities;
	/** ACP 会话模式状态 */
	acpMode?: AcpModeState;
	/** ACP 动态配置项 */
	acpConfigOptions?: readonly AcpConfigOption[];
	/** 切换 ACP 会话模式 */
	onAcpModeChange?: (modeId: string) => void;
	/** 修改 ACP 动态配置项 */
	onAcpConfigOptionChange?: (configId: string, value: string) => void;
	/** 输入框顶部的额外选择栏（例如新建引导页的 Host / Project / Agent 芯片） */
	header?: ReactNode;
	/** 是否显示右下角的会话速度与上下文窗口芯片，默认显示；新建草稿页可传 false 隐藏 */
	showStatusChips?: boolean;
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
	isSending = false,
	canStop = activity === "running",
	contextUsage,
	onLoadContextDetails,
	sessionStats,
	sessionMessages = [],
	streamingChars = 0,
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
	capabilities,
	acpMode,
	acpConfigOptions,
	onAcpModeChange,
	onAcpConfigOptionChange,
	header,
	showStatusChips = true,
}: ComposerProps) {
	const { t } = useI18n();
	const openImagePreview = useImagePreview();
	// 一排按钮共用一份悬浮提示：谁被悬停就贴谁
	const tip = useHoverTip();
	const caps = capabilities ?? PI_AGENT_CAPABILITIES;
	const canQueueWhileRunning = caps.supportsSteering || caps.supportsFollowUp;
	const isQueuing = activity === "running" && canQueueWhileRunning;

	// 运行中发送走排队，插入当前轮次；压缩、停止中与连接断开时不接受新输入。
	// 只有图片没有文字也算一条要发的内容。
	// 上一条还没被主机确认时也发不了：草稿要等回执才收，不锁的话慢回执期间每次点击都是一次新发送。
	const canSend =
		isBlocked !== true &&
		!isSending &&
		(value.trim().length > 0 || attachments.length > 0) &&
		(activity === "idle" || isQueuing);
	/** 这一轮还在跑且没内容要发时，按钮换成停止；发送在途时仍留在发送上，免得一下没收住轮次。 */
	const showsStop = activity !== "idle" && !canSend && !isSending;
	const [openMenu, setOpenMenu] = useState<string | undefined>(undefined);
	const [contextBreakdownState, setContextBreakdownState] = useState<{
		key: string | undefined;
		data: ContextBreakdown | undefined;
	}>({ key: draftKey, data: undefined });
	const [loadingContextDetails, setLoadingContextDetails] = useState(false);
	const contextBreakdown = contextBreakdownState.key === draftKey ? contextBreakdownState.data : undefined;
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
	const statsRef = useDismiss(openMenu === "stats", () => setOpenMenu(undefined));
	const contextRefreshKey = `${draftKey ?? ""}:${contextUsage?.tokens ?? ""}:${contextUsage?.contextWindow ?? 0}:${isCompacting ? "1" : "0"}`;

	useEffect(() => {
		if (openMenu !== "context" || onLoadContextDetails === undefined || isCompacting) {
			return;
		}
		// `contextRefreshKey` 变化时重新拉取当前分支明细，保证压缩或切会话后展示最新数据
		void contextRefreshKey;
		let cancelled = false;
		setLoadingContextDetails(true);
		void onLoadContextDetails()
			.then((details) => {
				if (!cancelled) {
					setContextBreakdownState({ key: draftKey, data: details });
				}
			})
			.catch(() => {
				// 按需拉取失败时保留基础 contextUsage 展示
			})
			.finally(() => {
				if (!cancelled) {
					setLoadingContextDetails(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [openMenu, onLoadContextDetails, draftKey, isCompacting, contextRefreshKey]);
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
	/** 这一路能不能接图片：宿主给了入口、当前模型与代理后端都支持收图片 */
	const effectiveCanAddImages = canAddImages && caps.supportsImages;
	const acceptsImages = onAddImages !== undefined && effectiveCanAddImages;

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
				if (!acceptsImages) {
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
			{header}
			{attachments.length === 0 ? null : (
				<div className="composer-files">
					{attachments.map((item, index) => (
						<figure className="att" key={item.id}>
							<button
								type="button"
								className="att-preview"
								aria-label={t("imagePreview.open")}
								onClick={(event) =>
									openImagePreview({
										items: attachments.map((attachment) => ({
											src: attachment.previewUrl,
											alt: attachment.name,
										})),
										index,
										source: event.currentTarget,
									})
								}
							>
								<img src={item.previewUrl} alt={item.name} />
							</button>
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
			{/* 输入域外面这一圈只管定位：占位提示按它的上缘对齐，图片多了也不会盖到缩略图上 */}
			<div className="composer-input">
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
			</div>
			<div className="composer-row">
				<div className="chip-wrap" ref={attachRef}>
					<IconButton
						variant="ghost"
						size="sm"
						className="ib"
						aria-label={t("composer.add")}
						{...tip.handlers(t("composer.addImageOrFile"))}
						aria-expanded={openMenu === "attach"}
						onClick={() => setOpenMenu(openMenu === "attach" ? undefined : "attach")}
					>
						<Plus size={ICON_SIZE.lg} />
					</IconButton>
					{openMenu === "attach" ? (
						// biome-ignore lint/a11y/useSemanticElements: 浮层里是一组按钮，用不到 fieldset 的表单语义
						<div className="chip-pop is-attach" role="group" aria-label={t("composer.addContent")}>
							<button
								type="button"
								className="chip-pop-item is-row"
								disabled={onPickImages === undefined || !effectiveCanAddImages}
								onClick={() => {
									if (onPickImages === undefined || !effectiveCanAddImages) {
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

				{caps.configStyle === "acp" ? (
					<AcpConfigChips
						openMenuId={openMenu}
						onToggleMenu={setOpenMenu}
						acpMode={acpMode}
						acpConfigOptions={acpConfigOptions}
						onAcpModeChange={onAcpModeChange}
						onAcpConfigOptionChange={onAcpConfigOptionChange}
					/>
				) : (
					<>
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
									level:
										thinkingLevel === undefined ? t("composer.defaultLevel") : LEVEL_LABELS[thinkingLevel],
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
					</>
				)}

				<span className="composer-send">
					{showStatusChips ? (
						<>
							<span className="chip-wrap" ref={statsRef}>
								<SessionStatsChip
									messages={sessionMessages}
									streamingChars={streamingChars}
									isStreaming={activity === "running"}
									sessionStats={sessionStats}
									isOpen={openMenu === "stats"}
									onToggle={() => setOpenMenu(openMenu === "stats" ? undefined : "stats")}
								/>
							</span>
							{caps.hasContextBreakdown || caps.canCompact ? (
								<span className="chip-wrap" ref={contextRef}>
									<button
										type="button"
										className="composer-status-chip"
										data-chip="context"
										onClick={() => setOpenMenu(openMenu === "context" ? undefined : "context")}
										aria-expanded={openMenu === "context"}
										aria-label={usageLabel(contextUsage, t)}
										{...tip.handlers(usageLabel(contextUsage, t))}
									>
										<ContextRing usage={contextUsage} />
										{(() => {
											const shortPercent = usagePercentShort(contextUsage);
											return shortPercent === null ? null : <span>{shortPercent}</span>;
										})()}
									</button>
									{openMenu === "context" ? (
										<ContextPopover
											contextUsage={contextUsage}
											breakdown={contextBreakdown}
											loading={loadingContextDetails}
											isCompacting={isCompacting}
											canCompact={canCompact}
											onCompact={
												onCompact === undefined
													? undefined
													: () => {
															onCompact();
															setOpenMenu(undefined);
														}
											}
										/>
									) : null}
								</span>
							) : null}
						</>
					) : null}
					{/*
					 * 发送与停止共用一个按钮：有内容要发时是发送（运行中就是排队），
					 * 没有内容而这一轮还在跑时是停止。位置与尺寸不变，两者互相替换。
					 */}
					{showsStop ? (
						<IconButton
							variant="primary"
							size="md"
							radius="pill"
							className="is-stop"
							onClick={onStop}
							disabled={!canStop || activity === "stopping"}
							aria-label={activity === "stopping" ? t("composer.stopping") : t("composer.stop")}
							{...tip.handlers(activity === "stopping" ? t("composer.stopping") : t("composer.stopTurn"))}
						>
							<StopIcon size={ICON_SIZE.lg} />
						</IconButton>
					) : (
						<IconButton
							variant="primary"
							size="md"
							radius="pill"
							aria-label={isQueuing ? t("composer.queue") : t("composer.send")}
							{...tip.handlers(isQueuing ? t("composer.insertTurn") : undefined)}
							onClick={onSend}
							disabled={!canSend}
						>
							<SendIcon size={ICON_SIZE.lg} />
						</IconButton>
					)}
				</span>
			</div>
			{tip.render()}
		</div>
	);
}
