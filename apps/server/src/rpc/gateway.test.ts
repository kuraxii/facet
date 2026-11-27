/**
 * 网关的两条分发路径。
 *
 * 重点在边界：未知方法、权限档、参数形状、伪造的主机内部动作。
 */
import type { ServerActionFrame } from "@facet/protocol";
import { DISPATCH_CONTRACTS, REQUEST_CONTRACTS } from "@facet/protocol";
import { describe, expect, it, vi } from "vitest";
import type { Connection, RpcContext } from "./context.ts";
import { DISPATCH_WINDOW } from "./dispatch-log.ts";
import { handleDispatch, handleRequest } from "./gateway.ts";

/** 最小可用的连接，只记下发出去的帧。 */
function makeConnection(patch: Partial<Connection> = {}): Connection & { frames: ServerActionFrame[] } {
	const frames: ServerActionFrame[] = [];
	return {
		clientId: "c1",
		remoteAddress: "127.0.0.1",
		subscriptions: new Map(),
		authenticated: true,
		trusted: true,
		role: "admin",
		entry: "desktop",
		send: (frame) => {
			if (frame.type === "action") {
				frames.push(frame);
			}
		},
		close: () => {},
		frames,
		...patch,
	};
}

/** 只提供被测方法用到的那几个成员。 */
function makeContext(patch: Record<string, unknown> = {}): RpcContext {
	const abort = vi.fn(async () => {});
	const hold = vi.fn(() => ({ release: () => {} }));
	// hub 按字段合并：用例只覆盖自己关心的那几个，其余保持默认
	const hub = {
		busyFiles: () => ["a.jsonl"] as string[],
		hold,
		agent: () => ({ abort }),
		lastSeq: () => 0,
		turnTicket: () => ({ cancelled: () => false }),
		cancelPendingTurns: () => {},
		...(patch.hub as Record<string, unknown> | undefined),
	};
	return {
		config: { hostName: "host", dataDir: "/tmp", host: "127.0.0.1", port: 0, remotePermission: "operate" },
		factory: {},
		projectStore: {},
		settingsStore: {},
		hostId: "host-1",
		hostSource: "machine-id",
		connections: new Set(),
		sessions: {},
		modelLog: {},
		terminals: {},
		workspaces: {},
		gitRefresh: {},
		audit: { record: () => {} },
		...patch,
		hub,
	} as unknown as RpcContext;
}

describe("请求分发", () => {
	it("未知方法按 unknown_method 拒绝", async () => {
		await expect(handleRequest(makeContext(), makeConnection(), "nope", {})).rejects.toMatchObject({
			code: "unknown_method",
		});
	});

	it("只读连接不能调 write 档方法", async () => {
		const connection = makeConnection({ role: "viewer", entry: "web" });
		await expect(handleRequest(makeContext(), connection, "writeFile", {})).rejects.toMatchObject({
			code: "rejected",
			message: "This connection is read-only",
		});
	});

	it("浏览器入口不能调 admin 档方法", async () => {
		const connection = makeConnection({ role: "operator", entry: "web" });
		await expect(handleRequest(makeContext(), connection, "addProject", { cwd: "/x" })).rejects.toMatchObject(
			{
				code: "rejected",
				message: "This operation is only available in the desktop app",
			},
		);
	});

	it("参数形状不对按 bad_params 拒绝，不进处理器", async () => {
		const busyFiles = vi.fn(() => []);
		const context = makeContext({ hub: { busyFiles, lastSeq: () => 0 } });
		await expect(handleRequest(context, makeConnection(), "busySessions", null)).resolves.toEqual({
			files: [],
		});
		await expect(
			handleRequest(context, makeConnection(), "snapshot", { sessionId: 42 }),
		).rejects.toMatchObject({
			code: "bad_params",
		});
		expect(busyFiles).toHaveBeenCalledTimes(1);
	});

	it("没有参数的方法允许整条省掉 params", async () => {
		await expect(handleRequest(makeContext(), makeConnection(), "busySessions", undefined)).resolves.toEqual({
			files: ["a.jsonl"],
		});
	});

	it("空串标识在参数层被拒", async () => {
		await expect(
			handleRequest(makeContext(), makeConnection(), "openSession", { sessionFile: "" }),
		).rejects.toMatchObject({ code: "bad_params" });
	});
});

