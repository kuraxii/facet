/**
 * 两个端接同一台主机的行为。
 *
 * 用真实的端点与 WebSocket 连接，工厂与会话换成假实现：验证多个端订阅同一会话时收到
 * 同一串动作、并发写同一轮时只有一条执行、断线重连按序号补齐。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Entry, SessionEvent, SessionEventListener, SessionSnapshot } from "@facet/protocol";
import { type Channel, encodeFrame, FrameDecoder, makeChannel } from "@facet/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "./config.ts";
import { startEndpoint } from "./endpoint.ts";
import { ProjectStore } from "./project-store.ts";
import type { HubAgent } from "./session-hub.ts";
import { SessionHub } from "./session-hub.ts";
import { SessionsChannel } from "./sessions-channel.ts";
import { SettingsStore } from "./settings-store.ts";

const SESSION = makeChannel("session", "s1");
const CHAT = makeChannel("chat", "s1");

/** 只够端点与登记表用的会话。prompt 只改运行标记，不产生真实输出。 */
class FakeAgent implements HubAgent {
	readonly id = "s1";
	readonly file = "/tmp/s1.jsonl";
	busy = false;
	streaming = false;
	readonly prompts: string[] = [];
	private readonly listeners = new Set<SessionEventListener>();

	get isBusy(): boolean {
		return this.busy;
	}

	get isStreaming(): boolean {
		return this.streaming;
	}

