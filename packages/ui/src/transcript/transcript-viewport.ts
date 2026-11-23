/**
 * 面板的定位接口。
 *
 * 对话导航（竖轨）、切会话的位置记忆与「回到底部」都只认这几个方法：它们要的是「某一行在哪」
 * 与「跳到某一行」，不该知道虚拟化器怎么算。行没挂载也能量到位置——这正是虚拟化要解决的矛盾。
 *
 * 位置恢复可能比数据早到：面板刚重挂时历史还在路上，所以 `restore` 允许先挂着。挂着的那一份
 * 有两个出口，缺一不可：
 * - **用户接管**：恢复落位前有任何主动滚动（滚轮、触摸、翻页键）或点了导航轨，立刻放弃；
 * - **行已不在窗口**：初始窗口是一次性替换进来的（`fetchPages` await 完所有页才 `replaceChat`），
 *   所以面板已经有行却仍找不到那一行，说明它被裁掉了，放弃恢复并回到底部——否则会停在一个
 *   既不是原位置、也不是最近内容的地方。
 */
import type { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { SCROLL_UP_KEYS } from "../chat/use-stick-to-bottom.ts";
import { TRANSCRIPT_DATA_ATTRS } from "../layout/layout-contract.ts";
import type { DisplayRow } from "./group.ts";
import { resolveAnchorRowId, type TranscriptAnchor } from "./virtual-anchor.ts";

/**
 * 跳到某一行时在它上面留出的空隙（px），别让那一条贴着视口上沿的渐隐。
 *
 * 同一个数也交给虚拟化器的 `scrollPaddingStart`，这样 `scrollToIndex(align: "start")` 与
 * `getOffsetForIndex("start")` 用的是同一份口径，量位置时不必各算一遍。
 */
export const JUMP_LEAD = 12;

/** 落位校准最多等多少帧（平滑滚动 + 目标行测量）。 */
const SETTLE_FRAMES = 60;

/** 偏差在这个范围内就不必再补（px）。 */
const CALIBRATE_TOLERANCE = 2;

/** 虚拟化器的实例类型，只用到定位那几个方法。 */
type VirtualList = ReturnType<typeof useVirtualizer<HTMLElement, HTMLElement>>;

/** 面板对外的定位接口。 */
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

/** 建定位接口需要的东西。 */
export interface TranscriptViewportOptions {
	/** 这一帧的行 */
	readonly rows: readonly DisplayRow[];
	/** 滚动容器 */
	readonly scrollElement: HTMLElement | null;
	/** 导航键（用户消息的条目 id）到行下标 */
	readonly outlineIndex: ReadonlyMap<string, number>;
	/** 行标识到行下标 */
	readonly rowIndexById: ReadonlyMap<string, number>;
	/** 实时消息提升为历史消息时的标识迁移；恢复时按它把记下的旧标识换成当前的 */
	readonly renames: Readonly<Record<string, string>>;
	/** 虚拟化器 */
	readonly virtualizer: VirtualList;
	/** 位置恢复失败（那一行已经不在窗口里）时的落点 */
	readonly onRestoreLost?: (() => void) | undefined;
	/** 接口交出去的位置，由面板转给对话导航与位置记忆 */
	readonly viewportRef: { current: TranscriptViewport | null };
}

/**
 * 建出定位接口并挂到 `viewportRef` 上。
 *
 * 接口本身只建一次：对话导航在滚动里逐帧读它，身份一变就要重挂监听；会变的东西都从 ref 里现取。
 */
export function useTranscriptViewport(options: TranscriptViewportOptions): void {
	const {
		rows,
		scrollElement,
		outlineIndex,
		rowIndexById,
		renames,
		virtualizer,
		onRestoreLost,
		viewportRef,
	} = options;

	const latest = useRef({
		rows,
		virtualizer,
		scrollElement,
		outlineIndex,
		rowIndexById,
		renames,
		onRestoreLost,
	});
	latest.current = { rows, virtualizer, scrollElement, outlineIndex, rowIndexById, renames, onRestoreLost };

	/** 还没落位的位置恢复，等那一行出现 */
	const pendingRestore = useRef<TranscriptAnchor | null>(null);
	/** 用户主动滚动的次数：恢复与落位校准都据此让路 */
	const userIntent = useRef(0);

	/**
	 * 落位之后按真实 DOM 再对一次。
	 *
	 * 还没测量过的行只有估高，长距离跳转的落点会差出一小段；等到位置不再变化（平滑滚动走完、
	 * 目标行也挂上了），按那一行的实际矩形补一次差。中途用户一动就放弃——他已经在看别处了。
	 */
	const calibrate = useCallback((index: number, lead: number) => {
		const token = userIntent.current;
		let frames = 0;
		let stable = 0;
		let lastTop = Number.NaN;
		const step = (): void => {
			frames += 1;
			const element = latest.current.scrollElement;
			if (element === null || token !== userIntent.current) {
				return;
			}
			const top = element.scrollTop;
			stable = Math.abs(top - lastTop) < 0.5 ? stable + 1 : 0;
			lastTop = top;
			if (stable < 2 && frames <= SETTLE_FRAMES) {
				window.requestAnimationFrame(step);
				return;
			}
			const row = element.querySelector<HTMLElement>(`[${TRANSCRIPT_DATA_ATTRS.rowIndex}="${index}"]`);
			if (row === null) {
				return;
			}
			const offset = row.getBoundingClientRect().top - element.getBoundingClientRect().top;
			if (Math.abs(offset - lead) > CALIBRATE_TOLERANCE) {
				latest.current.virtualizer.scrollToOffset(top + (offset - lead), { behavior: "auto" });
			}
		};
		window.requestAnimationFrame(step);
	}, []);

	const applyRestore = useCallback(
		(anchor: TranscriptAnchor): boolean => {
			const { virtualizer: scroller, rowIndexById: index, renames: migrations } = latest.current;
			// 记下的是旧标识时（离开期间提升为历史消息），按映射换成当前的模样再找
			const target = index.get(resolveAnchorRowId(anchor.rowId, migrations));
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
				// 用户已经自己换了位置，挂着的恢复与正在进行的校准都不该再抢
				pendingRestore.current = null;
				userIntent.current += 1;
				/*
				 * 一步到位，不做平滑动画。
				 *
				 * 跳转目标是按估高算的，落点附近的行要等挂载、渲染、测量之后才是真高度；边滚边改
				 * 目标的表现就是"一边加载一边抖"。直接落位只抖一次，落位后按真实矩形校准一下
				 * （`calibrate`）就稳住了。鼠标滚轮是浏览器自己的惯性滚动，不受这里影响。
				 */
				latest.current.virtualizer.scrollToIndex(target, { align: "start" });
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
				pendingRestore.current = null;
				if (applyRestore(anchor)) {
					return;
				}
				// 已经有行了还找不到：初始窗口是一次性替换进来的，说明那一行不在窗口里
				if (latest.current.rows.length > 0) {
					latest.current.onRestoreLost?.();
					return;
				}
				pendingRestore.current = anchor;
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

	// 用户在恢复落位前自己动了位置：挂着的恢复作废，正在进行的校准也让路
	useEffect(() => {
		if (scrollElement === null) {
			return;
		}
		const takeOver = (): void => {
			pendingRestore.current = null;
			userIntent.current += 1;
		};
		const onWheel = (event: WheelEvent): void => {
			if (event.deltaY < 0) {
				takeOver();
			}
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (SCROLL_UP_KEYS.has(event.key)) {
				takeOver();
			}
		};
		scrollElement.addEventListener("wheel", onWheel, { passive: true });
		scrollElement.addEventListener("touchmove", takeOver, { passive: true });
		scrollElement.addEventListener("keydown", onKeyDown);
		return () => {
			scrollElement.removeEventListener("wheel", onWheel);
			scrollElement.removeEventListener("touchmove", takeOver);
			scrollElement.removeEventListener("keydown", onKeyDown);
		};
	}, [scrollElement]);

	// 位置恢复可能比数据早到：行到齐之后再看一眼；还是找不到就放弃并回到最近的内容
	useLayoutEffect(() => {
		const pending = pendingRestore.current;
		if (pending === null) {
			return;
		}
		if (applyRestore(pending)) {
			pendingRestore.current = null;
			return;
		}
		if (rows.length > 0) {
			pendingRestore.current = null;
			latest.current.onRestoreLost?.();
		}
	}, [applyRestore, rows]);
}
