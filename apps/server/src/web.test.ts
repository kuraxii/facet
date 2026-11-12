/**
 * Web 接入的测试。
 *
 * 页面服务：找不到文件时回首页、越界路径拒绝、没配目录时说明；连接：WebSocket 上跑同一套
 * 帧，令牌不对断开，令牌正确按远程档位握手，只读档不能建会话。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFrame } from "@facet/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { AuditLog } from "./audit.ts";
import type { ServerConfig } from "./config.ts";
import { startEndpoint } from "./endpoint.ts";
import { ProjectStore } from "./project-store.ts";
import { SessionHub } from "./session-hub.ts";
import { SessionsChannel } from "./sessions-channel.ts";
import { SettingsStore } from "./settings-store.ts";
import { serveWebRequest } from "./web.ts";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "facet-web-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

/** 一个最小的假响应对象，够断言状态码与内容。 */
function fakeResponse() {
	const state: { status?: number; headers?: Record<string, string>; body?: string | Buffer } = {};
	return {
		state,
		writeHead(status: number, headers?: Record<string, string>) {
			state.status = status;
			state.headers = headers;
		},
		end(body?: string | Buffer) {
			state.body = body;
		},
	};
}

describe("页面服务", () => {
	it("给出目录时发首页，未知路径退回首页", async () => {
		const root = join(dir, "web");
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "index.html"), "<html>首页</html>");
		const first = fakeResponse();
		await serveWebRequest(root, { url: "/" } as never, first as never);
		expect(first.state.status).toBe(200);
		expect(String(first.state.body)).toBe("<html>首页</html>");
		expect(first.state.headers?.["content-type"]).toContain("text/html");

		const fallback = fakeResponse();
		await serveWebRequest(root, { url: "/some/route" } as never, fallback as never);
		expect(String(fallback.state.body)).toBe("<html>首页</html>");
	});

	it("静态资源按扩展名给类型", async () => {
		const root = join(dir, "web");
		await mkdir(join(root, "assets"), { recursive: true });
		await writeFile(join(root, "assets", "app.js"), "console.log(1)");
		const response = fakeResponse();
		await serveWebRequest(root, { url: "/assets/app.js" } as never, response as never);
		expect(response.state.headers?.["content-type"]).toContain("text/javascript");
	});

	it("指到目录之外的一律拒绝", async () => {
		const root = join(dir, "web");
		await mkdir(root, { recursive: true });
		const response = fakeResponse();
		await serveWebRequest(root, { url: "/../../etc/passwd" } as never, response as never);
		expect(response.state.status).toBe(403);
	});

	it("没有配置目录时说明原因", async () => {
		const response = fakeResponse();
		await serveWebRequest(undefined, { url: "/" } as never, response as never);
		expect(response.state.status).toBe(503);
	});
});

describe("WebSocket 接入", () => {
	let endpoint: Awaited<ReturnType<typeof startEndpoint>>;

	function config(dataDir: string, webPort: number, webRoot: string): ServerConfig {
		return {
			host: "127.0.0.1",
			port: 0,
			socketPath: join(dataDir, "host.sock"),
			token: "令牌",
			agentDir: dataDir,
			sessionDir: undefined,
			dataDir,
			remotePermission: "view",
			webPort,
			webRoot,
			replayLimit: 32,
			sessionIdleMs: 60_000,
			hostName: "主机",
			debug: false,
		};
	}

	beforeEach(async () => {
		const root = join(dir, "web");
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "index.html"), "<html>首页</html>");
		const hub = new SessionHub({
			factory: {
				create: async () => {
					throw new Error("只读档不该建会话");
				},
				open: async () => {
					throw new Error("本用例不开会话");
				},
				fork: async () => {
					throw new Error("本用例不分叉");
				},
				peekSessionId: async () => "s1",
				listSessions: async () => [],
				agentDir: dir,
				sessionDir: dir,
			} as never,
			replayLimit: 32,
		});
		endpoint = await startEndpoint({
			config: config(dir, 0, root),
			factory: { listSessions: async () => [], agentDir: dir, sessionDir: dir } as never,
			hub: hub as never,
			projectStore: await ProjectStore.open({ file: join(dir, "projects.json") }),
			settingsStore: await SettingsStore.open({ file: join(dir, "settings.json") }),
			hostId: "h",
			sessions: new SessionsChannel(32),
			audit: new AuditLog(join(dir, "audit.log")),
		});
	});

	const opened: WebSocket[] = [];

	afterEach(async () => {
		for (const ws of opened.splice(0)) {
			ws.terminate();
		}
		await endpoint.close().catch(() => undefined);
	});

	/** 连上之后等一帧。 */
	async function connect(token: string): Promise<{ ws: WebSocket; frames: Record<string, unknown>[] }> {
		const port = endpoint.webPort as number;
		const ws = new WebSocket(`ws://127.0.0.1:${port}/endpoint`);
		opened.push(ws);
		const frames: Record<string, unknown>[] = [];
		ws.on("message", (raw) => {
			for (const line of raw.toString().split("\n")) {
				if (line.trim().length > 0) {
					frames.push(JSON.parse(line) as Record<string, unknown>);
				}
			}
		});
		await new Promise<void>((resolve, reject) => {
			ws.once("open", () => resolve());
			ws.once("error", reject);
		});
		ws.send(encodeFrame({ type: "auth", token }));
		await new Promise((resolve) => setTimeout(resolve, 200));
		return { ws, frames };
	}

	it("令牌不对时断开", async () => {
		const { ws, frames } = await connect("错的");
		expect(frames).toEqual([]);
		expect(ws.readyState === WebSocket.OPEN).toBe(false);
	});

	it("令牌正确时按远程档位握手，只读档不能建会话", async () => {
		const { ws, frames } = await connect("令牌");
		const hello = frames.find((frame) => frame.type === "hello");
		expect(hello?.role).toBe("viewer");
		ws.send(
			encodeFrame({ type: "request", id: "r1", method: "createSession", params: { cwd: dir } } as never),
		);
		await new Promise((resolve) => setTimeout(resolve, 200));
		const response = frames.find((frame) => frame.type === "response");
		expect(response).toMatchObject({ ok: false, error: { message: "这条连接是只读的" } });
		ws.close();
	});
});
