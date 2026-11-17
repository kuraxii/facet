/**
 * 连接链路的节奏。
 *
 * 用假时钟验证退避间隔、连上之后的复位与续订，以及主动断开之后不再有幽灵重连。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostHandshake } from "./client.ts";
import { ConnectionLink, type LinkSnapshot, type LinkTransport } from "./link.ts";

function handshake(): HostHandshake {
	return {
		protocolVersion: 3,
		hostId: "host-1",
		hostName: "主机",
		clientId: "c1",
		role: "operator",
		canManage: true,
		capabilities: [],
	};
}

/** 只提供链路用到的四个成员，状态变化可以自己触发。 */
class FakeTransport implements LinkTransport {
	state = "closed";
	connectCalls = 0;
	/** 设置后下一次 connect 抛这个错 */
	failure: Error | undefined;
	closed = 0;
	private readonly listeners = new Set<(state: string) => void>();

	async connect(): Promise<HostHandshake> {
		this.connectCalls += 1;
		if (this.failure !== undefined) {
			const error = this.failure;
			this.failure = undefined;
			this.emit("closed");
			throw error;
		}
		this.emit("ready");
		this.state = "ready";
		return handshake();
	}

	onStateChange(listener: (state: string) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	close(): void {
		this.closed += 1;
		this.state = "closed";
		this.emit("closed");
	}

	/** 模拟掉线：状态先回到 closed，宿主不再有任何动作。 */
	drop(): void {
		this.state = "closed";
		this.emit("closed");
	}

	private emit(state: string): void {
		for (const listener of [...this.listeners]) {
			listener(state);
		}
	}
}

/** 记录调用顺序的假会话端。 */
class FakeSession {
	attached: HostHandshake[] = [];
	resumes = 0;
	failResume = false;

	attach(next: HostHandshake): void {
		this.attached.push(next);
	}

