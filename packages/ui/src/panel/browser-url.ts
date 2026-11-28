/**
 * 右侧栏内嵌浏览器的地址解析与安全校验（纯函数，不依赖 Electron 或 DOM）。
 *
 * 仅允许 `http:`、`https:` 与 `about:blank`，拒绝 `file:`、`javascript:`、`data:` 等危险或本地协议；
 * 自动补全开发常用的 `localhost:port`、`:5173`、裸域名与搜索词。
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const PORT_ONLY_RE = /^:?(\d{1,5})([/?#].*)?$/;
const LOCAL_HOST_RE = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?([/?#].*)?$/i;
const PRIVATE_IP_RE =
	/^(10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?([/?#].*)?$/;
const DOMAIN_LIKE_RE = /^[^\s/:$.?#][^\s/:]*\.[a-zA-Z]{2,}(?::\d+)?([/?#].*)?$/;

/** 判断一个完整 URL 是否允许在右侧栏浏览器视图中加载。 */
export function isAllowedBrowserUrl(raw: string): boolean {
	if (raw === "about:blank") {
		return true;
	}
	try {
		const parsed = new URL(raw);
		return ALLOWED_PROTOCOLS.has(parsed.protocol);
	} catch {
		return false;
	}
}

/** 将用户输入的地址规范化为安全可加载的 URL；非法协议或空串返回 `undefined`。 */
export function normalizeBrowserUrl(input: string): string | undefined {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	if (trimmed === "about:blank") {
		return "about:blank";
	}
	// 先识别端口与无协议头主机地址，避免 `localhost:8080` 被 `SCHEME_RE` 误判成自定义协议
	const portMatch = PORT_ONLY_RE.exec(trimmed);
	if (portMatch !== null) {
		const port = Number.parseInt(portMatch[1] ?? "", 10);
		if (port >= 1 && port <= 65535) {
			const suffix = portMatch[2] ?? "";
			return `http://localhost:${port}${suffix}`;
		}
	}
	if (LOCAL_HOST_RE.test(trimmed) || PRIVATE_IP_RE.test(trimmed)) {
		return `http://${trimmed}`;
	}
	if (DOMAIN_LIKE_RE.test(trimmed)) {
		return `https://${trimmed}`;
	}
	if (SCHEME_RE.test(trimmed)) {
		return isAllowedBrowserUrl(trimmed) ? trimmed : undefined;
	}
	return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}
