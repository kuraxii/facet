/**
 * 等一次平滑滚动落定。
 *
 * 只有落定之后才能插页：动画途中插入整页会让主线程在飞行轨迹上多出几十到两百毫秒的长任务，
 * 用户看到的就是"跳着跳着卡一下"。
 *
 * 优先用 `scrollend` 事件；浏览器不认识它时退回"连续两帧滚动位置不动"。两者都配一个兜底时长，
 * 否则一次没有位移的滚动（例如本来就在顶部）会让调用方永远等不到回调。
 */

/**
 * 等 `element` 的平滑滚动落定，然后调用一次 `done`。
 *
 * @param element 滚动容器
 * @param done 落定或超时后调用一次
 * @param timeoutMs 兜底时长，超过就当作落定
 * @returns 取消函数。取消之后再落定也不会调用 `done`
 */
export function whenScrollSettles(element: HTMLElement, done: () => void, timeoutMs = 1200): () => void {
	let settled = false;
	let frame = 0;
	let timer = 0;
	let lastTop = element.scrollTop;
	let stillFrames = 0;
	const finish = (): void => {
		if (settled) {
			return;
		}
		settled = true;
		element.removeEventListener("scrollend", finish);
		element.removeEventListener("scroll", poll);
		if (frame !== 0) {
			cancelAnimationFrame(frame);
		}
		window.clearTimeout(timer);
		done();
	};
	/** 退回轮询：滚动位置连续两帧不动就算落定（中间会有极短的停顿帧，两帧足够避开它） */
	const poll = (): void => {
		if (frame !== 0) {
			return;
		}
		frame = requestAnimationFrame(() => {
			frame = 0;
			stillFrames = element.scrollTop === lastTop ? stillFrames + 1 : 0;
			lastTop = element.scrollTop;
			if (stillFrames >= 2) {
				finish();
			}
		});
	};
	// 用一条不参与类型收窄的判定：直接 `"onscrollend" in element` 会把 else 分支的元素收成 never
	const supportsScrollEnd = "onscrollend" in (element as unknown as Record<string, unknown>);
	if (supportsScrollEnd) {
		element.addEventListener("scrollend", finish);
	} else {
		element.addEventListener("scroll", poll, { passive: true });
	}
	timer = window.setTimeout(finish, timeoutMs);
	return () => {
		if (settled) {
			return;
		}
		settled = true;
		element.removeEventListener("scrollend", finish);
		element.removeEventListener("scroll", poll);
		if (frame !== 0) {
			cancelAnimationFrame(frame);
		}
		window.clearTimeout(timer);
	};
}
