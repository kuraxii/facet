/**
 * 终端客户端的测试：挂载顺序、输出与退出分派、确认合并、挂断。
 */
import type {
	Action,
	ActionFrame,
	Channel,
	RequestMethod,
	RequestParams,
	RequestResults,
	TerminalInfo,
} from "@facet/protocol";
import { describe, expect, it, vi } from "vitest";
import type { SessionTransport } from "./client.ts";
import { TerminalClient, type TerminalListener } from "./terminal-client.ts";

function info(overrides: Partial<TerminalInfo> = {}): TerminalInfo {
	return {
		id: "t1",
		cwd: "/work/a",
		shell: "/bin/zsh",
		title: "zsh",
		cols: 80,
		rows: 24,
		pid: 10,
		createdAt: 1,
		lastUsedAt: 1,
		exit: null,
		restored: false,
		...overrides,
	};
}

/** 记下发出去的请求，动作从外部推进。 */
function fakeTransport(options: { sequence?: TerminalInfo[] } = {}): {
	transport: SessionTransport;
	calls: { method: string; params: unknown }[];
	push: (channel: Channel, action: Action, seq: number) => void;
} {
	const calls: { method: string; params: unknown }[] = [];
	const listeners = new Set<(frame: ActionFrame) => void>();
	const terminals = options.sequence ?? [info()];
	const transport: SessionTransport = {
		async request<M extends RequestMethod>(method: M, params?: RequestParams[M]): Promise<RequestResults[M]> {
			calls.push({ method, params });
			if (method === "listTerminals") {
				return { terminals } as RequestResults[M];
			}
			if (method === "serializeTerminal") {
				return { text: "回滚", seq: 7, cols: 80, rows: 24 } as RequestResults[M];
			}
			if (method === "subscribe") {
				return { seq: 7, resync: false } as RequestResults[M];
			}
			if (method === "createTerminal") {
				return { terminal: info({ id: "t2" }) } as RequestResults[M];
			}
			if (method === "killTerminal") {
				// 挂断之后清单里就没有它了
				terminals.length = 0;
			}
			return {} as RequestResults[M];
		},
		dispatch(): number {
			return 1;
		},
		onAction(listener: (frame: ActionFrame) => void): () => void {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return {
		transport,
		calls,
		push: (channel, action, seq) => {
			for (const listener of [...listeners]) {
				listener({ type: "action", channel, action, serverSeq: seq, origin: undefined });
			}
		},
	};
}

function collector(): {
	listener: TerminalListener;
	data: string[];
	exited: number[];
	closed: string[];
	resized: string[];
} {
	const data: string[] = [];
	const exited: number[] = [];
	const resized: string[] = [];
	const closed: string[] = [];
	return {
		data,
		exited,
		closed,
		resized,
		listener: {
			onData: (text) => data.push(text),
			onExit: (exit) => exited.push(exit.exitCode),
			onClosed: () => closed.push("closed"),
			onResized: (cols, rows) => resized.push(`${cols}x${rows}`),
		},
	};
}

describe("TerminalClient", () => {
	it("挂载时先取回滚再按序号订阅", async () => {
		const { transport, calls } = fakeTransport();
		const { listener } = collector();
		const client = new TerminalClient({ transport });
		const attached = await client.attach("t1", listener);
		expect(attached.text).toBe("回滚");
		expect(attached.seq).toBe(7);
		expect(calls.map((call) => call.method)).toEqual(["listTerminals", "serializeTerminal", "subscribe"]);
		expect(calls[2]?.params).toEqual({ channel: "terminal:/t1", since: 7 });
	});

	it("输出交给界面，退出与尺寸变化分派到对应回调", async () => {
		const { transport, push } = fakeTransport();
		const { listener, data, exited, resized } = collector();
		const client = new TerminalClient({ transport });
		client.start();
		await client.attach("t1", listener);

		push("terminal:/t1", { type: "terminal/data", id: "t1", text: "你好" }, 8);
		push("terminal:/t1", { type: "terminal/exit", id: "t1", exit: { exitCode: 0 } }, 9);
		push("terminal:/t1", { type: "terminal/resized", id: "t1", cols: 100, rows: 30 }, 10);
		expect(data).toEqual(["你好"]);
		expect(exited).toEqual([0]);
		expect(resized).toEqual(["100x30"]);
	});

	it("没挂载的终端推来的输出直接忽略", async () => {
		const { transport, push } = fakeTransport();
		const { listener, data } = collector();
		const client = new TerminalClient({ transport });
		client.start();
		push("terminal:/t1", { type: "terminal/data", id: "t1", text: "不该出现" }, 3);
		await client.attach("t1", listener).catch(() => undefined);
		expect(data).toEqual([]);
	});

	it("确认按窗口合并，只报最新序号", async () => {
		vi.useFakeTimers();
		try {
			const { transport, push, calls } = fakeTransport();
			const { listener } = collector();
			const client = new TerminalClient({ transport });
			client.start();
			await client.attach("t1", listener);
			push("terminal:/t1", { type: "terminal/data", id: "t1", text: "一" }, 8);
			push("terminal:/t1", { type: "terminal/data", id: "t1", text: "二" }, 9);
			expect(calls.some((call) => call.method === "ackTerminal")).toBe(false);
			vi.advanceTimersByTime(60);
			const acks = calls.filter((call) => call.method === "ackTerminal");
			expect(acks).toHaveLength(1);
			expect(acks[0]?.params).toEqual({ id: "t1", seq: 9 });
		} finally {
			vi.useRealTimers();
		}
	});

	it("被别的端关掉时通知界面", async () => {
		const { transport, push } = fakeTransport();
		const { listener, closed } = collector();
		const client = new TerminalClient({ transport });
		client.start();
		await client.attach("t1", listener);
		push("terminal:/t1", { type: "terminal/closed", id: "t1" }, 8);
		expect(closed).toEqual(["closed"]);
	});

	it("挂断后退出订阅", async () => {
		const { transport, calls } = fakeTransport();
		const { listener } = collector();
		const client = new TerminalClient({ transport });
		await client.attach("t1", listener);
		await client.kill("t1");
		expect(calls.map((call) => call.method)).toEqual([
			"listTerminals",
			"serializeTerminal",
			"subscribe",
			"killTerminal",
			"unsubscribe",
		]);
	});

	it("写入与改尺寸走对应请求", async () => {
		const { transport, calls } = fakeTransport();
		const { listener } = collector();
		const client = new TerminalClient({ transport });
		client.attach("t1", listener).catch(() => undefined);
		client.write("t1", "ls\r");
		client.resize("t1", 120, 40);
		await Promise.resolve();
		const writes = calls.filter(
			(call) => call.method === "writeTerminal" || call.method === "resizeTerminal",
		);
		expect(writes[0]?.params).toEqual({ id: "t1", data: "ls\r" });
		expect(writes[1]?.params).toEqual({ id: "t1", cols: 120, rows: 40 });
	});
});
