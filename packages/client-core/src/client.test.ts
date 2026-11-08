import type {
	Action,
	ActionFrame,
	Channel,
	Entry,
	Message,
	RequestMethod,
	RequestParams,
	RequestResults,
	SessionSnapshot,
} from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { type DeviceHandshake, SessionClient, type SessionTransport } from "./client.ts";

const CHAT = "chat:/s1" as const;
const SESSION = "session:/s1" as const;

function assistant(text: string): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		provider: "p",
		model: "m",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			reasoning: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}

function snapshot(): SessionSnapshot {
	return {
		id: "s1",
		file: "/tmp/s1.jsonl",
		cwd: "/tmp",
		name: "既有会话",
		status: "idle",
		model: undefined,
		thinkingLevel: "medium",
		availableThinkingLevels: ["medium"],
		activeToolNames: [],
		queued: { steering: [], followUp: [] },
		pendingApprovals: [],
		contextUsage: undefined,
		stats: {
			sessionId: "s1",
			sessionFile: "/tmp/s1.jsonl",
			userMessages: 0,
			assistantMessages: 0,
			toolCalls: 0,
			toolResults: 0,
			totalMessages: 0,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			cost: 0,
			contextUsage: undefined,
		},
		modelFallbackMessage: undefined,
	};
}

class FakeTransport implements SessionTransport {
	readonly calls: { method: string; params: unknown }[] = [];
	readonly entries: Entry[];
	private listener: ((frame: ActionFrame) => void) | undefined;
	private seq = 0;
	/** 每个通道已发出的最大序号,订阅时作为基线返回 */
	private readonly lastSeq = new Map<Channel, number>();

	constructor(entryCount: number) {
		this.entries = Array.from({ length: entryCount }, (_, index) => ({
			id: `e${index + 1}`,
			parentId: index === 0 ? null : `e${index}`,
			kind: "message" as const,
			timestamp: "2026-11-08T00:00:00Z",
			message: assistant(`第 ${index + 1} 条`),
		}));
	}

	async request<M extends RequestMethod>(method: M, params?: RequestParams[M]): Promise<RequestResults[M]> {
		this.calls.push({ method, params });
		const result = (() => {
			switch (method) {
				case "openSession": {
					const file = (params as { sessionFile: string }).sessionFile;
					const id = file.split("/").pop()?.replace(".jsonl", "") ?? "s1";
					return { ...snapshot(), id, file };
				}
				case "forkSession":
					return { ...snapshot(), id: "s2", file: "/tmp/s2.jsonl" };
				case "snapshot":
					return snapshot();
				case "subscribe":
					return {
						seq: 0,
						resync: false,
						session: (params as { channel: Channel }).channel === SESSION ? snapshot() : undefined,
					};
				case "unsubscribe":
					return {};
				case "entries": {
					const { cursor, limit } = params as { cursor?: string; limit?: number };
					const size = limit ?? 50;
					let end = this.entries.length;
					if (cursor !== undefined) {
						const index = this.entries.findIndex((entry) => entry.id === cursor);
						end = Math.max(index, 0);
					}
					const start = Math.max(0, end - size);
					const window = this.entries.slice(start, end);
					const first = window[0];
					return { entries: window, nextCursor: start > 0 && first ? first.id : undefined };
				}
				default:
					return {};
			}
		})();
		return result as RequestResults[M];
	}

	dispatch(_channel: Channel, _action: Action): number {
		this.seq += 1;
		return this.seq;
	}

	onAction(listener: (frame: ActionFrame) => void): () => void {
		this.listener = listener;
		return () => {
			this.listener = undefined;
		};
	}

	/** 按通道推动作,序号自动递增。 */
	emit(channel: Channel, action: Action, seq?: number): void {
		const previous = this.lastSeq.get(channel) ?? 0;
		const next = seq ?? previous + 1;
		this.seq = next;
		this.lastSeq.set(channel, next);
		this.listener?.({ type: "action", channel, serverSeq: next, origin: undefined, action });
	}
}

const handshake: DeviceHandshake = {
	protocolVersion: 1,
	hostId: "h",
	hostName: "设备",
	clientId: "c",
	capabilities: ["dispatch"],
};

function createClient(entryCount: number, options: { initialPages?: number; pageSize?: number } = {}) {
	const transport = new FakeTransport(entryCount);
	const client = new SessionClient({ transport, ...options });
	client.attach(handshake);
	return { transport, client };
}