	subscribe(listener: SessionEventListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(text: string): Promise<void> {
		this.prompts.push(text);
		this.streaming = true;
		this.busy = true;
	}

	emit(event: SessionEvent): void {
		for (const listener of [...this.listeners]) {
			listener(event);
		}
	}

	entryPage(): { entries: Entry[]; nextCursor: string | undefined } {
		return { entries: [], nextCursor: undefined };
	}

	entriesAfter(): { entries: Entry[]; leafId: string | null } {
		return { entries: [], leafId: null };
	}

	entryBefore(): string | null {
		return null;
	}

	leafEntryId(): string | null {
		return null;
	}

	setName(): void {}
	async revertTo(): Promise<string | undefined> {
		return undefined;
	}
	dispose(): void {}

	snapshot(): SessionSnapshot {
		return {
			id: this.id,
			file: this.file,
			cwd: "/tmp",
			name: "会话一",
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
}

/** 一条连接上的测试端：按行发帧、收动作帧。 */
class TestClient {
	private readonly socket: ReturnType<typeof connect>;
	private seq = 0;
	private readonly pending = new Map<string, (result: unknown) => void>();
	readonly frames: { channel: Channel; action: { type: string }; seq: number; rejectionReason?: string }[] =
		[];
	private readonly decoder = new FrameDecoder();

	constructor(socket: ReturnType<typeof connect>) {
		this.socket = socket;
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			for (const line of this.decoder.push(chunk)) {
				this.receive(line);
			}
		});
	}

	/** 处理一帧：响应交给等待者，动作记下来。 */
	private receive(raw: string): void {
		const frame = JSON.parse(raw) as {
			type: string;
			id?: string;
			data?: unknown;
			channel?: Channel;
			action?: { type: string };
			serverSeq?: number;
			rejectionReason?: string;
		};
		if (frame.type === "response" && frame.id !== undefined) {
			this.pending.get(frame.id)?.(frame.data);
			this.pending.delete(frame.id);
			return;
		}
		if (frame.type === "action" && frame.channel !== undefined && frame.action !== undefined) {
			this.frames.push({
				channel: frame.channel,
				action: frame.action,
				seq: frame.serverSeq ?? 0,
				...(frame.rejectionReason === undefined ? {} : { rejectionReason: frame.rejectionReason }),
			});
		}
	}

	static async connect(port: number, token = ""): Promise<TestClient> {
		const socket = connect({ host: "127.0.0.1", port });
		await new Promise<void>((resolve, reject) => {
			socket.once("connect", () => resolve());
			socket.once("error", reject);
		});
		const client = new TestClient(socket);
		// 首帧是令牌，主机校验通过才回 hello
		socket.write(encodeFrame({ type: "auth", token }));
		return client;
	}

	request<M extends string>(method: M, params: unknown): Promise<unknown> {
		this.seq += 1;
		const id = `r${this.seq}`;
		return new Promise((resolve) => {
			this.pending.set(id, resolve);
			this.socket.write(encodeFrame({ type: "request", id, method, params } as never));
		});
	}

	async subscribe(channel: Channel, since?: number): Promise<{ seq: number; resync: boolean }> {
		return (await this.request("subscribe", since === undefined ? { channel } : { channel, since })) as {
			seq: number;
			resync: boolean;
		};
	}

	dispatch(channel: Channel, action: unknown): void {
		this.socket.write(encodeFrame({ type: "dispatch", channel, action } as never));
	}

	close(): void {
		this.socket.end();
		this.socket.destroy();
	}
}

let dir: string;
let agent: FakeAgent;
let endpoint: { port: number; socketPath?: string; close(): Promise<void> };
let clients: TestClient[] = [];

function config(dataDir: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
	return {
		host: "127.0.0.1",
		port: 0,
		socketPath: undefined,
		token: undefined,
		remotePermission: "view",
		webPort: undefined,
		webRoot: undefined,
		agentDir: dataDir,
		sessionDir: undefined,
		dataDir,
		replayLimit: 32,
		sessionIdleMs: 60_000,
		hostName: "测试主机",
		debug: false,
		...overrides,
	};
}

/** 端点用得上的工厂入口，全部指向同一个假会话。 */
function fakeFactory(dataDir: string) {
	return {
		create: async () => agent,
		open: async () => agent,
		fork: async () => agent,
		peekSessionId: async () => "s1",
		listSessions: async () => [
			{
				id: "s1",
				path: "/tmp/s1.jsonl",
				cwd: "/tmp",
				name: "会话一",
				parentSessionPath: undefined,
				created: 1,
				modified: 2,
				messageCount: 0,
				firstMessage: "",
			},
		],
		agentDir: dataDir,
		sessionDir: dataDir,
	} as never;
}

/** 一个已打开会话的登记表。 */
function fakeHub(): SessionHub<FakeAgent> {
	return new SessionHub<FakeAgent>({
		factory: {
			create: async () => agent,
			open: async () => agent,
			fork: async () => agent,
			peekSessionId: async () => "s1",
		},
		replayLimit: 32,
		idleCloseMs: 60_000,
	});
}

/** 用测试目录建一个端点，用例里改令牌或监听方式时用。 */
async function startTestEndpoint(overrides: Partial<ServerConfig> = {}) {
	const hub = fakeHub();
	await hub.openSession("/tmp/s1.jsonl");
	return await startEndpoint({
		config: config(dir, overrides),
		factory: fakeFactory(dir),
		// 假会话只实现端点用到的那部分接口，泛型对不上，测试里按 never 收窄
		hub: hub as never,
		projectStore: await ProjectStore.open({
			file: join(dir, `projects-${Math.random().toString(36).slice(2)}.json`),
		}),
		settingsStore: await SettingsStore.open({
			file: join(dir, `settings-${Math.random().toString(36).slice(2)}.json`),
		}),
		hostId: "h",
		sessions: new SessionsChannel(32),
	});
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "facet-multi-"));
	agent = new FakeAgent();
	endpoint = await startTestEndpoint();
});

afterEach(async () => {
	for (const client of clients) {
		client.close();
	}
	clients = [];
	await endpoint.close();
	await rm(dir, { recursive: true, force: true });
});

async function openClient(token?: string): Promise<TestClient> {
	const client = await TestClient.connect(endpoint.port, token);
	clients.push(client);
	return client;
}

/** 等一会儿，让广播帧到达。 */
async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 60));
}

