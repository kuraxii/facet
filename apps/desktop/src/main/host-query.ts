/**
 * 退出前的运行状态查询。
 *
 * 主进程不再持有主机对象，问一问端点有没有在跑的会话：连上、发一个 busySessions 请求、
 * 断开。查不到时按没有运行中的会话处理，免得网络问题挡住退出。
 */

import { connectLocalHost, type LocalHost } from "./host-daemon.ts";

/** 查询超时，毫秒。超过就当没查到。 */
const QUERY_TIMEOUT_MS = 1500;

/** 正在运行的会话数。查询失败时给 0。 */
export async function countBusySessions(host: LocalHost): Promise<number> {
	const transport = connectLocalHost(host, QUERY_TIMEOUT_MS);
	try {
		await withTimeout(transport.connect(), QUERY_TIMEOUT_MS);
		const { files } = await withTimeout(transport.request("busySessions", {}), QUERY_TIMEOUT_MS);
		return files.length;
	} catch {
		return 0;
	} finally {
		transport.close();
	}
}

/** 给一个承诺加超时，超时后按失败处理。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("timeout")), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}
