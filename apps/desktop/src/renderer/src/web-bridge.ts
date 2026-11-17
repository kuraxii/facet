import {
	createI18n,
	type LanguageSetting,
	readLanguageSetting,
	resolveLanguage,
	type SupportedLanguage,
	translate,
} from "@facet/i18n";

/**
 * Web 端的桥。
 *
 * 同一份界面既跑在桌面里也跑在浏览器里：桌面的桥由 preload 注入，这里在没有桥时补一个，
 * 把「主进程的通道」换成一条到当前主机的 WebSocket。页面与连接同源，令牌从地址栏或本地
 * 存储里取，认证帧里带上它。
 */

/** 令牌在本地存储里的键。 */
const TOKEN_KEY = "facet.web.token";

/** Web 本机语言设置；Web 没有主进程，直接存在 localStorage。 */
const LANGUAGE_KEY = "facet.web.language";

/** 浏览器语言作为 auto 的系统语言。 */
function systemLanguage(): string {
	return navigator.languages[0] ?? navigator.language;
}

/** 读取 Web 本机语言设置，非法值按跟随系统处理。 */
function readWebLanguageSetting(): LanguageSetting {
	return readLanguageSetting(localStorage.getItem(LANGUAGE_KEY)) ?? "auto";
}

/** 连接的 WebSocket 地址：与页面同源，路径固定。 */
/** 一段字节转 base64。浏览器里没有 Buffer，分段拼避免一次展开成超长参数。 */
export function bytesToBase64(bytes: Uint8Array): string {
	let text = "";
	const chunk = 0x8000;
	for (let index = 0; index < bytes.length; index += chunk) {
		text += String.fromCharCode(...bytes.subarray(index, index + chunk));
	}
	return btoa(text);
}

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
	const i18n = createI18n(resolveLanguage(readWebLanguageSetting(), systemLanguage()));
	const t = translate(i18n);

	window.facet = {
		projectDir: "",
		platform: "web",
		appVersion: "web",
		// Web 端暂时不做界面缩放，浏览器自身负责页面缩放
		uiScale: 100,
		setUiScale: () => {},
		// Web 没有主进程，语言设置与浏览器语言都在这一层解析
		languageSetting: readWebLanguageSetting(),
		language: resolveLanguage(readWebLanguageSetting(), systemLanguage()),
		setLanguage: (setting: LanguageSetting): Promise<SupportedLanguage> => {
			localStorage.setItem(LANGUAGE_KEY, setting);
			return Promise.resolve(resolveLanguage(setting, systemLanguage()));
		},
		// Web 端连的就是当前这台主机，没有「本机/远程」之分
		hostMode: "external",
		getLocalHost: async () => ({ target: "local", address: location.host, token }),
		onLocalHostChanged: () => () => {},
		openHostChannel: async (target, handlers) => {
			if (target !== "local") {
				throw new Error(t("web.onlyCurrentHost"));
			}
			const socket = new WebSocket(socketUrl());
			await new Promise<void>((resolve, reject) => {
				socket.onopen = () => resolve();
				socket.onerror = () => reject(new Error(t("web.connectFailed", { address: location.host })));
			});
			socket.onmessage = (event) => {
				handlers.onData(typeof event.data === "string" ? event.data : "");
			};
			socket.onclose = () => handlers.onClose("closed");
			return {
				ok: true as const,
				id: 1,
				token,
				// Web 是远程端：按操作档申请，主机按 FACET_REMOTE_PERMISSION 收窄（缺省只读）
				role: "operator" as const,
				entry: "web" as const,
				write: (text: string) => socket.send(text),
				close: () => socket.close(),
			};
		},
		// 浏览器里没有原生的目录选择与保存窗口，用最接近的替代
		pickDirectory: async () => window.prompt(t("web.projectDirPrompt")) ?? undefined,
		// 选图用隐藏的文件输入框；用户取消时浏览器不一定给事件，这里按空结果收尾
		pickImages: async () => {
			const input = document.createElement("input");
			input.type = "file";
			input.accept = "image/*";
			input.multiple = true;
			const files = await new Promise<File[]>((resolve) => {
				input.addEventListener("change", () => resolve([...(input.files ?? [])]), { once: true });
				input.addEventListener("cancel", () => resolve([]), { once: true });
				input.click();
			});
			return await Promise.all(
				files.map(async (file) => ({
					name: file.name,
					mimeType: file.type,
					data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
					byteSize: file.size,
				})),
			);
		},
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
