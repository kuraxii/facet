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

/** 滚动跟随的句柄。 */
export interface StickToBottom {
	/** 挂到滚动容器上 */
	scrollRef: (node: HTMLDivElement | null) => void;
	/** 当前是否贴底 */
	isPinned: boolean;
	/** 回到底部并恢复跟随 */
	scrollToBottom: (behavior?: ScrollBehavior) => void;
}

/**
 * 跟随滚动容器底部。
 *
 * contentKey 变化时若处于贴底则重新滚到底；resetKey 变化时强制回到贴底，用于切换会话。
 * 容器内容高度变化（图片、代码高亮等异步渲染）时，贴底状态下同样跟到底。
 */
export function useStickToBottom(contentKey: unknown, resetKey: unknown): StickToBottom {
	const [element, setElement] = useState<HTMLDivElement | null>(null);
	const pinnedRef = useRef(true);
	const animatingRef = useRef(false);
	const [isPinned, setIsPinned] = useState(true);

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

	// 切换会话时回到贴底
	useLayoutEffect(() => {
		applyPinned(true);
		jumpToBottom();
	}, [resetKey, element, applyPinned, jumpToBottom]);

	// 内容变化时跟随
	useLayoutEffect(() => {
		if (pinnedRef.current) {
			jumpToBottom();
		}
	}, [contentKey, element, jumpToBottom]);

	useEffect(() => {
		if (!element) {
			return;
		}
		const onScroll = () => {
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
		});
		if (content) {
			observer.observe(content);
		}
		return () => {
			element.removeEventListener("scroll", onScroll);
			observer.disconnect();
		};
	}, [element, applyPinned, jumpToBottom]);

	return { scrollRef, isPinned, scrollToBottom };
}
