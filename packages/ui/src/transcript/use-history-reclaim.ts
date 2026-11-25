/**
 * 定时静默回收更早的历史。
 *
 * 每 `RECLAIM_INTERVAL_MS` 问一次判据（`reclaim-gate.ts`）：该不该裁、能不能裁。能裁时按
 * **视口最顶那一行**做锚点：裁之前记下它的顶边，裁完在 `useLayoutEffect` 里量一次新的顶边，
 * 把差值补回 `scrollTop`，屏幕上这一行的位置一动不动（0px 偏差）。
 *
 * 定时器只活在当前会话的转录视图里：容器换了、会话换了或组件卸载都清掉，不会留下一只还在
 * 跑的空转定时器。
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { DisplayRow } from "./group.ts";
import { decideHistoryReclaim, RECLAIM_INTERVAL_MS } from "./reclaim-gate.ts";
import { isScrollSettling } from "./scroll-settle.ts";

/** 一行的元素选择器，与 `row-measure.ts` 的测量口径一致。 */
const ROW_SELECTOR = ".row";

/** 回收要用到的输入与动作。 */
export interface HistoryReclaimOptions {
	/** 正文所在的滚动容器 */
	scrollElement: HTMLElement | null;
	/** 当前的对话行；用来把裁剪点换算成行下标 */
	rows: readonly DisplayRow[];
	/** 保留水位的条目数 */
	retainMaxEntries: number;
	/** 当前会话已装载的条目数 */
	entryCount: number;
	/** 裁剪线的首条视图标识；为空表示不到水位或找不到对齐点 */
	cutViewId: string | undefined;
	/** 是否正在流式输出 */
	isStreaming: boolean;
	/** 是否正在补更早的历史 */
	isLoadingOlder: boolean;
	/** 会话标识：换了它就重开定时器，不把上一个会话的计时带过来 */
	sessionKey: string | undefined;
	/** 执行裁剪：同步写入 store，裁剪后行模型随之变短 */
	onReclaim: () => void;
}

/** 一行元素与它当前的顶边。 */
interface AnchorFrame {
	/** 裁之前钉住的锚点行 */
	element: HTMLElement | null;
	/** 裁之前量到的顶边，视口坐标系 */
	top: number;
}

/**
 * 视口里最顶部那一行的下标。
 *
 * 一次遍历读完全部行的矩形：第一行之前的行都在视口上方，找到第一行底边越过容器顶边的就停。
 * 不解引用 `rows`：DOM 顺序就是行顺序，与行模型同源。
 */
function topVisibleRowIndex(rows: readonly HTMLElement[], containerTop: number): number | undefined {
	for (let index = 0; index < rows.length; index += 1) {
		const element = rows[index];
		if (element !== undefined && element.getBoundingClientRect().bottom > containerTop) {
			return index;
		}
	}
	return undefined;
}

/** 把裁剪点（首条视图标识）换算成行下标：行内首项的标识就是它。 */
function rowIndexOf(rows: readonly DisplayRow[], cutViewId: string | undefined): number | undefined {
	if (cutViewId === undefined) {
		return undefined;
	}
	const index = rows.findIndex((row) => row.items[0]?.id === cutViewId);
	return index < 0 ? undefined : index;
}

