/**
 * 协议一致性冒烟检查。
 *
 * 起一个真实假主机（`index.ts --check`），用 `@facet/protocol` 自己的编码器与解码器走一遍
 * 界面启动时会发的那串帧：握手、清单与快照的读取、三条通道的订阅、一次发送与一次停止。
 * 只要客户端侧有一帧不合契约，假主机就会记一条违规并以非零码退出，这里再把它转成非零退出。
 *
 * 假主机本身是长驻服务，`--check` 只负责记账；这个脚本负责喂帧、收尾并给出结论。
 */

import { spawn } from "node:child_process";
import { connect, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientFrame, RequestMethod } from "@facet/protocol";
import { encodeFrame, FrameDecoder, PROTOCOL_VERSION } from "@facet/protocol";

/** 整轮冒烟的时限，超时就当失败。 */
const TIMEOUT_MS = 30_000;

const here = dirname(fileURLToPath(import.meta.url));

/** 假主机打出的一行 ready，端口由系统分配。 */
interface Ready {
	endpoint: number;
	control: number;
}

/** 收到的响应。 */
interface Response {
	type: "response";
	id: string;
	ok: boolean;
	data?: unknown;
	error?: { code: string; message: string };
}

/** 收到的动作帧。 */
interface Action {
	type: "action";
	channel: string;
	action: { type: string; [key: string]: unknown };
	serverSeq: number;
	origin?: { clientId: string; clientSeq: number };
	rejectionReason?: string;
}

/** 握手帧里冒烟要用的部分。 */
interface Hello {
	protocolVersion: number;
	hostId: string;
}

/** 一个最小的线格式客户端：发帧、收帧、按 id 等响应。 */
class WireClient {
	readonly responses = new Map<string, Response>();
	readonly actions: Action[] = [];
	private readonly decoder = new FrameDecoder();
	private readonly waiters = new Map<string, (response: Response) => void>();
	/** 握手帧到达时兑现；只到一次 */
	private helloResolve: ((hello: Hello) => void) | undefined;
	private helloFrame: Hello | undefined;
	private nextId = 1;
	/** 底层连接 */
	private readonly socket: Socket;

	constructor(socket: Socket) {
		this.socket = socket;
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			for (const line of this.decoder.push(chunk)) {
				const frame: unknown = JSON.parse(line);
				if (!isRecord(frame)) {
					continue;
				}
				if (frame.type === "response" && typeof frame.id === "string") {
					const response: Response = {
						type: "response",
						id: frame.id,
						ok: frame.ok === true,
						data: frame.data,
						error: isRecord(frame.error) ? asError(frame.error) : undefined,
					};
					this.responses.set(response.id, response);
					this.waiters.get(response.id)?.(response);
					continue;
				}
				if (frame.type === "action" && isRecord(frame.action) && typeof frame.action.type === "string") {
					this.actions.push({
						type: "action",
						channel: typeof frame.channel === "string" ? frame.channel : "",
						action: { ...frame.action, type: frame.action.type },
						serverSeq: typeof frame.serverSeq === "number" ? frame.serverSeq : 0,
						origin: isRecord(frame.origin) ? asOrigin(frame.origin) : undefined,
						rejectionReason: typeof frame.rejectionReason === "string" ? frame.rejectionReason : undefined,
					});
					continue;
				}
				if (frame.type === "hello") {
					const hello: Hello = {
						protocolVersion: typeof frame.protocolVersion === "number" ? frame.protocolVersion : 0,
						hostId: typeof frame.hostId === "string" ? frame.hostId : "",
					};
					this.helloFrame = hello;
					this.helloResolve?.(hello);
				}
			}
		});
	}

	/** 发一帧。 */
	send(frame: ClientFrame): void {
		this.socket.write(encodeFrame(frame));
	}

	/** 发一条请求并等它的响应。 */
	async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
		const id = `r${this.nextId}`;
		this.nextId += 1;
		const arrived = new Promise<Response>((resolve) => this.waiters.set(id, resolve));
		this.send({ type: "request", id, method: method as RequestMethod, params });
		const response = await arrived;
		if (!response.ok) {
			throw new Error(`${method} 被拒: ${response.error?.code ?? ""} ${response.error?.message ?? ""}`);
		}
		return response.data;
	}

	/** 等握手帧。 */
	async hello(): Promise<Hello> {
		if (this.helloFrame !== undefined) {
			return this.helloFrame;
		}
		return new Promise<Hello>((resolve) => {
			this.helloResolve = resolve;
		});
	}

	/** 等一帧满足条件的动作。 */
	async actionMatching(match: (action: Action) => boolean): Promise<Action> {
		const deadline = Date.now() + 5_000;
		for (;;) {
			const found = this.actions.find(match);
			if (found !== undefined) {
				return found;
			}
			if (Date.now() > deadline) {
				throw new Error("等不到约定的动作帧");
			}
			await sleep(20);
		}
	}
}

/** 是不是一个普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 响应里的错误详情。 */
function asError(value: Record<string, unknown>): { code: string; message: string } {
	return {
		code: typeof value.code === "string" ? value.code : "",
		message: typeof value.message === "string" ? value.message : "",
	};
}

/** 动作来源。 */
function asOrigin(value: Record<string, unknown>): { clientId: string; clientSeq: number } {
	return {
		clientId: typeof value.clientId === "string" ? value.clientId : "",
		clientSeq: typeof value.clientSeq === "number" ? value.clientSeq : 0,
	};
}

/** 清单里第一个会话的文件路径。 */
function firstSessionPath(data: unknown): string | undefined {
	if (!isRecord(data) || !Array.isArray(data.sessions)) {
		return undefined;
	}
	const first: unknown = data.sessions[0];
	if (!isRecord(first) || !isRecord(first.summary)) {
		return undefined;
	}
	const path = first.summary.path;
	return typeof path === "string" ? path : undefined;
}