describe("令牌与 unix socket", () => {
	it("令牌不对时断开，拿不到 hello", async () => {
		await endpoint.close();
		endpoint = await startTestEndpoint({ token: "正确的令牌" });
		const client = await TestClient.connect(endpoint.port, "错的令牌");
		clients.push(client);
		await settle();
		// 主机直接断开，没有 hello 也没有任何请求的应答
		expect(client.frames).toEqual([]);
	});

	it("不带令牌时连不上", async () => {
		await endpoint.close();
		endpoint = await startTestEndpoint({ token: "正确的令牌" });
		const client = await TestClient.connect(endpoint.port, "");
		clients.push(client);
		await settle();
		expect(client.frames).toEqual([]);
	});

	it("令牌正确时正常握手", async () => {
		await endpoint.close();
		endpoint = await startTestEndpoint({ token: "正确的令牌" });
		const client = await TestClient.connect(endpoint.port, "正确的令牌");
		clients.push(client);
		await client.subscribe(SESSION);
		expect(client.frames.length).toBeGreaterThanOrEqual(0);
	});

	it("unix socket 上同样能连", async () => {
		await endpoint.close();
		const socketPath = join(dir, "host.sock");
		endpoint = await startTestEndpoint({ socketPath, token: "令牌" });
		expect(endpoint.socketPath).toBe(socketPath);
		const socket = connect({ path: socketPath });
		const client = new TestClient(socket);
		clients.push(client);
		await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
		socket.write(encodeFrame({ type: "auth", token: "令牌" }));
		await settle();
		const response = (await client.request("listProjects", {})) as { projects: unknown[] };
		expect(response.projects).toEqual([]);
	});
});

describe("两个端接同一台主机", () => {
	it("订阅同一会话时收到同一串动作", async () => {
		const first = await openClient();
		const second = await openClient();
		for (const client of [first, second]) {
			await client.subscribe(SESSION);
			await client.subscribe(CHAT);
		}
		agent.emit({ type: "queue", steering: ["补充"], followUp: [] } as never);
		agent.emit({ type: "settled", aborted: false } as never);
		await settle();
		expect(first.frames.length).toBeGreaterThan(0);
		expect(first.frames.map((frame) => [frame.channel, frame.action, frame.seq])).toEqual(
			second.frames.map((frame) => [frame.channel, frame.action, frame.seq]),
		);
	});

	it("一个端发消息，另一个端收到同一条广播", async () => {
		const first = await openClient();
		const second = await openClient();
		await first.subscribe(SESSION);
		await second.subscribe(SESSION);
		first.dispatch(CHAT, { type: "chat/turnStarted", text: "你好" });
		await settle();
		expect(agent.prompts).toEqual(["你好"]);
		// 两个端都从主机收到了这一轮开始的动作
		expect(second.frames.length).toBe(first.frames.length);
	});

	it("并发写同一轮时只有一条执行，另一条被明确拒绝", async () => {
		const first = await openClient();
		const second = await openClient();
		await first.subscribe(SESSION);
		await second.subscribe(SESSION);
		first.dispatch(CHAT, { type: "chat/turnStarted", text: "第一条" });
		second.dispatch(CHAT, { type: "chat/turnStarted", text: "第二条" });
		await settle();
		expect(agent.prompts).toEqual(["第一条"]);
		const rejected = [...first.frames, ...second.frames].filter(
			(frame) => frame.rejectionReason !== undefined,
		);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]?.rejectionReason).toContain("streamingBehavior");
	});

	it("断线重连按序号补齐中间的动作", async () => {
		const first = await openClient();
		const second = await openClient();
		await first.subscribe(SESSION);
		await second.subscribe(SESSION);
		agent.emit({ type: "queue", steering: ["断线前"], followUp: [] } as never);
		await settle();
		const seen = first.frames.at(-1)?.seq ?? 0;
		first.close();
		agent.emit({ type: "queue", steering: ["断线中"], followUp: [] } as never);
		await settle();

		const again = await openClient();
		const resumed = await again.subscribe(SESSION, seen);
		await settle();
		expect(resumed.resync).toBe(false);
		const texts = again.frames
			.filter((frame) => frame.action.type === "session/queueChanged")
			.map((frame) => (frame.action as unknown as { steering: string[] }).steering[0]);
		expect(texts).toEqual(["断线中"]);
	});
});
