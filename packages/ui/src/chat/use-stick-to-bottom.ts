/**
 * 滚动跟随。
 *
 * 贴底时内容变化自动跟到底部；用户往上翻之后脱离跟随，由界面给出回底入口。
 *
 * 判据是**意图**而不是位置：流式输出一帧就能插进一整段代码块或一张图，按「距底超过 24px」
 * 判断会把还在底部的人误判成离开。这里只在真的看到用户的向上操作（滚轮向上、翻页键）时脱钩，
 * 再靠「往下滚到接近底部」或显式回底重新贴回去。
 *
 * 往底部写入只有一处：贴底期间内容变化、尺寸变化与回底按钮都走 `scrollToBottom`。写入优先
 * 交给调用方的 `scrollToEnd`（虚拟化器自己写，它才知道这次滚动是自己做的），没有才退回直接写
 * `scrollTop`——绕开虚拟化器写，之后的补偿会按旧位置算，把视口拽回去。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** 距底部多少像素以内算贴底。 */
const PIN_THRESHOLD = 24;

/** 平滑回底的动画时长估计，动画期间不按位置判断跟随状态。 */
const SMOOTH_MS = 500;

/** 滚动区两侧还有没有可滚的内容。 */
export interface ScrollEdges {
	/** 顶部还能往上滚 */
	readonly top: boolean;
	/** 底部还能往下滚 */
	readonly bottom: boolean;
}

/** 滚动跟随的句柄。 */
export interface StickToBottom {
	/** 挂到滚动容器上 */
	scrollRef: (node: HTMLDivElement | null) => void;
	/** 滚动容器本身，正文定位与对话导航要用 */
	element: HTMLDivElement | null;
	/** 当前是否贴底 */
	isPinned: boolean;
	/** 两侧是否还有可滚内容：对话视口据此决定边缘渐隐要不要淡入 */
	edges: ScrollEdges;
	/** 回到底部并恢复跟随 */
	scrollToBottom: (behavior?: ScrollBehavior) => void;
	/** 放弃跟随：用户往上翻，或者要恢复到别的位置 */
	release: () => void;
}

/** 键盘上能让视口往上走的键。 */
const SCROLL_UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

/** 位置往后走了这么多像素就算用户离开了底部（`scrollTop` 只会因为主动滚动而变小）。 */
const UPWARD_EPSILON = 1;

/**
 * 贴底写入之后的收尾窗口。
 *
 * 行高是一帧帧量出来的，最后几行的实测往往晚于这次写入：写完之后内容还会再长一截，而那个
 * 高度变化不一定落在我们看得见的那一帧里。所以写入之后开一个短窗口，每 100ms 看一眼——
 * 还贴着底、又没真到底就再补一次；真到底、或者用户往上翻了就立刻停。
 */
const SETTLE_WINDOW_MS = 1000;

/** 收尾窗口里的复查间隔。 */
const SETTLE_RETRY_MS = 100;

/** 跟随滚动的外部依赖。 */
export interface StickToBottomOptions {
	/**
	 * 滚到最底部。给了就由它写（虚拟化器接管这次写入），返回 `false` 表示这一帧还写不了。
	 */
	scrollToEnd?: (behavior: ScrollBehavior) => boolean;
}

/**
 * 跟随滚动容器底部。
 *
 * contentKey 变化时若仍贴着底就重新滚到底；贴在底部时容器高度变化（图片、代码高亮等异步
 * 渲染、虚拟化回填的实测高度）同样跟到底。
 */