	async resume(): Promise<void> {
		this.resumes += 1;
		if (this.failResume) {
			throw new Error("会话文件不在了");
		}
	}
}

let transport: FakeTransport;
let session: FakeSession;

function makeLink(overrides: { retryable?: (error: unknown) => boolean } = {}): ConnectionLink {
	return new ConnectionLink({
		transport,
		session,
		// 抖动取中值，等待时间正好等于基准，用例才好断言
		random: () => 0.5,
		...(overrides.retryable === undefined ? {} : { retryable: overrides.retryable }),
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	transport = new FakeTransport();
	session = new FakeSession();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("连接链路", () => {
	it("连上后续订并回到 ready，失败计数归零", async () => {
		const link = makeLink();
		await link.open();
		expect(link.snapshot).toEqual({
			status: "ready",
			attempt: 0,
			nextRetryAt: undefined,
			lastError: undefined,
		});
		expect(session.resumes).toBe(1);
		expect(session.attached).toHaveLength(1);
	});

	it("掉线后按指数退避重连", async () => {
		const link = makeLink();
		await link.open();
		transport.drop();
		expect(link.snapshot.status).toBe("reconnecting");
		expect(link.snapshot.nextRetryAt).toBe(Date.now() + 400);
		// 第一次等待 400ms
		transport.failure = new Error("连不上");
		await vi.advanceTimersByTimeAsync(399);
		expect(transport.connectCalls).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(transport.connectCalls).toBe(2);
		expect(link.snapshot).toMatchObject({ status: "reconnecting", attempt: 1, lastError: "连不上" });
		// 第二次等待 800ms
		transport.failure = new Error("还是连不上");
		await vi.advanceTimersByTimeAsync(799);
		expect(transport.connectCalls).toBe(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(transport.connectCalls).toBe(3);
		// 第三次 1600ms
		transport.failure = new Error("仍然连不上");
		await vi.advanceTimersByTimeAsync(1599);
		expect(transport.connectCalls).toBe(3);
		await vi.advanceTimersByTimeAsync(1);
		expect(transport.connectCalls).toBe(4);
	});

	it("等待不超过 8000ms", async () => {
		const link = makeLink();
		await link.open();
		for (let index = 0; index < 6; index += 1) {
			transport.failure = new Error(`第 ${index + 1} 次失败`);
			await link.reconnectNow();
		}
		// 400、800、1600、3200、6400 之后顶到上限
		expect(link.snapshot.attempt).toBe(6);
		expect(link.snapshot.nextRetryAt).toBe(Date.now() + 8000);
	});

	it("重连成功之后计数复位并重新续订", async () => {
		const link = makeLink();
		await link.open();
		transport.drop();
		transport.failure = new Error("连不上");
		await vi.advanceTimersByTimeAsync(400);
		expect(link.snapshot.attempt).toBe(1);
		// 下一次连上
		await vi.advanceTimersByTimeAsync(800);
		expect(link.snapshot).toEqual({
			status: "ready",
			attempt: 0,
			nextRetryAt: undefined,
			lastError: undefined,
		});
		expect(session.resumes).toBe(2);
		// 再掉线又从 400ms 开始
		transport.drop();
		expect(link.snapshot.nextRetryAt).toBe(Date.now() + 400);
	});

	it("reconnectNow 跳过等待立刻重连", async () => {
		const link = makeLink();
		await link.open();
		transport.drop();
		expect(link.snapshot.nextRetryAt).toBe(Date.now() + 400);
		await link.reconnectNow();
		expect(transport.connectCalls).toBe(2);
		expect(link.snapshot.status).toBe("ready");
		// 原来的定时器已经取消，过一会儿也不会再连
		await vi.advanceTimersByTimeAsync(10_000);
		expect(transport.connectCalls).toBe(2);
	});

	it("reconnectNow 失败后继续退避", async () => {
		const link = makeLink();
		await link.open();
		transport.drop();
		transport.failure = new Error("连不上");
		await link.reconnectNow();
		expect(link.snapshot).toMatchObject({ status: "reconnecting", attempt: 1, lastError: "连不上" });
		transport.failure = new Error("还是连不上");
		await vi.advanceTimersByTimeAsync(800);
		expect(transport.connectCalls).toBe(3);
	});

	it("需要密码这类错误不再自动重试", async () => {
		const failures: boolean[] = [];
		const link = new ConnectionLink({
			transport,
			session,
			random: () => 0.5,
			retryable: (error) => (error as { code?: string }).code !== "need_password",
			hooks: {
				onFailure: (_error, willRetry) => failures.push(willRetry),
			},
		});
		await link.open();
		transport.drop();
		transport.failure = Object.assign(new Error("需要密码"), { code: "need_password" });
		await vi.advanceTimersByTimeAsync(400);
		expect(link.snapshot.status).toBe("disconnected");
		expect(failures).toEqual([false]);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(transport.connectCalls).toBe(2);
	});

	it("disconnect 之后不再重连", async () => {
		const link = makeLink();
		await link.open();
		transport.drop();
		link.disconnect();
		expect(transport.closed).toBe(1);
		expect(link.snapshot.status).toBe("disconnected");
		await vi.advanceTimersByTimeAsync(10_000);
		expect(transport.connectCalls).toBe(1);
	});

	it("dispose 之后定时器与订阅都不再起作用", async () => {
		const link = makeLink();
		const seen: LinkSnapshot[] = [];
		link.subscribe((snapshot) => seen.push(snapshot));
		await link.open();
		transport.drop();
		link.dispose();
		const before = seen.length;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(transport.connectCalls).toBe(1);
		expect(seen).toHaveLength(before);
		// 之后传输再报状态也没有反应
		transport.drop();
		expect(seen).toHaveLength(before);
	});

	it("续订失败时连接照样可用，并把失败交给宿主", async () => {
		const ready: boolean[] = [];
		const link = new ConnectionLink({
			transport,
			session,
			random: () => 0.5,
			hooks: {
				onReady: (_handshake, resumeFailed) => {
					ready.push(resumeFailed);
				},
			},
		});
		session.failResume = true;
		// open 自己不发通知，重连才发
		await link.open();
		expect(link.snapshot.status).toBe("ready");
		expect(ready).toEqual([]);
		transport.drop();
		await vi.advanceTimersByTimeAsync(400);
		expect(link.snapshot.status).toBe("ready");
		expect(ready).toEqual([true]);
	});

	it("快照内容不变时不换引用也不通知", async () => {
		const link = makeLink();
		const seen: LinkSnapshot[] = [];
		link.subscribe((snapshot) => seen.push(snapshot));
		await link.open();
		const first = link.snapshot;
		const count = seen.length;
		link.disconnect();
		expect(link.snapshot.status).toBe("disconnected");
		link.disconnect();
		expect(seen).toHaveLength(count + 1);
		expect(link.snapshot).not.toBe(first);
	});
});
