/**
 * 对话面板。
 *
 * 把渲染单元聚合成一行一行，并维护每行的收起状态：流式追加内容时不会把用户收起过的行重新展开。
 * 默认只有过程行收起,其余行展开。每行怎么画在 `row-view.tsx`，过程行的部件在
 * `row-parts.tsx`，外壳与计时在 `row-shell.tsx`，消息里的图片在 `message-images.tsx`。
 *
 * 面板自己就是 `.column.chat-grid` 那一层：给不给滚动容器决定了要不要虚拟化——给了就只挂
 * 视口附近的行，并用前后留白撑出真实高度（`use-virtual-transcript.ts`）；没给（静态渲染、
 * 单测）就整段渲染，行组件与收起状态两边完全一致。
 */
import type { MessageImage, TranscriptItem } from "@facet/client-core";
import type { Maintenance } from "@facet/protocol";
import { ListCollapse } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { type DisplayRow, groupRows, isTurnTimingLive, reuseRows } from "./group.ts";
import { imagesOf } from "./message-images.tsx";
import { isCollapsedByDefault, retryDelayText, Shell, textOf, useNow } from "./row-shell.tsx";
import { RowView } from "./row-view.tsx";
import { useSelectionPin } from "./use-selection-pin.ts";
import { type TranscriptViewport, useVirtualTranscript } from "./use-virtual-transcript.ts";
import type { GridSegment } from "./virtual-anchor.ts";

/** 没有附带图片时共用这一份空数组，行复用时不必每帧新建。 */
const NO_IMAGES: readonly MessageImage[] = [];

/** 正文所在的那一层：三列网格与「引用」的选区范围都挂在它上面。 */
const COLUMN_CLASS = "column chat-grid";

/** 压缩进度与重试各占一行，标识只用来满足外壳的必填项，不参与虚拟化的行表。 */
const COMPACTING_ROW_ID = "maintenance:compaction";
const RETRY_ROW_ID = "maintenance:retry";

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
	/** 滚动容器：给了就只挂视口附近的行，不给就整段渲染 */
	scrollElement?: HTMLElement | null | undefined;
	/** 定位接口交出去：对话导航与切会话的位置恢复都走它 */
	viewportRef?: { current: TranscriptViewport | null } | undefined;
	/** 位置恢复失败（那一行已经不在窗口里）时的落点，通常是回到底部 */
	onRestoreLost?: (() => void) | undefined;
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
	viewportRef,
	onRestoreLost,
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

	const [column, setColumn] = useState<HTMLDivElement | null>(null);
	/** 调用方没要定位接口时用的空引用，接口写进来也没人读 */
	const ownViewport = useRef<TranscriptViewport | null>(null);
	const isVirtual = scrollElement !== null;
	const selection = useSelectionPin(column, isVirtual);
	const { plan, measureRow } = useVirtualTranscript({
		rows,
		isCollapsed: (row) => overrides.get(row.id) ?? isCollapsedByDefault(row.kind),
		scrollElement,
		selection,
		renames,
		viewportRef: viewportRef ?? ownViewport,
		onRestoreLost,
	});

	if (rows.length === 0 && maintenance === undefined) {
		return (
			<div className={COLUMN_CLASS} data-quote-source ref={setColumn}>
				<div className="empty">{emptyHint ?? t("transcript.empty")}</div>
			</div>
		);
	}

	// 虚拟化时只画视口附近的行，占位块补齐跳过的那些；否则整段按顺序画
	const slots: readonly GridSegment[] = isVirtual
		? plan.segments
		: rows.map((_, index) => ({ kind: "row", index }));

	return (
		<div
			className={COLUMN_CLASS}
			data-quote-source
			ref={setColumn}
			style={
				isVirtual
					? { paddingTop: `${plan.paddingTop}px`, paddingBottom: `${plan.paddingBottom}px` }
					: undefined
			}
		>
			{slots.map((slot) => {
				if (slot.kind === "spacer") {
					// 两端不相邻的块之间的空白：高度已扣掉两侧的 row-gap，不画任何东西
					return <div key={slot.key} aria-hidden="true" style={{ height: `${slot.height}px` }} />;
				}
				const row = rows[slot.index];
				if (row === undefined) {
					return null;
				}
				return (
					<RowView
						key={row.id}
						row={row}
						rowIndex={isVirtual ? slot.index : undefined}
						measureRef={isVirtual ? measureRow : undefined}
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
				);
			})}

			{isCompacting ? (
				<Shell className="is-divider" rowId={COMPACTING_ROW_ID}>
					<div className="divider" role="status" aria-live="polite" aria-busy="true">
						<span className="line" />
						<ListCollapse size={ICON_SIZE.md} aria-hidden="true" />
						<span className="group-label is-live">{t("transcript.compactionSummary")}</span>
						<span className="line" />
					</div>
				</Shell>
			) : null}

			{retry ? (
				<Shell className="is-retry" rowId={RETRY_ROW_ID}>
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
		</div>
	);
}
