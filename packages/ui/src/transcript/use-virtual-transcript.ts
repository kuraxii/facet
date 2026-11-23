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
 * （行标识, 行内偏移）记住并恢复位置，以及把「滚到底」这类程序化滚动也交给它写——绕开它直接写
 * `scrollTop` 会让它以为视口被别人挪走，之后的补偿全按旧位置算。
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { TRANSCRIPT_DATA_ATTRS } from "../layout/layout-contract.ts";
import type { DisplayRow } from "./group.ts";
import type { SelectionPin } from "./use-selection-pin.ts";
import {
	buildGridPlan,
	estimateRowHeight,
	extractPinnedRange,
	type GridPlan,
	type TranscriptAnchor,
	VIRTUAL_OVERSCAN,
	VIRTUAL_ROW_GAP,
	VIRTUAL_SCROLL_MARGIN,
} from "./virtual-anchor.ts";

/** 跳到某一行时在它上面留出的空隙（px），别让那一条贴着视口上沿的渐隐。 */
const JUMP_LEAD = 12;

/** 落位校准最多等多少帧（平滑滚动 + 目标行测量）。 */
const SETTLE_FRAMES = 60;

/**
 * 面板对外的定位接口。
 *
 * 对话导航（竖轨）与切会话的滚动记忆都走这里：它们只需要「某一行在哪」与「跳到某一行」，
 * 不该知道虚拟化器怎么算。行没挂载也能量到位置——这正是虚拟化要解决的矛盾。
 */
export interface TranscriptViewport {
	/** 一行（按导航键）的顶边相对视口上沿的偏移；没有这一行时返回 `undefined` */
	offsetOf(key: string): number | undefined;
	/** 把一行滚到视口顶部附近 */
	jumpTo(key: string): void;
	/** 滚到最底部；写入交给虚拟化器，它才知道这次滚动是自己做的 */
	scrollToEnd(behavior?: ScrollBehavior): void;
	/** 记下视口顶部那一行与行内偏移；没有内容时返回 `null` */
	capture(): TranscriptAnchor | null;
	/** 恢复到记下的位置；行还没到齐时先挂着，等行到齐再落位 */
	restore(anchor: TranscriptAnchor): void;
}

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
	/** 定位接口交给调用方，它据此驱动对话导航与位置恢复 */
	readonly viewportRef: { current: TranscriptViewport | null };
}

