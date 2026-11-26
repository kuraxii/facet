/**
 * 缩略图与大图之间的 View Transitions。
 *
 * 只做一件事：给「点开的那个元素」与「更新之后出现的那个元素」临时挂同一个
 * `view-transition-name`，让浏览器把两张快照补间过去；时长与曲线在 `image-preview.css` 里
 * 读 `--dur-enter` / `--ease-enter`。
 *
 * 三处降级：
 * - 浏览器没有 `startViewTransition`（测试与旧内核）——直接切换；
 * - 用户要减动效（`data-motion="reduced"` 或系统偏好）——直接切换；
 * - 浏览器正在跑另一段过渡（会抛 `InvalidStateError`）——摘掉名字、直接切换。
 */

/** 过渡名：同一时刻只允许一对元素共用。 */
const MORPH_NAME = "image-preview";

/** 这份环境能不能做过渡：要原生支持，且没被减动效关掉。 */
export function canMorph(): boolean {
	if (typeof document === "undefined") {
		return false;
	}
	if (typeof document.startViewTransition !== "function") {
		return false;
	}
	if (document.documentElement.dataset.motion === "reduced") {
		return false;
	}
	const query =
		typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
	return query === null || !query.matches;
}

/** 把名字挂在元素上；元素可能已经被卸载，挂不上就算了。 */
function name(element: HTMLElement | null | undefined, value: string): void {
	if (element?.isConnected === true) {
		element.style.viewTransitionName = value;
	}
}

/**
 * 从 `from` 飞到更新之后出现的那个元素。
 *
 * `apply` 必须是同步的（内部用 `flushSync` 提交 React 更新）；`nameTarget` 在应用更新之后
 * 立刻调用，用来给新出现的元素挂名字——它得在本次回调返回之前完成，浏览器那时才拍新快照。
 */
export function morphImage(
	from: HTMLElement | null,
	apply: () => void,
	nameTarget: () => HTMLElement | null,
): void {
	if (from === null || typeof document.startViewTransition !== "function" || !canMorph()) {
		apply();
		return;
	}
	name(from, MORPH_NAME);
	let target: HTMLElement | null = null;
	try {
		const transition = document.startViewTransition(() => {
			// 旧快照在回调前已经拍完；打开预览时 `from`（缩略图按钮）仍在 DOM 里，必须先摘掉它的
			// `viewTransitionName`，否则新快照阶段会有两个元素同名，Chromium 会直接跳过整段过渡。
			from.style.viewTransitionName = "";
			apply();
			target = nameTarget();
			name(target, MORPH_NAME);
			if (target instanceof HTMLImageElement && !target.complete && typeof target.decode === "function") {
				return target.decode().catch(() => {});
			}
			return undefined;
		});
		void transition.finished.finally(() => {
			from.style.viewTransitionName = "";
			name(target, "");
		});
	} catch {
		// 上一段过渡还没跑完，或者元素已经不在了：别让一次预览因此开不了
		from.style.viewTransitionName = "";
		apply();
	}
}
