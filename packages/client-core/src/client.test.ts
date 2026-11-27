import type {
	Action,
	ActionFrame,
	Channel,
	Entry,
	Message,
	RequestMethod,
	RequestParams,
	RequestResults,
} from "@facet/protocol";
import { workspaceChannelFor } from "@facet/protocol";
import { describe, expect, it, vi } from "vitest";
import { type HostHandshake, SessionClient, type SessionTransport } from "./client.ts";
import { sessionSnapshot } from "./session-fixture.test-support.ts";
import { toTranscript } from "./transcript.ts";

const CHAT = "chat:/s1" as const;
const SESSION = "session:/s1" as const;

function assistant(text: string): Extract<Message, { role: "assistant" }> {
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

/** 用户消息。 */
function user(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1 };
}

/** 带工具调用的助手消息。 */
function assistantCalling(block: Extract<Message, { role: "assistant" }>["content"][number]): Message {
	const base = assistant("") as Extract<Message, { role: "assistant" }>;
	return { ...base, content: [block] };
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
	/** 为真时订阅按主机不认识这个会话报错,模拟主机重启过 */
	unknownSession = false;
	entriesAfterGate: Promise<void> | undefined;
	respondUiGate: Promise<void> | undefined;
	snapshotGate: Promise<void> | undefined;
	uiAccepted = true;

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
					return { ...sessionSnapshot(), id, file };
				}
				case "forkSession":
					return { ...sessionSnapshot(), id: "s2", file: "/tmp/s2.jsonl" };
				case "respondUi":
					return { accepted: this.uiAccepted };
				case "snapshot":
					return sessionSnapshot();
				case "availableModels":
					return {
						models: [
							{
								provider: "deepseek",
								id: "deepseek-v4-flash",
								name: "DeepSeek V4 Flash",
								reasoning: true,
								input: ["text"],
								contextWindow: 1_048_576,
								maxTokens: 384_000,
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
								thinkingLevels: ["off", "medium"],
							},
						],
					};
				case "listCommands":
					return {
						commands: [
							{ name: "compact", description: "压缩", source: "builtin" as const, handler: "facet" as const },
						],
					};
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
					// 只对会话通道生效：模型通道与清单通道跟主机重启没有关系
					if (this.unknownSession && channel.startsWith("session:")) {
						// 主机刚重启时不认识旧会话,重新打开之后就记得了
						this.unknownSession = false;
						throw Object.assign(new Error("会话不存在:s1"), { code: "unknown_session" });
					}
					return {
						seq: 0,
						resync: false,
						session: channel.startsWith("session:") ? sessionSnapshot() : undefined,
					};
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
		if (method === "entriesAfter") {
			await this.entriesAfterGate;
		}
		if (method === "respondUi") await this.respondUiGate;
		if (method === "snapshot") await this.snapshotGate;
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

	/** 推一条带拒绝原因的动作帧,序号取通道当前值,与主机侧一致。 */
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

	handled(clientSeq: number, clientId = "c"): void {
		this.listener?.({
			type: "action",
			channel: CHAT,
			action: { type: "chat/inputHandled" },
			serverSeq: this.lastSeq.get(CHAT) ?? 0,
			origin: { clientId, clientSeq },
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

const handshake: HostHandshake = {
	protocolVersion: 1,
	hostId: "h",
	hostName: "主机",
	clientId: "c",
	role: "admin",
	canManage: true,
	capabilities: ["dispatch"],
};

function createClient(
	entryCount: number,
	options: { initialPages?: number; pageSize?: number; sessionRetentionMs?: number } = {},
) {
	const transport = new FakeTransport(entryCount);
	const client = new SessionClient({ transport, ...options });
	client.attach(handshake);
	return { transport, client };
}

function transcriptOf(client: SessionClient) {
	const view = client.chatView();
	if (view === undefined) {
		throw new Error("会话尚未打开");
	}
	return toTranscript(view);
}

describe("SessionClient", () => {
	it("打开会话时订阅两条通道", async () => {
		const { transport, client } = createClient(10, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		const subscriptions = transport.calls
			.filter((call) => call.method === "subscribe")
			.map((call) => (call.params as { channel: Channel }).channel)
			// 清单通道与模型通道在 attach 时就订上了，与打开会话无关
			.filter((channel) => !channel.startsWith("sessions:") && !channel.startsWith("models:"));
		expect(subscriptions).toEqual([SESSION, CHAT]);
		expect(client.current?.sessionId).toBe("s1");
	});

	it("手动压缩走会话通道", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		client.compact();
		expect(transport.dispatched).toEqual([{ channel: SESSION, action: { type: "session/compact" } }]);
	});

	it("中止请求走对话通道,阶段由主机回报", async () => {
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
		// 主机先回别的动作,不算确认
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
		expect(client.chatView()?.notices).toEqual([
			{ level: "error", message: "Send failed:session is running" },
		]);
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

	it("运行中发出去的消息被主机排进队列时，按文字认出来并收起", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		const sent: string[] = [];
		client.onSent((text) => sent.push(text));
		// 界面上发出去的就是一条普通发送，主机在运行中把它排进了队列
		client.send("运行中补充", { streamingBehavior: "steer" });
		expect(sent).toEqual([]);
		transport.emit(SESSION, { type: "session/queueChanged", steering: ["运行中补充"], followUp: [] });
		expect(sent).toEqual(["运行中补充"]);
	});

	it("连续发两条时按 clientSeq 逐条核销，不互相覆盖", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		const sent: string[] = [];
		client.onSent((text) => sent.push(text));
		const first = client.send("第一条");
		const second = client.send("第二条");
		expect([first, second]).toEqual([1, 2]);

		transport.handled(first);
		expect(sent).toEqual(["第一条"]);
		// 第二条还挂着，重复的旧回执不再触发通知
		transport.handled(first);
		expect(sent).toEqual(["第一条"]);

		transport.handled(second);
		expect(sent).toEqual(["第一条", "第二条"]);
	});

	it("发送之后切走会话，确认仍然记回原来那个会话", async () => {
		const { transport, client } = createClient(2);
		// 用 s1：假传输的 handled() 固定在 chat:/s1 上推送
		await client.openSession("/tmp/s1.jsonl");
		const sent: string[] = [];
		client.onSent((text) => sent.push(text));
		const clientSeq = client.send("发给 a 的");
		await client.switchSession("/tmp/b.jsonl");
		expect(client.chatView()?.channel).toBe("chat:/b");

		transport.handled(clientSeq);
		expect(sent).toEqual(["发给 a 的"]);
	});

	it("重连后悬挂的发送作废，不会一直等下去", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		const sent: string[] = [];
		client.onSent((text) => sent.push(text));
		const clientSeq = client.send("断线前发的");
		await client.resume();
		// 旧连接的回执迟到也不再生效
		transport.handled(clientSeq);
		expect(sent).toEqual([]);
	});

	it("待确认的发送记进会话状态，回执到达后解除", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		expect(client.sessionView()?.state.hasPendingSend).toBe(false);
		expect(client.hasPendingSend()).toBe(false);

		const clientSeq = client.send("还在路上");
		// 同步读得出、视图里也立刻记下：界面靠这两处分别拦同一帧的连点与重绘后的点击
		expect(client.hasPendingSend()).toBe(true);
		expect(client.sessionView()?.state.hasPendingSend).toBe(true);

		transport.handled(clientSeq);
		expect(client.hasPendingSend()).toBe(false);
		expect(client.sessionView()?.state.hasPendingSend).toBe(false);
	});

	it("只进队列的那条不算在途，不会把发送入口锁住", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		client.enqueue("排队的一句");
		expect(client.hasPendingSend()).toBe(false);
		transport.emit(SESSION, { type: "session/queueChanged", steering: ["排队的一句"], followUp: [] });
		expect(client.sessionView()?.state.hasPendingSend).toBe(false);
	});

	it("发送被拒之后解锁，用户可以改完再发", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		const clientSeq = client.send("会被拒的");
		expect(client.hasPendingSend()).toBe(true);
		transport.reject(CHAT, clientSeq, { type: "chat/turnStarted", text: "会被拒的" }, "session is running");
		expect(client.hasPendingSend()).toBe(false);
		expect(client.sessionView()?.state.hasPendingSend).toBe(false);
		// 下一条还能发：闸门不该卡在失败的这一条上
		expect(client.send("改完之后再发")).toBe(clientSeq + 1);
		expect(client.hasPendingSend()).toBe(true);
	});

	it("重连之后不再等在途状态上", async () => {
		const { client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		client.send("断线前发的");
		expect(client.hasPendingSend()).toBe(true);
		await client.resume();
		// 新连接带着新的 clientId，旧回执不会再回来，悬挂的发送作废
		expect(client.hasPendingSend()).toBe(false);
		expect(client.sessionView()?.state.hasPendingSend).toBe(false);
	});

	it("在途状态按会话隔离：切走之后另一个会话照常发", async () => {
		const { client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		client.send("发给 a 的");
		expect(client.hasPendingSend("/tmp/s1.jsonl")).toBe(true);
		expect(client.hasPendingSend()).toBe(true);

		await client.switchSession("/tmp/b.jsonl");
		// 当前激活的是 b：它没有在途发送，a 那条仍然记着
		expect(client.hasPendingSend()).toBe(false);
		expect(client.hasPendingSend("/tmp/s1.jsonl")).toBe(true);
		expect(client.sessionView()?.state.hasPendingSend).toBe(false);

		// 切回 a 时锁还在，等它的回执
		await client.switchSession("/tmp/s1.jsonl");
		expect(client.hasPendingSend()).toBe(true);
	});

	it("重取快照不会抹掉在途状态", async () => {
		const { client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		client.send("等回执的一条");
		await client.refreshSession();
		// 快照只描述主机那边，本端的在途记账要留着，否则等回执期间界面又解锁
		expect(client.sessionView()?.state.hasPendingSend).toBe(true);
		expect(client.hasPendingSend()).toBe(true);
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
				message: "Send failed:Cannot submit a prompt while compaction is in progress",
			},
		]);
	});

	it("会话通道的动作被拒也提示在对话视图上", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		transport.reject(SESSION, 1, { type: "session/configChanged" }, "unknown model: nope/nope");
		expect(client.chatView()?.notices).toEqual([
			{ level: "error", message: "Action rejected:unknown model: nope/nope" },
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

	it("命令清单每个会话只取一次", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/a.jsonl");
		const first = await client.listCommands();
		expect(await client.listCommands()).toEqual(first);
		expect(transport.calls.filter((call) => call.method === "listCommands")).toHaveLength(1);
		await client.switchSession("/tmp/b.jsonl");
		await client.listCommands();
		expect(transport.calls.filter((call) => call.method === "listCommands")).toHaveLength(2);
		await client.switchSession("/tmp/a.jsonl");
		expect(await client.listCommands()).toEqual(first);
		expect(transport.calls.filter((call) => call.method === "listCommands")).toHaveLength(2);
	});

	it("扩展重新初始化后重取命令清单", async () => {
		const { transport, client } = createClient(2);
		const opened = await client.openSession("/tmp/a.jsonl");
		await client.listCommands();
		transport.emit(opened.sessionChannel, {
			type: "session/initialized",
			initialization: { kind: "ready" },
		});
		await client.listCommands();
		expect(transport.calls.filter((call) => call.method === "listCommands")).toHaveLength(2);
	});

	it("切回已缓存的会话不再重新打开", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/a.jsonl");
		await client.switchSession("/tmp/b.jsonl");
		const before = transport.calls.length;
		const opened = await client.switchSession("/tmp/a.jsonl");
		expect(opened.file).toBe("/tmp/a.jsonl");
		expect(transport.calls.slice(before).filter((call) => call.method === "openSession")).toHaveLength(0);
		expect(transport.calls.slice(before).filter((call) => call.method === "entries")).toHaveLength(0);
		expect(client.chatView()?.channel).toBe("chat:/a");
	});

	it("未激活的会话仍然接收动作", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/a.jsonl");
		await client.switchSession("/tmp/b.jsonl");
		transport.emit("chat:/a", { type: "chat/notice", level: "info", message: "后台消息" }, 1);
		expect(client.store.chatView("chat:/a")?.notices).toEqual([{ level: "info", message: "后台消息" }]);
	});

	it("关闭标签后保留缓存，超时才释放", async () => {
		vi.useFakeTimers();
		try {
			const { client } = createClient(2, { sessionRetentionMs: 1000 });
			await client.openSession("/tmp/a.jsonl");
			await client.switchSession("/tmp/b.jsonl");
			client.closeSession("/tmp/a.jsonl");
			expect(client.hasSession("/tmp/a.jsonl")).toBe(true);
			await vi.advanceTimersByTimeAsync(1000);
			expect(client.hasSession("/tmp/a.jsonl")).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("关闭标签后重新切回会取消释放", async () => {
		vi.useFakeTimers();
		try {
			const { client } = createClient(2, { sessionRetentionMs: 1000 });
			await client.openSession("/tmp/a.jsonl");
			await client.switchSession("/tmp/b.jsonl");
			client.closeSession("/tmp/a.jsonl");
			await client.switchSession("/tmp/a.jsonl");
			await vi.advanceTimersByTimeAsync(1000);
			expect(client.hasSession("/tmp/a.jsonl")).toBe(true);
		} finally {
			vi.useRealTimers();
		}
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

	it("删除当前会话后队列继续执行", async () => {
		const { client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		const timeout = new Promise<never>((_resolve, reject) => {
			setTimeout(() => reject(new Error("delete deadlocked")), 100);
		});
		await expect(Promise.race([client.deleteSession("/tmp/s1.jsonl"), timeout])).resolves.toBeUndefined();
		expect(client.current).toBeUndefined();
		const reopened = await client.openSession("/tmp/s1.jsonl");
		expect(reopened.file).toBe("/tmp/s1.jsonl");
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

	it("缺省装载最近两页", async () => {
		const { client } = createClient(12, { pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		const messages = client.chatView()?.items ?? [];
		expect(messages).toHaveLength(10);
		expect(messages[0]?.id).toBe("e:e3");
		expect(client.hasMore).toBe(true);
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

	it("同时发起多次向前翻页只请求一页", async () => {
		const { transport, client } = createClient(25, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		const before = transport.calls.filter((call) => call.method === "entries").length;
		const first = client.loadOlder();
		const second = client.loadOlder();
		await Promise.all([first, second]);
		expect(transport.calls.filter((call) => call.method === "entries")).toHaveLength(before + 1);
		expect(client.chatView()?.items).toHaveLength(10);
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
		expect(client.chatView()?.items.length).toBe(5);
		expect(client.hasMore).toBe(true);
	});

	it("重载失败时保留旧视图和游标", async () => {
		const { transport, client } = createClient(25, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		const before = (client.chatView()?.items ?? []).map((item) => item.id);
		expect(before).toHaveLength(5);
		transport.failNext = "entries";
		transport.emit(CHAT, { type: "chat/notice", level: "info", message: "第一条" }, 1);
		transport.emit(CHAT, { type: "chat/notice", level: "warning", message: "跳号" }, 9);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect((client.chatView()?.items ?? []).map((item) => item.id)).toEqual(before);
		expect(client.hasMore).toBe(true);
		const page = await client.loadOlder();
		expect(page.loaded).toBe(5);
	});

	it("settled 之后把实时消息提升为历史消息并记下边界", async () => {
		const { transport, client } = createClient(2, { pageSize: 10 });
		await client.openSession("/tmp/s1.jsonl");
		const opened = client.current as { chatChannel: Channel; sessionId: string };
		const e3: Entry = {
			id: "e3",
			parentId: "e2",
			kind: "message",
			timestamp: "2026-11-08T00:00:03Z",
			message: assistant("问题"),
		};
		const e4: Entry = {
			id: "e4",
			parentId: "e3",
			kind: "message",
			timestamp: "2026-11-08T00:00:04Z",
			message: assistant("答复"),
		};
		transport.entries.push(e3, e4);
		transport.emit(opened.chatChannel, {
			type: "chat/messageAppended",
			messageId: "m1",
			message: assistant("问题"),
		});
		transport.emit(opened.chatChannel, { type: "chat/entryCommitted", messageId: "m1", entry: e3 });
		transport.emit(opened.chatChannel, {
			type: "chat/messageAppended",
			messageId: "m2",
			message: assistant("答复"),
		});
		transport.emit(opened.chatChannel, { type: "chat/entryCommitted", messageId: "m2", entry: e4 });
		transport.emit(opened.chatChannel, { type: "chat/settled", aborted: false });

		const messages = client.chatView()?.items ?? [];
		expect(messages.map((item) => item.id)).toEqual(["e:e1", "e:e2", "m1", "m2"]);
		expect(messages.map((item) => item.entry?.id)).toEqual(["e1", "e2", "e3", "e4"]);
		expect(transport.calls.filter((call) => call.method === "entriesAfter")).toHaveLength(0);
	});

	it("中止时清除残留流式标记且不发起提升请求", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		transport.emit(CHAT, {
			type: "chat/messageAppended",
			messageId: "m1",
			message: { ...assistant(""), stopReason: "pending" },
		});
		expect(client.chatView()?.items.at(-1)?.isStreaming).toBe(true);
		transport.emit(CHAT, { type: "chat/settled", aborted: true });
		expect(client.chatView()?.items.at(-1)?.isStreaming).toBe(false);
		expect(transport.calls.filter((call) => call.method === "entriesAfter")).toHaveLength(0);
	});

	it("自动压缩提交条目与后续流式输出各自保留且互不冲突", async () => {
		const { transport, client } = createClient(2);
		await client.openSession("/tmp/s1.jsonl");
		const e3: Entry = {
			id: "e3",
			parentId: "e2",
			kind: "message",
			timestamp: "2026-11-08T00:00:02Z",
			message: assistant("工具处理结束"),
		};
		const c1: Entry = {
			id: "c1",
			parentId: "e3",
			kind: "compaction",
			timestamp: "2026-11-08T00:00:03Z",
			summary: "中途摘要",
		};
		const e4: Entry = {
			id: "e4",
			parentId: "c1",
			kind: "message",
			timestamp: "2026-11-08T00:00:04Z",
			message: assistant("继续生成完成"),
		};
		transport.emit(CHAT, {
			type: "chat/messageAppended",
			messageId: "m1",
			message: assistant("工具处理结束"),
		});
		transport.emit(CHAT, { type: "chat/entryCommitted", messageId: "m1", entry: e3 });
		transport.emit(CHAT, { type: "chat/entryCommitted", entry: c1 });
		transport.emit(CHAT, {
			type: "chat/messageAppended",
			messageId: "m2",
			message: { ...assistant(""), stopReason: "pending" },
		});
		transport.emit(CHAT, {
			type: "chat/delta",
			messageId: "m2",
			partIndex: 0,
			kind: "text",
			delta: "继续生成",
		});
		expect(client.chatView()?.items.map((item) => item.id)).toEqual(["e:e1", "e:e2", "m1", "e:c1", "m2"]);
		expect(client.chatView()?.items.at(-1)).toMatchObject({
			isStreaming: true,
			streaming: { 0: { text: "继续生成" } },
		});
		transport.emit(CHAT, {
			type: "chat/messageUpdated",
			messageId: "m2",
			message: assistant("继续生成完成"),
		});
		transport.emit(CHAT, { type: "chat/entryCommitted", messageId: "m2", entry: e4 });
		transport.emit(CHAT, { type: "chat/settled", aborted: false });
		expect(client.chatView()?.items.at(-1)).toMatchObject({ id: "m2", entry: e4, isStreaming: false });
		expect(transcriptOf(client).filter((item) => item.kind === "compaction")).toHaveLength(1);
		expect(transport.calls.filter((call) => call.method === "entriesAfter")).toHaveLength(0);
	});

	it("工具结果与流式消息随 chat/entryCommitted 原地补齐 entry", async () => {
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
		const entries = live.map((item, index) => ({
			id: `e${index + 3}`,
			parentId: index === 0 ? "e2" : `e${index + 2}`,
			kind: "message" as const,
			timestamp: "2026-11-08T00:00:00Z",
			message: item.message,
		}));
		for (const [index, item] of live.entries()) {
			transport.emit(
				opened.chatChannel,
				{ type: "chat/messageAppended", messageId: item.messageId, message: item.message },
				index * 2 + 1,
			);
			const committed = entries[index];
			if (committed !== undefined) {
				transport.emit(
					opened.chatChannel,
					{ type: "chat/entryCommitted", messageId: item.messageId, entry: committed },
					index * 2 + 2,
				);
			}
		}
		transport.emit(opened.chatChannel, { type: "chat/settled", aborted: false }, live.length * 2 + 1);

		expect(client.chatView()?.items.map((item) => item.id)).toEqual(["e:e1", "e:e2", "m1", "m2", "m3", "m4"]);
		expect(client.chatView()?.items.map((item) => item.entry?.id)).toEqual([
			"e1",
			"e2",
			"e3",
			"e4",
			"e5",
			"e6",
		]);
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
		const subscriptions = transport.calls
			.slice(before)
			.filter((call) => call.method === "subscribe")
			.map((call) => call.params as { channel: Channel; since?: number })
			.filter((call) => !call.channel.startsWith("sessions:") && !call.channel.startsWith("models:"));
		expect(subscriptions.map((call) => call.since)).toEqual([2, 1]);
	});

	it("同时到达的两次续订只跑一遍", async () => {
		const { transport, client } = createClient(4, { initialPages: 1, pageSize: 5 });
		await client.openSession("/tmp/s1.jsonl");
		const before = transport.calls.length;
		await Promise.all([client.resume(), client.resume()]);
		const subscribes = transport.calls
			.slice(before)
			.filter((call) => call.method === "subscribe")
			.map((call) => (call.params as { channel: Channel }).channel)
			.filter((channel) => !channel.startsWith("sessions:") && !channel.startsWith("models:"));
		// 两个通道各订阅一次，重复的那次并在同一个流程里
		expect(subscribes).toEqual([SESSION, CHAT]);
	});

	it("attach 之后订阅清单，收到推送就更新列表", async () => {
		const { transport, client } = createClient(2);
		const listChannel = "sessions:/h" as Channel;
		expect(
			transport.calls.some(
				(call) =>
					call.method === "subscribe" && (call.params as { channel: Channel }).channel === listChannel,
			),
		).toBe(true);
		transport.emit(listChannel, {
			type: "sessions/changed",
			summary: {
				id: "s1",
				path: "/work/a/s1.jsonl",
				cwd: "/work/a",
				name: undefined,
				parentSessionPath: undefined,
				created: 1,
				modified: 2,
				firstMessage: "你好",
			},
			status: { activity: "running", settle: undefined, pendingInput: 0, seenAt: 0 },
		});
		expect(client.store.sessionList().map((entry) => entry.summary.path)).toEqual(["/work/a/s1.jsonl"]);
		expect(client.store.sessionStatus("/work/a/s1.jsonl").activity).toBe("running");
	});

	it("disposeHost 之后清单、登录与两条通道的水位都不留", async () => {
		const { transport, client } = createClient(2, { initialPages: 1, pageSize: 5 });
		const listChannel = "sessions:/h" as Channel;
		const modelChannel = "models:/h" as Channel;
		await client.openSession("/tmp/s1.jsonl");
		transport.emit(listChannel, {
			type: "sessions/changed",
			summary: {
				id: "s1",
				path: "/work/a/s1.jsonl",
				cwd: "/work/a",
				name: undefined,
				parentSessionPath: undefined,
				created: 1,
				modified: 2,
				firstMessage: "你好",
			},
			status: { activity: "idle", settle: undefined, pendingInput: 0, seenAt: 0 },
		});
		transport.emit(modelChannel, {
			type: "models/loginEvent",
			loginId: "l1",
			providerId: "anthropic",
			event: { type: "info", message: "开始登录" },
		});
		expect(client.store.sessionList()).toHaveLength(1);
		expect(client.store.providerLogin("anthropic")).toBeDefined();

		await client.disposeHost();

		expect(client.store.sessionList()).toEqual([]);
		expect(client.store.providerLogin("anthropic")).toBeUndefined();
		expect(client.store.sessionListSeq).toBe(0);
		expect(client.store.providerLoginSeq).toBe(0);
		expect(client.host).toBeUndefined();
		expect(client.current).toBeUndefined();
		// 会话通道在放开时就退了订
		const unsubscribed = transport.calls
			.filter((call) => call.method === "unsubscribe")
			.map((call) => (call.params as { channel: Channel }).channel);
		expect(unsubscribed).toEqual(expect.arrayContaining([SESSION, CHAT]));
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

describe("工作树通道订阅", () => {
	const channel = workspaceChannelFor("/work/a");

	/** 等一拍，让异步订阅落到假传输上。 */
	async function settle(): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	it("关注一个目录就订阅它的工作树通道，放弃关注时退订", async () => {
		const { transport, client } = createClient(1);
		const stop = client.watchWorkspace("/work/a");
		await settle();
		expect(
			transport.calls.some(
				(call) => call.method === "subscribe" && (call.params as { channel: Channel }).channel === channel,
			),
		).toBe(true);

		stop();
		await settle();
		expect(
			transport.calls.some(
				(call) => call.method === "unsubscribe" && (call.params as { channel: Channel }).channel === channel,
			),
		).toBe(true);
	});

	it("变化推进版本号，历史变化单独记", async () => {
		const { transport, client } = createClient(1);
		const stop = client.watchWorkspace("/work/a");
		await settle();
		transport.emit(channel, { type: "workspace/changed", history: false });
		transport.emit(channel, { type: "workspace/changed", history: true });
		expect(client.store.workspaceRevision(channel)).toBe(2);
		expect(client.store.workspaceHistoryRevision(channel)).toBe(1);
		stop();
	});

	it("重连之后按记下的目录续订，并且带上已收到的序号", async () => {
		const { transport, client } = createClient(1);
		const stop = client.watchWorkspace("/work/a");
		await settle();
		transport.emit(channel, { type: "workspace/changed", history: false });
		const before = transport.calls.length;
		await client.resume();
		const workspaceCalls = transport.calls
			.slice(before)
			.filter((call) => call.method === "subscribe")
			.map((call) => call.params as { channel: Channel; since?: number })
			.filter((call) => call.channel === channel);
		expect(workspaceCalls.map((call) => call.since)).toEqual([1]);
		stop();
	});
});

describe("重连", () => {
	it("主机重启过时按文件重新打开会话", async () => {
		const { client, transport } = createClient(5);
		const opened = await client.openSession("/tmp/s1.jsonl");
		expect(client.sessionView()?.state.file).toBe("/tmp/s1.jsonl");

		transport.unknownSession = true;
		await client.resume();
		expect(transport.calls.filter((call) => call.method === "openSession")).toHaveLength(2);
		expect(client.sessionView()?.state.file).toBe("/tmp/s1.jsonl");
		expect(opened.file).toBe("/tmp/s1.jsonl");
	});

	it("其他失败照常抛出", async () => {
		const { client, transport } = createClient(5);
		await client.openSession("/tmp/s1.jsonl");
		transport.failSubscribe.add("session:/s1");
		await expect(client.resume()).rejects.toThrow("subscribe 失败");
	});
});

describe("多端视图一致", () => {
	/** 取对话投影；没有打开会话时给空数组。 */
	function transcriptOf(client: SessionClient) {
		const view = client.chatView();
		return view === undefined ? [] : toTranscript(view);
	}

	it("同一串动作喂给两个端，会话状态与对话内容逐条相等", async () => {
		const one = createClient(3, { initialPages: 1, pageSize: 5 });
		const two = createClient(3, { initialPages: 1, pageSize: 5 });
		await one.client.openSession("/tmp/s1.jsonl");
		await two.client.openSession("/tmp/s1.jsonl");

		const frames: [Channel, Action][] = [
			[SESSION, { type: "session/phase", phase: "running", maintenance: undefined }],
			[CHAT, { type: "chat/turnStarted", text: "你好" }],
			[CHAT, { type: "chat/messageAppended", messageId: "m1", message: assistant("收到") }],
			[SESSION, { type: "session/queueChanged", steering: ["补充"], followUp: [] }],
			[CHAT, { type: "chat/settled", aborted: false }],
		];
		for (const [channel, action] of frames) {
			one.transport.emit(channel, action);
			two.transport.emit(channel, action);
		}

		expect(one.client.sessionView()?.state.phase).toBe(two.client.sessionView()?.state.phase);
		expect(one.client.sessionView()?.state.queued).toEqual(two.client.sessionView()?.state.queued);
		expect(transcriptOf(one.client)).toEqual(transcriptOf(two.client));
	});

	it("一个端发出的写操作由主机广播回两端，自己不先改状态", async () => {
		const one = createClient(2, { initialPages: 1, pageSize: 5 });
		const two = createClient(2, { initialPages: 1, pageSize: 5 });
		await one.client.openSession("/tmp/s1.jsonl");
		await two.client.openSession("/tmp/s1.jsonl");
		const before = transcriptOf(one.client).length;
		one.client.send("一起看这句");
		// 主机还没广播，发出这条消息的端也不先把它塞进对话
		expect(transcriptOf(one.client)).toHaveLength(before);
		expect(transcriptOf(two.client)).toHaveLength(before);
		const broadcast: [Channel, Action] = [
			CHAT,
			{ type: "chat/messageAppended", messageId: "m1", message: user("一起看这句") },
		];
		one.transport.emit(...broadcast);
		two.transport.emit(...broadcast);
		expect(transcriptOf(one.client)).toHaveLength(before + 1);
		expect(transcriptOf(one.client)).toEqual(transcriptOf(two.client));
	});
});

describe("回退", () => {
	it("派发到对话通道", async () => {
		const { client, transport } = createClient(5);
		await client.openSession("/tmp/s1.jsonl");
		client.revert("e3");
		expect(transport.dispatched.at(-1)).toEqual({
			channel: "chat:/s1",
			action: { type: "chat/revertTo", entryId: "e3" },
		});
	});

	it("列可用模型走 availableModels 请求", async () => {
		const { transport, client } = createClient(1);
		const models = await client.listAvailableModels();
		// attach 时会顺带订阅清单并取一次会话列表，这里只看模型请求本身
		expect(transport.calls.filter((call) => call.method === "availableModels")).toHaveLength(1);
		expect(models.map((model) => `${model.provider}/${model.id}`)).toEqual(["deepseek/deepseek-v4-flash"]);
	});

	it("收到 branchMoved 后重新装载历史", async () => {
		const { client, transport } = createClient(25, { pageSize: 10 });
		await client.openSession("/tmp/s1.jsonl");
		const before = transport.calls.filter((call) => call.method === "entries").length;
		transport.emit("chat:/s1", { type: "chat/branchMoved", leafId: null });
		await new Promise((done) => setTimeout(done, 20));
		const after = transport.calls.filter((call) => call.method === "entries").length;
		expect(after).toBeGreaterThan(before);
		// 清空之后只重新装载最近两页，更早的历史继续向前翻
		expect(client.chatView()?.items).toHaveLength(20);
		expect(client.hasMore).toBe(true);
	});
});

describe("扩展交互状态", () => {
	it("应答明确定位会话与请求，不提前移除待答状态", async () => {
		const { client, transport } = createClient(0);
		await client.openSession("/tmp/s1.jsonl");
		const ui = { prompts: [{ kind: "input" as const, requestId: "u1", title: "路径" }] };
		transport.emit(SESSION, { type: "session/uiChanged", ui });
		expect(await client.respondUi("u1", { kind: "input", value: "  完整内容  " })).toBe(true);
		expect(transport.calls.at(-1)).toEqual({
			method: "respondUi",
			params: { sessionId: "s1", requestId: "u1", response: { kind: "input", value: "  完整内容  " } },
		});
		expect(client.sessionView()?.state.extensionUi).toEqual(ui);
		transport.emit(SESSION, { type: "session/uiChanged", ui: { prompts: [] } });
		expect(client.sessionView()?.state.extensionUi.prompts).toEqual([]);
	});

	it("重复 UI 帧不覆盖新状态，初始化与维护动作分别更新", async () => {
		const { client, transport } = createClient(0);
		await client.openSession("/tmp/s1.jsonl");
		transport.emit(SESSION, {
			type: "session/phase",
			phase: "running",
			maintenance: {
				kind: "compaction",
				reason: "manual",
				tokensBefore: undefined,
				estimatedTokensAfter: undefined,
			},
		});
		transport.emit(
			SESSION,
			{
				type: "session/uiChanged",
				ui: { prompts: [{ kind: "confirm", requestId: "u1", title: "确认", message: "内容" }] },
			},
			2,
		);
		transport.emit(SESSION, { type: "session/uiChanged", ui: { prompts: [] } }, 3);
		transport.emit(
			SESSION,
			{ type: "session/uiChanged", ui: { prompts: [{ kind: "input", requestId: "u1", title: "旧请求" }] } },
			2,
		);
		transport.emit(SESSION, { type: "session/initialized", initialization: { kind: "ready" } }, 4);
		expect(client.sessionView()?.state.extensionUi.prompts).toEqual([]);
		expect(client.sessionView()?.state.maintenance?.kind).toBe("compaction");
	});

	it("应答期间切换会话，不用旧响应刷新新会话", async () => {
		const { client, transport } = createClient(0);
		await client.openSession("/tmp/s1.jsonl");
		let resolve!: () => void;
		transport.respondUiGate = new Promise<void>((done) => {
			resolve = done;
		});
		transport.uiAccepted = false;
		const response = client.respondUi("u1", { kind: "cancel" }, "s1");
		await client.switchSession("/tmp/s2.jsonl");
		const before = transport.calls.length;
		resolve();
		expect(await response).toBe(false);
		expect(transport.calls).toHaveLength(before);
		expect(client.current?.sessionId).toBe("s2");
		expect(await client.respondUi("u1", { kind: "cancel" }, "s1")).toBe(false);
	});

	it("过期应答重新获取快照，快照期间切换会话不恢复旧视图", async () => {
		const { client, transport } = createClient(0);
		await client.openSession("/tmp/s1.jsonl");
		transport.uiAccepted = false;
		let resolve!: () => void;
		transport.snapshotGate = new Promise<void>((done) => {
			resolve = done;
		});
		const response = client.respondUi("u1", { kind: "cancel" });
		await vi.waitFor(() => expect(transport.calls.at(-1)?.method).toBe("snapshot"));
		await client.switchSession("/tmp/s2.jsonl");
		resolve();
		expect(await response).toBe(false);
		expect(client.sessionView()?.channel).toBe("session:/s2");
		// 旧会话留在缓存里，但不会被这次过期应答刷新
		expect(client.store.sessionView(SESSION)?.channel).toBe(SESSION);
	});

	it("扩展消费回执只确认同一端的同一次发送，回执不增加对话条目", async () => {
		const { client, transport } = createClient(0);
		await client.openSession("/tmp/s1.jsonl");
		const sent = vi.fn();
		client.onSent(sent);
		const seq = client.send("/ask", { streamingBehavior: "steer" });
		expect(transport.dispatched.at(-1)?.action).toEqual({
			type: "chat/turnStarted",
			text: "/ask",
			streamingBehavior: "steer",
		});
		transport.handled(seq, "other");
		transport.handled(seq + 1);
		expect(sent).not.toHaveBeenCalled();
		transport.handled(seq);
		transport.handled(seq);
		expect(sent).toHaveBeenCalledExactlyOnceWith("/ask");
		expect(client.chatView()?.items).toEqual([]);
	});

	it("demoteSteering 派发 session/steeringDemoted，onQueueReclaimed 仅响应本端实时回收帧", async () => {
		const { client, transport } = createClient(0);
		await client.openSession("/tmp/s1.jsonl");
		const reclaimed: Array<{ items: unknown[]; sessionId: string }> = [];
		client.onQueueReclaimed((items, sessionId) => reclaimed.push({ items, sessionId }));

		client.demoteSteering();
		expect(transport.dispatched.at(-1)?.action).toEqual({ type: "session/steeringDemoted" });

		// 发往其他客户端的回收帧不触发回调
		transport.emit(CHAT, {
			type: "chat/queueReclaimed",
			targetClientId: "other",
			items: [{ text: "忽略" }],
		});
		expect(reclaimed).toEqual([]);

		// 发往本端 ("c") 的实时新帧触发回调
		transport.emit(CHAT, {
			type: "chat/queueReclaimed",
			targetClientId: "c",
			items: [{ text: "第一条" }, { text: "第二条" }],
		});
		expect(reclaimed).toEqual([{ items: [{ text: "第一条" }, { text: "第二条" }], sessionId: "s1" }]);

		// 重复或旧序号帧不再重复回填
		transport.emit(
			CHAT,
			{
				type: "chat/queueReclaimed",
				targetClientId: "c",
				items: [{ text: "旧帧" }],
			},
			2,
		);
		expect(reclaimed).toHaveLength(1);
	});

	it("支持 ACP 模式与动态配置派发及 session/acpStateChanged 归约更新", async () => {
		const { client, transport } = createClient(0);
		await client.openSession("/tmp/s1.jsonl");
		expect(client.sessionView()?.state.backendId).toBe("pi");
		expect(client.sessionView()?.state.capabilities.configStyle).toBe("pi");

		client.setAcpMode("plan");
		client.setAcpConfigOption("model", "gemini-2.5");
		expect(transport.dispatched.slice(-2).map((item) => item.action)).toEqual([
			{ type: "session/acpModeSet", modeId: "plan" },
			{ type: "session/acpConfigOptionSet", configId: "model", value: "gemini-2.5" },
		]);

		transport.emit(SESSION, {
			type: "session/acpStateChanged",
			mode: { currentModeId: "plan", availableModes: [{ id: "plan", name: "Plan" }] },
			configOptions: [
				{
					id: "model",
					name: "Model",
					category: "model",
					currentValue: "gemini-2.5",
					options: [{ value: "gemini-2.5", name: "Gemini 2.5" }],
				},
			],
		});
		expect(client.sessionView()?.state.acpMode?.currentModeId).toBe("plan");
		expect(client.sessionView()?.state.acpConfigOptions).toHaveLength(1);
	});
});
