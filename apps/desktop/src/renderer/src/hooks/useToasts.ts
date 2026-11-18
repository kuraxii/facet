/**
 * 轻提示的队列与计时。
 *
 * 队列本身是 `@facet/ui` 里的纯函数；这里只负责「什么时候算一次过期」和「指针停在上面时
 * 暂停」这两件命令式的事。计时用一条 250ms 的定时器整体扫一遍，逐条定时器在提示合并、
 * 拖动与重复提示下会一直重排，反而更乱。
 */
import {
	dismissToast,
	expireToasts,
	pushToast,
	shiftToastExpiry,
	type Toast,
	type ToastInput,
} from "@facet/ui";
import { useCallback, useEffect, useRef, useState } from "react";

/** 扫过期的间隔，毫秒。够细到看不出延迟，又不会为每条提示各开一个定时器。 */
const TICK_MS = 250;

/** 界面能用的轻提示接口。 */
export interface Toasts {
	/** 当前要显示的提示 */
	toasts: readonly Toast[];
	/** 弹一条；同一句话重复出现时只会刷新计时并累加次数 */
	show: (input: Omit<ToastInput, "now">) => void;
	/** 收掉一条 */
	dismiss: (id: string) => void;
	/** 指针或焦点落在提示上，暂停计时 */
	setPaused: (paused: boolean) => void;
}

export function useToasts(): Toasts {
	const [toasts, setToasts] = useState<readonly Toast[]>([]);
	/** 暂停开始的时刻；暂停期间用它当「现在」，剩余时间就不会被吃掉 */
	const pausedAt = useRef<number | undefined>(undefined);

	useEffect(() => {
		const timer = window.setInterval(() => {
			const now = pausedAt.current ?? Date.now();
			// 一条都没到点时纯函数原样返回入参，这里的 setState 也就不会触发重绘
			setToasts((current) => expireToasts(current, now));
		}, TICK_MS);
		return () => window.clearInterval(timer);
	}, []);

	const show = useCallback((input: Omit<ToastInput, "now">): void => {
		setToasts((current) => pushToast(current, { ...input, now: Date.now() }));
	}, []);

	const dismiss = useCallback((id: string): void => {
		setToasts((current) => dismissToast(current, id));
	}, []);

	const setPaused = useCallback((paused: boolean): void => {
		if (paused) {
			pausedAt.current ??= Date.now();
			return;
		}
		const startedAt = pausedAt.current;
		pausedAt.current = undefined;
		if (startedAt === undefined) {
			return;
		}
		// 恢复时把暂停的这段时长补回到期时刻，否则暂停期间到点的提示会立刻消失
		setToasts((current) => shiftToastExpiry(current, Date.now() - startedAt));
	}, []);

	return { toasts, show, dismiss, setPaused };
}