describe("派发分发", () => {
	it("伪造的主机内部动作回一条拒绝帧，不进处理器", async () => {
		const connection = makeConnection();
		// 会话清单通道不在派发允许的种类里，按未知通道拒绝
		await expect(
			handleDispatch(makeContext(), connection, {
				channel: "sessions:/host-1",
				action: { type: "sessions/changed", summary: {}, status: {} },
				clientSeq: 1,
			}),
		).rejects.toMatchObject({ code: "unknown_channel" });
		expect(connection.frames).toHaveLength(0);
		await expect(
			handleDispatch(makeContext(), connection, {
				channel: "chat:/s1",
				action: { type: "chat/delta", messageId: "m", partIndex: 0, kind: "text", delta: "x" },
				clientSeq: 2,
			}),
		).resolves.toBeUndefined();
		expect(connection.frames).toHaveLength(1);
		expect(connection.frames[0]?.rejectionReason).toContain("produced by the host");
	});

	it("形状不对的动作回 bad_params 拒绝帧", async () => {
		const connection = makeConnection();
		await handleDispatch(makeContext(), connection, {
			channel: "chat:/s1",
			action: { type: "chat/turnStarted", text: 42 },
			clientSeq: 3,
		});
		expect(connection.frames[0]?.rejectionReason).toContain("bad_params");
	});

	it("只读连接派发动作一律拒绝", async () => {
		const connection = makeConnection({ role: "viewer", entry: "web" });
		await handleDispatch(makeContext(), connection, {
			channel: "chat:/s1",
			action: { type: "chat/turnCancelled" },
			clientSeq: 4,
		});
		expect(connection.frames[0]?.rejectionReason).toBe("This connection is read-only");
	});

	it("合法的中止动作走到处理器", async () => {
		const abort = vi.fn(async () => {});
		const release = vi.fn();
		const context = makeContext({
			hub: { busyFiles: () => [], hold: () => ({ release }), agent: () => ({ abort }), lastSeq: () => 0 },
		});
		await handleDispatch(context, makeConnection(), {
			channel: "chat:/s1",
			action: { type: "chat/turnCancelled" },
			clientSeq: 5,
		});
		await vi.waitFor(() => expect(abort).toHaveBeenCalledTimes(1));
		expect(release).toHaveBeenCalledTimes(1);
	});
});

