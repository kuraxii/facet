/**
 * 工作区标签栏的滚动与溢出渐隐 Hook。
 */

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { RightPanelTab } from "./panel-state.ts";

/**
 * 每一帧收掉剩余距离的比例。
 *
 * 0.28 时一格滚轮（约 100px）在 12 帧左右（≈200ms）走完，起手快、到尾巴自然慢下来，
 * 与系统里那种"滑一下"的手感接近。一次给满（1）就是瞬移，给太小则显得拖沓。
 */
const TAB_SCROLL_EASING = 0.28;

/**
 * 要不要做滑动动画。
 *
 * 与样式里的 `--dur-*` 数是同一套判断：系统偏好与设置项任一成立就减动效，此时直接落位。
 */
function wantsSmoothScroll(): boolean {
	if (typeof document === "undefined") {
		return false;
	}
	if (document.documentElement.dataset.motion === "reduced") {
		return false;
	}
	return !(
		typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/**
 * 标签栏的横向滚动。
 *
 * 两件事共用一份「目标位置」：滚轮/触控板横滚，以及当前项切过去时把它带回可视范围。
 * 自己维护目标值而不直接读 `scrollLeft`——动画途中 `scrollLeft` 是中间位置，快速连滚时
 * `scrollLeft += delta` 会把上一段动画吃掉，滚得越快反而越走不动。
 *
 * 滚轮部分：React 的 `onWheel` 挂在根节点上且是**被动**监听，里面 `preventDefault()` 不
 * 生效，所以挂原生监听并标 `passive: false`。标签栏本身没有可滚的纵向内容，吃掉这个事件
 * 不会影响别处；没溢出时直接放行，让外层照旧处理。触控板横向滑动给的是 `deltaX`，鼠标
 * 竖滚给的是 `deltaY`：取绝对值大的那个方向，两种设备都能滚。
 *
 * 带回可视范围：新开的标签排在末尾、容器窄时它就在滚动区外面，键盘切到看不见的那一条也
 * 一样。这里只改标签栏自己的 `scrollLeft`，不调 `scrollIntoView`——那会把外壳的横向滚动
 * 一起带走。
 */
export function useTabStripScroll(
	barRef: RefObject<HTMLDivElement | null>,
	buttonsRef: RefObject<Map<RightPanelTab, HTMLButtonElement>>,
	activeId: RightPanelTab | null,
): void {
	/** 动画要走到哪儿；`null` 表示没有在走 */
	const targetRef = useRef<number | null>(null);
	/** 在跑的那一帧；0 表示没在跑 */
	const frameRef = useRef(0);

	/** 逐帧走向目标位置 */
	const glide = useCallback(
		function step(): void {
			const bar = barRef.current;
			const target = targetRef.current;
			if (bar === null || target === null) {
				frameRef.current = 0;
				return;
			}
			const remaining = target - bar.scrollLeft;
			if (Math.abs(remaining) < 1) {
				bar.scrollLeft = target;
				targetRef.current = null;
				frameRef.current = 0;
				return;
			}
			bar.scrollLeft += remaining * TAB_SCROLL_EASING;
			frameRef.current = requestAnimationFrame(step);
		},
		[barRef],
	);

	/** 走向某个位置（已夹在可滚范围内）；减动效时直接落位 */
	const scrollTo = useCallback(
		(next: number): void => {
			const bar = barRef.current;
			if (bar === null) {
				return;
			}
			const max = bar.scrollWidth - bar.clientWidth;
			targetRef.current = Math.min(max, Math.max(0, next));
			if (!wantsSmoothScroll()) {
				bar.scrollLeft = targetRef.current;
				targetRef.current = null;
				return;
			}
			if (frameRef.current === 0) {
				frameRef.current = requestAnimationFrame(glide);
			}
		},
		[barRef, glide],
	);

	useEffect(() => {
		const bar = barRef.current;
		if (bar === null) {
			return;
		}
		const onWheel = (event: WheelEvent): void => {
			if (bar.scrollWidth <= bar.clientWidth) {
				return;
			}
			const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
			if (delta === 0) {
				return;
			}
			event.preventDefault();
			scrollTo((targetRef.current ?? bar.scrollLeft) + delta);
		};
		bar.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			bar.removeEventListener("wheel", onWheel);
			if (frameRef.current !== 0) {
				cancelAnimationFrame(frameRef.current);
			}
			frameRef.current = 0;
			targetRef.current = null;
		};
	}, [barRef, scrollTo]);

	// 依赖只有当前项：新开一条标签时它就是新那条，切换与追加都会走到这里
	useEffect(() => {
		const bar = barRef.current;
		const button = activeId === null ? undefined : buttonsRef.current.get(activeId);
		if (bar === null || button === undefined) {
			return;
		}
		const barRect = bar.getBoundingClientRect();
		const buttonRect = button.getBoundingClientRect();
		const from = targetRef.current ?? bar.scrollLeft;
		if (buttonRect.left < barRect.left) {
			scrollTo(from - (barRect.left - buttonRect.left));
		} else if (buttonRect.right > barRect.right) {
			scrollTo(from + (buttonRect.right - barRect.right));
		}
	}, [activeId, barRef, buttonsRef, scrollTo]);
}

/** 标签溢出状态：只有真的被左右边界裁住时才亮起对应一侧的渐隐遮罩。 */
export interface TabStripFade {
	left: boolean;
	right: boolean;
}

/** 跟踪横向标签栏两端是否存在溢出裁切，避免在全部放得下时误加边缘渐隐。 */
export function useTabStripFade(
	barRef: RefObject<HTMLDivElement | null>,
	itemCount: number,
	activeId: RightPanelTab | null,
): TabStripFade {
	const [fade, setFade] = useState<TabStripFade>({ left: false, right: false });

	const sync = useCallback((): void => {
		const bar = barRef.current;
		if (bar === null) {
			return;
		}
		// 留 1px 容差吸收亚像素滚动取整误差
		const left = bar.scrollLeft > 1;
		const right = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1;
		setFade((current) => (current.left === left && current.right === right ? current : { left, right }));
	}, [barRef]);

	useEffect(() => {
		// itemCount / activeId 变更后重算一次渐隐状态（依赖显式参与判定而非多余分支）
		void itemCount;
		void activeId;
		sync();
	}, [activeId, itemCount, sync]);

	useEffect(() => {
		const bar = barRef.current;
		if (bar === null) {
			return;
		}
		bar.addEventListener("scroll", sync, { passive: true });
		const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(sync);
		observer?.observe(bar);
		return () => {
			bar.removeEventListener("scroll", sync);
			observer?.disconnect();
		};
	}, [barRef, sync]);

	return fade;
}
