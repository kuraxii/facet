/**
 * 假主机上的混沌验证。
 *
 * 起一个真实 `mock-server` 子进程（端口传 0，由系统分配），用真实 `SessionClient` 通过
 * `StreamTransport` 连上去，再用控制口注入故障，验证客户端在异常时序下的行为。这里不造
 * 假的传输层，走的就是桌面端那条握手、订阅、动作归约、历史重载的完整路径。
 */
import { type ChildProcess, spawn } from "node:child_process";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionClient } from "@facet/client-core";
import type { ActionFrame, Channel } from "@facet/protocol";
import { StreamTransport } from "@facet/transport";
import { afterEach, describe, expect, it } from "vitest";

const mockPath = join(dirname(fileURLToPath(import.meta.url)), "../../../../tools/mock-server/index.ts");

/** 一条跑着的假主机。 */
interface MockHost {
	readonly endpoint: number;
	readonly control: number;
	readonly child: ChildProcess;
}

/** 一条连上的客户端，`close` 负责拆干净。 */
interface Peer {
	readonly client: SessionClient;
	/** 客户端发过的请求方法，按顺序 */
	readonly requested: string[];
	/** 主机推来的动作帧，按到达顺序 */
	readonly actions: ActionFrame[];
	close(): void;
}

const running: MockHost[] = [];
const peers: Peer[] = [];

/** 起一个假主机，等它打出 ready 行拿实际端口。 */
async function startMock(): Promise<MockHost> {
	const child = spawn(
		process.execPath,
		[mockPath, "--port", "0", "--control", "0", "--sessions", "2", "--turns", "2", "--stream-seconds", "1"],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	const ports = await new Promise<{ endpoint: number; control: number }>((resolve, reject) => {
		let output = "";
		const timer = setTimeout(() => reject(new Error(`假主机没起来：${output}`)), 10_000);
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			output += chunk;
			const matched = /ready endpoint=127\.0\.0\.1:(\d+) control=127\.0\.0\.1:(\d+)/.exec(output);
			if (matched?.[1] !== undefined && matched[2] !== undefined) {
				clearTimeout(timer);
				resolve({ endpoint: Number(matched[1]), control: Number(matched[2]) });
			}
		});
		child.once("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`假主机退出，code=${code}`));
		});
	});
	const host = { ...ports, child };
	running.push(host);
	return host;
}

/** 往控制口装一个故障，命中一次即清。 */
async function armFault(host: MockHost, fault: Record<string, unknown>): Promise<void> {
	await fetch(`http://127.0.0.1:${host.control}`, { method: "POST", body: JSON.stringify({ fault }) });
}

/** 用真实字节流传输连上假主机，并记下客户端发过哪些请求方法。 */
async function connect(host: MockHost): Promise<Peer> {
	const transport = new StreamTransport({
		token: "",
		createStream: async () => {
			const socket = net.connect({ port: host.endpoint, host: "127.0.0.1" });
			socket.setEncoding("utf8");
			await new Promise<void>((resolve, reject) => {
				socket.once("connect", resolve);
				socket.once("error", reject);
			});
			const dataListeners = new Set<(chunk: string) => void>();
			const closeListeners = new Set<(reason: string) => void>();
			socket.on("data", (chunk: string) => {
				for (const listener of [...dataListeners]) listener(chunk);
			});
			socket.on("close", () => {
				for (const listener of [...closeListeners]) listener("closed");
			});
			socket.on("error", () => {
				for (const listener of [...closeListeners]) listener("error");
			});
			return {
				write: (text: string) => socket.write(text),
				onData: (listener) => {
					dataListeners.add(listener);
					return () => dataListeners.delete(listener);
				},
				onClose: (listener) => {
					closeListeners.add(listener);
					return () => closeListeners.delete(listener);
				},
				close: () => socket.destroy(),
			};
		},
	});
	const handshake = await transport.connect();
	const client = new SessionClient({ transport });
	client.attach(handshake);
	const requested: string[] = [];
	const original = transport.request.bind(transport) as unknown as (
		method: string,
		params: unknown,
	) => unknown;
	(transport as { request: unknown }).request = (method: string, params: unknown) => {
		requested.push(method);
		return original(method, params);
	};
	const actions: ActionFrame[] = [];
	const stopActions = transport.onAction((frame) => actions.push(frame));
	const peer = {
		client,
		requested,
		actions,
		close: () => {
			stopActions();
			client.dispose();
		},
	};
	peers.push(peer);
	return peer;
}