describe("SessionClient", () => {
	it("打开会话时订阅两条通道", async () => {
		const { transport, client } = createClient(10, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		const subscriptions = transport.calls.filter((call) => call.method === "subscribe");
		expect(subscriptions.map((call) => (call.params as { channel: Channel }).channel)).toEqual([
			SESSION,
			CHAT,
		]);
		expect(client.current?.sessionId).toBe("s1");
	});

	it("首次装载按页取最近历史且顺序为时间升序", async () => {
		const { client } = createClient(12, { initialPages: 2, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		const messages = client.chatView()?.messages ?? [];
		expect(messages).toHaveLength(10);
		expect(messages[0]?.message && "content" in (messages[0].message ?? {})).toBe(true);
		expect(JSON.stringify(messages[0]?.id)).toBe('"e:e3"');
		expect(JSON.stringify(messages[messages.length - 1]?.id)).toBe('"e:e12"');
		expect(client.hasMore).toBe(true);
	});

	it("继续往更早翻页时补在前面且不重复", async () => {
		const { client } = createClient(12, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		expect(client.chatView()?.messages).toHaveLength(5);
		const result = await client.loadOlder();
		expect(result.loaded).toBe(5);
		expect(client.chatView()?.messages).toHaveLength(10);
		const ids = (client.chatView()?.messages ?? []).map((message) => message.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids[0]).toBe("e:e3");
		expect(ids[9]).toBe("e:e12");
		expect(client.hasMore).toBe(true);
		await client.loadOlder();
		expect(client.hasMore).toBe(false);
	});

	it("订阅返回的序号成为基线,首条动作不误报缺口", async () => {
		const { transport, client } = createClient(2, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		const before = transport.calls.length;
		transport.emit(CHAT, { type: "chat/notice", level: "info", message: "第一条" }, 1);
		expect(client.chatView()?.notices).toHaveLength(1);
		expect(transport.calls.length).toBe(before);
	});

	it("重复序号被丢弃", async () => {
		const { transport, client } = createClient(2, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		transport.emit(CHAT, { type: "chat/notice", level: "info", message: "第一次" }, 1);
		transport.emit(CHAT, { type: "chat/notice", level: "info", message: "补发" }, 1);
		expect(client.chatView()?.notices).toEqual([{ level: "info", message: "第一次" }]);
	});

	it("序号缺口时重新装载最近一页历史", async () => {
		const { transport, client } = createClient(12, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		transport.emit(CHAT, { type: "chat/notice", level: "info", message: "第一条" }, 1);
		const before = transport.calls.filter((call) => call.method === "entries").length;
		transport.emit(CHAT, { type: "chat/notice", level: "warning", message: "跳号" }, 9);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const after = transport.calls.filter((call) => call.method === "entries").length;
		expect(after).toBeGreaterThan(before);
		expect(client.chatView()?.messages.length).toBe(5);
	});

	it("状态通道缺口重取快照,不动历史", async () => {
		const { transport, client } = createClient(12, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		transport.emit(SESSION, { type: "session/status", status: "running" }, 1);
		const before = transport.calls.filter((call) => call.method === "entries").length;
		const snapshots = transport.calls.filter((call) => call.method === "snapshot").length;
		transport.emit(SESSION, { type: "session/status", status: "idle" }, 6);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(transport.calls.filter((call) => call.method === "entries").length).toBe(before);
		expect(transport.calls.filter((call) => call.method === "snapshot").length).toBeGreaterThan(snapshots);
	});

	it("对话通道缺口只补历史", async () => {
		const { transport, client } = createClient(12, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		transport.emit(CHAT, { type: "chat/notice", level: "info", message: "第一条" }, 1);
		const snapshots = transport.calls.filter((call) => call.method === "snapshot").length;
		transport.emit(CHAT, { type: "chat/turnStarted", text: "x" }, 9);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(transport.calls.filter((call) => call.method === "snapshot").length).toBe(snapshots);
	});

	it("重连续订时带上已收到的最后序号", async () => {
		const { transport, client } = createClient(4, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		transport.emit(SESSION, { type: "session/status", status: "running" }, 2);
		transport.emit(CHAT, { type: "chat/turnStarted", text: "hi" }, 1);
		const before = transport.calls.length;
		await client.resume();
		const subscriptions = transport.calls.slice(before).filter((call) => call.method === "subscribe");
		expect(subscriptions.map((call) => (call.params as { since?: number }).since)).toEqual([2, 1]);
	});

	it("重复 attach 不叠加动作监听", async () => {
		const { transport, client } = createClient(2, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		client.attach(handshake);
		transport.emit(CHAT, { type: "chat/notice", level: "info", message: "只一条" }, 1);
		expect(client.chatView()?.notices).toEqual([{ level: "info", message: "只一条" }]);
	});

	it("发消息派发到对话通道", async () => {
		const { client } = createClient(2, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		expect(client.send("你好")).toBeGreaterThan(0);
		expect(() => {
			client.dispose();
			client.send("再来");
		}).not.toThrow();
	});

	it("分叉后切到新会话", async () => {
		const { transport, client } = createClient(4, { initialPages: 1, pageSize: 5 });
		const before = await client.openSession("/tmp/s1.jsonl");
		const after = await client.fork("e:e3");
		expect(after.sessionId).toBe("s2");
		expect(after.file).toBe("/tmp/s2.jsonl");
		expect(client.current?.sessionId).toBe("s2");
		const forkCall = transport.calls.find((call) => call.method === "forkSession");
		expect(forkCall?.params).toEqual({ sessionFile: "/tmp/s1.jsonl", entryId: "e3" });
		expect(before.sessionId).toBe("s1");
	});

	it("实时消息的分叉请求带上设备分配的标识", async () => {
		const { transport, client } = createClient(4, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		await client.fork("m3");
		const forkCall = transport.calls.find((call) => call.method === "forkSession");
		expect(forkCall?.params).toEqual({ sessionFile: "/tmp/s1.jsonl", messageId: "m3" });
	});

	it("流式增量按消息标识累积到视图", async () => {
		const { transport, client } = createClient(2, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		transport.emit(CHAT, { type: "chat/messageAppended", messageId: "m1", message: assistant("") }, 1);
		transport.emit(CHAT, { type: "chat/delta", messageId: "m1", partIndex: 0, kind: "text", delta: "你" }, 2);
		transport.emit(CHAT, { type: "chat/delta", messageId: "m1", partIndex: 0, kind: "text", delta: "好" }, 3);
		const live = client.chatView()?.messages ?? [];
		const last = live[live.length - 1];
		expect(last?.id).toBe("m1");
		expect(last?.streaming[0]).toBe("你好");
		expect(last?.isStreaming).toBe(true);
	});
});
