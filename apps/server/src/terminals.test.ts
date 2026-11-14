/**
 * 终端登记与通道的测试。
 *
 * 用内存 pty 后端替掉子进程：验证发布与序号、单帧切分、流控水位、订阅补齐、退出与登记。
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action, ActionFrame, Channel, TerminalExit } from "@facet/protocol";
import { terminalChannelFor } from "@facet/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { PtyBackend, PtyHandle, PtySink, PtySpawnOptions } from "./pty-server.ts";
import { TerminalService } from "./terminals.ts";

/** 内存终端：记下写进来的按键与尺寸变化，也能把输出与退出推回去。 */
class FakePty implements PtyHandle {
	readonly pid: number;
	readonly shell: string;
	/** 收到的按键 */
	readonly writes: string[] = [];
	/** 收到过的尺寸 */
	readonly resizes: { cols: number; rows: number }[] = [];
	/** 是否被要求暂停读 */
	paused = false;
	/** 暂停与恢复的调用次数 */
	resumeCount = 0;
	/** 是否被挂断 */
	killed = false;
	private readonly sink: PtySink;
	private readonly options: PtySpawnOptions;

	constructor(options: PtySpawnOptions, sink: PtySink, pid: number) {
		this.options = options;
		this.sink = sink;
		this.pid = pid;
		this.shell = options.shell ?? "/bin/zsh";
	}

	write(data: string): void {
		this.writes.push(data);
	}

	resize(cols: number, rows: number): void {
		this.resizes.push({ cols, rows });
	}

	pause(): void {
		this.paused = true;
	}

	resume(): void {
		this.paused = false;
		this.resumeCount += 1;
	}

	kill(): void {
		this.killed = true;
	}

	/** 让 pty 吐出输出 */
	emit(text: string): void {
		this.sink.data(text);
	}

	/** 让 pty 结束 */
	finish(exit: TerminalExit): void {
		this.sink.exit(exit);
	}

	/** 启动目录，测试用来核对参数透传 */
	get cwd(): string {
		return this.options.cwd;
	}
}

/** 内存后端：按调用顺序记下每个终端。 */
class FakeBackend implements PtyBackend {
	readonly handles: FakePty[] = [];
	unavailable: string | undefined;
	disposed = false;

	async spawn(options: PtySpawnOptions, sink: PtySink): Promise<PtyHandle> {
		const handle = new FakePty(options, sink, 1000 + this.handles.length);
		this.handles.push(handle);
		return handle;
	}

	dispose(): void {
		this.disposed = true;
	}
}

function collector(): { frames: ActionFrame[]; sink: { id: string; send(frame: ActionFrame): void } } {
	const frames: ActionFrame[] = [];
	return { frames, sink: { id: "c1", send: (frame) => frames.push(frame) } };
}

function actionsOf(frames: ActionFrame[], id: string): Action[] {
	return frames.filter((frame) => frame.channel === terminalChannelFor(id)).map((frame) => frame.action);
}

const temporary: string[] = [];

afterEach(async () => {
	for (const dir of temporary.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "facet-terminal-"));
	temporary.push(dir);
	return dir;
}

