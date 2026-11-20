/**
 * 布局档位。
 *
 * 档位判定只在这里做一次：断点数值只出现在 `LAYOUT_BREAKPOINT_PX`，样式表不再写档位媒体
 * 查询，只认根节点与 `.app` 上的类名。判定结果有两个读者：
 *
 * - `.app` 上的 `is-narrow` / `is-wide`：`AppFrame` 每次渲染同步取一次，首帧就是对的，
 *   不会先画一帧宽屏再纠正。
 * - 根节点 `html` 上的同名类名：渲染入口在 `createRoot().render()` 之前写一次，供 React
 *   挂载之前就存在的元素（`#root` 与 `body`）与首帧样式使用。
 *
 * 两个读者共用同一个 MediaQueryList 与同一个监听，所以不存在「CSS 认为是宽档、组件认为
 * 是窄档」的中间态。阈值本身在 `resolve-layout.ts`，这里只用它建媒体查询。
 */
import { LAYOUT_BREAKPOINT_PX } from "./resolve-layout.ts";

/**
 * 窄档判定。
 *
 * 用范围语法 `width < N` 而不是 `max-width: N - 1`：窄档的定义是「小于断点」，恰好等于
 * 断点时属于中档，写成减法会留下半个像素的缝。
 */
const narrowQuery = window.matchMedia(`(width < ${LAYOUT_BREAKPOINT_PX}px)`);

/** 档位类名：窄档 `is-narrow`，其余 `is-wide`。 */
export function layoutClassName(isNarrow: boolean): string {
	return isNarrow ? "is-narrow" : "is-wide";
}

/** 当前是否窄档。`useSyncExternalStore` 的快照读取，必须是纯函数。 */
export function readLayoutIsNarrow(): boolean {
	return narrowQuery.matches;
}

/** 订阅档位变化：窗口缩放与窗口尺寸变化都会触发。 */
export function subscribeLayout(listener: () => void): () => void {
	narrowQuery.addEventListener("change", listener);
	return () => {
		narrowQuery.removeEventListener("change", listener);
	};
}

/** 已经装过根节点同步，避免开发态重复挂载时叠加监听。 */
let bootstrapped = false;

/**
 * 首帧之前把档位写到根节点。
 *
 * 渲染入口在 `createRoot().render()` 之前调用一次：`BootScreen` 与工作区开始渲染之前，
 * 根节点上已经是正确的档位。写完之后继续跟着 MediaQueryList 维护，窗口缩放时不会停在
 * 首帧那一档。
 */
export function applyLayoutBootstrap(): void {
	if (bootstrapped) {
		return;
	}
	bootstrapped = true;
	const root = document.documentElement;
	const sync = (isNarrow: boolean): void => {
		root.classList.toggle("is-narrow", isNarrow);
		root.classList.toggle("is-wide", !isNarrow);
	};
	sync(narrowQuery.matches);
	narrowQuery.addEventListener("change", (event) => sync(event.matches));
}