describe("派发去重", () => {
	/** 记一次中止调用；`chat/turnCancelled` 是最省事的可重复动作。 */
	function makeAbortContext() {
		const abort = vi.fn(async () => {});
		const release = vi.fn();
		const context = makeContext({
			hub: { busyFiles: () => [], lastSeq: () => 0, hold: () => ({ release }), agent: () => ({ abort }) },
		});
		return { context, abort };
	}

	it("同一 (clientId, clientSeq) 只执行一次", async () => {
		const { context, abort } = makeAbortContext();
		const connection = makeConnection();
		const frame = { channel: "chat:/s1", action: { type: "chat/turnCancelled" }, clientSeq: 7 };
		await handleDispatch(context, connection, frame);
		await vi.waitFor(() => expect(abort).toHaveBeenCalledTimes(1));
		await handleDispatch(context, connection, frame);
		await vi.waitFor(() => expect(abort).toHaveBeenCalledTimes(1));
		await handleDispatch(context, connection, frame);
		await Promise.resolve();
		expect(abort).toHaveBeenCalledTimes(1);
	});

	it("重复的成功动作不再补发消费回执以外的帧", async () => {
		const handled = vi.fn(async () => "handled" as const);
		const context = makeContext({
			hub: {
				busyFiles: () => [],
				lastSeq: () => 0,
				hold: () => ({ release: () => {} }),
				agent: () => ({ abort: async () => {} }),
				withSession: async (_id: string, work: (agent: never) => Promise<void>) => {
					await handled();
					await work({
						isStreaming: false,
						prompt: async () => "handled",
					} as never);
				},
			},
		});
		const connection = makeConnection();
		const frame = { channel: "chat:/s1", action: { type: "chat/turnStarted", text: "你好" }, clientSeq: 1 };
		await handleDispatch(context, connection, frame);
		await vi.waitFor(() =>
			expect(connection.frames.filter((item) => item.action.type === "chat/inputHandled")).toHaveLength(1),
		);
		await handleDispatch(context, connection, frame);
		// 重复帧照样回一条 chat/inputHandled，处理器只跑了一次
		await vi.waitFor(() =>
			expect(connection.frames.filter((item) => item.action.type === "chat/inputHandled")).toHaveLength(2),
		);
		expect(handled).toHaveBeenCalledTimes(1);
	});

	it("重复发送被拒的 clientSeq 返回相同的拒绝原因", async () => {
		const connection = makeConnection();
		const frame = { channel: "chat:/s1", action: { type: "chat/delta", delta: "x" }, clientSeq: 3 };
		await handleDispatch(makeContext(), connection, frame);
		await handleDispatch(makeContext(), connection, frame);
		expect(connection.frames).toHaveLength(2);
		expect(connection.frames[0]?.rejectionReason).toBe(connection.frames[1]?.rejectionReason);
		expect(connection.frames[0]?.rejectionReason).toContain("produced by the host");
	});

	it("不同连接用同一个 clientSeq 互不干扰", async () => {
		const { context, abort } = makeAbortContext();
		const first = makeConnection({ clientId: "c1" });
		const second = makeConnection({ clientId: "c2" });
		const frame = { channel: "chat:/s1", action: { type: "chat/turnCancelled" }, clientSeq: 5 };
		await handleDispatch(context, first, frame);
		await handleDispatch(context, second, frame);
		await vi.waitFor(() => expect(abort).toHaveBeenCalledTimes(2));
	});

	it("窗口超过上限后旧记录被淘汰，同一个序号可以再次执行", async () => {
		const { context, abort } = makeAbortContext();
		const connection = makeConnection();
		const action = { type: "chat/turnCancelled" };
		await handleDispatch(context, connection, { channel: "chat:/s1", action, clientSeq: 1 });
		await vi.waitFor(() => expect(abort).toHaveBeenCalledTimes(1));
		for (let seq = 2; seq <= DISPATCH_WINDOW + 1; seq += 1) {
			await handleDispatch(context, connection, { channel: "chat:/s1", action, clientSeq: seq });
		}
		await vi.waitFor(() => expect(abort).toHaveBeenCalledTimes(DISPATCH_WINDOW + 1));
		// 1 已经被挤出窗口，再发一次会当作新动作执行
		await handleDispatch(context, connection, { channel: "chat:/s1", action, clientSeq: 1 });
		await vi.waitFor(() => expect(abort).toHaveBeenCalledTimes(DISPATCH_WINDOW + 2));
	});

	it("出队前收到取消，底层 prompt 不会被拉起", async () => {
		const prompt = vi.fn(async () => "handled");
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		// 假 hub 复刻真实语义：票在入队前领，取消抬水位
		let epoch = 0;
		const context = makeContext({
			hub: {
				busyFiles: () => [],
				lastSeq: () => 0,
				hold: () => ({ release: () => {} }),
				agent: () => ({ abort: async () => {} }),
				turnTicket: () => {
					const mine = epoch;
					return { cancelled: () => epoch !== mine };
				},
				cancelPendingTurns: () => {
					epoch += 1;
				},
				withSession: async (_id: string, work: (agent: unknown) => Promise<void>) => {
					// 模拟排在会话队列里还没出队
					await gate;
					await work({ isStreaming: false, prompt });
				},
			},
		});
		const connection = makeConnection();
		const started = handleDispatch(context, connection, {
			channel: "chat:/s1",
			action: { type: "chat/turnStarted", text: "排队的一条" },
			clientSeq: 1,
		});
		// 还在队列里时取消
		await handleDispatch(context, connection, {
			channel: "chat:/s1",
			action: { type: "chat/turnCancelled" },
			clientSeq: 2,
		});
		release();
		await started;
		await vi.waitFor(() => expect(epoch).toBe(1));
		await Promise.resolve();
		expect(prompt).not.toHaveBeenCalled();
		// 也没有发出「已受理」的回执
		expect(connection.frames.filter((frame) => frame.action.type === "chat/inputHandled")).toHaveLength(0);
	});

	it("运行中发出的消息被排进队列，也回一条受理回执", async () => {
		// 主机把这条排进了 pi 的队列，这一轮并没有新起：端点仍要收起草稿
		const context = makeContext({
			hub: {
				busyFiles: () => [],
				lastSeq: () => 0,
				hold: () => ({ release: () => {} }),
				agent: () => ({ abort: async () => {} }),
				withSession: async (_id: string, work: (agent: never) => Promise<void>) => {
					await work({
						isStreaming: true,
						// pi 在运行中收到带 streamingBehavior 的输入时返回 queued
						prompt: async () => "queued",
					} as never);
				},
			},
		});
		const connection = makeConnection();
		await handleDispatch(context, connection, {
			channel: "chat:/s1",
			action: { type: "chat/turnStarted", text: "运行中补充", streamingBehavior: "steer" },
			clientSeq: 7,
		});
		await vi.waitFor(() =>
			expect(
				connection.frames.filter(
					(frame) => frame.action.type === "chat/inputHandled" && frame.origin?.clientSeq === 7,
				),
			).toHaveLength(1),
		);
	});

	it("没有 clientSeq 的帧不做去重", async () => {
		const { context, abort } = makeAbortContext();
		const connection = makeConnection();
		const frame = { channel: "chat:/s1", action: { type: "chat/turnCancelled" } };
		await handleDispatch(context, connection, frame);
		await handleDispatch(context, connection, frame);
		await vi.waitFor(() => expect(abort).toHaveBeenCalledTimes(2));
	});

	it("中止时若返回了未消费的排队消息，向触发端下发回收列表", async () => {
		const reclaimed = [{ text: "插话 1" }, { text: "后续 2" }];
		const reclaimQueue = vi.fn();
		const context = makeContext({
			hub: {
				busyFiles: () => [],
				lastSeq: () => 0,
				hold: () => ({ release: () => {} }),
				agent: () => ({ abort: async () => reclaimed }),
				reclaimQueue,
			},
		});
		const connection = makeConnection({ clientId: "client-abort" });
		await handleDispatch(context, connection, {
			channel: "chat:/s1",
			action: { type: "chat/turnCancelled" },
			clientSeq: 9,
		});
		await vi.waitFor(() => expect(reclaimQueue).toHaveBeenCalledWith("s1", "client-abort", reclaimed));
	});

	it("session/steeringDemoted 派发到当前会话的 demoteSteering", async () => {
		const demoteSteering = vi.fn();
		const context = makeContext({
			hub: {
				busyFiles: () => [],
				lastSeq: () => 0,
				withSession: async (_id: string, work: (agent: never) => Promise<void>) => {
					await work({ demoteSteering } as never);
				},
			},
		});
		const connection = makeConnection();
		await handleDispatch(context, connection, {
			channel: "session:/s1",
			action: { type: "session/steeringDemoted" },
			clientSeq: 10,
		});
		await vi.waitFor(() => expect(demoteSteering).toHaveBeenCalledTimes(1));
	});
});

