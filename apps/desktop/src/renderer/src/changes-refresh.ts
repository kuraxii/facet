/**
 * 变更页什么时候真的去取一次状态。
 *
 * 三类局面要挡：窗口不在前台（没人看，探测留给回到前台那一次）、仓库改动过大（主机侧只给了
 * 前一批，每探一次都要扫一遍工作树）、以及回到前台但什么都没攒下（平时切窗口不该发请求）。
 *
 * 这里只做判定，拉请求、开定时器与脏标记都留在 Hook 里。
 */

/** 一条工作树信号该怎么处理。 */
export interface SignalDecision {
	/** 现在就去取 */
	refresh: boolean;
	/** 先记一笔，等回到前台再取 */
	defer: boolean;
}

/**
 * 收到工作树信号时的判定。
 *
 * 没有会话或变更页没显示时什么都不做：那时候本来就没有订阅，也没有可刷新的地方。
 */
export function decideOnSignal(input: {
	/** 变更页是否正在显示 */
	isVisible: boolean;
	/** 窗口是否在前台且可见 */
	isActive: boolean;
	/** 上一次探测是不是因为改动太多被截断了 */
	isTruncated: boolean;
}): SignalDecision {
	if (!input.isVisible) {
		return { refresh: false, defer: false };
	}
	if (!input.isActive || input.isTruncated) {
		return { refresh: false, defer: true };
	}
	return { refresh: true, defer: false };
}

/**
 * 回到前台时要不要补一次。
 *
 * 攒下过信号，或者正等着超大仓放行（重新聚焦是放行的时机之一），才补。平时切窗口什么都不做。
 */
export function shouldCatchUp(input: {
	/** 变更页是否正在显示 */
	isVisible: boolean;
	/** 窗口是否在前台且可见 */
	isActive: boolean;
	/** 失焦期间攒下过信号 */
	hasPending: boolean;
	/** 上一次探测是不是被截断了 */
	isTruncated: boolean;
}): boolean {
	if (!input.isVisible || !input.isActive) {
		return false;
	}
	return input.hasPending || input.isTruncated;
}
