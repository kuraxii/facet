/**
 * 对话面板。
 *
 * 行由渲染单元聚合而来,收起状态按行标识保存,所以流式追加内容时不会把用户收起过的行重新展开。
 * 默认只有过程行与文件改动行收起,其余行展开。
 */
import type { Part, ToolCallPart, ToolImage, TranscriptItem } from "@facet/client-core";
import type { Maintenance } from "@facet/protocol";
import {
	Brain,
	Check,
	CircleAlert,
	Copy,
	Edit3,
	FileText,
	ListCollapse,
	Search,
	Split,
	Terminal,
	Undo2,
	Wrench,
} from "lucide-react";
import {
	memo,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { Markdown } from "../markdown/Markdown.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";
import { ChevronIcon, TreeChevron } from "./chevron.tsx";
import {
	type DisplayRow,
	groupLabel,
	groupRows,
	isTurnTimingLive,
	reuseRows,
	turnDurationText,
} from "./group.ts";
import { MessageAction } from "./message-action.tsx";
import { foldOutput, type ToolCategory, toolDetail, toolKind, toolTarget } from "./tool-text.ts";

/** 面板参数。 */
export interface ChatTranscriptProps {
	/** 数据侧投影出的渲染单元,顺序即消息顺序 */
	items: readonly TranscriptItem[];
	/** 是否允许分叉,本轮结束前不允许 */
	canFork: boolean;
	/** 在某一轮结束处分叉,传入下一轮开始处条目的 id；缺省表示最后一轮 */
	onFork: (beforeEntryId: string | undefined) => void;
	/** 是否允许回退到某条用户消息之前,本轮结束前不允许 */
	canRevert: boolean;
	/** 回退到这条用户消息之前的一轮末尾,连同这条消息的文本一起带出 */
	onRevert: (entryId: string, text: string) => void;
	maintenance?: Maintenance | undefined;
	/** 重试这一轮:按最后一条用户消息重新发一次,不重复添加用户消息 */
	onRetryTurn?: ((entryId: string, text: string) => void) | undefined;
	/** 复制错误详情 */
	onCopyDetails?: ((text: string) => void) | undefined;
	/** 复制一条消息的原文，用户消息与最终答复都用它 */
	onCopyText?: ((text: string) => void) | undefined;
	/** 没有任何内容时显示的提示 */
	emptyHint?: string;
	/** 实时消息提升为历史消息时的标识迁移，用来搬动按行标识保存的收起状态 */
	renames?: Readonly<Record<string, string>> | undefined;
	/** 会话是否仍在推进；为真时最后一轮的时长持续计时 */
	isRunning?: boolean;
}

/**
 * 运行中的计时器。
 *
 * 回合还在跑的时候没有结束时间,界面每秒取一次当前时间自己计时;没有运行中的行时不挂定时器。
 */
/** 重试倒计时的文案,没有剩余时间时为空。 */
function retryDelayText(
	delayMs: number,
	startedAt: number | undefined,
	now: number | undefined,
	t: ReturnType<typeof useI18n>["t"],
): string | undefined {
	if (delayMs <= 0 || startedAt === undefined || now === undefined) {
		return undefined;
	}
	const left = Math.ceil((startedAt + delayMs - now) / 1000);
	return left <= 0 ? t("transcript.retrying") : t("transcript.retryIn", { seconds: left });
}

function useNow(isTicking: boolean): number | undefined {
	const [now, setNow] = useState<number | undefined>(undefined);
	useEffect(() => {
		if (!isTicking) {
			setNow(undefined);
			return;
		}
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [isTicking]);
	// 刚进入计时的第一帧还没有定时器时间，先用当前时刻，避免时长闪空
	return isTicking ? (now ?? Date.now()) : now;
}

/** 默认收起的行。 */
function isCollapsedByDefault(kind: DisplayRow["kind"]): boolean {
	return kind === "meta";
}

function textOf(parts: readonly Part[]): string {
	return parts
		.map((part) => (part.kind === "text" ? part.text : ""))
		.join("")
		.trim();
}

/**
 * 复制一段原文。
 *
 * 复制成功之后对勾亮一小会儿再换回复制图标，避免连点时分不清是没反应还是已经复制过。
 */
function CopyButton({
	text,
	onCopy,
	isReveal,
}: {
	text: string;
	onCopy: (text: string) => void;
	isReveal?: boolean;
}) {
	const { t } = useI18n();
	const [isDone, setIsDone] = useState(false);
	useEffect(() => {
		if (!isDone) {
			return;
		}
		const timer = setTimeout(() => setIsDone(false), 1200);
		return () => clearTimeout(timer);
	}, [isDone]);
	return (
		<MessageAction
			action="copy"
			label={isDone ? t("transcript.copied") : t("transcript.copy")}
			isDone={isDone}
			isReveal={isReveal === true}
			onClick={() => {
				onCopy(text);
				setIsDone(true);
			}}
		>
			{isDone ? <Check size={ICON_SIZE.md} /> : <Copy size={ICON_SIZE.md} />}
		</MessageAction>
	);
}

/**
 * 收起体：留在 DOM 里，收起时标成 `hidden="until-found"`。
 *
 * 这样浏览器自己的页内查找（`Ctrl+F` / `⌘F`）能命中折叠起来的内容：命中前浏览器派一个
 * `beforematch` 事件，我们在这里把这一块展开，查找结果就能滚到眼前——`display: none` 的
 * 内容查找看不见，这也是不用条件渲染的原因。
 *
 * 属性用 `setAttribute` 直接写而不是走 JSX：React 把 `hidden` 当布尔属性，传字符串只会得到
 * `hidden=""`（那是 `display: none`，正好把查找也一起关掉）。写在 `useLayoutEffect` 里是为了
 * 赶在首次绘制之前——晚一帧的话，收起的折叠体会先亮一下再消失。
 */
function useUntilFound<T extends HTMLElement>(isOpen: boolean, reveal: () => void): RefObject<T | null> {
	const ref = useRef<T>(null);
	// 回调用 ref 兜住：调用方多半是内联箭头函数，每次渲染都换引用，不该因此重绑监听
	const revealRef = useRef(reveal);
	revealRef.current = reveal;
	useLayoutEffect(() => {
		const node = ref.current;
		if (node === null) {
			return;
		}
		if (isOpen) {
			node.removeAttribute("hidden");
			return;
		}
		node.setAttribute("hidden", "until-found");
		const onBeforeMatch = (): void => {
			revealRef.current();
		};
		// `beforematch` 只有 Chromium 系覆盖；别的引擎里折叠体仍是普通收起，不影响其它功能
		node.addEventListener("beforematch", onBeforeMatch);
		return () => node.removeEventListener("beforematch", onBeforeMatch);
	}, [isOpen]);
	return ref;
}

/** 归类对应的行首图标。 */ /** 归类对应的行首图标。 */
function categoryIcon(category: ToolCategory): ReactNode {
	switch (category) {
		case "command":
			return <Terminal size={ICON_SIZE.md} />;
		case "read":
			return <FileText size={ICON_SIZE.md} />;
		case "edit":
			return <Edit3 size={ICON_SIZE.md} />;
		case "search":
			return <Search size={ICON_SIZE.md} />;
		default:
			return <Wrench size={ICON_SIZE.md} />;
	}
}

/**
 * 一次工具调用。
 *
 * 一行里只有图标、短名与参数摘要，点开才看输出；输出没有边框与底色，直接跟在下面。
 */
/** 工具结果里的一张图片。进入视口附近才挂载 data URL，默认按行宽缩、限高，点一下回到原始尺寸。 */
function ToolImageThumb({ image, label }: { image: ToolImage; label: string }) {
	const [isActual, setActual] = useState(false);
	const [isNearViewport, setIsNearViewport] = useState(() => typeof IntersectionObserver === "undefined");
	const buttonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (isNearViewport) return;
		const node = buttonRef.current;
		if (node === null) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				setIsNearViewport(true);
				observer.disconnect();
			},
			{ rootMargin: "300px 0px" },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [isNearViewport]);

	return (
		<button
			ref={buttonRef}
			type="button"
			className={isNearViewport ? "tr-image" : "tr-image is-pending"}
			onClick={() => setActual((actual) => !actual)}
			aria-label={label}
			aria-pressed={isActual}
			style={{ cursor: isActual ? "zoom-out" : "zoom-in", overflowX: isActual ? "auto" : undefined }}
		>
			{isNearViewport ? (
				<img
					src={`data:${image.mimeType};base64,${image.data}`}
					alt={label}
					decoding="async"
					style={{ maxWidth: isActual ? "none" : undefined, maxHeight: isActual ? "none" : undefined }}
				/>
			) : (
				<span className="tr-image-placeholder" aria-hidden="true" />
			)}
		</button>
	);
}