/** 建一次虚拟化器与定位接口。`rows` 换一帧就跟着重算可见窗口。 */
export function useVirtualTranscript(options: VirtualTranscriptOptions): VirtualTranscript {
	const { rows, isCollapsed, scrollElement, selection, viewportRef } = options;

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

	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollElement,
		getItemKey: (index) => rows[index]?.id ?? `row-missing:${index}`,
		estimateSize: (index) => {
			const row = rows[index];
			return row === undefined ? 0 : estimateRowHeight(row, isCollapsed(row));
		},
		// 行与行的距离由 CSS 的 row-gap 给；虚拟化器按同一个数算坐标，占位块才对得上
		gap: VIRTUAL_ROW_GAP,
		// 列表从 `.scroll` 的上内边距之后开始排，虚拟坐标与 DOM 偏移差这一档
		scrollMargin: VIRTUAL_SCROLL_MARGIN,
		// 跳转落点上方留一点空隙，同上「留白」，横向滚动的对齐也用它
		scrollPaddingStart: JUMP_LEAD,
		overscan: VIRTUAL_OVERSCAN,
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

	/**
	 * 定位接口只建一次：对话导航在滚动里逐帧读它，身份一变就要重挂监听。
	 * 会变的东西（行、虚拟化器、滚动容器）都从 ref 里现取。
	 */
	const latest = useRef({ rows, virtualizer, scrollElement, outlineIndex, rowIndexById });
	latest.current = { rows, virtualizer, scrollElement, outlineIndex, rowIndexById };
	/** 还没落位的位置恢复，等那一行出现 */
	const pendingRestore = useRef<TranscriptAnchor | null>(null);

	/**
	 * 落位之后按真实 DOM 再对一次。
	 *
	 * 还没测量过的行只有估高，长距离跳转的落点会差出一小段；等到位置不再变化（平滑滚动走完、
	 * 目标行也挂上了），按那一行的实际矩形补一次差，偏差在 2px 以内就不动。
	 */
	const calibrate = useCallback((index: number, lead: number) => {
		let frames = 0;
		let stable = 0;
		let lastTop = Number.NaN;
		const step = (): void => {
			frames += 1;
			const element = latest.current.scrollElement;
			if (element === null) {
				return;
			}
			const top = element.scrollTop;
			stable = Math.abs(top - lastTop) < 0.5 ? stable + 1 : 0;
			lastTop = top;
			if (stable >= 2 || frames > SETTLE_FRAMES) {
				const row = element.querySelector<HTMLElement>(`[${TRANSCRIPT_DATA_ATTRS.rowIndex}="${index}"]`);
				if (row !== null) {
					const offset = row.getBoundingClientRect().top - element.getBoundingClientRect().top;
					if (Math.abs(offset - lead) > 2) {
						latest.current.virtualizer.scrollToOffset(top + (offset - lead), { behavior: "auto" });
					}
				}
				return;
			}
			window.requestAnimationFrame(step);
		};
		window.requestAnimationFrame(step);
	}, []);

	const applyRestore = useCallback(
		(anchor: TranscriptAnchor): boolean => {
			const { virtualizer: scroller, rowIndexById: index } = latest.current;
			const target = index.get(anchor.rowId);
			if (target === undefined) {
				return false;
			}
			const offset = scroller.getOffsetForIndex(target, "start");
			if (offset === undefined) {
				return false;
			}
			// `getOffsetForIndex("start")` 已经扣掉跳转留白；这里要的是行顶边，得加回来
			scroller.scrollToOffset(offset[0] + JUMP_LEAD + anchor.offsetInRow, { behavior: "auto" });
			calibrate(target, anchor.offsetInRow);
			return true;
		},
		[calibrate],
	);

	const viewport = useMemo<TranscriptViewport>(
		() => ({
			offsetOf(key) {
				const { virtualizer: scroller, outlineIndex: index, scrollElement: element } = latest.current;
				const target = index.get(key);
				if (target === undefined) {
					return undefined;
				}
				const offset = scroller.getOffsetForIndex(target, "start");
				if (offset === undefined) {
					return undefined;
				}
				// 量位置要的是行顶边到视口上沿的距离：扣掉的留白加回来
				return offset[0] + JUMP_LEAD - (element?.scrollTop ?? 0);
			},
			jumpTo(key) {
				const target = latest.current.outlineIndex.get(key);
				if (target === undefined) {
					return;
				}
				// 平滑滚动期间只测量落点附近的行，长距离跳转不会一路抖过去
				latest.current.virtualizer.scrollToIndex(target, { align: "start", behavior: "smooth" });
				calibrate(target, JUMP_LEAD);
			},
			scrollToEnd(behavior = "auto") {
				const { virtualizer: scroller, scrollElement: element } = latest.current;
				if (element === null) {
					return;
				}
				// 按元素自己的 scrollHeight 算：`.scroll` 的底部内边距也算进可滚高度
				scroller.scrollToOffset(Math.max(0, element.scrollHeight - element.clientHeight), { behavior });
			},
			capture() {
				const { rows: current, virtualizer: scroller, scrollElement: element } = latest.current;
				if (element === null || current.length === 0) {
					return null;
				}
				const item = scroller.getVirtualItemForOffset(element.scrollTop);
				const row = item === undefined ? undefined : current[item.index];
				if (item === undefined || row === undefined) {
					return null;
				}
				return { rowId: row.id, offsetInRow: element.scrollTop - item.start };
			},
			restore(anchor) {
				if (!applyRestore(anchor)) {
					pendingRestore.current = anchor;
				}
			},
		}),
		[applyRestore, calibrate],
	);

	useLayoutEffect(() => {
		viewportRef.current = viewport;
		return () => {
			if (viewportRef.current === viewport) {
				viewportRef.current = null;
			}
		};
	}, [viewport, viewportRef]);

	// 位置恢复可能比数据早到：行到齐之后再看一眼。
	// rows 只当归位的信号，不参与计算，所以不进依赖表。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 同上
	useLayoutEffect(() => {
		const pending = pendingRestore.current;
		if (pending !== null && applyRestore(pending)) {
			pendingRestore.current = null;
		}
	}, [applyRestore, rows]);

	return { plan, measureRow: virtualizer.measureElement };
}