/** 快照里的会话标识。 */
function sessionIdOf(data: unknown): string | undefined {
	if (!isRecord(data)) {
		return undefined;
	}
	const id = data.id;
	return typeof id === "string" ? id : undefined;
}

/** 等一会儿。 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 起假主机，等它打出 ready。 */
function startHost(): Promise<{ child: ReturnType<typeof spawn>; ready: Ready; log: () => string }> {
	const child = spawn(
		process.execPath,
		[join(here, "index.ts"), "--check", "--port", "0", "--control", "0", "--sessions", "2", "--turns", "2"],
		{ cwd: join(here, "..", ".."), stdio: ["ignore", "pipe", "pipe"] },
	);
	let output = "";
	const log = (): string => output;
	const ready = new Promise<Ready>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`假主机没有就绪:\n${output}`)), 10_000);
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			output += chunk;
			const matched = /\[mock\] ready endpoint=127\.0\.0\.1:(\d+) control=127\.0\.0\.1:(\d+)/.exec(output);
			if (matched?.[1] !== undefined && matched[2] !== undefined) {
				clearTimeout(timer);
				resolve({ endpoint: Number(matched[1]), control: Number(matched[2]) });
			}
		});
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			output += chunk;
		});
		child.once("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`假主机提前退出，code=${String(code)}\n${output}`));
		});
	});
	return ready.then((value) => ({ child, ready: value, log }));
}

/** 连上协议口。 */
function open(endpoint: number): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const socket = connect(endpoint, "127.0.0.1");
		socket.once("connect", () => resolve(socket));
		socket.once("error", reject);
	});
}

/** 走完整轮冒烟。 */
async function smoke(endpoint: number): Promise<void> {
	const socket = await open(endpoint);
	const client = new WireClient(socket);
	try {
		client.send({ type: "auth", token: "mock" });
		const hello = await client.hello();
		if (hello.protocolVersion !== PROTOCOL_VERSION) {
			throw new Error(`握手版本不对: ${hello.protocolVersion} 期望 ${PROTOCOL_VERSION}`);
		}

		const file = firstSessionPath(await client.request("listSessions"));
		if (file === undefined) {
			throw new Error("假主机的会话清单是空的");
		}
		await client.request("listProjects");
		await client.request("listCommands", { sessionId: "mock-session-0" });
		await client.request("getSettings");
		await client.request("availableModels");
		await client.request("busySessions");
		await client.request("listTerminals");
		await client.request("gitStatus", { cwd: "/mock/project" });
		await client.request("subscribe", { channel: `sessions:/${hello.hostId}` });

		const sessionId = sessionIdOf(await client.request("openSession", { sessionFile: file }));
		if (sessionId === undefined) {
			throw new Error("openSession 没有给出会话标识");
		}
		await client.request("subscribe", { channel: `session:/${sessionId}` });
		await client.request("entries", { sessionId, limit: 3 });
		await client.request("entriesAfter", { sessionId, cursor: null });
		await client.request("subscribe", { channel: `chat:/${sessionId}` });

		// 一次发送：回执带 origin.clientSeq，随后的动作按通道递增
		client.send({
			type: "dispatch",
			channel: `chat:/${sessionId}`,
			clientSeq: 1,
			action: { type: "chat/turnStarted", text: "冒烟", streamingBehavior: undefined },
		});
		const receipt = await client.actionMatching(
			(action) => action.action.type === "chat/inputHandled" && action.origin?.clientSeq === 1,
		);
		const chatSeqs = client.actions
			.filter((action) => action.channel === receipt.channel)
			.map((action) => action.serverSeq);
		for (let index = 1; index < chatSeqs.length; index += 1) {
			const previous = chatSeqs[index - 1] ?? 0;
			const current = chatSeqs[index] ?? 0;
			if (current <= previous) {
				throw new Error(`通道序号没有递增: ${previous} -> ${current}`);
			}
		}
		if (client.actions.some((action) => action.rejectionReason !== undefined)) {
			throw new Error("出现拒绝帧：这条动作本应被接受");
		}

		client.send({
			type: "dispatch",
			channel: `chat:/${sessionId}`,
			clientSeq: 2,
			action: { type: "chat/turnCancelled" },
		});
		await client.actionMatching((action) => action.action.type === "chat/settled");
		await client.request("unsubscribe", { channel: `chat:/${sessionId}` });
	} finally {
		socket.end();
	}
}

const host = await startHost();
let failure: string | undefined;
try {
	await Promise.race([
		smoke(host.ready.endpoint),
		sleep(TIMEOUT_MS).then(() => {
			throw new Error(`冒烟超过 ${TIMEOUT_MS}ms 没有走完`);
		}),
	]);
} catch (error) {
	failure = error instanceof Error ? error.message : String(error);
}

const exited = new Promise<number>((resolve) => {
	host.child.once("exit", (code) => resolve(code ?? 1));
});
host.child.kill("SIGTERM");
const code = await exited;
const output = host.log();

if (failure !== undefined) {
	console.error(`[check] 冒烟失败: ${failure}`);
	process.exitCode = 1;
} else if (code !== 0) {
	console.error(`[check] 假主机以 ${code} 退出:\n${output}`);
	process.exitCode = 1;
} else if (!output.includes("[mock][检查] 没有发现协议违规")) {
	console.error(`[check] 没有看到假主机的检查结论:\n${output}`);
	process.exitCode = 1;
} else {
	console.log("[check] 冒烟通过：握手、读取、订阅、发送与停止都没有违规");
}