function ToolRow({ part }: { part: ToolCallPart }) {
	const { t } = useI18n();
	const [isOpen, setOpen] = useState(false);
	const [isExpanded, setExpanded] = useState(false);
	// 参数完整内容的悬停浮层，与别处的提示共用一份实现
	const tip = useHoverTip();
	const output = part.output ?? "";
	// 展开给的就是工具结果原文：模型看到的那份，界面上不再删改任何一行
	const body = output;
	const folded = foldOutput(body);
	const isLong = folded.hiddenLines > 0;
	const shown = isLong && !isExpanded ? folded.preview : body;
	const target = toolTarget(part.input);
	// 摘要被截断时才有弹窗可看，没截断的话悬停不弹东西
	const detail = toolDetail(part.input);
	const hasDetail = detail.length > 0 && detail !== target;
	const kind = toolKind(part.name);
	const isRunning = part.status === "running";
	const outputBody = useUntilFound<HTMLDivElement>(isOpen, () => setOpen(true));

	return (
		<div className={`tr is-${part.status}`}>
			<button
				type="button"
				className="tr-head"
				onClick={() => setOpen((open) => !open)}
				aria-expanded={isOpen}
			>
				<span className="tr-icon">{categoryIcon(kind.category)}</span>
				{/* 运行中由短名与参数上的扫光表示，行尾不加状态标记 */}
				<span className={`tr-name${isRunning ? " is-live" : ""}`}>{kind.label}</span>
				{target.length === 0 ? null : (
					<span
						className={`tr-arg${isRunning ? " is-live" : ""}`}
						{...tip.handlers(hasDetail ? <pre>{detail}</pre> : undefined)}
					>
						{target}
					</span>
				)}
			</button>
			{/* 图片是结果的主体，不折在展开区里，点一下看原始大小 */}
			{part.images.length === 0 ? null : (
				<div className="tr-images">
					{part.images.map((image, index) => (
						<ToolImageThumb
							key={`${part.callId}-${image.mimeType}-${image.data.slice(0, 32)}`}
							image={image}
							label={t("transcript.imageLabel", { tool: kind.label, index: index + 1 })}
						/>
					))}
				</div>
			)}
			{body.length === 0 ? null : (
				<div className="tr-out" ref={outputBody}>
					<pre>{shown}</pre>
					{isLong && !isExpanded ? (
						<button type="button" className="tr-more" onClick={() => setExpanded(true)}>
							{t("transcript.folded", { count: folded.hiddenLines })}
						</button>
					) : null}
				</div>
			)}
			{tip.render()}
		</div>
	);
}

