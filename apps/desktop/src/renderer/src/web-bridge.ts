/**
 * Web 端的桥。
 *
 * 同一份界面既跑在桌面里也跑在浏览器里：桌面的桥由 preload 注入，这里在没有桥时补一个，
 * 把「主进程的通道」换成一条到当前主机的 WebSocket。页面与连接同源，令牌从地址栏或本地
 * 存储里取，认证帧里带上它。
 */

/** 令牌在本地存储里的键。 */
const TOKEN_KEY = "facet.web.token";

/** 连接的 WebSocket 地址：与页面同源，路径固定。 */
function socketUrl(): string {
	const scheme = location.protocol === "https:" ? "wss" : "ws";
	return `${scheme}://${location.host}/endpoint`;
}

/** 取令牌：地址栏优先，其次本地存储。 */
function readToken(): string {
	const fromQuery = new URLSearchParams(location.search).get("tkn");
	if (fromQuery !== null && fromQuery.length > 0) {
		localStorage.setItem(TOKEN_KEY, fromQuery);
		return fromQuery;
	}
	return localStorage.getItem(TOKEN_KEY) ?? "";
}

/** 给浏览器补一个与桌面同形的桥。 */
export function installWebBridge(): void {
	const token = readToken();

	window.facet = {
		projectDir: "",
		platform: "web",
		appVersion: "web",
		// Web 端连的就是当前这台主机，没有「本机/远程」之分
		hostMode: "external",
		// 关掉页面不会结束主机，这两个开关在 Web 上不起作用
		keepHostOnClose: true,
		getHostPrefs: async () => ({ keepOnClose: true }),
		setHostPrefs: async (prefs) => prefs,
		stopHost: async () => {},
		getLocalHost: async () => ({ target: "local", address: location.host, token }),
		onLocalHostChanged: () => () => {},
		openHostChannel: async (target, handlers) => {
			if (target !== "local") {
				throw new Error("Web 端只能连接当前主机");
			}
			const socket = new WebSocket(socketUrl());
			await new Promise<void>((resolve, reject) => {
				socket.onopen = () => resolve();
				socket.onerror = () => reject(new Error(`连不上主机 ${location.host}`));
			});
			socket.onmessage = (event) => {
				handlers.onData(typeof event.data === "string" ? event.data : "");
			};
			socket.onclose = () => handlers.onClose("closed");
			return {
				id: 1,
				token,
				// Web 是远程端：按操作档申请，主机按 FACET_REMOTE_PERMISSION 收窄（缺省只读）
				role: "operator" as const,
				write: (text: string) => socket.send(text),
				close: () => socket.close(),
			};
		},
		// 浏览器里没有原生的目录选择与保存窗口，用最接近的替代
		pickDirectory: async () => window.prompt("主机上的项目目录（绝对路径）") ?? undefined,
		saveText: async (suggestedName, text) => {
			const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = suggestedName;
			link.click();
			URL.revokeObjectURL(url);
			return true;
		},
	};
}
