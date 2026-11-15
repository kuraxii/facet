/**
 * 开发期日志。
 *
 * 只在 Vite 开发服务器下输出：`npm run dev` 时 import.meta.env.DEV 为真，打包产物里为假，
 * 测试环境的 MODE 是 test，也不输出。界面侧不写文件、不读环境变量，保持可在浏览器里跑。
 */

/** 构建期注入的环境信息，非 Vite 运行环境下为空。 */
const env = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env;

/** 是否输出开发期日志。 */
export function isDebugLogEnabled(): boolean {
	return env?.DEV === true && env.MODE !== "test";
}

/** 把日志明细转成字符串，避免 Electron 只转发首个参数时丢掉对象。 */
function formatDetail(detail: unknown): string {
	if (detail === undefined) {
		return "";
	}
	try {
		return ` ${JSON.stringify(detail)}`;
	} catch {
		return ` ${String(detail)}`;
	}
}

/**
 * 输出一条开发期日志。关掉时是空操作。
 *
 * 明细转成 JSON 拼进同一条字符串：Electron 的 console-message 只把首个参数传给主进程，
 * 直接传对象在终端里会变成 [object Object]。
 */
export function debugLog(scope: string, message: string, detail?: unknown): void {
	if (!isDebugLogEnabled()) {
		return;
	}
	console.log(`[facet:${scope}] ${message}${formatDetail(detail)}`);
}

/** 输出一条错误日志。打包版也保留，用于定位提交与历史同步失败。 */
export function errorLog(scope: string, message: string, detail?: unknown): void {
	console.error(`[facet:${scope}] ${message}${formatDetail(detail)}`);
}
