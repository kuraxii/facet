import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer, WebSocket as WsSocket } from "ws";
import { WsTransport } from "./ws.ts";

interface Harness {
	url: string;
	server: Server;
	wss: WebSocketServer;
	received: string[];
	/** 服务端主动推一条动作帧 */
	push(frame: unknown): void;
}

let harness: Harness | undefined;
let transport: WsTransport | undefined;

async function startHarness(): Promise<Harness> {
	const received: string[] = [];
	const server = createServer();
	const wss = new WebSocketServer({ server, path: "/endpoint" });
	wss.on("connection", (socket) => {
		socket.send(
			JSON.stringify({
				type: "hello",
				protocolVersion: 1,
				hostId: "host-1",
				hostName: "测试主机",
				clientId: "client-1",
				role: "admin",
				canManage: true,
				capabilities: ["dispatch", "approval"],
			}),
		);
		socket.on("message", (raw) => {
			received.push(raw.toString());
			const frame = JSON.parse(raw.toString()) as { type: string; id: string; method: string };
			if (frame.type !== "request") {
				return;
			}
			if (frame.method === "listSessions") {
				socket.send(JSON.stringify({ type: "response", id: frame.id, ok: true, data: { sessions: [] } }));
				return;
			}
			socket.send(
				JSON.stringify({
					type: "response",
					id: frame.id,
					ok: false,
					error: { code: "unknown_method", message: "no such method" },
				}),
			);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address !== null ? address.port : 0;
	return {
		url: `ws://127.0.0.1:${port}/endpoint`,
		server,
		wss,
		received,
		push: (frame) => {
			for (const client of wss.clients) {
				client.send(JSON.stringify(frame));
			}
		},
	};
}

beforeEach(async () => {
	harness = await startHarness();
});

afterEach(async () => {
	transport?.close();
	transport = undefined;
	const current = harness;
	harness = undefined;
	if (current) {
		for (const client of current.wss.clients) {
			client.terminate();
		}
		await new Promise<void>((resolve) => current.wss.close(() => resolve()));
		await new Promise<void>((resolve) => current.server.close(() => resolve()));
	}
});

function open(): WsTransport {
	const created = new WsTransport({
		url: harness?.url ?? "",
		createSocket: (url) => new WsSocket(url) as never,
	});
	transport = created;
	return created;
}

describe("WsTransport", () => {
	it("握手后进入就绪状态并带回主机信息", async () => {
		const connection = open();
		const states: string[] = [];
		connection.onStateChange((state) => states.push(state));
		const handshake = await connection.connect();
		expect(handshake).toEqual({
			protocolVersion: 1,
			hostId: "host-1",
			hostName: "测试主机",
			clientId: "client-1",
			role: "admin",
			canManage: true,
			capabilities: ["dispatch", "approval"],
		});
		expect(connection.state).toBe("ready");
		expect(states).toEqual(["connecting", "ready"]);
	});

	it("请求按 id 对应响应", async () => {
		const connection = open();
		await connection.connect();
		const result = await connection.request("listSessions", {});
		expect(result).toEqual({ sessions: [] });
	});

	it("失败响应转成带错误分类的异常", async () => {
		const connection = open();
		await connection.connect();
		await expect(connection.request("providers", {})).rejects.toMatchObject({
			name: "TransportError",
			code: "unknown_method",
			message: "no such method",
		});
	});

	it("派发动作不等待响应并递增端内序号", async () => {
		const connection = open();
		await connection.connect();
		const first = connection.dispatch("chat:/s1", { type: "chat/turnCancelled" });
		const second = connection.dispatch("chat:/s1", { type: "chat/turnCancelled" });
		expect([first, second]).toEqual([1, 2]);
		await new Promise((resolve) => setTimeout(resolve, 50));
		const frames =
			harness?.received.map((raw) => JSON.parse(raw) as { type: string; clientSeq: number }) ?? [];
		// 首帧是令牌，之后才是派发的动作
		expect(frames.map((frame) => frame.type)).toEqual(["auth", "dispatch", "dispatch"]);
		expect(frames.slice(1).map((frame) => frame.clientSeq)).toEqual([1, 2]);
	});

	it("收到动作帧时通知订阅者", async () => {
		const connection = open();
		await connection.connect();
		const seen: number[] = [];
		const stop = connection.onAction((frame) => seen.push(frame.serverSeq));
		harness?.push({
			type: "action",
			channel: "chat:/s1",
			serverSeq: 7,
			origin: undefined,
			action: { type: "chat/turnCancelled" },
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(seen).toEqual([7]);
		stop();
	});

	it("连接关闭后请求被拒绝且状态变为关闭", async () => {
		const connection = open();
		await connection.connect();
		connection.close();
		expect(connection.state).toBe("closed");
		await expect(connection.request("listSessions", {})).rejects.toThrow("连接未就绪");
		expect(() => connection.dispatch("chat:/s1", { type: "chat/turnCancelled" })).toThrow("连接未就绪");
	});
});