/** 一段思考。收起时只有一行，点开是正文。 */
function ThinkingRow({ text }: { text: string }) {
	const [isOpen, setOpen] = useState(false);
	const thinkingBody = useUntilFound<HTMLPreElement>(isOpen, () => setOpen(true));
	return (
		<div className="tr is-think">
			<button type="button" className="tr-head" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen}>
				<span className="tr-icon">
					<Brain size={ICON_SIZE.md} />
				</span>
				<span className="tr-name">Thinking</span>
			</button>
			<pre className="tr-think" ref={thinkingBody}>
				{text}
			</pre>
		</div>
	);
}

/** 一段内容。正文走 Markdown,思考与工具各自成块。 */
function PartView({ part, isStreaming }: { part: Part; isStreaming: boolean }) {
	if (part.kind === "text") {
		return <Markdown text={part.text} isStreaming={isStreaming} />;
	}
	if (part.kind === "thinking") {
		return <ThinkingRow text={part.text} />;
	}
	return <ToolRow part={part} />;
}

/** 这一行是否被用户中止。 */
function isAborted(row: DisplayRow): boolean {
	return row.items.some((item) => item.stopReason === "aborted");
}

/** 中止的提示,挂在被截断的那一行末尾。 */
function StoppedNote(): ReactNode {
	const { t } = useI18n();
	return <div className="stopped-line">{t("transcript.stopped")}</div>;
}

