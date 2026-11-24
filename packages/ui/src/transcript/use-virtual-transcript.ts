/**
 * 对话面板的虚拟化。
 *
 * 面板按「行」虚拟化：只有视口附近的行真的挂载，滚出去的收掉。行的位置不用绝对定位算，
 * 而是靠 `.column.chat-grid` 的正常流加前后留白撑（见 `virtual-anchor.ts`），三列轨道与
 * `row-gap` 因此原样保留。
 *
 * 这几件事交给 `@tanstack/react-virtual` 自己做，这边不另写一套：
 * - **向上补历史**：`anchorTo: "end"` 按行的 key 记住视口顶部那一行与行内偏移，前面的行插进来
 *   之后把滚动位置按 key 摆回去，不靠像素相减；
 * - **异步增高**：实测高度按 key 记在虚拟化器里，视口上方那一行变高时按差值补滚动位置
 *   （正在往上翻的当帧不补，否则会把回看的视口往下推）；
 * - **贴底**：已经在底部时内容变高，按总高差值跟到底。
 *
 * 这边补它不认的三件事：拖选跨行时要钉住一段连续的行（`extractPinnedRange`）、切会话时按
 * （行标识, 行内偏移）记住并恢复位置（定位接口在 `transcript-viewport.ts`），以及把「滚到底」
 * 这类程序化滚动也交给它写——绕开它直接写 `scrollTop` 会让它以为视口被别人挪走，之后的补偿
 * 全按旧位置算。
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useMemo, useState } from "react";
import { JUMP_LEAD } from "../chat/chat-outline.ts";
import { TRANSCRIPT_DATA_ATTRS } from "../layout/layout-contract.ts";
import type { DisplayRow } from "./group.ts";
import { type TranscriptViewport, useTranscriptViewport } from "./transcript-viewport.ts";
import type { SelectionPin } from "./use-selection-pin.ts";
import {
	buildGridPlan,
	estimateRowHeight,
	extractPinnedRange,
	type GridPlan,
	VIRTUAL_JUMP_OVERSCAN,
	VIRTUAL_OVERSCAN,
	VIRTUAL_ROW_GAP,
	VIRTUAL_SCROLL_MARGIN,
} from "./virtual-anchor.ts";

export type { TranscriptViewport } from "./transcript-viewport.ts";

/** 没有标识迁移时共用这一份空表。 */
const NO_RENAMES: Readonly<Record<string, string>> = {};

/** 虚拟化之后面板需要的东西。 */
export interface VirtualTranscript {
	/** `.column` 这一帧的前后留白与需要插的占位块 */
	readonly plan: GridPlan;
	/** 挂到每一行根节点上的测量回调 */
	readonly measureRow: (node: HTMLElement | null) => void;
}

export interface VirtualTranscriptOptions {
	/** 这一帧的行 */
	readonly rows: readonly DisplayRow[];
	/** 某一行当前是不是收起的，只用来把未测量的行估得更接近 */
	readonly isCollapsed: (row: DisplayRow) => boolean;
	/** 滚动容器 */
	readonly scrollElement: HTMLElement | null;
	/** 拖选跨过的两行 */
	readonly selection: SelectionPin;
	/** 实时消息提升为历史消息时的标识迁移，位置恢复要按它认亲 */
	readonly renames: Readonly<Record<string, string>> | undefined;
	/** 定位接口交给调用方，它据此驱动对话导航与位置恢复 */
	readonly viewportRef: { current: TranscriptViewport | null };
	/** 位置恢复失败（那一行已经不在窗口里）时的落点，通常是回到底部 */
	readonly onRestoreLost?: (() => void) | undefined;
	/** 此刻是否贴着底：贴底时底部由跟随逻辑守，虚拟化器不许自己挪位置 */
	readonly pinned: boolean;
}