/** 等到条件成立，超时就失败；假主机的推送有间隔，只能轮询。 */
async function until(check: () => boolean, timeoutMs = 4000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (check()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("等待超时");
}

/** 一个会话的视图里的条目标识，用来查重复。 */
function itemIds(client: SessionClient, channel: Channel): string[] {
	return (client.store.chatView(channel)?.items ?? []).map((item) => item.id);
}

afterEach(async () => {
	for (const peer of peers.splice(0)) {
		peer.close();
	}
	for (const host of running.splice(0)) {
		// 假主机的两个监听口本来就只为这条用例开着，直接收掉，不等它自己退
		host.child.kill("SIGKILL");
	}
});

describe("假主机上的混沌时序", () => {
	it("迟到的回执仍然核销到发起它的会话，另一个会话不受影响", async () => {
		const host = await startMock();
		const { client } = await connect(host);
		const sessions = await client.listSessions();
		const first = sessions[0]?.summary.path;
		const second = sessions[1]?.summary.path;
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		if (first === undefined || second === undefined) {
			return;
		}

		const firstSession = await client.openSession(first);
		const firstChat = firstSession.chatChannel;
		await armFault(host, { kind: "late-receipt", ms: 120 });
		const sent: string[] = [];
		client.onSent((text) => sent.push(text));
		const clientSeq = client.send("跨会话的一条");
		expect(clientSeq).toBeGreaterThan(0);

		// 回执还没回来就切走：确认必须记回发起它的那个会话
		const secondSession = await client.switchSession(second);
		expect(client.chatView()?.channel).toBe(secondSession.chatChannel);

		const secondBefore = itemIds(client, secondSession.chatChannel);
		await until(() => sent.length > 0);
		expect(sent).toEqual(["跨会话的一条"]);

		// 另一个会话的视图一条不多一条不少：确认没有串到它身上
		expect(itemIds(client, secondSession.chatChannel)).toEqual(secondBefore);
		// 原会话照样收到了这一轮的流式动作
		await until(() => itemIds(client, firstChat).length > 0);
	});

	it("同一条回执投递两次只确认一次", async () => {
		const host = await startMock();
		const { client, actions } = await connect(host);
		const sessions = await client.listSessions();
		const file = sessions[0]?.summary.path;
		expect(file).toBeDefined();
		if (file === undefined) {
			return;
		}
		await client.openSession(file);
		const sent: string[] = [];
		client.onSent((text) => sent.push(text));

		await armFault(host, { kind: "dup-receipt" });
		client.send("只确认一次");
		// 故障真的生效：同一条 clientSeq 的回执到过两次
		await until(() => actions.filter((frame) => frame.action.type === "chat/inputHandled").length === 2);
		// 但只确认一次：第二条到了也不该再通知一遍
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(sent).toEqual(["只确认一次"]);
	});

	it("被拒绝的那条精确作废，草稿留在输入框，后续发送照常确认", async () => {
		const host = await startMock();
		const { client, actions } = await connect(host);
		const sessions = await client.listSessions();
		const file = sessions[0]?.summary.path;
		expect(file).toBeDefined();
		if (file === undefined) {
			return;
		}
		const opened = await client.openSession(file);
		const sent: string[] = [];
		client.onSent((text) => sent.push(text));

		await armFault(host, { kind: "reject", reason: "假主机不干" });
		client.send("会被拒的一条");
		// 拒绝帧不进序号流，只落一条错误提示
		await until(() =>
			(client.store.chatView(opened.chatChannel)?.notices ?? []).some((notice) =>
				notice.message.includes("假主机不干"),
			),
		);
		expect(actions.some((frame) => frame.rejectionReason === "假主机不干")).toBe(true);
		expect(sent).toEqual([]);

		// 被拒的那条已经作废：后面这条的流式消息不会把它误认成已发送
		client.send("后面这条能过");
		await until(() => sent.length > 0);
		expect(sent).toEqual(["后面这条能过"]);
	});

	it("序号跳变上报缺口，重取历史之后视图无重复条目", async () => {
		const host = await startMock();
		const { client, requested } = await connect(host);
		const sessions = await client.listSessions();
		const file = sessions[0]?.summary.path;
		expect(file).toBeDefined();
		if (file === undefined) {
			return;
		}

		const opened = await client.openSession(file);
		const gaps: { expected: number; received: number }[] = [];
		client.store.onGap((gap) => gaps.push({ expected: gap.expected, received: gap.received }));

		// 先收一帧建立基线：第一帧之前没有期望序号，跳号无从判断
		client.send("先打个基线");
		await until(() => client.store.lastSeq(opened.chatChannel) > 0);
		const beforeRequests = requested.length;
		await armFault(host, { kind: "gap" });
		client.send("触发一次推送");
		await until(() => gaps.length > 0);
		// 跳号：收到的比期望的大
		expect(gaps[0]?.received).toBeGreaterThan(gaps[0]?.expected ?? 0);

		// 缺口之后客户端会重新取一次历史
		await until(() => requested.slice(beforeRequests).includes("entries"));
		await until(() => itemIds(client, opened.chatChannel).length > 0);

		const ids = itemIds(client, opened.chatChannel);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("相邻帧倒序到达也按缺口处理并对齐", async () => {
		const host = await startMock();
		const { client, requested } = await connect(host);
		const sessions = await client.listSessions();
		const file = sessions[0]?.summary.path;
		expect(file).toBeDefined();
		if (file === undefined) {
			return;
		}

		const opened = await client.openSession(file);
		const gaps: { expected: number; received: number }[] = [];
		client.store.onGap((gap) => gaps.push({ expected: gap.expected, received: gap.received }));

		client.send("先打个基线");
		await until(() => client.store.lastSeq(opened.chatChannel) > 0);
		const beforeRequests = requested.length;
		await armFault(host, { kind: "out-of-order" });
		client.send("再看一次倒序");
		await until(() => gaps.length > 0);
		expect(gaps[0]?.received).toBeGreaterThan(gaps[0]?.expected ?? 0);

		await until(() => requested.slice(beforeRequests).includes("entries"));
		await until(() => itemIds(client, opened.chatChannel).length > 0);
		const ids = itemIds(client, opened.chatChannel);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
