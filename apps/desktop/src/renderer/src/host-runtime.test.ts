/**
 * 每台主机一套的运行时。
 *
 * 这里只验两件事：同一台主机拿到的永远是同一套运行时；两台主机之间状态、通道与释放
 * 互不影响。协议本身用一条假字节流跑：收到 auth 就回 hello，之后按方法名回一个最小应答。
 */
import { DEFAULT_SETTINGS } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import type { HostChannelBridge } from "./host-connection.ts";
import { HostRuntimeRegistry } from "./host-runtime.ts";

/** 一条假字节流：把写进来的帧按行切开，交给回包函数。 */
interface FakeChannel {
	write(text: string): void;
	close(): void;
}

/** 假主机：按方法名回一个最小应答，够客户端把握手与初始读取跑完。 */
function makeBridge(): HostChannelBridge & { readonly opened: string[] } {
	const opened: string[] = [];
	return {
		opened,
		getLocalHost: async () => ({ target: "local", address: "/tmp/facet.sock", token: "t" }),
		onLocalHostChanged: () => () => undefined,
		openHostChannel: async (target, handlers) => {
			opened.push(target);
			let buffer = "";
			let answered = false;
			const channel: FakeChannel = {
				write: (text) => {
					buffer += text;
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const line of lines) {
						if (line.length === 0) {
							continue;
						}
						const frame = JSON.parse(line) as { type: string; id?: string; method?: string };
						if (frame.type === "auth" && !answered) {
							answered = true;
							handlers.onData(`${JSON.stringify({ type: "hello", hostId: `h-${target}`, ...hello() })}\n`);
							continue;
						}
						if (frame.type === "request" && frame.id !== undefined) {
							handlers.onData(
								`${JSON.stringify({
									type: "response",
									id: frame.id,
									ok: true,
									data: replyFor(frame.method ?? ""),
								})}\n`,
							);
						}
					}
				},
				close: () => undefined,
			};
			return {
				ok: true,
				id: opened.length,
				token: "t",
				role: "operator" as const,
				entry: "desktop" as const,
				write: (text: string) => channel.write(text),
				close: () => channel.close(),
			};
		},
	};
}

/** hello 帧里与协议版本有关的那几项。 */
function hello() {
	return {
		protocolVersion: 1,
		hostName: "主机",
		clientId: "c1",
		role: "operator" as const,
		canManage: true,
		capabilities: [] as const,
		agentDir: "/tmp",
	};
}

/** 按方法名给一个够用的应答。 */
function replyFor(method: string): unknown {
	switch (method) {
		case "getSettings":
			return { settings: DEFAULT_SETTINGS };
		case "availableModels":
			return { models: [] };
		case "providers":
			return { providers: [] };
		case "subscribe":
			return { seq: 0, resync: false };
		default:
			return {};
	}
}

describe("HostRuntimeRegistry", () => {
	it("同一台主机只有一套运行时，换端点换成另一套", () => {
		const bridge = makeBridge();
		const registry = new HostRuntimeRegistry();
		const local = registry.ensure({ bridge, endpoint: "local", isLocal: true });
		expect(registry.ensure({ bridge, endpoint: "local", isLocal: true })).toBe(local);
		const remote = registry.ensure({ bridge, endpoint: "ssh://me@box", isLocal: false });
		expect(remote).not.toBe(local);
		expect(remote.client).not.toBe(local.client);
		expect(remote.transport).not.toBe(local.transport);
		expect(registry.endpoints()).toEqual(["local", "ssh://me@box"]);
	});

	it("两台主机的连接与状态互不影响，断开一台不动另一台", async () => {
		const bridge = makeBridge();
		const registry = new HostRuntimeRegistry();
		const local = registry.ensure({ bridge, endpoint: "local", isLocal: true });
		const remote = registry.ensure({ bridge, endpoint: "ssh://me@box", isLocal: false });

		await Promise.all([local.connect(), remote.connect()]);
		expect(local.getSnapshot().phase).toBe("ready");
		expect(remote.getSnapshot().phase).toBe("ready");
		// 各连各的通道，握手结果是各自那台主机的
		expect(bridge.opened).toEqual(["local", "ssh://me@box"]);
		expect(local.getSnapshot().handshake?.hostId).toBe("h-local");
		expect(remote.getSnapshot().handshake?.hostId).toBe("h-ssh://me@box");

		await registry.dispose("ssh://me@box");
		// 断开的那台从表里消失、客户端状态清空；另一台照旧
		expect(registry.get("ssh://me@box")).toBeUndefined();
		expect(remote.client.host).toBeUndefined();
		expect(local.getSnapshot().phase).toBe("ready");
		expect(local.client.host?.hostId).toBe("h-local");
		expect(registry.endpoints()).toEqual(["local"]);
	});

	it("断开的运行时可以重新建一个，旧实例不再改状态", async () => {
		const bridge = makeBridge();
		const registry = new HostRuntimeRegistry();
		const first = registry.ensure({ bridge, endpoint: "local", isLocal: true });
		await first.connect();
		await registry.dispose("local");

		const second = registry.ensure({ bridge, endpoint: "local", isLocal: true });
		expect(second).not.toBe(first);
		await second.connect();
		expect(second.getSnapshot().phase).toBe("ready");
		// 旧的那份已经放开，重新连也不会再上状态
		await first.connect();
		expect(first.getSnapshot().phase).toBe("ready");
		expect(first.client.host).toBeUndefined();
	});
});