/** 定时静默回收。 */
export function useHistoryReclaim(options: HistoryReclaimOptions): void {
	const latest = useRef(options);
	latest.current = options;
	/** 最后一次滚动、指针或按键的时刻，Unix 毫秒 */
	const lastInteraction = useRef(Date.now());
	/** 裁之前钉住的锚点，裁完在同一帧里补偿回去 */
	const anchor = useRef<AnchorFrame>({ element: null, top: 0 });

	/** 量一次视口，够条件就裁 */
	const attempt = useCallback(() => {
		const current = latest.current;
		const element = current.scrollElement;
		if (element === null) {
			return;
		}
		const domRows = [...element.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
		const containerTop = element.getBoundingClientRect().top;
		const rowCount = domRows.length;
		// 行元素与行模型对不上时不动：布局还没落稳，行下标换算出来的锚点是错的
		const aligned = rowCount === current.rows.length;
		const decision = decideHistoryReclaim({
			entryCount: current.entryCount,
			retainMaxEntries: current.retainMaxEntries,
			isStreaming: current.isStreaming,
			isJumping: isScrollSettling(element),
			isLoadingOlder: current.isLoadingOlder,
			idleMs: Date.now() - lastInteraction.current,
			hasSelection: (window.getSelection()?.isCollapsed ?? true) === false,
			isVisible: document.visibilityState === "visible",
			viewportHeight: element.clientHeight,
			rowCount,
			cutRowIndex: aligned ? rowIndexOf(current.rows, current.cutViewId) : undefined,
			firstVisibleRowIndex: aligned ? topVisibleRowIndex(domRows, containerTop) : undefined,
		});
		if (!decision.go) {
			return;
		}
		const anchorRow = decision.anchorRowIndex === undefined ? undefined : domRows[decision.anchorRowIndex];
		anchor.current = {
			element: anchorRow ?? null,
			top: anchorRow?.getBoundingClientRect().top ?? 0,
		};
		current.onReclaim();
	}, []);

	// 交互记账：滚动、滚轮、触摸与按键都算"用户还在动"，十秒内不裁
	useEffect(() => {
		const element = options.scrollElement;
		if (element === null) {
			return;
		}
		const touch = (): void => {
			lastInteraction.current = Date.now();
		};
		element.addEventListener("scroll", touch, { passive: true });
		element.addEventListener("wheel", touch, { passive: true });
		element.addEventListener("touchstart", touch, { passive: true });
		window.addEventListener("pointerdown", touch, { passive: true });
		window.addEventListener("keydown", touch);
		return () => {
			element.removeEventListener("scroll", touch);
			element.removeEventListener("wheel", touch);
			element.removeEventListener("touchstart", touch);
			window.removeEventListener("pointerdown", touch);
			window.removeEventListener("keydown", touch);
		};
	}, [options.scrollElement]);

	// 定时器跟着会话走：换会话、换容器或卸载都重新计时，不留空转的旧定时器
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只靠会话与容器重开定时器，`attempt` 自己读最新值
	useEffect(() => {
		if (options.scrollElement === null) {
			return;
		}
		lastInteraction.current = Date.now();
		const timer = window.setInterval(attempt, RECLAIM_INTERVAL_MS);
		return () => {
			window.clearInterval(timer);
		};
	}, [attempt, options.scrollElement, options.sessionKey]);

	/*
	 * 开发构建才有的手动推开。
	 *
	 * 生产里只有那只五分钟的定时器，而真机验收不可能每个阶段都干等一个周期。这里把一个函数
	 * 挂到 `globalThis` 上供验收脚本（`tools/transcript-perf/reclaim.mjs`）手动推，走的仍然是
	 * 同一套判据与裁剪。`import.meta.env.DEV` 在打包时是静态值，生产产物里这段会被整段去掉。
	 */
	useEffect(() => {
		if (!import.meta.env.DEV) {
			return;
		}
		const host = globalThis as { __facetReclaimNow?: () => void };
		host.__facetReclaimNow = attempt;
		return () => {
			delete host.__facetReclaimNow;
		};
	}, [attempt]);

	/*
	 * 裁完的同一帧把锚点补回去。
	 *
	 * 滚动容器上是 `overflow-anchor: none`（见 `chat.css` 的 `.scroll`），浏览器不会自己再补一次，
	 * 这里的差值就是唯一的一次补偿。贴底时上层 `useStickToBottom` 的 layout effect 排在后面，
	 * 会把它重新拉到底，这条补偿不与之打架。
	 */
	// 行模型换了就是一次新的提交：锚点补偿只能落在这里
	// biome-ignore lint/correctness/useExhaustiveDependencies: `rows` 只作提交信号，补偿读的是 ref 里的锚点
	useLayoutEffect(() => {
		const element = options.scrollElement;
		const pinned = anchor.current;
		anchor.current = { element: null, top: 0 };
		if (element === null || pinned.element === null || !pinned.element.isConnected) {
			return;
		}
		element.scrollTop += pinned.element.getBoundingClientRect().top - pinned.top;
	}, [options.rows, options.scrollElement]);
}
