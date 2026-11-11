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
	if (detail === undefined) {
		console.log(`[facet:${scope}] ${message}`);
		return;
	}
	let text: string;
	try {
		text = JSON.stringify(detail);
	} catch {
		text = String(detail);
	}
	console.log(`[facet:${scope}] ${message} ${text}`);
}
