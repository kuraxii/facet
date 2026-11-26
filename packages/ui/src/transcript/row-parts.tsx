/**
 * 过程行里的部件：思考行、工具行、工具结果里的图片，以及把渲染段铺成正文的逻辑。
 *
 * 只负责把投影好的 `Part` 画出来，不认识行与收起状态；行外壳与对话面板在 `rows.tsx`。
 */
import type { Part, ToolCallPart, ToolImage } from "@facet/client-core";
import { Brain, Edit3, FileText, Search, Terminal, Wrench } from "lucide-react";
import {
	memo,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { useImagePreview } from "../image/image-preview.tsx";
import type { ImagePreviewItem } from "../image/image-preview-types.ts";
import { Markdown } from "../markdown/Markdown.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";
import type { DisplayRow } from "./group.ts";
import { useUntilFound } from "./row-shell.tsx";
import { foldOutput, type ToolCategory, toolDetail, toolKind, toolTarget } from "./tool-text.ts";

/** 归类对应的行首图标。 */
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
/**
 * 工具结果里的一张图片。
 *
 * 进入视口附近才挂载 data URL；显示尺寸由行宽与 `--tool-image-height` 定死，点它不会就地
 * 放大、也不会把行撑开，而是交给全局图片预览。
 */
function ToolImageThumb({
	image,
	label,
	onOpen,
}: {
	image: ToolImage;
	label: string;
	onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
	const [isNearViewport, setIsNearViewport] = useState(() => typeof IntersectionObserver === "undefined");
	const imageRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (isNearViewport) return;
		const node = imageRef.current;
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

	const source = `data:${image.mimeType};base64,${image.data}`;
	return (
		<button
			ref={imageRef}
			type="button"
			className={isNearViewport ? "tr-image" : "tr-image is-pending"}
			aria-label={label}
			onClick={onOpen}
		>
			{isNearViewport ? (
				<img src={source} alt={label} decoding="async" />
			) : (
				<span className="tr-image-placeholder" aria-hidden="true" />
			)}
		</button>
	);
}

/**
 * 一条工具调用。
 *
 * `memo` 是流式期间的关键：正在写的那条消息每帧都会重投影一次，而它已经结束的工具调用会沿用
 * 上一次的段对象（见 `toTranscript` 的 `parts` 缓存），这里据此直接跳过——不然一轮里几十个
 * 工具行会跟着每一帧重算 `toolTarget`/`foldOutput`、重建图标、重写 DOM。
 */
const ToolRow = memo(function ToolRow({ part }: { part: ToolCallPart }) {
	const { t } = useI18n();
	const [isOpen, setOpen] = useState(false);
	const [isExpanded, setExpanded] = useState(false);
	const openImagePreview = useImagePreview();
	// 参数全文的悬停浮层：里面能滚动，指针离开后留一段宽限才收（见 `HoverTipOptions`）
	const tip = useHoverTip({ holdOnLeave: true });
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
	/** 这一行的图片既是缩略图的数据源，也是预览里那一组：点第几张就从第几张开始翻 */
	const imageItems = useMemo<ImagePreviewItem[]>(
		() =>
			part.images.map((image, index) => ({
				src: `data:${image.mimeType};base64,${image.data}`,
				alt: t("transcript.imageLabel", { tool: kind.label, index: index + 1 }),
			})),
		[part.images, kind.label, t],
	);
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
			{/* 图片是结果的主体，不折在展开区里；点开是全局预览，同一行的几张可以左右翻 */}
			{part.images.length === 0 ? null : (
				<div className="tr-images">
					{part.images.map((image, index) => (
						<ToolImageThumb
							key={`${part.callId}-${image.mimeType}-${image.data.slice(0, 32)}`}
							image={image}
							label={imageItems[index]?.alt ?? ""}
							onOpen={(event) => openImagePreview({ items: imageItems, index, source: event.currentTarget })}
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
});

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

/**
 * 一段内容。正文走 Markdown,思考与工具各自成块。
 *
 * 同样 `memo`：段对象没变就不重渲染。正文段的字符串没变时 `Markdown` 自己也会跳过解析，
 * 这里先跳一层能省下每次投影重建几十个元素的钱。
 */
export const PartView = memo(function PartView({ part, isStreaming }: { part: Part; isStreaming: boolean }) {
	if (part.kind === "text") {
		return <Markdown text={part.text} isStreaming={isStreaming} />;
	}
	if (part.kind === "thinking") {
		return <ThinkingRow text={part.text} />;
	}
	if (part.kind === "image") {
		// 图片由行级别的缩略图条统一渲染（见 `message-images.tsx`），这里不再画一份
		return null;
	}
	return <ToolRow part={part} />;
});

/** 这一行是否被用户中止。 */
export function isAborted(row: DisplayRow): boolean {
	return row.items.some((item) => item.stopReason === "aborted");
}

/** 中止的提示,挂在被截断的那一行末尾。 */
export function StoppedNote(): ReactNode {
	const { t } = useI18n();
	return <div className="stopped-line">{t("transcript.stopped")}</div>;
}

/** 答复行的正文:相邻的正文段合成一块 Markdown,思考与工具按原位置插入。 */
export function bodyOf(row: DisplayRow): ReactNode[] {
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