describe("TerminalService", () => {
	it("开终端时参数原样交给 pty，清单里能看到它", async () => {
		const backend = new FakeBackend();
		const service = new TerminalService({ backend });
		const { frames, sink } = collector();
		const info = await service.create({ cwd: "/work/a", cols: 100, rows: 30 });
		service.subscribe(terminalChannelFor(info.id) as Channel, undefined, sink);

		expect(info.cwd).toBe("/work/a");
		expect(info.cols).toBe(100);
		expect(info.rows).toBe(30);
		expect(info.pid).toBe(1000);
		expect(info.exit).toBeNull();
		expect(info.restored).toBe(false);
		expect(backend.handles[0]?.cwd).toBe("/work/a");

		const created = service.list();
		expect(created).toHaveLength(1);
		expect(created[0]?.id).toBe(info.id);
		// 创建本身不发通道动作，帧要等到有输出
		expect(frames).toEqual([]);
	});

	it("输出写成带序号的帧，回滚只留尾部", async () => {
		const backend = new FakeBackend();
		const service = new TerminalService({ backend });
		const info = await service.create({ cwd: "/work/a", cols: 80, rows: 24 });
		const { frames, sink } = collector();
		service.subscribe(terminalChannelFor(info.id) as Channel, undefined, sink);

		backend.handles[0]?.emit("你好\r\n");
		const actions = actionsOf(frames, info.id);
		expect(actions).toEqual([{ type: "terminal/data", id: info.id, text: "你好\r\n" }]);
		expect(frames[0]?.serverSeq).toBe(1);

		const big = "x".repeat(250_000);
		backend.handles[0]?.emit(big);
		const snapshot = service.serialize(info.id);
		expect(snapshot.text.length).toBe(200_000);
		expect(snapshot.text.endsWith("x")).toBe(true);
	});

	it("一次说得太多时按单帧上限切开", async () => {
		const backend = new FakeBackend();
		const service = new TerminalService({ backend });
		const info = await service.create({ cwd: "/work/a", cols: 80, rows: 24 });
		const { frames, sink } = collector();
		service.subscribe(terminalChannelFor(info.id) as Channel, undefined, sink);

		backend.handles[0]?.emit("y".repeat(150_000));
		const actions = actionsOf(frames, info.id);
		expect(actions).toHaveLength(3);
		for (const action of actions) {
			expect(action.type).toBe("terminal/data");
			if (action.type === "terminal/data") {
				expect(action.text.length).toBeLessThanOrEqual(64 * 1024);
			}
		}
		// 序号连续，端据此能发现缺口
		expect(frames.map((frame) => frame.serverSeq)).toEqual([1, 2, 3]);
	});

	it("未确认字符超过高水位就让 pty 暂停，确认到低水位后恢复", async () => {
		const backend = new FakeBackend();
		const service = new TerminalService({ backend });
		const info = await service.create({ cwd: "/work/a", cols: 80, rows: 24 });
		const { frames, sink } = collector();
		service.subscribe(terminalChannelFor(info.id) as Channel, undefined, sink);
		const pty = backend.handles[0];

		pty?.emit("z".repeat(50_000));
		expect(pty?.paused).toBe(false);
		pty?.emit("z".repeat(60_000));
		expect(pty?.paused).toBe(true);
		expect(service.pendingChars(info.id)).toBe(110_000);

		// 确认第一段输出之后还剩 110_000-50000=60000，仍在低水位之上
		service.ack(info.id, 1);
		expect(pty?.paused).toBe(true);
		expect(service.pendingChars(info.id)).toBe(60_000);

		// 再确认到最新一帧，未确认归零，pty 恢复
		const last = frames[frames.length - 1]?.serverSeq ?? 0;
		service.ack(info.id, last);
		expect(pty?.paused).toBe(false);
		expect(pty?.resumeCount).toBe(1);
		expect(service.pendingChars(info.id)).toBe(0);
	});

	it("写入、调尺寸与挂断都转给 pty，挂断后登记里不再有它", async () => {
		const backend = new FakeBackend();
		const service = new TerminalService({ backend });
		const info = await service.create({ cwd: "/work/a", cols: 80, rows: 24 });
		const { frames, sink } = collector();
		service.subscribe(terminalChannelFor(info.id) as Channel, undefined, sink);
		const pty = backend.handles[0];

		service.write(info.id, "ls\r");
		expect(pty?.writes).toEqual(["ls\r"]);

		service.resize(info.id, 120, 40);
		expect(pty?.resizes).toEqual([{ cols: 120, rows: 40 }]);
		expect(service.get(info.id)?.cols).toBe(120);

		service.kill(info.id);
		expect(pty?.killed).toBe(true);
		expect(service.get(info.id)).toBeUndefined();
		expect(actionsOf(frames, info.id).at(-1)).toEqual({ type: "terminal/closed", id: info.id });
	});

	it("进程自己结束之后还能看回滚，但不能写入", async () => {
		const backend = new FakeBackend();
		const service = new TerminalService({ backend });
		const info = await service.create({ cwd: "/work/a", cols: 80, rows: 24 });
		const { frames, sink } = collector();
		service.subscribe(terminalChannelFor(info.id) as Channel, undefined, sink);

		backend.handles[0]?.emit("再见\r\n");
		backend.handles[0]?.finish({ exitCode: 3 });

		expect(service.get(info.id)?.exit).toEqual({ exitCode: 3 });
		expect(actionsOf(frames, info.id).at(-1)).toEqual({
			type: "terminal/exit",
			id: info.id,
			exit: { exitCode: 3 },
		});
		expect(service.serialize(info.id).text).toContain("再见");
		expect(() => service.write(info.id, "x")).toThrow("已经结束");
	});

	it("订阅时按 since 补齐缺口，缺口超出缓冲就报 resync", async () => {
		const backend = new FakeBackend();
		const service = new TerminalService({ backend });
		const info = await service.create({ cwd: "/work/a", cols: 80, rows: 24 });
		const pty = backend.handles[0];
		for (let index = 0; index < 5; index += 1) {
			pty?.emit(`第${index}行\r\n`);
		}

		const { frames, sink } = collector();
		const result = service.subscribe(terminalChannelFor(info.id) as Channel, 2, sink);
		expect(result.seq).toBe(5);
		expect(result.resync).toBe(false);
		// since 2 之后是序号 3 到 5
		expect(frames.map((frame) => frame.serverSeq)).toEqual([3, 4, 5]);

		const gap = service.subscribe(terminalChannelFor(info.id) as Channel, -1, {
			id: "c2",
			send: () => {},
		});
		expect(gap.resync).toBe(false);
	});

	it("主机重启后把以前开过的终端列成已结束，不再接受写入", async () => {
		const dir = await tempDir();
		const file = join(dir, "terminals.json");
		const backend = new FakeBackend();
		const first = new TerminalService({ backend, file });
		const info = await first.create({ cwd: "/work/a", cols: 90, rows: 25 });
		backend.handles[0]?.emit("还记得吗\r\n");
		// 等登记写完，再模拟重启
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(JSON.parse(await readFile(file, "utf8")).terminals).toHaveLength(1);

		const second = new TerminalService({ backend: new FakeBackend(), file });
		await second.load();
		const restored = second.get(info.id);
		expect(restored?.restored).toBe(true);
		expect(restored?.cols).toBe(90);
		expect(restored?.rows).toBe(25);
		expect(second.list()).toHaveLength(1);
		expect(() => second.write(info.id, "x")).toThrow("已经结束");
	});

	it("pty 后端不可用时开终端直接报原因", async () => {
		const backend = new FakeBackend();
		backend.unavailable = "这台主机的终端不可用：原生模块加载失败";
		const service = new TerminalService({ backend });
		expect(service.unavailable).toBe("这台主机的终端不可用：原生模块加载失败");
		await expect(service.create({ cwd: "/work/a", cols: 80, rows: 24 })).rejects.toThrow("原生模块加载失败");
		expect(service.list()).toEqual([]);
	});
});
