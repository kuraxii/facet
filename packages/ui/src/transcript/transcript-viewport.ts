/**
 * 面板的定位接口。
 *
 * 对话导航（竖轨）、切会话的位置记忆与「回到底部」都只认这几个方法：它们要的是「某一行在哪」
 * 与「跳到某一行」，不该知道虚拟化器怎么算。行没挂载也能量到位置——这正是虚拟化要解决的矛盾。
 *
 * 跳转与「回到底部」都走同一套 rAF 曲线（`scroll-motion.ts` + `scroll-driver.ts`）：落点按估高
 * 算，浏览器的 `behavior: "smooth"` 中途改不了目标，表现是「一边加载一边抖」。系统要求减少
 * 动效时退回一步落位，再按真实矩形校准一次。
 *
 * 位置恢复可能比数据早到：面板刚重挂时历史还在路上，所以 `restore` 允许先挂着。挂着的那一份
 * 有两个出口，缺一不可：
 * - **用户接管**：恢复落位前有任何主动滚动（滚轮、触摸、翻页键）或点了导航轨，立刻放弃；
 * - **行已不在窗口**：初始窗口是一次性替换进来的（`fetchPages` await 完所有页才 `replaceChat`），
 *   所以面板已经有行却仍找不到那一行，说明它被裁掉了，放弃恢复并回到底部——否则会停在一个
 *   既不是原位置、也不是最近内容的地方。
 */
import type { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { TRANSCRIPT_DATA_ATTRS } from "../layout/layout-contract.ts";
import { VISUAL_SCALE } from "../styles/visual-contract.ts";
import type { DisplayRow } from "./group.ts";
import { calibrateRow } from "./scroll-calibrate.ts";
import { useScrollDriver, useScrollInterrupt } from "./scroll-driver.ts";
import { resolveAnchorRowId, type TranscriptAnchor } from "./virtual-anchor.ts";

/**
 * 跳到某一行时在它上面留出的空隙（px）：整条顶部渐隐的高度。
 *
 * 视口上沿压着一层渐暗（`.chat-fade.is-top`，高 `--control-lg`），落点贴着上沿的话，跳过去
 * 的第一行正好被那层暗色压住；留这么多空间，行顶边就落在渐隐的下边缘。
 *
 * 同一个数也交给虚拟化器的 `scrollPaddingStart`，这样 `scrollToIndex(align: "start")` 与
 * `getOffsetForIndex("start")` 用的是同一份口径，量位置时不必各算一遍。
 */
export const JUMP_LEAD = VISUAL_SCALE.control.lg;

/** 虚拟化器的实例类型，只用到定位那几个方法。 */
type VirtualList = ReturnType<typeof useVirtualizer<HTMLElement, HTMLElement>>;

/** 面板对外的定位接口。 */
export interface TranscriptViewport {
	/** 一行（按导航键）的顶边相对视口上沿的偏移；没有这一行时返回 `undefined` */
	offsetOf(key: string): number | undefined;
	/** 把一行滚到视口顶部附近 */
	jumpTo(key: string): void;
	/** 滚到最底部；`"smooth"` 走统一曲线，其余情况一步落位 */
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

	/** 统一曲线的滚动器：跳转与「回到底部」共用，新的调用会打断旧的 */
	const prefersReducedMotion = useCallback(
		() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
		[],
	);
	const driver = useScrollDriver({
		getElement: () => latest.current.scrollElement,
		prefersReducedMotion,
	});

	/** 还没落位的位置恢复，等那一行出现 */
	const pendingRestore = useRef<TranscriptAnchor | null>(null);
	/** 用户主动滚动的次数：恢复与落位校准都据此让路 */
	const userIntent = useRef(0);

	/** 一步落位之后按真实矩形对一次；走曲线的路径不需要（每帧都在重读目标） */
	const calibrate = useCallback((index: number, lead: number) => {
		const token = userIntent.current;
		calibrateRow({
			getElement: () => latest.current.scrollElement,
			index,
			lead,
			isCancelled: () => token !== userIntent.current,
			write: (scrollTop) => latest.current.virtualizer.scrollToOffset(scrollTop, { behavior: "auto" }),
		});
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
			// 记下的偏移是「行顶边在视口上沿之上多少」，校准比对的是矩形偏移，方向相反
			calibrate(target, -anchor.offsetInRow);
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
				// 用户已经自己换了位置，挂着的恢复与正在进行的动画都不该再抢
				pendingRestore.current = null;
				userIntent.current += 1;
				const scroller = latest.current.virtualizer;
				/*
				 * 每帧重读目标行的位置：落点是按估高算的，动画期间目标附近的行才陆续测量，坐标会动。
				 * 行一旦挂载就按它的**真实矩形**算（视口里那几行量出来的高度和估高有偏差，
				 * 只按虚拟坐标落位会让行顶边压进顶部渐隐里），没挂载时退回虚拟顶边——每帧
				 * 重读的意义就在于让落点收敛到真实位置，而不是收在估算上。
				 *
				 * 行标识先抓住：补历史会让下标整体后移，按标识重新认下标才不会跳错行。
				 */
				const rowId = latest.current.rows[target]?.id;
				const readLive = (): number => {
					const element = latest.current.scrollElement;
					const index = rowId === undefined ? target : (latest.current.rowIndexById.get(rowId) ?? target);
					if (element !== null) {
						const row = element.querySelector<HTMLElement>(`[${TRANSCRIPT_DATA_ATTRS.rowIndex}="${index}"]`);
						if (row !== null) {
							const offset = row.getBoundingClientRect().top - element.getBoundingClientRect().top;
							return element.scrollTop + offset - JUMP_LEAD;
						}
					}
					return scroller.getOffsetForIndex(index, "start")?.[0] ?? element?.scrollTop ?? 0;
				};
				if (prefersReducedMotion()) {
					// 系统要求减少动效：一步落位，再按落点那一行的实际矩形校准一次
					driver.cancel();
					scroller.scrollToIndex(target, { align: "start" });
					calibrate(target, JUMP_LEAD);
					return;
				}
				driver.run(readLive);
			},
			scrollToEnd(behavior = "auto") {
				const { virtualizer: scroller, scrollElement: element } = latest.current;
				if (element === null) {
					return;
				}
				// 按元素自己的 scrollHeight 算：`.scroll` 的底部内边距也算进可滚高度
				const readLive = (): number => Math.max(0, element.scrollHeight - element.clientHeight);
				if (behavior !== "smooth" || prefersReducedMotion()) {
					driver.cancel();
					scroller.scrollToOffset(readLive(), { behavior: "auto" });
					return;
				}
				/*
				 * 缓入到贴底：每帧重读底边，动画期间新挂载的行长高多少都会被吸收。
				 * 落位后再补一次底边——到达时最后几行可能还在测量，这一下把差的那几像素收掉，
				 * 之后由贴底的收尾窗口与 ResizeObserver 接着管。
				 */
				driver.run(readLive, () => {
					scroller.scrollToOffset(Math.max(0, element.scrollHeight - element.clientHeight), {
						behavior: "auto",
					});
				});
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
				driver.cancel();
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
		[applyRestore, calibrate, driver, prefersReducedMotion],
	);

	useLayoutEffect(() => {
		viewportRef.current = viewport;
		return () => {
			if (viewportRef.current === viewport) {
				viewportRef.current = null;
			}
		};
	}, [viewport, viewportRef]);

	// 用户在恢复落位前自己动了位置：挂着的恢复作废，正在跑的曲线也让路
	useScrollInterrupt(scrollElement, () => {
		pendingRestore.current = null;
		userIntent.current += 1;
		driver.cancel();
	});

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
