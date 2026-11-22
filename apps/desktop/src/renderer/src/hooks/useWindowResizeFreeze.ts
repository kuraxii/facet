/**
 * 窗口缩放期间的过渡冻结。
 *
 * 拖窗口边缘时每一帧都在改视口尺寸，全仓的过渡会把这一连串变化叠成一条追赶动画，观感就是
 * 拖影与发糊。这里在缩放期间往 `documentElement` 上挂 `data-window-resizing`，样式表那头把
 * 四档时长清零（见 `motion.css`），松手约 150ms 后摘掉。
 *
 * 用防抖而不是 `resize` 一结束就摘：拖拽途中会有一连串极短的停顿，立刻摘掉会让冻结在拖动中
 * 反复开关，反而闪。
 */
import { useEffect } from "react";

/** 最后一次 `resize` 之后多久摘掉属性。 */
const SETTLE_MS = 150;

/** 属性名：样式表按它清零时长。 */
const ATTR = "data-window-resizing";

/** 在窗口缩放期间冻结全仓过渡。 */
export function useWindowResizeFreeze(): void {
	useEffect(() => {
		const root = document.documentElement;
		let timer: number | undefined;

		const onResize = (): void => {
			// 已经挂着就不必再写一次属性：拖动期间这里每帧都会进来
			if (!root.hasAttribute(ATTR)) {
				root.setAttribute(ATTR, "");
			}
			if (timer !== undefined) {
				window.clearTimeout(timer);
			}
			timer = window.setTimeout(() => {
				timer = undefined;
				root.removeAttribute(ATTR);
			}, SETTLE_MS);
		};

		window.addEventListener("resize", onResize, { passive: true });
		return () => {
			window.removeEventListener("resize", onResize);
			if (timer !== undefined) {
				window.clearTimeout(timer);
			}
			root.removeAttribute(ATTR);
		};
	}, []);
}
