import { resolve } from "node:path";
import type { Entry, SessionEvent, SessionEventListener, SessionSnapshot } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { ApprovalBroker } from "./approval-broker.ts";
import { type AgentFactory, type HubAgent, SessionHub } from "./session-hub.ts";

class FakeAgent implements HubAgent {
	readonly id: string;
	readonly file: string | undefined;
	isStreaming = false;
	isCompacting = false;
	disposed = false;
	private readonly listeners = new Set<SessionEventListener>();

	constructor(id: string, file?: string) {
		this.id = id;
		this.file = file;
	}

	subscribe(listener: SessionEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	entries(_since?: string): { entries: Entry[]; leafId: string | null } {
		return { entries: [], leafId: null };
	}

	snapshot(): SessionSnapshot {
		return {
			id: this.id,
			file: this.file,
			cwd: "/tmp",
			name: `会话 ${this.id}`,
			status: this.isStreaming ? "running" : "idle",
			model: undefined,
			thinkingLevel: "medium",
			availableThinkingLevels: ["medium"],
			activeToolNames: [],
			queued: { steering: [], followUp: [] },
			pendingApprovals: [],
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

	/** 推一个事件,用来验证登记表把事件转成了动作。 */
	emit(event: SessionEvent): void {
		for (const listener of [...this.listeners]) {
			listener(event);
		}
	}
}

/** 假工厂按文件建立假 agent,记录建立次数与收到的参数。 */
class FakeFactory implements AgentFactory<FakeAgent> {
	created = 0;
	opened: string[] = [];
	private readonly agents = new Map<string, FakeAgent>();

	async create(): Promise<FakeAgent> {
		this.created += 1;
		const agent = new FakeAgent(`new-${this.created}`, `/tmp/new-${this.created}.jsonl`);
		this.agents.set(agent.id, agent);
		return agent;
	}

	async open(options: { sessionFile: string }): Promise<FakeAgent> {
		this.opened.push(options.sessionFile);
		const existing = this.agents.get(`file:${resolve(options.sessionFile)}`);
		if (existing) {
			return existing;
		}
		const agent = new FakeAgent(`file:${resolve(options.sessionFile)}`, resolve(options.sessionFile));
		this.agents.set(agent.id, agent);
		return agent;
	}
}

function createHub(factory = new FakeFactory()): { hub: SessionHub<FakeAgent>; factory: FakeFactory } {
	return { hub: new SessionHub<FakeAgent>({ factory, replayLimit: 8 }), factory };
}

describe("SessionHub 的会话唯一性", () => {
	it("同一文件重复打开复用同一份运行态", async () => {
		const { hub, factory } = createHub();
		const first = await hub.openSession("/tmp/s1.jsonl");
		const second = await hub.openSession("/tmp/s1.jsonl");
		expect(factory.opened).toEqual(["/tmp/s1.jsonl"]);
		expect(second.id).toBe(first.id);
	});

	it("并发打开同一文件共用一次建立", async () => {
		const { hub, factory } = createHub();
		const [a, b] = await Promise.all([hub.openSession("/tmp/s1.jsonl"), hub.openSession("/tmp/s1.jsonl")]);
		expect(factory.opened).toHaveLength(1);
		expect(a.id).toBe(b.id);
	});

	it("同一文件的不同写法落到同一个键", async () => {
		const { hub, factory } = createHub();
		await hub.openSession("./s1.jsonl");
		await hub.openSession(resolve("./s1.jsonl"));
		expect(factory.opened).toHaveLength(1);
	});

	it("不同文件各自建立", async () => {
		const { hub, factory } = createHub();
		await hub.openSession("/tmp/s1.jsonl");
		await hub.openSession("/tmp/s2.jsonl");
		expect(factory.opened).toHaveLength(2);
		expect(hub.sessionIds()).toHaveLength(2);
	});

	it("会话释放后索引一并清掉,再次打开会重新建立", async () => {
		const { hub, factory } = createHub();
		const opened = await hub.openSession("/tmp/s1.jsonl");
		hub.release(opened.id);
		expect(hub.sessionIdByFile("/tmp/s1.jsonl")).toBeUndefined();
		await hub.openSession("/tmp/s1.jsonl");
		expect(factory.opened).toHaveLength(2);
	});

	it("新建会话走工厂并登记", async () => {
		const { hub, factory } = createHub();
		const snapshot = await hub.createSession({ cwd: "/tmp" });
		expect(factory.created).toBe(1);
		expect(hub.has(snapshot.id)).toBe(true);
	});
});

describe("SessionHub 的登记冲突", () => {
	it("同一会话已有另一份状态时保留先登记的,丢弃新来的", () => {
		const { hub } = createHub();
		const first = new FakeAgent("s1", "/tmp/s1.jsonl");
		const second = new FakeAgent("s1", "/tmp/s1.jsonl");
		hub.attach(first, new ApprovalBroker());
		hub.attach(second, new ApprovalBroker());
		expect(hub.agent("s1")).toBe(first);
		expect(first.disposed).toBe(false);
		expect(second.disposed).toBe(true);
	});

	it("重复登记同一个实例不变更状态", () => {
		const { hub } = createHub();
		const agent = new FakeAgent("s1", "/tmp/s1.jsonl");
		hub.attach(agent, new ApprovalBroker());
		const subscribed = hub.subscribe("chat:/s1", undefined, () => {});
		hub.attach(agent, new ApprovalBroker());
		expect(hub.lastSeq("chat:/s1")).toBe(subscribed.seq);
		expect(hub.agent("s1")).toBe(agent);
	});
});
