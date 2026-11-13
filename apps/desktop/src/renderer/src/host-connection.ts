/**
 * 界面到主机的连接。
 *
 * 渲染进程跑在沙箱里，打不开 socket，所以连接由主进程代理：这里把主进程的通道收成一条
 * 按行收发的字节流，传输层（StreamTransport）在它上面跑同一套协议。本机与远程的差别只在
 * 目标字符串上，令牌每次都向主进程取最新的——本机重启后旧令牌就失效了。
 */
import type { ClientEntry } from "@facet/protocol";
import { StreamTransport } from "@facet/transport";

/** 本机目标的标识，与主进程约定一致。 */
export const LOCAL_TARGET = "local";

/** 主进程暴露的通道接口，来自 preload。 */
export interface HostChannelBridge {
	getLocalHost: () => Promise<{ target: string; address: string; token: string | undefined } | undefined>;
	onLocalHostChanged: (listener: () => void) => () => void;
	openHostChannel: (
		target: string,
		handlers: { onData: (chunk: string) => void; onClose: (reason: string) => void },
	) => Promise<{
		id: number;
		token: string | undefined;
		role: "operator" | "viewer" | undefined;
		/** 连接从哪来：桌面主进程打开的通道，或浏览器页面 */
		entry: ClientEntry;
		write: (text: string) => void;
		close: () => void;
	}>;
}

/**
 * 去掉 IPC 包装，只留主进程给的说明。
 *
 * Electron 把 ipcMain 抛出的错误包成 `Error invoking remote method 'x': Error: 说明`，
 * 界面上直接显示这串前缀看不懂。
 */
export function cleanHostError(error: unknown): Error {
	const text = error instanceof Error ? error.message : String(error);
	const stripped = text.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "");
	return new Error(stripped);
}

/** 建一个走主进程通道的传输。readTarget 每次重连都会重新读，切换主机后立即生效。 */
export function makeTransport(bridge: HostChannelBridge, readTarget: () => string): StreamTransport {
	let dataListener: ((chunk: string) => void) | undefined;
	let closeListener: ((reason: string) => void) | undefined;

	const transport = new StreamTransport({
		createStream: async () => {
			const target = readTarget();
			const channel = await bridge.openHostChannel(target, {
				onData: (chunk) => dataListener?.(chunk),
				onClose: (reason) => closeListener?.(reason),
			});
			// 令牌、权限档与入口由桥给出：桌面通道不声明档位即管理档，浏览器页面声明 web
			transport.setToken(channel.token, channel.role, channel.entry);
			return {
				write: (text) => channel.write(text),
				onData: (listener) => {
					dataListener = listener;
					return () => {
						dataListener = undefined;
					};
				},
				onClose: (listener) => {
					closeListener = listener;
					return () => {
						closeListener = undefined;
					};
				},
				close: () => channel.close(),
			};
		},
	});

	// createStream 的失败会带着 IPC 前缀进到传输层，这里换成干净的说明
	const connect = transport.connect.bind(transport);
	transport.connect = async () => {
		try {
			return await connect();
		} catch (error) {
			throw cleanHostError(error);
		}
	};
	return transport;
}
