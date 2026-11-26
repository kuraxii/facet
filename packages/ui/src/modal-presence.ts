/**
 * 模态弹层退场时序的纯计算逻辑。
 *
 * 与 `overlays.css` 里的 `--dur-slow` 同步：关掉弹层时先保留挂载直到退场动画与遮罩
 * 淡出播完，再从 DOM 里移除；减弱动效、窗口缩放冻结以及无样式的测试环境一律立即落定。
 */

/** 动画结束监听的兜底额外宽限（ms），避开浏览器帧对齐抖动导致的提前卸载闪烁。 */
export const MODAL_EXIT_SLACK_MS = 24;

/** 把 CSS 时长值（`180ms` / `0.18s`）解析为毫秒；无效或非正数一律归零。 */
export function parseModalDurationMs(raw: string): number {
	const value = raw.trim();
	if (value.endsWith("ms")) {
		const num = Number.parseFloat(value.slice(0, -2));
		return Number.isFinite(num) && num > 0 ? num : 0;
	}
	if (value.endsWith("s")) {
		const num = Number.parseFloat(value.slice(0, -1));
		return Number.isFinite(num) && num > 0 ? num * 1000 : 0;
	}
	return 0;
}

/** 计算弹层关闭前需要保留挂载的毫秒数；无需等待时返回 `0`。 */
export function modalExitDelayMs(input: {
	/** 根样式上的 `--dur-slow` 原始字符串 */
	readonly rawDuration: string;
	/** 是否正处于窗口缩放 / 分栏拖拽冻结期 */
	readonly isWindowResizing: boolean;
}): number {
	if (input.isWindowResizing) {
		return 0;
	}
	return parseModalDurationMs(input.rawDuration);
}