/** 答复行的正文:相邻的正文段合成一块 Markdown,思考与工具按原位置插入。 */
function bodyOf(row: DisplayRow): ReactNode[] {
	const nodes: ReactNode[] = [];
	let buffer: string[] = [];
	let index = 0;
	const flush = (isStreaming: boolean): void => {
		const text = buffer.join("\n\n").trim();
		buffer = [];
		if (text.length === 0) {
			return;
		}
		index += 1;
		nodes.push(
			<Markdown
				key={`md:${row.id}:${index}`}
				text={text}
				isStreaming={isStreaming}
				indexKey={`${row.id}:${index}`}
			/>,
		);
	};
	for (const item of row.items) {
		for (const part of item.parts) {
			if (part.kind === "text") {
				buffer.push(part.text);
				continue;
			}
			flush(item.isStreaming);
			nodes.push(<PartView key={`${item.id}-${part.partId}`} part={part} isStreaming={item.isStreaming} />);
		}
		flush(item.isStreaming);
	}
	if (nodes.length === 0) {
		nodes.push(
			<div key="empty" className="t3">
				(无正文)
			</div>,
		);
	}
	return nodes;
}

/**
 * 一行外壳。
 *
 * 正在流式写入的行带上 is-streaming：样式据此把它排除在视口裁剪之外，
 * 新增内容始终有真实的布局盒模型。
 */
function Shell({
	className,
	children,
	outlineKey,
	isStreaming = false,
}: {
	className: string;
	children: ReactNode;
	/** 对话导航的定位键，只在用户消息行上给 */
	outlineKey?: string;
	/** 这一行是否仍在增长 */
	isStreaming?: boolean;
}) {
	return (
		<div
			className={isStreaming ? `row ${className} is-streaming` : `row ${className}`}
			data-outline-key={outlineKey}
		>
			{children}
		</div>
	);
}

/** 一行要用到的状态与回调。 */
interface RowViewProps {
	/** 这一行 */
	row: DisplayRow;
	/** 用户收起过这一行，缺省按行的种类决定 */
	isCollapsed: boolean;
	/** 第一条用户消息的行标识，它前面没有可回退的轮次 */
	firstUserRowId: string | undefined;
	/** 分叉行要复制的原文：这一轮最后一条答复 */
	forkText: string;
	/** 最后一条用户消息的条目 id，重试按它重发 */
	retryEntryId: string | undefined;
	/** 最后一条用户消息的原文 */
	retryText: string;
	/** 计时的当前时刻，只有分叉行需要 */
	now: number | undefined;
	/** 是否允许分叉 */
	canFork: boolean;
	/** 是否允许回退 */
	canRevert: boolean;
	/** 切换这一行的收起状态 */
	onToggle: (row: DisplayRow) => void;
	onFork: (beforeEntryId: string | undefined) => void;
	onRevert: (entryId: string, text: string) => void;
	onRetryTurn?: ((entryId: string, text: string) => void) | undefined;
	onCopyDetails?: ((text: string) => void) | undefined;
	onCopyText?: ((text: string) => void) | undefined;
}

