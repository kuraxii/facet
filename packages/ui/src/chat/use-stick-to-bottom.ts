/**
 * 滚动跟随。
 *
 * 贴底时内容变化自动跟到底部；用户向上滚动后脱离跟随，由界面给出回底入口。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** 距底部多少像素以内仍算贴底。 */
const PIN_THRESHOLD = 24;

/** 平滑回底的动画时长估计，动画期间不按位置判断跟随状态。 */
const SMOOTH_MS = 500;

/** 切回会话时要恢复的滚动位置。 */
export interface ScrollRestore {
	/** 距内容顶部的像素 */
	readonly top: number;
	/** 保存时是否贴在底部 */
	readonly atBottom: boolean;
}

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
}

/**
 * 跟随滚动容器底部。
 *
 * contentKey 变化时若处于贴底则重新滚到底；resetKey 变化时强制回到贴底，用于切换会话。
 * 容器内容高度变化（图片、代码高亮等异步渲染）时，贴底状态下同样跟到底。
 */
export function useStickToBottom(
	contentKey: unknown,
	resetKey: unknown,
	options: { restore?: (key: unknown) => ScrollRestore | undefined } = {},
): StickToBottom {
	const [element, setElement] = useState<HTMLDivElement | null>(null);
	const restoreRef = useRef(options.restore);
	restoreRef.current = options.restore;
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
		if (element) {
			element.scrollTop = element.scrollHeight;
		}
	}, [element]);

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
			element.scrollTo({ top: element.scrollHeight, behavior });
		},
		[element, applyPinned],
	);

	// 切换会话时恢复保存的位置；没有记录或原来贴底时回到贴底
	useLayoutEffect(() => {
		const saved = restoreRef.current?.(resetKey);
		if (saved !== undefined && !saved.atBottom && element !== null) {
			applyPinned(false);
			element.scrollTop = saved.top;
			return;
		}
		applyPinned(true);
		jumpToBottom();
	}, [resetKey, element, applyPinned, jumpToBottom]);

	// 内容变化时跟随。写在这里而不是帧回调里：提交已改完 DOM，此刻读高度、写 scrollTop
	// 与这次内容变化处在同一帧，绘制时新文字已经在正确位置；排到下一帧会多出一帧错位。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 内容标识只作跟随信号，不参与计算
	useLayoutEffect(() => {
		if (pinnedRef.current) {
			jumpToBottom();
		}
	}, [contentKey, jumpToBottom]);

	useEffect(() => {
		if (!element) {
			return;
		}
		const measureEdges = (): void => {
			const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
			applyEdges({ top: element.scrollTop > PIN_THRESHOLD, bottom: distance > PIN_THRESHOLD });
		};
		const onScroll = () => {
			// 边缘状态与跟随状态无关：平滑回底期间也要更新，否则渐隐会停在上一态
			measureEdges();
			if (animatingRef.current) {
				return;
			}
			const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
			applyPinned(distance <= PIN_THRESHOLD);
		};
		element.addEventListener("scroll", onScroll, { passive: true });
		const content = element.firstElementChild;
		const observer = new ResizeObserver(() => {
			if (pinnedRef.current) {
				jumpToBottom();
			}
			measureEdges();
		});
		if (content) {
			observer.observe(content);
		}
		measureEdges();
		return () => {
			element.removeEventListener("scroll", onScroll);
			observer.disconnect();
		};
	}, [element, applyEdges, applyPinned, jumpToBottom]);

	return { scrollRef, element, isPinned, edges, scrollToBottom };
}