export function useStickToBottom(contentKey: unknown, options: StickToBottomOptions = {}): StickToBottom {
	const [element, setElement] = useState<HTMLDivElement | null>(null);
	const scrollToEndRef = useRef(options.scrollToEnd);
	scrollToEndRef.current = options.scrollToEnd;
	const pinnedRef = useRef(true);
	const animatingRef = useRef(false);
	const [isPinned, setIsPinned] = useState(true);
	/** 边缘状态：只在真的翻面时 setState，滚动过程中不产生无谓渲染 */
	const edgesRef = useRef<ScrollEdges>({ top: false, bottom: false });
	const [edges, setEdges] = useState<ScrollEdges>(edgesRef.current);
	const applyEdges = useCallback((next: ScrollEdges) => {
		if (edgesRef.current.top === next.top && edgesRef.current.bottom === next.bottom) {
			return;
		}
		edgesRef.current = next;
		setEdges(next);
	}, []);

	const scrollRef = useCallback((node: HTMLDivElement | null) => {
		setElement(node);
	}, []);

	const applyPinned = useCallback((value: boolean) => {
		if (pinnedRef.current === value) {
			return;
		}
		pinnedRef.current = value;
		setIsPinned(value);
	}, []);

	const jumpToBottom = useCallback(() => {
		if (scrollToEndRef.current?.("auto") === true) {
			return;
		}
		if (element) {
			element.scrollTop = element.scrollHeight;
		}
	}, [element]);

	/** 收尾窗口的定时器，同一时间只留一个 */
	const settleTimer = useRef<number | null>(null);
	const settleUntil = useRef(0);

	const stopSettle = useCallback(() => {
		if (settleTimer.current !== null) {
			window.clearTimeout(settleTimer.current);
			settleTimer.current = null;
		}
	}, []);

	/**
	 * 贴底跟到底。
	 *
	 * 先按当前内容写一次，再在收尾窗口里复查：只要仍贴着底、又没真的到底，就继续补。
	 * 用户往上翻（贴底状态被解除）立刻停手，不会把他拽回来。
	 */
	const followToBottom = useCallback(() => {
		jumpToBottom();
		if (settleTimer.current !== null) {
			return;
		}
		settleUntil.current = Date.now() + SETTLE_WINDOW_MS;
		const tick = (): void => {
			settleTimer.current = null;
			if (!pinnedRef.current || element === null) {
				return;
			}
			const gap = element.scrollHeight - element.scrollTop - element.clientHeight;
			if (gap <= 1 || Date.now() > settleUntil.current) {
				return;
			}
			jumpToBottom();
			settleTimer.current = window.setTimeout(tick, SETTLE_RETRY_MS);
		};
		settleTimer.current = window.setTimeout(tick, SETTLE_RETRY_MS);
	}, [element, jumpToBottom]);

	// 卸载时收掉收尾窗口里的定时器
	useEffect(() => stopSettle, [stopSettle]);

	const scrollToBottom = useCallback(
		(behavior: ScrollBehavior = "auto") => {
			if (!element) {
				return;
			}
			applyPinned(true);
			if (behavior === "smooth") {
				animatingRef.current = true;
				window.setTimeout(() => {
					animatingRef.current = false;
				}, SMOOTH_MS);
			}
			const scrollToEnd = scrollToEndRef.current;
			if (scrollToEnd === undefined || !scrollToEnd(behavior)) {
				element.scrollTo({ top: element.scrollHeight, behavior });
			}
		},
		[element, applyPinned],
	);

	const release = useCallback(() => {
		animatingRef.current = false;
		applyPinned(false);
		stopSettle();
	}, [applyPinned, stopSettle]);

	// 内容变化时跟随。写在这里而不是帧回调里：提交已改完 DOM，此刻读高度、写 scrollTop
	// 与这次内容变化处在同一帧，绘制时新文字已经在正确位置；排到下一帧会多出一帧错位。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 内容标识只作跟随信号，不参与计算
	useLayoutEffect(() => {
		if (pinnedRef.current) {
			followToBottom();
		}
	}, [contentKey, followToBottom]);

	useEffect(() => {
		if (!element) {
			return;
		}
		let lastTop = element.scrollTop;
		const measureEdges = (): void => {
			const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
			applyEdges({ top: element.scrollTop > PIN_THRESHOLD, bottom: distance > PIN_THRESHOLD });
		};
		const onScroll = () => {
			// 边缘状态与跟随状态无关：平滑回底期间也要更新，否则渐隐会停在上一态
			measureEdges();
			const top = element.scrollTop;
			const delta = top - lastTop;
			lastTop = top;
			if (animatingRef.current) {
				return;
			}
			const distance = element.scrollHeight - top - element.clientHeight;
			if (delta < -UPWARD_EPSILON && distance > PIN_THRESHOLD) {
				// 位置变小且已经离开底部：用户往上翻，或者点了导航轨跳走。
				// 只是内容变矮（估高换成实测、行被收起）时浏览器会把它夹小，那时仍贴着底，不算离开。
				release();
				return;
			}
			// 只有往下滚到接近底部才重新贴回去；往上滚时哪怕还差几像素也不抢
			if (distance <= PIN_THRESHOLD && delta > 0) {
				applyPinned(true);
			}
		};
		const onWheel = (event: WheelEvent) => {
			if (event.deltaY < 0) {
				release();
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (SCROLL_UP_KEYS.has(event.key)) {
				release();
			}
		};
		element.addEventListener("scroll", onScroll, { passive: true });
		element.addEventListener("wheel", onWheel, { passive: true });
		element.addEventListener("keydown", onKeyDown);
		const content = element.firstElementChild;
		const observer = new ResizeObserver(() => {
			if (pinnedRef.current) {
				followToBottom();
			}
			measureEdges();
		});
		if (content) {
			observer.observe(content);
		}
		measureEdges();
		return () => {
			element.removeEventListener("scroll", onScroll);
			element.removeEventListener("wheel", onWheel);
			element.removeEventListener("keydown", onKeyDown);
			observer.disconnect();
		};
	}, [element, applyEdges, applyPinned, followToBottom, release]);

	return { scrollRef, element, isPinned, edges, scrollToBottom, release };
}