/**
 * 面板里的一行。
 *
 * 内容没变时行对象沿用的是同一个，回调身份也不变，这里直接跳过重渲染：流式期间每帧
 * 只有末尾那一两行真的重建。
 */
const RowView = memo(function RowView({
	row,
	isCollapsed,
	firstUserRowId,
	forkText,
	retryEntryId,
	retryText,
	now,
	canFork,
	canRevert,
	onToggle,
	onFork,
	onRevert,
	onRetryTurn,
	onCopyDetails,
	onCopyText,
}: RowViewProps): ReactNode {
	const { t } = useI18n();
	/*
	 * 收起体常驻 DOM 并标 `hidden="until-found"`：页内查找命中它时自动展开。
	 * 这个 Hook 必须在所有分支之前无条件跑一遍——同一个位置的行会换种类，按分支调用会让
	 * 两次渲染的 Hook 数量对不上。
	 */
	const groupBody = useUntilFound<HTMLDivElement>(!isCollapsed, () => onToggle(row));

	if (row.kind === "fork") {
		const fork = row.fork;
		if (fork === undefined) {
			return null;
		}
		// 收在这一轮的末尾：复制、分叉，右边是这一轮工作了多久；悬停才显形
		return (
			<Shell className="is-fork">
				<div className="turn-foot">
					<div className="turn-actions">
						{onCopyText === undefined || forkText.length === 0 || row.isStreaming ? null : (
							<CopyButton text={forkText} onCopy={onCopyText} />
						)}
						<MessageAction
							action="fork"
							label={t("transcript.fork")}
							disabled={fork.needsSettle && !canFork}
							onClick={() => onFork(fork.beforeEntryId)}
						>
							<Split size={ICON_SIZE.md} />
						</MessageAction>
					</div>
					{turnDurationText(row, now, t).length === 0 ? null : (
						<span className="turn-time">{turnDurationText(row, now, t)}</span>
					)}
				</div>
			</Shell>
		);
	}

	if (row.kind === "divider") {
		const text = row.items
			.flatMap((item) => item.parts)
			.map((part) => (part.kind === "text" ? part.text : ""))
			.join("");
		const label =
			row.items[0]?.kind === "compaction" ? t("transcript.compactionSummary") : t("transcript.branchSummary");
		return (
			<Shell className="is-divider">
				<details className="context-summary">
					<summary className="divider">
						<span className="line" />
						<ListCollapse size={ICON_SIZE.md} aria-hidden="true" />
						<span>{label}</span>
						<span className="context-summary-chevron" aria-hidden="true">
							<ChevronIcon isOpen={false} />
						</span>
						<span className="line" />
					</summary>
					<div className="context-summary-body">
						<Markdown text={text} isStreaming={false} indexKey={`summary:${row.id}`} />
					</div>
				</details>
			</Shell>
		);
	}

	if (row.kind === "error") {
		const text = textOf(row.items.flatMap((item) => item.parts));
		const message = text.length > 0 ? text : t("transcript.runError");
		// 重试按最后一条用户消息重发一次,失败的那条助手消息留在历史里
		const canRetry = onRetryTurn !== undefined && canRevert && retryEntryId !== undefined;
		// 一条带色底的提示：图标固定在左上，正文自己换行，动作是文字按钮
		return (
			<Shell className="is-error">
				<div className="error-line" role="alert">
					<CircleAlert className="error-mark" size={ICON_SIZE.lg} />
					<div className="error-body">
						<div className="error-text">{message}</div>
						{!canRetry && onCopyDetails === undefined ? null : (
							<div className="error-actions">
								{canRetry ? (
									<button
										type="button"
										className="error-btn"
										onClick={() => onRetryTurn(retryEntryId as string, retryText)}
									>
										{t("transcript.retry")}
									</button>
								) : null}
								{onCopyDetails === undefined ? null : (
									<button type="button" className="error-btn" onClick={() => onCopyDetails(message)}>
										{t("transcript.copyDetails")}
									</button>
								)}
							</div>
						)}
					</div>
				</div>
			</Shell>
		);
	}

	if (row.kind === "user") {
		const text = textOf(row.items.flatMap((item) => item.parts));
		// 回退要有落地过的条目:实时消息在提升之前没有条目 id
		const entryId = row.items[0]?.entryId;
		// 第一条用户消息之前没有可回退的轮次
		const canRevertThis = canRevert && entryId !== undefined && row.id !== firstUserRowId;
		return (
			<Shell className="is-user" outlineKey={entryId ?? row.id}>
				<div className="user-line">
					<div className="bub">{text}</div>
				</div>
				{!canRevertThis && onCopyText === undefined ? null : (
					<div className="user-foot">
						{onCopyText === undefined ? null : <CopyButton text={text} onCopy={onCopyText} isReveal />}
						{canRevertThis ? (
							<MessageAction
								action="revert"
								label={t("transcript.revert")}
								isReveal
								onClick={() => onRevert(entryId, text)}
							>
								<Undo2 size={ICON_SIZE.md} />
							</MessageAction>
						) : null}
					</div>
				)}
			</Shell>
		);
	}

	if (row.kind === "meta") {
		// 收起时是一行图标加标题，展开时标题变成药丸底、左侧换成下箭头
		return (
			<Shell className="is-process" isStreaming={row.isStreaming}>
				<div className="group">
					<button
						type="button"
						className={isCollapsed ? "group-head" : "group-head is-open"}
						onClick={() => onToggle(row)}
						aria-expanded={!isCollapsed}
						aria-label={t("transcript.process")}
					>
						<span className="group-icon">
							{isCollapsed ? <Wrench size={ICON_SIZE.md} /> : <TreeChevron isOpen />}
						</span>
						<span className={row.isStreaming ? "group-label is-live" : "group-label"}>
							{groupLabel(row, t)}
						</span>
					</button>
					<div className="group-body" ref={groupBody}>
						{row.items.flatMap((item) =>
							item.parts.map((part) => (
								<PartView key={`${item.id}-${part.partId}`} part={part} isStreaming={item.isStreaming} />
							)),
						)}
					</div>
					{isAborted(row) ? <StoppedNote /> : null}
				</div>
			</Shell>
		);
	}

	return (
		<Shell className="is-assistant" isStreaming={row.isStreaming}>
			<div className="assistant-body">
				{bodyOf(row)}
				{isAborted(row) ? <StoppedNote /> : null}
			</div>
		</Shell>
	);
});

