/**
 * Web 端接入。
 *
 * 同一个端口发页面也接 WebSocket：页面来自构建好的前端产物，连接按行帧走 WS。缺省关闭，
 * 只有给出端口时才开；这不是 SSH 那条路，所以接入开关与权限档在这里生效。
 */
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

/** 内容类型表，按扩展名给；认不出的按二进制发。 */
const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
};

/**
 * 处理一次页面请求。
 *
 * 请求路径先归一化再拼到根目录下，落在根目录之外的一律拒绝；找不到文件时退回 index.html，
 * 前端路由因此可以直接刷新。根目录没配置时给出说明。
 */
export async function serveWebRequest(
	root: string | undefined,
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
	if (root === undefined || root.length === 0) {
		response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
		response.end("这台主机没有配置 Web 界面目录\n");
		return;
	}
	const base = resolve(root);
	const pathname = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
	const relative = normalize(pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
	let file = join(base, relative);
	if (!file.startsWith(base)) {
		response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
		response.end("Forbidden\n");
		return;
	}
	const info = await stat(file).catch(() => undefined);
	if (info === undefined || !info.isFile()) {
		// 前端路由：找不到文件时给首页
		file = join(base, "index.html");
	}
	const body = await readFile(file).catch(() => undefined);
	if (body === undefined) {
		response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		response.end("Not found\n");
		return;
	}
	response.writeHead(200, {
		"content-type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
		"cache-control": extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
	});
	response.end(body);
}
