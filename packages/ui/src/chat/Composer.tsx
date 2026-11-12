/**
 * 输入区。
 *
 * 输入框、发送与停止，以及当前模型与思考档位两个芯片。模型芯片按提供方分组列出可选模型，
 * 思考芯片只列出当前模型支持的档位；两个芯片都能把当前选择存成新建会话的默认值。
 * 附件与引用还没有实现，按钮保持可见但不可点。
 */
import type { ChatActivity } from "@facet/client-core";
import type { ModelInfo, ThinkingLevel } from "@facet/protocol";
import { FileUp, ImagePlus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SendIcon, StopIcon } from "../transcript/icons.tsx";

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
	/** 现在不能发送的原因，给出时输入区上方显示说明并禁用发送 */
	blockedReason?: string | undefined;
}

/** 模型芯片的显示文本。 */
function modelLabel(model: ModelInfo | undefined): string {
	return model ? model.id : "无模型";
}

/** 思考档位的中文说明。 */
const LEVEL_LABELS: Record<ThinkingLevel, string> = {
	off: "不思考",
	minimal: "极简",
	low: "低",
	medium: "中",
	high: "高",
	xhigh: "很高",
	max: "最高",
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
	blockedReason,
}: ComposerProps) {
	// 运行中发送走排队，插入当前轮次；压缩、停止中与连接断开时不接受新输入
	const canSend =
		blockedReason === undefined && value.trim().length > 0 && (activity === "idle" || activity === "running");
	const isQueuing = activity === "running";
	const [openMenu, setOpenMenu] = useState<"model" | "level" | "attach" | undefined>(undefined);
	const modelRef = useDismiss(openMenu === "model", () => setOpenMenu(undefined));
	const attachRef = useDismiss(openMenu === "attach", () => setOpenMenu(undefined));
	const levelRef = useDismiss(openMenu === "level", () => setOpenMenu(undefined));

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
			{blockedReason === undefined ? null : <p className="composer-blocked">{blockedReason}</p>}
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
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
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
						{canPickModel ? <i className={openMenu === "model" ? "chev is-open" : "chev"} /> : null}
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
					>
						思考 · {thinkingLevel === undefined ? "默认" : LEVEL_LABELS[thinkingLevel]}
						{canPickLevel ? <i className={openMenu === "level" ? "chev is-open" : "chev"} /> : null}
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
									<span className="chip-pop-meta mono">{level}</span>
								</button>
							))}
						</div>
					) : null}
				</div>

				<span className="composer-send">
					{activity === "idle" ? null : (
						<button type="button" className="btn" onClick={onStop} disabled={activity === "stopping"}>
							<StopIcon size={11} />
							{activity === "stopping" ? "停止中" : "停止"}
						</button>
					)}
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
				</span>
			</div>
		</div>
	);
}
