/**
 * 远程连接的权限档与审计。
 *
 * 本机监听给管理档，远程监听按配置给操作档或只读档：只读档不能改会话与文件，远程连接
 * 无论哪档都碰不到设置、凭证、项目增删与结束主机；远程的写操作进审计文件。
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Channel, encodeFrame, FrameDecoder, makeChannel } from "@facet/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "./audit.ts";
import type { ServerConfig } from "./config.ts";
import { startEndpoint } from "./endpoint.ts";
import { ProjectStore } from "./project-store.ts";
import { SessionHub } from "./session-hub.ts";
import { SessionsChannel } from "./sessions-channel.ts";
import { SettingsStore } from "./settings-store.ts";

const SESSION = makeChannel("session", "s1") as Channel;

/** 一条测试连接：按行发帧、收响应与动作。 */
class Peer {
	private readonly socket: Socket;
	private readonly decoder = new FrameDecoder();
	private seq = 0;
	private buffer: { id?: string; frame: Record<string, unknown> }[] = [];
	private readonly waiters: (() => void)[] = [];

	constructor(socket: Socket) {
		this.socket = socket;
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			for (const line of this.decoder.push(chunk)) {
				this.buffer.push({ frame: JSON.parse(line) as Record<string, unknown> });
				for (const waiter of this.waiters.splice(0)) {
					waiter();
				}
			}
		});
	}

	static async connect(
		path: string,
		token: string,
		role?: "operator" | "viewer",
		entry?: "desktop" | "web",
	): Promise<Peer> {
		const socket = connect({ path });
		await new Promise<void>((resolve, reject) => {
			socket.once("connect", () => resolve());
			socket.once("error", reject);
		});
		const peer = new Peer(socket);
		socket.write(
			encodeFrame({
				type: "auth",
				token,
				...(role === undefined ? {} : { role }),
				...(entry === undefined ? {} : { entry }),
			}),
		);
		return peer;
	}

	/** 等到下一条满足条件的帧。 */
	private async waitFor<T>(match: (frame: Record<string, unknown>) => boolean): Promise<T> {
		for (;;) {
			const index = this.buffer.findIndex((item) => match(item.frame));
			if (index >= 0) {
				const [item] = this.buffer.splice(index, 1);
				return item?.frame as T;
			}
			await new Promise<void>((resolve) => {
				this.waiters.push(resolve);
				setTimeout(resolve, 500);
			});
		}
	}

	/** 发一个请求，取回响应里的 ok 与错误说明。 */
	async request(method: string, params: unknown = {}): Promise<{ ok: boolean; message?: string }> {
		this.seq += 1;
		const id = `r${this.seq}`;
		this.socket.write(encodeFrame({ type: "request", id, method, params } as never));
		const frame = await this.waitFor<{ ok: boolean; error?: { message: string } }>(
			(item) => item.type === "response" && item.id === id,
		);
		return { ok: frame.ok, ...(frame.error === undefined ? {} : { message: frame.error.message }) };
	}

	/** 拿握手结果里的权限档与能力。 */
	async hello(): Promise<{ role: string; canManage: boolean; capabilities: string[] }> {
		return await this.waitFor<{ role: string; canManage: boolean; capabilities: string[] }>(
			(item) => item.type === "hello",
		);
	}

	/** 派发一条动作，返回拒绝原因（被接受时为空）。 */
	async dispatch(channel: Channel, action: unknown): Promise<string | undefined> {
		this.socket.write(encodeFrame({ type: "dispatch", channel, action } as never));
		const frame = await this.waitFor<{ rejectionReason?: string }>(
			(item) => item.type === "action" && typeof item.rejectionReason === "string",
		);
		return frame.rejectionReason;
	}

	close(): void {
		this.socket.destroy();
	}
}

let dir: string;
let peerList: Peer[] = [];
let endpoint: Awaited<ReturnType<typeof startEndpoint>>;

function config(dataDir: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
	return {
		host: "127.0.0.1",
		port: 0,
		socketPath: undefined,
		token: "令牌",
		agentDir: dataDir,
		sessionDir: undefined,
		dataDir,
		remotePermission: "view",
		webPort: undefined,
		webRoot: undefined,
		replayLimit: 32,
		sessionIdleMs: 60_000,
		hostName: "主机",
		debug: false,
		...overrides,
	};
}