/** 建一次虚拟化器与定位接口。`rows` 换一帧就跟着重算可见窗口。 */
export function useVirtualTranscript(options: VirtualTranscriptOptions): VirtualTranscript {
	const { rows, isCollapsed, scrollElement, selection, renames, viewportRef, onRestoreLost, pinned } =
		options;

	/** 行标识到下标：拖选钉行与按标识定位都查它 */
	const rowIndexById = useMemo(() => {
		const index = new Map<string, number>();
		for (let at = 0; at < rows.length; at += 1) {
			const row = rows[at];
			if (row !== undefined) {
				index.set(row.id, at);
			}
		}
		return index;
	}, [rows]);

	/** 对话导航的键到行下标：用户消息行上记的是条目 id，与竖轨里的键同源 */
	const outlineIndex = useMemo(() => {
		const index = new Map<string, number>();
		for (let at = 0; at < rows.length; at += 1) {
			const row = rows[at];
			if (row?.kind !== "user") {
				continue;
			}
			index.set(row.items[0]?.entryId ?? row.id, at);
		}
		return index;
	}, [rows]);

	const rowIndexOf = useCallback(
		(rowId: string): number | undefined => rowIndexById.get(rowId),
		[rowIndexById],
	);

	/** 曲线是否在跑：跑的这段时间只挂落点那一窗附近的行，落位后再放开 */
	const [isMoving, setIsMoving] = useState(false);

	const virtualizer = useVirtualizer<HTMLElement, HTMLElement>({
		count: rows.length,
		getScrollElement: () => scrollElement,
		getItemKey: (index) => rows[index]?.id ?? `row-missing:${index}`,
		/*
		 * 行的"占用高度"要含上下外边距：`.row.is-fork` 用 `margin-top: -6px` 让分叉行贴近上一轮，
		 * 只按边框盒量的话，每个分叉行都会在窗口里凭空多出 6px，一路累加下去——跳转落点会比
		 * 目标高十几像素，竖轨判当前轮次也就跟着错一格。虚拟化器的坐标只认"盒 + 固定行距"，
		 * 所以外边距必须折进行高。
		 */
		measureElement: (element) => {
			const style = getComputedStyle(element);
			const margin = (Number.parseFloat(style.marginTop) || 0) + (Number.parseFloat(style.marginBottom) || 0);
			return Math.round(element.getBoundingClientRect().height + margin);
		},
		estimateSize: (index) => {
			const row = rows[index];
			return row === undefined ? 0 : estimateRowHeight(row, isCollapsed(row));
		},
		// 行与行的距离由 CSS 的 row-gap 给；虚拟化器按同一个数算坐标，占位块才对得上
		gap: VIRTUAL_ROW_GAP,
		// 列表从 `.scroll` 的上内边距之后开始排，虚拟坐标与 DOM 偏移差这一档
		scrollMargin: VIRTUAL_SCROLL_MARGIN,
		/*
		 * 起点取容器此刻的 `scrollTop`。虚拟化器只在滚动事件里读位置（`observeElementOffset`
		 * 不回调初值），而面板会随会话重挂、容器却停在原处：不给起点的话它以为自己在 0，
		 * 于是画顶部那一窗，而容器没动、也不会再派滚动事件，进会话就停在最上面。
		 */
		initialOffset: () => scrollElement?.scrollTop ?? 0,
		// 跳转落点上方留出的空隙，与定位接口量位置时用同一个数
		scrollPaddingStart: JUMP_LEAD,
		overscan: isMoving ? VIRTUAL_JUMP_OVERSCAN : VIRTUAL_OVERSCAN,
		// 头部插入的新行按 key 锚回原位；已经在底部时按总高差值跟到底
		anchorTo: "end",
		indexAttribute: TRANSCRIPT_DATA_ATTRS.rowIndex,
		// React 19 里在生命周期内调 flushSync 会报警，这里让 React 自己合批
		useFlushSync: false,
		rangeExtractor: (range) => extractPinnedRange({ range, selection, rowIndexOf }),
	});

	const plan = buildGridPlan({
		items: virtualizer.getVirtualItems(),
		totalSize: virtualizer.getTotalSize(),
		gap: VIRTUAL_ROW_GAP,
		scrollMargin: VIRTUAL_SCROLL_MARGIN,
	});

	useTranscriptViewport({
		rows,
		scrollElement,
		outlineIndex,
		rowIndexById,
		renames: renames ?? NO_RENAMES,
		onMotionRunningChange: setIsMoving,
		virtualizer,
		pinned,
		onRestoreLost,
		viewportRef,
	});

	return { plan, measureRow: virtualizer.measureElement };
}