describe("契约表", () => {
	it("每个方法的权限档只在生成物里声明一次", () => {
		expect(Object.keys(REQUEST_CONTRACTS)).toHaveLength(58);
		expect(REQUEST_CONTRACTS.contextDetails?.auth).toBe("public");
		expect(REQUEST_CONTRACTS.respondUi?.auth).toBe("write");
		expect(REQUEST_CONTRACTS.saveCredential?.auth).toBe("admin");
		expect(REQUEST_CONTRACTS.listSessions?.auth).toBe("public");
		// 默认模型存在 pi 的设置里：读是公开的，写要管理档
		expect(REQUEST_CONTRACTS.getAgentDefaults?.auth).toBe("public");
		expect(REQUEST_CONTRACTS.setAgentDefaults?.auth).toBe("admin");
		// 从上游拉模型要带密钥出去，只给管理档
		expect(REQUEST_CONTRACTS.fetchProviderModels?.auth).toBe("admin");
		// 登录会写凭证，应答与取消同样只给管理档
		expect(REQUEST_CONTRACTS.providerLoginStart?.auth).toBe("admin");
		expect(REQUEST_CONTRACTS.providerLoginRespond?.auth).toBe("admin");
		expect(REQUEST_CONTRACTS.providerLoginCancel?.auth).toBe("admin");
	});

	it("派发白名单只含客户端动作", () => {
		const types = Object.keys(DISPATCH_CONTRACTS);
		expect(types).toHaveLength(11);
		expect(types.every((type) => type.startsWith("chat/") || type.startsWith("session/"))).toBe(true);
		expect(types).not.toContain("chat/delta");
		expect(types).not.toContain("sessions/changed");
		expect(types).not.toContain("terminal/output");
	});

	it("每个派发动作都要求非只读", () => {
		const tiers = Object.values(DISPATCH_CONTRACTS).map((contract) => contract?.auth);
		expect(tiers.every((tier) => tier === "write")).toBe(true);
	});

	it("模型通道只有一条，标识对不上的按未知通道拒绝", async () => {
		const connection = makeConnection();
		await expect(
			handleRequest(makeContext(), connection, "subscribe", { channel: "models:/别的" }),
		).rejects.toMatchObject({ code: "unknown_channel" });
		// 标识对上时交给模型通道订阅，返回它的序号
		const context = makeContext({
			modelLog: { subscribe: () => ({ seq: 3, resync: false }) },
		});
		await expect(
			handleRequest(context, connection, "subscribe", { channel: "models:/host-1" }),
		).resolves.toEqual({ seq: 3, resync: false });
	});

	it("工作树通道按目录订阅，目录不在的按未知通道拒绝", async () => {
		const connection = makeConnection();
		const missing = makeContext({ workspaces: { subscribe: async () => undefined, unsubscribe: () => {} } });
		await expect(
			handleRequest(missing, connection, "subscribe", { channel: "workspace:/work/a" }),
		).rejects.toMatchObject({ code: "unknown_channel" });

		// 目录在的时候交给工作树通道订阅，返回它的序号
		const context = makeContext({
			workspaces: { subscribe: async () => ({ seq: 2, resync: false }), unsubscribe: () => {} },
		});
		await expect(
			handleRequest(context, connection, "subscribe", { channel: "workspace:/work/a" }),
		).resolves.toEqual({ seq: 2, resync: false });
	});

	it("已移除的通道种类按未知通道拒绝", async () => {
		// 契约只声明 channel 是字符串，种类由 requireChannel 把关
		await expect(
			handleDispatch(makeContext(), makeConnection(), {
				channel: "diff:/s1",
				action: { type: "chat/turnCancelled" },
				clientSeq: 6,
			}),
		).rejects.toMatchObject({ code: "unknown_channel" });
	});
});
