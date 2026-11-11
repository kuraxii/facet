import { basename, resolve } from "node:path";
import type { Entry, SessionEvent, SessionEventListener, SessionSnapshot } from "@facet/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ActionSink,
	type AgentFactory,
	type HubAgent,
	SessionConflictError,
	SessionHub,
} from "./session-hub.ts";

const IDLE_MS = 1000;

/** 最小可用的消息条目，用例只需要 id 与顺序。 */
function messageEntry(id: string, parentId: string | null): Entry {
	return {
		id,
		parentId,
		kind: "message",
		timestamp: "2026-11-08T00:00:00Z",
		message: {
			role: "assistant",
			content: [{ type: "text", text: id }],
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
		},
	};
}

class FakeAgent implements HubAgent {
	readonly id: string;
	readonly file: string | undefined;
	busy = false;
	disposed = false;
	private readonly listeners = new Set<SessionEventListener>();

	constructor(id: string, file?: string) {
		this.id = id;
		this.file = file;
	}

	get isBusy(): boolean {
		return this.busy;
	}

	subscribe(listener: SessionEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** 已写盘的条目,用例按需填 */
	readonly stored: Entry[] = [];

	/** 按页取条目，游标为空表示从末尾开始 */
	entryPage(cursor: string | undefined, limit: number): { entries: Entry[]; nextCursor: string | undefined } {
		const size = Math.max(1, limit);
		if (cursor === undefined) {
			const start = Math.max(0, this.stored.length - size);
			return {
				entries: this.stored.slice(start),
				nextCursor: start > 0 ? this.stored[start]?.id : undefined,
			};
		}
		const index = this.stored.findIndex((entry) => entry.id === cursor);
		if (index < 0) {
			throw new Error(`unknown session entry: ${cursor}`);
		}
		const start = Math.max(0, index - size);
		return {
			entries: this.stored.slice(start, index),
			nextCursor: start > 0 ? this.stored[start]?.id : undefined,
		};
	}

	/** 分叉点：取给定条目在 stored 里的前一条 */
	entryBefore(entryId: string): string | null {
		const index = this.stored.findIndex((entry) => entry.id === entryId);
		if (index <= 0) {
			return null;
		}
		return this.stored[index - 1]?.id ?? null;
	}

	/** 取边界之后的条目，用例按 stored 尾部模拟 */
	entriesAfter(afterEntryId: string | null): { entries: Entry[]; leafId: string | null } {
		const index = afterEntryId === null ? -1 : this.stored.findIndex((entry) => entry.id === afterEntryId);
		if (afterEntryId !== null && index < 0) {
			throw new Error(`unknown session entry: ${afterEntryId}`);
		}
		const leaf = this.stored[this.stored.length - 1];
		return { entries: this.stored.slice(index + 1), leafId: leaf?.id ?? null };
	}

	snapshot(): SessionSnapshot {
		return {
			id: this.id,
			file: this.file,
			cwd: "/tmp",
			name: `会话 ${this.id}`,
			phase: this.busy ? "running" : "idle",
			maintenance: undefined,
			model: undefined,
			thinkingLevel: "medium",
			availableThinkingLevels: ["medium"],
			activeToolNames: [],
			queued: { steering: [], followUp: [] },
			contextUsage: undefined,
			stats: {
				sessionId: this.id,
				sessionFile: this.file,
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

	dispose(): void {
		this.disposed = true;
	}

	emit(event: SessionEvent): void {
		for (const listener of [...this.listeners]) {
			listener(event);
		}
	}
}

/** 假工厂:会话 id 缺省取文件名去掉扩展名,可用 ids 覆盖以模拟复制出来的会话文件。 */
class FakeFactory implements AgentFactory<FakeAgent> {
	readonly ids = new Map<string, string>();
	readonly opened: string[] = [];
	readonly forked: string[] = [];
	created = 0;
	/** 建立会话时等待的闸门,用来让并发请求真正交错 */
	gate: Promise<void> | undefined;

	async peekSessionId(file: string): Promise<string> {
		return this.ids.get(file) ?? basename(file, ".jsonl");
	}

	async create(): Promise<FakeAgent> {
		this.created += 1;
		return new FakeAgent(`new-${this.created}`, resolve(`/tmp/new-${this.created}.jsonl`));
	}

	async fork(options: { sessionFile: string; entryId?: string }): Promise<FakeAgent> {
		this.forked.push(`${options.sessionFile}#${options.entryId ?? "leaf"}`);
		await Promise.resolve();
		return new FakeAgent(`fork-${this.forked.length}`, resolve(`/tmp/fork-${this.forked.length}.jsonl`));
	}

	async open(options: { sessionFile: string }): Promise<FakeAgent> {
		this.opened.push(options.sessionFile);
		if (this.gate) {
			await this.gate;
		}
		await Promise.resolve();
		return new FakeAgent(await this.peekSessionId(options.sessionFile), resolve(options.sessionFile));
	}
}

let factory: FakeFactory;
let hub: SessionHub<FakeAgent>;

beforeEach(() => {
	vi.useFakeTimers();
	factory = new FakeFactory();
	hub = new SessionHub<FakeAgent>({ factory, replayLimit: 8, idleCloseMs: IDLE_MS });
});

afterEach(() => {
	hub.dispose();
	vi.useRealTimers();
});

const sink = (id: string) => ({ id, send: () => {} });

describe("会话建立与复用", () => {
	it("打开同一文件复用同一份运行态", async () => {
		const first = await hub.openSession("/tmp/s1.jsonl");
		const second = await hub.openSession("/tmp/s1.jsonl");
		expect(factory.opened).toEqual(["/tmp/s1.jsonl"]);
		expect(second.id).toBe(first.id);
	});

	it("并发打开同一文件共用一次建立", async () => {
		let open: () => void = () => {};
		factory.gate = new Promise<void>((resolveGate) => {
			open = resolveGate;
		});
		const first = hub.openSession("/tmp/s1.jsonl");
		const second = hub.openSession("/tmp/s1.jsonl");
		await Promise.resolve();
		open();
		const [a, b] = await Promise.all([first, second]);
		expect(factory.opened).toHaveLength(1);
		expect(a.id).toBe(b.id);
	});

	it("同一文件的不同写法落到同一个键", async () => {
		await hub.openSession("./s1.jsonl");
		await hub.openSession(resolve("./s1.jsonl"));
		expect(factory.opened).toHaveLength(1);
	});

	it("不同文件各自建立", async () => {
		await hub.openSession("/tmp/s1.jsonl");
		await hub.openSession("/tmp/s2.jsonl");
		expect(factory.opened).toHaveLength(2);
		expect(hub.sessionIds()).toHaveLength(2);
	});

	it("同一个会话 id 出现在两个文件时报冲突", async () => {
		factory.ids.set(resolve("/tmp/a.jsonl"), "same");
		factory.ids.set(resolve("/tmp/b.jsonl"), "same");
		await hub.openSession("/tmp/a.jsonl");
		await expect(hub.openSession("/tmp/b.jsonl")).rejects.toBeInstanceOf(SessionConflictError);
	});

	it("新建会话经工厂并登记", async () => {
		const snapshot = await hub.createSession({ cwd: "/tmp" });
		expect(factory.created).toBe(1);
		expect(hub.has(snapshot.id)).toBe(true);
	});

	it("分叉出新会话并登记", async () => {
		const source = await hub.openSession("/tmp/s1.jsonl");
		const agent = hub.agent(source.id);
		for (const id of ["e1", "e2", "e3"]) {
			agent.stored.push({
				id,
				parentId: id === "e1" ? null : `e${Number(id.slice(1)) - 1}`,
				kind: "message",
				timestamp: "2026-11-08T00:00:00Z",
				message: {
					role: "assistant",
					content: [{ type: "text", text: id }],
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
				},
			});
		}
		const forked = await hub.forkSession({ sessionFile: "/tmp/s1.jsonl", beforeEntryId: "e3" });
		// 分叉点是下一轮开始处的前一条
		expect(factory.forked).toEqual(["/tmp/s1.jsonl#e2"]);
		expect(forked.id).not.toBe(source.id);
		expect(hub.has(forked.id)).toBe(true);
		expect(hub.has(source.id)).toBe(true);
	});

	it("缺省分叉点取活动分支的叶子", async () => {
		await hub.openSession("/tmp/s1.jsonl");
		await hub.forkSession({ sessionFile: "/tmp/s1.jsonl" });
		expect(factory.forked).toEqual(["/tmp/s1.jsonl#leaf"]);
	});

	it("运行中不允许分叉", async () => {
		const source = await hub.openSession("/tmp/s1.jsonl");
		hub.agent(source.id).busy = true;
		await expect(hub.forkSession({ sessionFile: "/tmp/s1.jsonl", beforeEntryId: "e1" })).rejects.toThrow(
			"不能分叉",
		);
	});

	it("分叉点不在分支上时报错", async () => {
		await hub.openSession("/tmp/s1.jsonl");
		await expect(hub.forkSession({ sessionFile: "/tmp/s1.jsonl", beforeEntryId: "e99" })).rejects.toThrow(
			"找不到消息对应的会话条目",
		);
	});

	it("同一会话已有另一份状态时保留先登记的", () => {
		const first = new FakeAgent("s1", "/tmp/s1.jsonl");
		const second = new FakeAgent("s1", "/tmp/s1.jsonl");
		hub.attach(first);
		hub.attach(second);
		expect(hub.agent("s1")).toBe(first);
		expect(first.disposed).toBe(false);
		expect(second.disposed).toBe(true);
	});
});

describe("空闲回收", () => {
	it("没有订阅者且不在运行时到点回收", async () => {
		const snapshot = await hub.createSession();
		const agent = hub.agent(snapshot.id);
		expect(hub.has(snapshot.id)).toBe(true);
		await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
		expect(hub.has(snapshot.id)).toBe(false);
		expect(agent.disposed).toBe(true);
	});

	it("有订阅者时不回收", async () => {
		const snapshot = await hub.openSession("/tmp/s1.jsonl");
		await hub.subscribe(`chat:/${snapshot.id}`, undefined, sink("a"));
		await vi.advanceTimersByTimeAsync(IDLE_MS * 3);
		expect(hub.has(snapshot.id)).toBe(true);
	});

	it("退订后归零再回收", async () => {
		const snapshot = await hub.openSession("/tmp/s1.jsonl");
		const listener = sink("a");
		await hub.subscribe(`chat:/${snapshot.id}`, undefined, listener);
		await vi.advanceTimersByTimeAsync(IDLE_MS * 3);
		hub.unsubscribe(`chat:/${snapshot.id}`, listener);
		await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
		expect(hub.has(snapshot.id)).toBe(false);
	});

	it("订阅两条通道的同一个端只算一个持有者", async () => {
		const snapshot = await hub.openSession("/tmp/s1.jsonl");
		const listener = sink("a");
		await hub.subscribe(`chat:/${snapshot.id}`, undefined, listener);
		await hub.subscribe(`session:/${snapshot.id}`, undefined, listener);
		hub.unsubscribe(`chat:/${snapshot.id}`, listener);
		await vi.advanceTimersByTimeAsync(IDLE_MS * 3);
		expect(hub.has(snapshot.id)).toBe(true);
		hub.unsubscribe(`session:/${snapshot.id}`, listener);
		await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
		expect(hub.has(snapshot.id)).toBe(false);
	});

	it("倒计时期间重新订阅则取消回收", async () => {
		const snapshot = await hub.openSession("/tmp/s1.jsonl");
		await vi.advanceTimersByTimeAsync(IDLE_MS - 200);
		await hub.subscribe(`chat:/${snapshot.id}`, undefined, sink("a"));
		await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
		expect(hub.has(snapshot.id)).toBe(true);
	});

	it("运行中不回收,停下后进入倒计时", async () => {
		const snapshot = await hub.openSession("/tmp/s1.jsonl");
		const agent = hub.agent(snapshot.id);
		agent.busy = true;
		await vi.advanceTimersByTimeAsync(IDLE_MS * 3);
		expect(hub.has(snapshot.id)).toBe(true);
		agent.busy = false;
		agent.emit({ type: "settled", aborted: false });
		await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
		expect(hub.has(snapshot.id)).toBe(false);
	});

	it("历史分页从末尾往更早取，游标缺失时报错", async () => {
		const snapshot = await hub.openSession("/tmp/s1.jsonl");
		const agent = hub.agent(snapshot.id);
		for (const id of ["e1", "e2", "e3", "e4", "e5"]) {
			agent.stored.push(messageEntry(id, id === "e1" ? null : `e${Number(id.slice(1)) - 1}`));
		}
		const first = await hub.entries(snapshot.id, undefined, 2);
		expect(first.entries.map((entry) => entry.id)).toEqual(["e4", "e5"]);
		expect(first.nextCursor).toBe("e4");
		const second = await hub.entries(snapshot.id, first.nextCursor, 2);
		expect(second.entries.map((entry) => entry.id)).toEqual(["e2", "e3"]);
		expect(second.nextCursor).toBe("e2");
		const last = await hub.entries(snapshot.id, second.nextCursor, 2);
		expect(last.entries.map((entry) => entry.id)).toEqual(["e1"]);
		expect(last.nextCursor).toBeUndefined();
		await expect(hub.entries(snapshot.id, "nope", 2)).rejects.toThrow("找不到消息对应的会话条目");
	});

	it("取边界之后的条目只返回这一段", async () => {
		const snapshot = await hub.openSession("/tmp/s1.jsonl");
		const agent = hub.agent(snapshot.id);
		for (const id of ["e1", "e2", "e3"]) {
			agent.stored.push({
				id,
				parentId: id === "e1" ? null : `e${Number(id.slice(1)) - 1}`,
				kind: "message",
				timestamp: "2026-11-08T00:00:00Z",
				message: {
					role: "assistant",
					content: [{ type: "text", text: id }],
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
				},
			});
		}
		const result = await hub.entriesAfter(snapshot.id, "e1");
		expect(result.entries.map((entry) => entry.id)).toEqual(["e2", "e3"]);
		expect(result.leafId).toBe("e3");
		await expect(hub.entriesAfter(snapshot.id, "e9")).rejects.toThrow("条目不在活动分支上");
	});

	it("持有期间到点也不回收,归还后才回收", async () => {
		const snapshot = await hub.createSession();
		const agent = hub.agent(snapshot.id);
		const lease = hub.hold(snapshot.id);
		await vi.advanceTimersByTimeAsync(IDLE_MS * 3);
		expect(hub.has(snapshot.id)).toBe(true);
		expect(agent.disposed).toBe(false);
		lease.release();
		await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
		expect(hub.has(snapshot.id)).toBe(false);
		expect(agent.disposed).toBe(true);
	});

	it("持有期间的显式释放等归还后再执行", async () => {
		const snapshot = await hub.createSession();
		const agent = hub.agent(snapshot.id);
		const lease = hub.hold(snapshot.id);
		hub.release(snapshot.id);
		expect(hub.has(snapshot.id)).toBe(true);
		expect(agent.disposed).toBe(false);
		lease.release();
		expect(hub.has(snapshot.id)).toBe(false);
		expect(agent.disposed).toBe(true);
	});

	it("读历史或取快照会续期", async () => {
		const snapshot = await hub.openSession("/tmp/s1.jsonl");
		await vi.advanceTimersByTimeAsync(IDLE_MS - 400);
		await hub.entries(snapshot.id, undefined, 5);
		await vi.advanceTimersByTimeAsync(IDLE_MS - 400);
		expect(hub.has(snapshot.id)).toBe(true);
		await hub.snapshot(snapshot.id);
		await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
		expect(hub.has(snapshot.id)).toBe(false);
	});
});

describe("动作的持有与串行", () => {
	it("同一会话的动作依次执行", async () => {
		const snapshot = await hub.createSession();
		const order: string[] = [];
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const first = hub.withSession(snapshot.id, async () => {
			order.push("第一个开始");
			await firstGate;
			order.push("第一个结束");
		});
		const second = hub.withSession(snapshot.id, async () => {
			order.push("第二个开始");
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(order).toEqual(["第一个开始"]);
		releaseFirst();
		await Promise.all([first, second]);
		expect(order).toEqual(["第一个开始", "第一个结束", "第二个开始"]);
	});

	it("执行期间持有会话,到点也不回收", async () => {
		const snapshot = await hub.createSession();
		const agent = hub.agent(snapshot.id);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const running = hub.withSession(snapshot.id, async () => {
			await gate;
		});
		await vi.advanceTimersByTimeAsync(IDLE_MS * 3);
		expect(hub.has(snapshot.id)).toBe(true);
		expect(agent.disposed).toBe(false);
		release();
		await running;
		await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
		expect(hub.has(snapshot.id)).toBe(false);
	});

	it("动作抛错时归还持有并继续处理后面的动作", async () => {
		const snapshot = await hub.createSession();
		const order: string[] = [];
		await expect(
			hub.withSession(snapshot.id, async () => {
				order.push("失败的动作");
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		await hub.withSession(snapshot.id, async () => {
			order.push("后面的动作");
		});
		expect(order).toEqual(["失败的动作", "后面的动作"]);
		await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
		expect(hub.has(snapshot.id)).toBe(false);
	});

	it("会话不存在时报错", async () => {
		await expect(hub.withSession("nope", async () => {})).rejects.toThrow("unknown session");
	});
});

describe("通道与动作", () => {
	it("订阅时补发缓冲并对齐序号", async () => {
		const snapshot = await hub.openSession("/tmp/s1.jsonl");
		const agent = hub.agent(snapshot.id);
		const received: number[] = [];
		const first: ActionSink = {
			id: "a",
			send: (frame) => {
				received.push(frame.serverSeq);
			},
		};
		await hub.subscribe(`chat:/${snapshot.id}`, undefined, first);
		agent.emit({ type: "turn_start" });
		agent.emit({ type: "notice", level: "info", message: "hi" });

		const replay: number[] = [];
		const second: ActionSink = {
			id: "b",
			send: (frame) => {
				replay.push(frame.serverSeq);
			},
		};
		const subscription = await hub.subscribe(`chat:/${snapshot.id}`, 0, second);
		expect(replay).toHaveLength(received.length);
		expect(subscription.seq).toBe(hub.lastSeq(`chat:/${snapshot.id}`));
	});

	it("事件按通道分流", async () => {
		const snapshot = await hub.openSession("/tmp/s1.jsonl");
		const agent = hub.agent(snapshot.id);
		const sessionFrames: string[] = [];
		const chatFrames: string[] = [];
		await hub.subscribe(`session:/${snapshot.id}`, undefined, {
			id: "a",
			send: (frame) => sessionFrames.push(frame.action.type),
		});
		await hub.subscribe(`chat:/${snapshot.id}`, undefined, {
			id: "b",
			send: (frame) => chatFrames.push(frame.action.type),
		});
		agent.emit({ type: "phase", phase: "running", maintenance: undefined });
		agent.emit({ type: "notice", level: "info", message: "hello" });
		expect(sessionFrames).toEqual(["session/phase"]);
		expect(chatFrames.includes("chat/notice")).toBe(true);
	});
});

describe("查询", () => {
	it("会话文件能查到对应的会话 id", async () => {
		const snapshot = await hub.openSession("/tmp/s1.jsonl");
		expect(hub.sessionIdByFile("/tmp/s1.jsonl")).toBe(snapshot.id);
		expect(hub.sessionIdByFile("/tmp/other.jsonl")).toBeUndefined();
	});

	it("未登记的会话取快照报不存在", async () => {
		await expect(hub.snapshot("nope")).rejects.toThrow("unknown session");
	});
});
