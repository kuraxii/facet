/**
 * 对话面板。
 *
 * 把渲染单元聚合成一行一行，并维护每行的收起状态：流式追加内容时不会把用户收起过的行重新展开。
 * 默认只有过程行与文件改动行收起,其余行展开。每行怎么画在 `row-view.tsx`，过程行的部件在
 * `row-parts.tsx`，外壳与计时在 `row-shell.tsx`，消息里的图片在 `message-images.tsx`。
 */
import type { MessageImage, TranscriptItem } from "@facet/client-core";
import type { Maintenance } from "@facet/protocol";
import { ListCollapse } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { type DisplayRow, groupRows, isTurnTimingLive, reuseRows } from "./group.ts";
import { imagesOf } from "./message-images.tsx";
import { forgetRowMeasure, measureStaleRows, ROW_MEASURE_SETTLE_MS } from "./row-measure.ts";
import { isCollapsedByDefault, retryDelayText, Shell, textOf, useNow } from "./row-shell.tsx";
import { RowView } from "./row-view.tsx";

/** 没有附带图片时共用这一份空数组，行复用时不必每帧新建。 */
const NO_IMAGES: readonly MessageImage[] = [];

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
	/** 回退到这条用户消息之前的一轮末尾,连同这条消息的文本与图片一起带出 */
	onRevert: (entryId: string, text: string, images: readonly MessageImage[]) => void;
	maintenance?: Maintenance | undefined;
	/** 重试这一轮:按最后一条用户消息重新发一次,不重复添加用户消息 */
	onRetryTurn?: ((entryId: string, text: string, images: readonly MessageImage[]) => void) | undefined;
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
	/** 正文的滚动容器：增量测高与翻页锚定都在它上面做 */
	scrollElement?: HTMLElement | null;
}

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
	scrollElement = null,
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
	/*
	 * 增量测高（`row-measure.ts`）的第一个入口：结构变化之后、首绘之前。
	 *
	 * 新翻上来的一页就是这里唯一的脏行；量完把真实高度写回行内尺寸，再按"测量后高度减去上一帧
	 * 高度"把视口钉回原来那一行——原来那套 `scrollTop = scrollHeight - 距底距离` 的锚定跑在
	 * rAF 里，锚定那一刻用的还是 64px 的估算值，翻页后视口会先错一帧。
	 */
	const structure = useRef<{ firstId: string; count: number; height: number } | null>(null);
	useLayoutEffect(() => {
		if (scrollElement === null) {
			return;
		}
		const firstId = rows[0]?.id ?? "";
		const previous = structure.current;
		// 首行换了、但原来那行还在列表里 —— 这是前插（翻页），不是换会话
		const prepended =
			previous !== null &&
			previous.firstId !== "" &&
			previous.firstId !== firstId &&
			rows.some((row) => row.id === previous.firstId);
		if (previous === null || prepended || previous.count !== rows.length) {
			measureStaleRows(scrollElement);
		}
		if (prepended && previous !== null) {
			scrollElement.scrollTop += scrollElement.scrollHeight - previous.height;
		}
		structure.current = { firstId, count: rows.length, height: scrollElement.scrollHeight };
	}, [rows, scrollElement]);

	/*
	 * 第二个入口：尺寸停稳之后重测。
	 *
	 * 改宽度会让每一行的真实高度都变，写回的值全部作废。重测前记下视口里第一行的顶边，写回之后
	 * 按差值把 `scrollTop` 补回去，免得太晚（停稳 150ms）才重排、阅读位置忽然挪一下。
	 * 滚动容器上是 `overflow-anchor: none`，浏览器不会自己再做一次补偿。
	 */
	/** 视口里第一行与它的顶边：改宽之前就得记下来，否则布局已经变了再量，补偿无从谈起 */
	const anchor = useRef<{ element: HTMLElement | null; top: number }>({ element: null, top: 0 });
	useEffect(() => {
		if (scrollElement === null) {
			return;
		}
		const element = scrollElement;
		/*
		 * 滚动与测量之后各记一次锚点。只在滚动时读一次布局，滚动路径上本来就要读，不额外花钱；
		 * 拖宽/改窗口那两个动作不会触发滚动，所以这里记下的就是"变宽之前的顶边"。
		 */
		const remember = (): void => {
			const containerTop = element.getBoundingClientRect().top;
			const row = Array.from(element.querySelectorAll<HTMLElement>(".row")).find(
				(candidate) => candidate.getBoundingClientRect().bottom > containerTop + 8,
			);
			anchor.current = { element: row ?? null, top: row === undefined ? 0 : row.getBoundingClientRect().top };
		};
		remember();
		element.addEventListener("scroll", remember, { passive: true });
		let timer = 0;
		const settle = (): void => {
			const result = measureStaleRows(element);
			const pinned = anchor.current;
			if (result.dirty > 0 && pinned.element !== null && pinned.element.isConnected) {
				element.scrollTop += pinned.element.getBoundingClientRect().top - pinned.top;
			}
			remember();
		};
		const observer = new ResizeObserver(() => {
			window.clearTimeout(timer);
			timer = window.setTimeout(settle, ROW_MEASURE_SETTLE_MS);
		});
		observer.observe(element);
		return () => {
			window.clearTimeout(timer);
			element.removeEventListener("scroll", remember);
			observer.disconnect();
		};
	}, [scrollElement]);

	/*
	 * 内容变了就把那行记为脏，等下一次测量重取高度。
	 *
	 * 只看 DOM 变动，不看渲染次数：流式期间每帧都在改，但那一行始终在视口里，`auto` 自己会跟住
	 * 它的尺寸，重测反而白花；视口外没人看，等下次按宽度扫的时候一起量就行。
	 * 只删记录、不动已经写回的行内尺寸，免得离屏行瞬间缩回 64px 把滚动条抖一截。
	 */
	useEffect(() => {
		if (scrollElement === null) {
			return;
		}
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				const target = record.target instanceof Element ? record.target : record.target.parentElement;
				const row = target?.closest(".row") ?? null;
				if (row === null || row.classList.contains("is-streaming")) {
					continue;
				}
				forgetRowMeasure(row);
			}
		});
		observer.observe(scrollElement, { childList: true, subtree: true, characterData: true });
		return () => observer.disconnect();
	}, [scrollElement]);

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
	const { forkTexts, retryEntryId, retryText, retryImages } = useMemo(() => {
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
			retryImages: lastUser === undefined ? NO_IMAGES : imagesOf(lastUser.items),
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
					retryImages={retryImages}
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