/**
 * 对话面板。把渲染单元聚合成分行,并维护每行的收起状态。
 */
export function ChatTranscript({
	items,
	canFork,
	onFork,
	canRevert,
	onRevert,
	maintenance,
	onRetryTurn,
	onCopyDetails,
	onCopyText,
	emptyHint,
	renames,
	isRunning = false,
}: ChatTranscriptProps) {
	const { t } = useI18n();
	// 分组每帧都会重算，内容没变的行沿用上一帧的对象，行组件据此跳过重渲染
	const lastRows = useRef<DisplayRow[]>([]);
	const rows = useMemo(() => {
		const next = reuseRows(lastRows.current, groupRows(items, { running: isRunning }));
		lastRows.current = next;
		return next;
	}, [items, isRunning]);
	const retry = maintenance?.kind === "retry" ? maintenance : undefined;
	const isCompacting = maintenance?.kind === "compaction";
	// 第一条用户消息之前没有可回退的轮次
	const firstUserRowId = rows.find((row) => row.kind === "user")?.id;
	const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
	const isTicking = isTurnTimingLive(rows);
	const now = useNow(isTicking);
	// 重试开始的时刻,倒计时以它为准;重试结束或次数变化时重新计时
	const retryKey = retry === undefined ? undefined : `${retry.attempt}/${retry.maxAttempts}`;
	const [retryStartedAt, setRetryStartedAt] = useState<number | undefined>(undefined);
	useEffect(() => {
		setRetryStartedAt(retryKey === undefined ? undefined : Date.now());
	}, [retryKey]);

	// 一轮结束、消息提升为历史消息后行标识会变，把按旧标识保存的收起状态搬到新标识上
	useEffect(() => {
		if (renames === undefined) {
			return;
		}
		setOverrides((previous) => {
			let next: Map<string, boolean> | undefined;
			for (const [from, to] of Object.entries(renames)) {
				const value = previous.get(from);
				if (value === undefined) {
					continue;
				}
				next ??= new Map(previous);
				next.delete(from);
				if (!next.has(to)) {
					next.set(to, value);
				}
			}
			return next ?? previous;
		});
	}, [renames]);

	const toggle = useCallback((row: DisplayRow) => {
		setOverrides((previous) => {
			const next = new Map(previous);
			const current = previous.get(row.id) ?? isCollapsedByDefault(row.kind);
			next.set(row.id, !current);
			return next;
		});
	}, []);

	// 行文本按行对象缓存：行没换就不必重新拼接正文，流式期间只算变化的那一行
	const rowTexts = useRef(new WeakMap<DisplayRow, string>());
	const textFor = useCallback((row: DisplayRow): string => {
		const cached = rowTexts.current.get(row);
		if (cached !== undefined) {
			return cached;
		}
		const text = textOf(row.items.flatMap((item) => item.parts));
		rowTexts.current.set(row, text);
		return text;
	}, []);

	// 分叉行要复制的是这一轮最后一条答复，重试要的是最后一条用户消息，都先配好，
	// 行组件就不依赖渲染顺序
	const { forkTexts, retryEntryId, retryText } = useMemo(() => {
		const texts = new Map<string, string>();
		let lastAnswer = "";
		let lastUser: DisplayRow | undefined;
		for (const row of rows) {
			if (row.kind === "assistant") {
				lastAnswer = textFor(row);
				continue;
			}
			if (row.kind === "user") {
				lastUser = row;
				continue;
			}
			if (row.kind === "fork") {
				texts.set(row.id, lastAnswer);
			}
		}
		return {
			forkTexts: texts,
			retryEntryId: lastUser?.items[0]?.entryId,
			retryText: lastUser === undefined ? "" : textFor(lastUser),
		};
	}, [rows, textFor]);

	if (rows.length === 0 && maintenance === undefined) {
		return <div className="empty">{emptyHint ?? t("transcript.empty")}</div>;
	}

	return (
		<>
			{rows.map((row) => (
				<RowView
					key={row.id}
					row={row}
					isCollapsed={overrides.get(row.id) ?? isCollapsedByDefault(row.kind)}
					firstUserRowId={firstUserRowId}
					forkText={forkTexts.get(row.id) ?? ""}
					retryEntryId={retryEntryId}
					retryText={retryText}
					now={row.kind === "fork" ? now : undefined}
					canFork={canFork}
					canRevert={canRevert}
					onToggle={toggle}
					onFork={onFork}
					onRevert={onRevert}
					onRetryTurn={onRetryTurn}
					onCopyDetails={onCopyDetails}
					onCopyText={onCopyText}
				/>
			))}

			{isCompacting ? (
				<Shell className="is-divider">
					<div className="divider" role="status" aria-live="polite" aria-busy="true">
						<span className="line" />
						<ListCollapse size={ICON_SIZE.md} aria-hidden="true" />
						<span className="group-label is-live">{t("transcript.compactionSummary")}</span>
						<span className="line" />
					</div>
				</Shell>
			) : null}

			{retry ? (
				<Shell className="is-retry" key="retry">
					<div className="retry-line">
						<span className="chip is-warn">
							<i className="dot is-warn pulse" />
							{t("transcript.retryAttempt", { attempt: retry.attempt, max: retry.maxAttempts })}
						</span>
						{retryDelayText(retry.delayMs, retryStartedAt, now, t) === undefined ? null : (
							<span className="t2">{retryDelayText(retry.delayMs, retryStartedAt, now, t)}</span>
						)}
					</div>
				</Shell>
			) : null}
		</>
	);
}
