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
import { describe, expect, it, vi } from "vitest";
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

/** 带工具调用的助手消息。 */
function assistantCalling(block: Extract<Message, { role: "assistant" }>["content"][number]): Message {
	const base = assistant("") as Extract<Message, { role: "assistant" }>;
	return { ...base, content: [block] };
}

function snapshot(): SessionSnapshot {
	return {
		id: "s1",
		file: "/tmp/s1.jsonl",
		cwd: "/tmp",
		name: "既有会话",
		phase: "idle",
		maintenance: undefined,
		model: undefined,
		thinkingLevel: "medium",
		availableThinkingLevels: ["medium"],
		activeToolNames: [],
		queued: { steering: [], followUp: [] },
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
	/** 下一个该方法名的请求直接失败,用例按需设置 */
	failNext: RequestMethod | undefined;
	/** 这些通道的订阅直接失败,用例按需设置 */
	readonly failSubscribe = new Set<Channel>();

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
		if (this.failNext === method) {
			this.failNext = undefined;
			throw new Error(`${method} 失败`);
		}
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
				case "listProjects":
					return {
						projects: [{ id: "p1", cwd: "/work/a", name: "A", createdAt: 1 }],
					};
				case "addProject": {
					const { cwd, name } = params as { cwd: string; name?: string };
					return { id: "p1", cwd, ...(name === undefined ? {} : { name }), createdAt: 1 };
				}
				case "renameProject": {
					const { id, name } = params as { id: string; name?: string };
					return { id, cwd: "/work/a", ...(name === undefined ? {} : { name }), createdAt: 1 };
				}
				case "removeProject":
					return {};
				case "subscribe": {
					const channel = (params as { channel: Channel }).channel;
					if (this.failSubscribe.has(channel)) {
						throw new Error("subscribe 失败");
					}
					return { seq: 0, resync: false, session: channel.startsWith("session:") ? snapshot() : undefined };
				}
				case "unsubscribe":
					return {};
				case "entriesAfter": {
					const { afterEntryId } = params as { afterEntryId?: string };
					const index =
						afterEntryId === undefined ? -1 : this.entries.findIndex((entry) => entry.id === afterEntryId);
					if (index < 0 && afterEntryId !== undefined) {
						throw new Error(`unknown session entry: ${afterEntryId}`);
					}
					const leaf = this.entries[this.entries.length - 1];
					return { entries: this.entries.slice(index + 1), leafId: leaf?.id ?? null };
				}
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

	/** 已派发的动作,用例按需断言 */
	readonly dispatched: { channel: Channel; action: Action }[] = [];

	dispatch(channel: Channel, action: Action): number {
		this.seq += 1;
		this.dispatched.push({ channel, action });
		return this.seq;
	}

	onAction(listener: (frame: ActionFrame) => void): () => void {
		this.listener = listener;
		return () => {
			this.listener = undefined;
		};
	}

	/** 推一条带拒绝原因的动作帧,序号取通道当前值,与设备侧一致。 */
	reject(channel: Channel, clientSeq: number, action: Action, reason: string): void {
		this.listener?.({
			type: "action",
			channel,
			action,
			serverSeq: this.lastSeq.get(channel) ?? 0,
			origin: { clientId: "c", clientSeq },
			rejectionReason: reason,
		});
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

	it("中止请求走对话通道,阶段由设备回报", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		client.cancel();
		expect(transport.dispatched).toEqual([{ channel: CHAT, action: { type: "chat/turnCancelled" } }]);
		transport.emit(SESSION, { type: "session/phase", phase: "stopping", maintenance: undefined });
		expect(client.sessionView()?.state.phase).toBe("stopping");
		transport.emit(SESSION, { type: "session/phase", phase: "idle", maintenance: undefined });
		expect(client.sessionView()?.state.phase).toBe("idle");
	});

	it("用户消息进入对话后才确认发送", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		const sent: string[] = [];
		client.onSent((text) => sent.push(text));
		client.send("你好");
		// 设备先回别的动作,不算确认
		transport.emit(CHAT, { type: "chat/notice", level: "info", message: "开始" });
		expect(sent).toEqual([]);
		transport.emit(CHAT, { type: "chat/messageAppended", messageId: "m1", message: assistant("答复") });
		expect(sent).toEqual([]);
		transport.emit(CHAT, {
			type: "chat/messageAppended",
			messageId: "m2",
			message: { role: "user", content: [{ type: "text", text: "你好" }], timestamp: 1 },
		});
		expect(sent).toEqual(["你好"]);
	});

	it("发送被拒时给出提示且不确认", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		const sent: string[] = [];
		client.onSent((text) => sent.push(text));
		const clientSeq = client.send("你好");
		transport.reject(CHAT, clientSeq, { type: "chat/turnStarted", text: "你好" }, "session is running");
		expect(sent).toEqual([]);
		expect(client.chatView()?.notices).toEqual([{ level: "error", message: "发送失败:session is running" }]);
		// 之后同类消息也不会再触发确认
		transport.emit(CHAT, {
			type: "chat/messageAppended",
			messageId: "m3",
			message: { role: "user", content: [{ type: "text", text: "你好" }], timestamp: 1 },
		});
		expect(sent).toEqual([]);
	});

	it("运行中的输入走排队,队列里出现这段文字才算收到", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		const sent: string[] = [];
		client.onSent((text) => sent.push(text));
		client.enqueue("补充一句");
		expect(transport.dispatched).toEqual([
			{
				channel: SESSION,
				action: { type: "session/pendingMessageSet", kind: "steering", text: "补充一句" },
			},
		]);
		expect(sent).toEqual([]);
		transport.emit(SESSION, { type: "session/queueChanged", steering: ["别的"], followUp: [] });
		expect(sent).toEqual([]);
		transport.emit(SESSION, { type: "session/queueChanged", steering: ["补充一句"], followUp: [] });
		expect(sent).toEqual(["补充一句"]);
		expect(client.sessionView()?.state.queued.steering).toEqual(["补充一句"]);
	});

	it("清空排队走会话通道", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		client.clearQueue();
		expect(transport.dispatched).toEqual([{ channel: SESSION, action: { type: "session/queueCleared" } }]);
	});

	it("排队被拒时给出提示且不确认", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		const sent: string[] = [];
		client.onSent((text) => sent.push(text));
		const clientSeq = client.enqueue("补充一句");
		transport.reject(
			SESSION,
			clientSeq,
			{ type: "session/pendingMessageSet", kind: "steering", text: "补充一句" },
			"Cannot submit a prompt while compaction is in progress",
		);
		expect(sent).toEqual([]);
		expect(client.chatView()?.notices).toEqual([
			{
				level: "error",
				message: "发送失败:Cannot submit a prompt while compaction is in progress",
			},
		]);
	});

	it("会话通道的动作被拒也提示在对话视图上", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		transport.reject(SESSION, 1, { type: "session/configChanged" }, "unknown model: nope/nope");
		expect(client.chatView()?.notices).toEqual([
			{ level: "error", message: "操作被拒绝:unknown model: nope/nope" },
		]);
	});

	it("快速切换时只采用最后一次选择", async () => {
		const { client } = createClient(2);
		await client.openSession("/tmp/a.jsonl");
		const [, last] = await Promise.all([
			client.switchSession("/tmp/b.jsonl"),
			client.switchSession("/tmp/c.jsonl"),
		]);
		expect(last.file).toBe("/tmp/c.jsonl");
		expect(client.current?.file).toBe("/tmp/c.jsonl");
		expect(client.current?.sessionId).toBe("c");
	});

	it("切换失败时退掉半个订阅,原来的会话仍然可用,可以重试", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/a.jsonl");
		// 新会话的会话通道订上,对话通道失败
		transport.failSubscribe.add("chat:/b");
		await expect(client.switchSession("/tmp/b.jsonl")).rejects.toThrow("subscribe 失败");
		expect(
			transport.calls
				.filter((call) => call.method === "unsubscribe")
				.map((call) => (call.params as { channel: Channel }).channel)
				.filter((channel) => channel.endsWith(":/b")),
		).toEqual(["session:/b"]);
		expect(client.current?.file).toBe("/tmp/a.jsonl");
		expect(client.sessionView()?.channel).toBe("session:/a");

		transport.failSubscribe.clear();
		const opened = await client.switchSession("/tmp/b.jsonl");
		expect(opened.file).toBe("/tmp/b.jsonl");
		expect(client.sessionView()?.channel).toBe("session:/b");
	});

	it("项目请求带上参数", async () => {
		const { transport, client } = createClient(0);
		expect(await client.listProjects()).toEqual([{ id: "p1", cwd: "/work/a", name: "A", createdAt: 1 }]);
		expect(await client.addProject({ cwd: "/work/b", name: "B" })).toEqual({
			id: "p1",
			cwd: "/work/b",
			name: "B",
			createdAt: 1,
		});
		expect(await client.renameProject("p1")).toEqual({ id: "p1", cwd: "/work/a", createdAt: 1 });
		await client.removeProject("p1");
		const calls = transport.calls
			.filter((call) => call.method.endsWith("Project") || call.method === "listProjects")
			.map((call) => [call.method, call.params]);
		expect(calls).toEqual([
			["listProjects", {}],
			["addProject", { cwd: "/work/b", name: "B" }],
			["renameProject", { id: "p1" }],
			["removeProject", { id: "p1" }],
		]);
	});

	it("首次装载按页取最近历史且顺序为时间升序", async () => {
		const { client } = createClient(12, { initialPages: 2, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		const messages = client.chatView()?.items ?? [];
		expect(messages).toHaveLength(10);
		expect(messages[0]?.message && "content" in (messages[0].message ?? {})).toBe(true);
		expect(JSON.stringify(messages[0]?.id)).toBe('"e:e3"');
		expect(JSON.stringify(messages[messages.length - 1]?.id)).toBe('"e:e12"');
		expect(client.hasMore).toBe(true);
	});

	it("缺省装载全部历史", async () => {
		const { client } = createClient(12, { pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		const messages = client.chatView()?.items ?? [];
		expect(messages).toHaveLength(12);
		expect(messages[0]?.id).toBe("e:e1");
		expect(client.hasMore).toBe(false);
	});

	it("继续往更早翻页时补在前面且不重复", async () => {
		const { client } = createClient(12, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		expect(client.chatView()?.items).toHaveLength(5);
		const result = await client.loadOlder();
		expect(result.loaded).toBe(5);
		expect(client.chatView()?.items).toHaveLength(10);
		const ids = (client.chatView()?.items ?? []).map((message) => message.id);
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

	it("序号缺口时重新装载历史", async () => {
		const { transport, client } = createClient(12, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		transport.emit(CHAT, { type: "chat/notice", level: "info", message: "第一条" }, 1);
		const before = transport.calls.filter((call) => call.method === "entries").length;
		transport.emit(CHAT, { type: "chat/notice", level: "warning", message: "跳号" }, 9);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const after = transport.calls.filter((call) => call.method === "entries").length;
		expect(after).toBeGreaterThan(before);
		expect(client.chatView()?.items.length).toBe(12);
	});

	it("settled 之后把实时消息提升为历史消息并记下边界", async () => {
		const { transport, client } = createClient(2, { pageSize: 10 });
		await client.openSession("/tmp/s1.jsonl");
		const opened = client.current as { chatChannel: Channel; sessionId: string };
		transport.entries.push(
			{
				id: "e3",
				parentId: "e2",
				kind: "message",
				timestamp: "2026-11-08T00:00:03Z",
				message: assistant("问题"),
			},
			{
				id: "e4",
				parentId: "e3",
				kind: "message",
				timestamp: "2026-11-08T00:00:04Z",
				message: assistant("答复"),
			},
		);
		transport.emit(opened.chatChannel, {
			type: "chat/messageAppended",
			messageId: "m1",
			message: assistant("问题"),
		});
		transport.emit(opened.chatChannel, {
			type: "chat/messageAppended",
			messageId: "m2",
			message: assistant("答复"),
		});
		transport.emit(opened.chatChannel, { type: "chat/settled", aborted: false });

		await vi.waitFor(() => {
			const messages = client.chatView()?.items ?? [];
			expect(messages.map((item) => item.id)).toEqual(["e:e1", "e:e2", "e:e3", "e:e4"]);
		});
		const messages = client.chatView()?.items ?? [];
		expect(messages.map((item) => item.entry?.id)).toEqual(["e1", "e2", "e3", "e4"]);
		expect(client.chatView()?.renames).toEqual({ m1: "e:e3", m2: "e:e4" });
		expect(transport.calls.filter((call) => call.method === "entriesAfter")).toEqual([
			{ method: "entriesAfter", params: { sessionId: opened.sessionId, afterEntryId: "e2" } },
		]);
	});

	it("工具结果与流式增量都在本轮内一并提升", async () => {
		const { transport, client } = createClient(2, { pageSize: 10 });
		await client.openSession("/tmp/s1.jsonl");
		const opened = client.current as { chatChannel: Channel };
		const call = {
			type: "toolCall" as const,
			id: "c1",
			name: "bash",
			arguments: { command: "ls" },
		};
		const live: { messageId: string; message: Message }[] = [
			{
				messageId: "m1",
				message: { role: "user", content: [{ type: "text", text: "列一下" }], timestamp: 10 },
			},
			{ messageId: "m2", message: assistantCalling(call) },
			{
				messageId: "m3",
				message: {
					role: "toolResult",
					callId: "c1",
					toolName: "bash",
					content: [{ type: "text", text: "a.ts" }],
					isError: false,
					timestamp: 12,
				},
			},
			{ messageId: "m4", message: assistant("一共一个文件") },
		];
		transport.entries.push(
			...live.map((item, index) => ({
				id: `e${index + 3}`,
				parentId: index === 0 ? "e2" : `e${index + 2}`,
				kind: "message" as const,
				timestamp: "2026-11-08T00:00:00Z",
				message: item.message,
			})),
		);
		for (const [index, item] of live.entries()) {
			transport.emit(
				opened.chatChannel,
				{ type: "chat/messageAppended", messageId: item.messageId, message: item.message },
				index + 1,
			);
		}
		transport.emit(opened.chatChannel, { type: "chat/settled", aborted: false });

		await vi.waitFor(() => {
			expect(client.chatView()?.items.map((item) => item.id)).toEqual([
				"e:e1",
				"e:e2",
				"e:e3",
				"e:e4",
				"e:e5",
				"e:e6",
			]);
		});
		expect(client.chatView()?.items.map((item) => item.entry?.id)).toEqual([
			"e1",
			"e2",
			"e3",
			"e4",
			"e5",
			"e6",
		]);
	});

	it("第二轮只提升新增的一段，边界随叶子推进", async () => {
		const { transport, client } = createClient(2, { pageSize: 10 });
		await client.openSession("/tmp/s1.jsonl");
		const opened = client.current as { chatChannel: Channel; sessionId: string };

		const turn = (startId: number, messageIds: [string, string]): void => {
			transport.entries.push(
				...messageIds.map((_, index) => ({
					id: `e${startId + index}`,
					parentId: index === 0 ? `e${startId - 1}` : `e${startId + index - 1}`,
					kind: "message" as const,
					timestamp: "2026-11-08T00:00:00Z",
					message: assistant(`第 ${startId + index} 条`),
				})),
			);
			for (const [index, messageId] of messageIds.entries()) {
				transport.emit(opened.chatChannel, {
					type: "chat/messageAppended",
					messageId,
					message: assistant(`第 ${startId + index} 条`),
				});
			}
		};

		turn(3, ["m1", "m2"]);
		transport.emit(opened.chatChannel, { type: "chat/settled", aborted: false });
		await vi.waitFor(() => {
			expect(client.chatView()?.items.map((item) => item.id)).toEqual(["e:e1", "e:e2", "e:e3", "e:e4"]);
		});

		turn(5, ["m3", "m4"]);
		transport.emit(opened.chatChannel, { type: "chat/settled", aborted: false });
		await vi.waitFor(() => {
			expect(client.chatView()?.items.map((item) => item.id)).toEqual([
				"e:e1",
				"e:e2",
				"e:e3",
				"e:e4",
				"e:e5",
				"e:e6",
			]);
		});
		const requests = transport.calls.filter((call) => call.method === "entriesAfter");
		expect(requests.map((call) => (call.params as { afterEntryId?: string }).afterEntryId)).toEqual([
			"e2",
			"e4",
		]);
		expect(client.chatView()?.renames).toEqual({
			m1: "e:e3",
			m2: "e:e4",
			m3: "e:e5",
			m4: "e:e6",
		});
	});

	it("提升时条目数与实时消息不符则重新装载历史", async () => {
		const { transport, client } = createClient(2, { pageSize: 10 });
		await client.openSession("/tmp/s1.jsonl");
		const opened = client.current as { chatChannel: Channel };
		transport.entries.push({
			id: "e3",
			parentId: "e2",
			kind: "message",
			timestamp: "2026-11-08T00:00:03Z",
			message: assistant("问题"),
		});
		transport.emit(opened.chatChannel, {
			type: "chat/messageAppended",
			messageId: "m1",
			message: assistant("问题"),
		});
		transport.emit(opened.chatChannel, {
			type: "chat/messageAppended",
			messageId: "m2",
			message: assistant("多出来的一条"),
		});
		const before = transport.calls.filter((call) => call.method === "entries").length;
		transport.emit(opened.chatChannel, { type: "chat/settled", aborted: false });

		await vi.waitFor(() => {
			expect(transport.calls.filter((call) => call.method === "entries").length).toBeGreaterThan(before);
		});
	});

	it("状态通道缺口重取快照,不动历史", async () => {
		const { transport, client } = createClient(12, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		transport.emit(SESSION, { type: "session/phase", phase: "running", maintenance: undefined }, 1);
		const before = transport.calls.filter((call) => call.method === "entries").length;
		const snapshots = transport.calls.filter((call) => call.method === "snapshot").length;
		transport.emit(SESSION, { type: "session/phase", phase: "idle", maintenance: undefined }, 6);
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
		transport.emit(SESSION, { type: "session/phase", phase: "running", maintenance: undefined }, 2);
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

	it("分叉后切到新会话，请求带上下一轮的起始条目", async () => {
		const { transport, client } = createClient(4, { initialPages: 1, pageSize: 5 });
		const before = await client.openSession("/tmp/s1.jsonl");
		const after = await client.fork("e7");
		expect(after.sessionId).toBe("s2");
		expect(after.file).toBe("/tmp/s2.jsonl");
		expect(client.current?.sessionId).toBe("s2");
		const forkCall = transport.calls.find((call) => call.method === "forkSession");
		expect(forkCall?.params).toEqual({ sessionFile: "/tmp/s1.jsonl", beforeEntryId: "e7" });
		expect(before.sessionId).toBe("s1");
	});

	it("最后一轮的分叉只带会话文件", async () => {
		const { transport, client } = createClient(4, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		await client.fork();
		const forkCall = transport.calls.find((call) => call.method === "forkSession");
		expect(forkCall?.params).toEqual({ sessionFile: "/tmp/s1.jsonl" });
	});

	it("流式增量按消息标识累积到视图", async () => {
		const { transport, client } = createClient(2, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		transport.emit(CHAT, { type: "chat/messageAppended", messageId: "m1", message: assistant("") }, 1);
		transport.emit(CHAT, { type: "chat/delta", messageId: "m1", partIndex: 0, kind: "text", delta: "你" }, 2);
		transport.emit(CHAT, { type: "chat/delta", messageId: "m1", partIndex: 0, kind: "text", delta: "好" }, 3);
		const live = client.chatView()?.items ?? [];
		const last = live[live.length - 1];
		expect(last?.id).toBe("m1");
		expect(last?.streaming[0]?.text).toBe("你好");
		expect(last?.isStreaming).toBe(true);
	});
});