/** 起一台只监听一个 unix socket 的主机；档位由认证帧声明，主机按配置收窄。 */
async function start(overrides: Partial<ServerConfig> = {}): Promise<void> {
	const hub = new SessionHub({
		factory: {
			create: async () => {
				throw new Error("本用例不建会话");
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
	const settingsStore = await SettingsStore.open({ file: join(dir, "settings.json") });
	endpoint = await startEndpoint({
		config: config(dir, overrides),
		factory: {
			listSessions: async () => [],
			agentDir: dir,
			sessionDir: dir,
		} as never,
		hub: hub as never,
		projectStore: await ProjectStore.open({ file: join(dir, "projects.json") }),
		settingsStore,
		hostId: "h",
		sessions: new SessionsChannel(32),
		audit: new AuditLog(join(dir, "audit.log")),
	});
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "facet-perm-"));
});

afterEach(async () => {
	for (const peer of peerList) {
		peer.close();
	}
	peerList = [];
	await endpoint.close().catch(() => undefined);
	// socket 文件随监听一起消失，目录里可能还有审计文件，稍等一下再删
	await new Promise((resolve) => setTimeout(resolve, 100));
	await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("权限档", () => {
	it("本机连接是管理档，只读档拿不到管理操作", async () => {
		await start({ socketPath: join(dir, "local.sock") });
		const local = await Peer.connect(join(dir, "local.sock"), "令牌");
		const readOnly = await Peer.connect(join(dir, "local.sock"), "令牌", "viewer");
		peerList.push(local, readOnly);
		const localHello = await local.hello();
		expect(localHello.role).toBe("admin");
		expect(localHello.canManage).toBe(true);
		const readOnlyHello = await readOnly.hello();
		expect(readOnlyHello.role).toBe("viewer");
		expect(readOnlyHello.canManage).toBe(false);
		expect(await readOnly.request("getSettings")).toEqual({ ok: true, message: undefined });
		expect((await readOnly.request("updateSettings", { settings: {} })).ok).toBe(false);
		expect((await readOnly.request("deleteCredential", { providerId: "x" })).message).toBe(
			"这个操作只在桌面端可用",
		);
	});

	it("只读档不能建会话、写文件，也不能派发动作", async () => {
		await start({ socketPath: join(dir, "local.sock") });
		const remote = await Peer.connect(join(dir, "local.sock"), "令牌", "viewer");
		peerList.push(remote);
		expect((await remote.request("createSession", { cwd: dir })).message).toBe("这条连接是只读的");
		expect(
			(await remote.request("writeFile", { cwd: dir, path: "a", content: "", expectedRevision: "" })).ok,
		).toBe(false);
		expect(await remote.dispatch(SESSION, { type: "chat/turnStarted", text: "你好" })).toBe(
			"这条连接是只读的",
		);
	});

	it("桌面入口的操作档能改设置，浏览器入口同一档位被拒", async () => {
		await start({ socketPath: join(dir, "local.sock"), remotePermission: "operate" });
		// 声明操作档，主机的配置是 operate，所以给操作档；入口决定能不能碰主机配置
		const ssh = await Peer.connect(join(dir, "local.sock"), "令牌", "operator", "desktop");
		const browser = await Peer.connect(join(dir, "local.sock"), "令牌", "operator", "web");
		peerList.push(ssh, browser);
		const sshHello = await ssh.hello();
		expect(sshHello.role).toBe("operator");
		expect(sshHello.canManage).toBe(true);
		expect((await ssh.request("updateSettings", { settings: {} })).ok).toBe(true);
		const browserHello = await browser.hello();
		expect(browserHello.role).toBe("operator");
		expect(browserHello.canManage).toBe(false);
		expect((await browser.request("updateSettings", { settings: {} })).message).toBe(
			"这个操作只在桌面端可用",
		);
		expect((await browser.request("diagnostics")).ok).toBe(false);
	});

	it("浏览器入口的只读档改不了会话，桌面入口的操作档可以", async () => {
		await start({ socketPath: join(dir, "local.sock"), remotePermission: "operate" });
		const browser = await Peer.connect(join(dir, "local.sock"), "令牌", "viewer", "web");
		peerList.push(browser);
		expect((await browser.request("createSession", { cwd: dir })).message).toBe("这条连接是只读的");
	});
});

describe("终端的权限", () => {
	it("只读档能列终端，开终端与打字都拒绝", async () => {
		await start({ socketPath: join(dir, "local.sock") });
		const remote = await Peer.connect(join(dir, "local.sock"), "令牌", "viewer");
		peerList.push(remote);
		expect((await remote.hello()).role).toBe("viewer");
		expect((await remote.request("listTerminals")).ok).toBe(true);
		expect((await remote.request("createTerminal", { cwd: dir, cols: 80, rows: 24 })).message).toBe(
			"这条连接是只读的",
		);
		expect((await remote.request("writeTerminal", { id: "x", data: "ls\r" })).message).toBe(
			"这条连接是只读的",
		);
		expect((await remote.request("resizeTerminal", { id: "x", cols: 100, rows: 30 })).message).toBe(
			"这条连接是只读的",
		);
		expect((await remote.request("killTerminal", { id: "x" })).ok).toBe(false);
	});

	it("没有 pty 后端的主机在握手里不报终端能力，开终端时说明原因", async () => {
		await start({ socketPath: join(dir, "local.sock") });
		const local = await Peer.connect(join(dir, "local.sock"), "令牌");
		peerList.push(local);
		const hello = await local.hello();
		expect(hello.capabilities).toContain("dispatch");
		expect(hello.capabilities).not.toContain("terminal");
		const result = await local.request("createTerminal", { cwd: dir, cols: 80, rows: 24 });
		expect(result.ok).toBe(false);
		expect(result.message).toBe("这台主机没有装配终端");
	});
});

describe("远程操作审计", () => {
	it("远程的写操作进审计文件，本机的不记", async () => {
		await start({ socketPath: join(dir, "local.sock") });
		const local = await Peer.connect(join(dir, "local.sock"), "令牌");
		const remote = await Peer.connect(join(dir, "local.sock"), "令牌", "viewer");
		peerList.push(local, remote);
		await local.request("getSettings");
		await remote.request("createSession", { cwd: dir });
		await remote.request("getSettings");
		await new Promise((resolve) => setTimeout(resolve, 100));
		const lines = (await readFile(join(dir, "audit.log"), "utf8"))
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as { role: string; name: string; ok: boolean; reason?: string });
		expect(lines.map((line) => line.name)).toEqual(["createSession"]);
		expect(lines[0]).toMatchObject({ role: "viewer", ok: false, reason: "这条连接是只读的" });
	});
});
