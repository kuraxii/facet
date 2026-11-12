/**
 * 主机侧的开发期日志。
 *
 * 由桌面主进程在 `npm run dev` 启动时通过 startServer 的 debug 选项打开；独立进程用
 * FACET_DEBUG=1 打开。打包运行时保持关闭。
 */

let enabled = false;

/** 打开或关闭开发期日志。 */
export function setDebugLog(value: boolean): void {
	enabled = value;
}

/** 是否输出开发期日志。 */
export function isDebugLogEnabled(): boolean {
	return enabled;
}

/** 输出一条开发期日志。关掉时是空操作。 */
export function debugLog(scope: string, message: string, detail?: unknown): void {
	if (!enabled) {
		return;
	}
	if (detail === undefined) {
		console.log(`[facet:${scope}] ${message}`);
		return;
	}
	console.log(`[facet:${scope}] ${message}`, detail);
}
