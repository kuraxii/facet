/**
 * pty 子进程的父侧代理。
 *
 * 上层只认 `PtyBackend`：开一个终端、写、调尺寸、暂停恢复、挂断。真实实现把消息转给
 * `pty-host-child`（同一份代码在打包产物里是 `pty-host.js`，直接跑源码时是
 * `pty-host-child.ts`），测试里换成内存实现。
 *
 * 输出在这里按 5ms 窗口合并：`cat` 一个大文件时 node-pty 每几 KB 触发一次，直接往
 * 通道里塞会让帧数暴涨。
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TerminalExit } from "@facet/protocol";
import type { PtyChildMessage, PtyParentMessage, PtySpawnOptions } from "./pty-host-child.ts";

export type { PtySpawnOptions } from "./pty-host-child.ts";

/** 合批窗口。与 percho 的终端实现取同一个值。 */
const BATCH_MS = 5;

/** 起一个终端后父进程拿到的东西。 */
export interface PtyHandle {
	/** shell 进程号 */
	readonly pid: number;
	/** 实际启动的 shell */
	readonly shell: string;
	/** 写入按键 */
	write(data: string): void;
	/** 改尺寸 */
	resize(cols: number, rows: number): void;
	/** 让 pty 停止读取，内核缓冲满了 shell 自己就会阻塞 */
	pause(): void;
	/** 恢复读取 */
	resume(): void;
	/** 挂断 */
	kill(): void;
}

/** pty 把输出与退出推给谁。 */
export interface PtySink {
	/** 一段输出，已经在父侧合并过 */
	data(text: string): void;
	/** 进程结束 */
	exit(result: TerminalExit): void;
}

/** pty 的启动能力。 */
export interface PtyBackend {
	/** 原生模块加载失败的原因，可用时为 undefined。 */
	readonly unavailable: string | undefined;
	/**
	 * 开一个终端。
	 *
	 * 后端不可用（原生模块加载失败）时直接抛错，错误信息给用户看，主机据此关掉终端能力。
	 */
	spawn(options: PtySpawnOptions, sink: PtySink): Promise<PtyHandle>;
	/** 关掉全部终端与子进程 */
	dispose(): void;
}

/** spawn 回执的超时时间，超时说明子进程卡住了。 */
const SPAWN_TIMEOUT_MS = 10_000;

interface PendingSpawn {
	resolve: (value: { pid: number; shell: string }) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

/** 已开的终端在父侧要记住的东西。 */
interface LiveTerminal {
	sink: PtySink;
	parts: string[];
	timer: ReturnType<typeof setTimeout> | undefined;
	exited: boolean;
}

/**
 * 真实实现：fork 一个 pty 子进程，用 IPC 消息转发操作。
 *
 * 子进程懒启动，崩溃或退出后下次开终端自动重建；崩溃时把还活着的终端按异常退出上报。
 */
export class ChildPtyBackend implements PtyBackend {
	private readonly entry: string;
	private readonly childEnv: NodeJS.ProcessEnv;
	private child: ChildProcess | undefined;
	private nextRequestId = 1;
	/** 等 spawn 回执的请求 */
	private readonly pending = new Map<number, PendingSpawn>();
	/** 已成功启动、还没退出的终端 */
	private readonly live = new Map<string, LiveTerminal>();
	/** 原生模块加载失败的原因，有值时不再尝试 */
	private failure: string | undefined;

	/** entry 缺省按产物名与源码名依次找，两个都找不到时保留产物名，让报错指向打包问题。 */
	constructor(options: { entry?: string; env?: NodeJS.ProcessEnv } = {}) {
		this.entry = options.entry ?? resolveEntry();
		this.childEnv = options.env ?? process.env;
	}

	/** 原生模块加载失败的原因，没有失败时为 undefined。 */
	get unavailable(): string | undefined {
		return this.failure;
	}

	async spawn(options: PtySpawnOptions, sink: PtySink): Promise<PtyHandle> {
		if (this.failure !== undefined) {
			throw new Error(this.failure);
		}
		const child = this.ensureChild();
		const id = `pty-${this.nextRequestId}`;
		const requestId = this.nextRequestId;
		this.nextRequestId += 1;
		const result = await new Promise<{ pid: number; shell: string }>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(requestId);
				reject(new Error("pty 启动超时"));
			}, SPAWN_TIMEOUT_MS);
			timer.unref?.();
			this.pending.set(requestId, { resolve, reject, timer });
			this.send(child, { type: "spawn", requestId, id, options });
		});
		this.live.set(id, { sink, parts: [], timer: undefined, exited: false });
		return {
			pid: result.pid,
			shell: result.shell,
			write: (data) => this.send(this.child, { type: "write", id, data }),
			resize: (cols, rows) => this.send(this.child, { type: "resize", id, cols, rows }),
			pause: () => this.send(this.child, { type: "pause", id }),
			resume: () => this.send(this.child, { type: "resume", id }),
			kill: () => this.send(this.child, { type: "kill", id }),
		};
	}

	dispose(): void {
		for (const request of this.pending.values()) {
			clearTimeout(request.timer);
			request.reject(new Error("pty 子进程已关闭"));
		}
		this.pending.clear();
		this.live.clear();
		const child = this.child;
		this.child = undefined;
		if (child === undefined) {
			return;
		}
		try {
			child.send?.({ type: "dispose" } satisfies PtyParentMessage);
		} catch {
			// IPC 已经断开，直接杀
		}
		child.kill();
	}

	/** 懒启动子进程，退出后下次调用重建。 */
	private ensureChild(): ChildProcess {
		if (this.child !== undefined) {
			return this.child;
		}
		const child = spawn(process.execPath, [this.entry], {
			// ELECTRON_RUN_AS_NODE 随环境下传：桌面拉起的本机主机用的就是 Electron 自带的 Node
			env: this.childEnv,
			stdio: ["ignore", "inherit", "inherit", "ipc"],
		});
		child.on("message", (message: PtyChildMessage) => this.onMessage(message));
		child.on("error", (error: Error) => {
			this.failure = `pty 子进程启动失败：${error.message}`;
			this.failAll(this.failure);
		});
		child.on("exit", (code) => {
			this.child = undefined;
			// 子进程没了，还活着的终端随之结束；下次开终端时重建
			const reason = `pty 子进程退出（${code ?? "未知"}）`;
			this.failure = code === 0 || code === null ? undefined : this.failure;
			this.failAll(reason);
		});
		this.child = child;
		return child;
	}

	/** 子进程不可用时，把所有等待中的启动请求与在跑的终端一起结掉。 */
	private failAll(reason: string): void {
		for (const request of this.pending.values()) {
			clearTimeout(request.timer);
			request.reject(new Error(reason));
		}
		this.pending.clear();
		const terminals = [...this.live.values()];
		this.live.clear();
		for (const terminal of terminals) {
			this.flush(terminal);
			if (!terminal.exited) {
				terminal.exited = true;
				terminal.sink.exit({ exitCode: 1 });
			}
		}
	}

	private send(child: ChildProcess | undefined, message: PtyParentMessage): void {
		try {
			child?.send?.(message);
		} catch {
			// 子进程刚退出时 send 会抛，退出回执已经走 exit 事件
		}
	}

	private onMessage(message: PtyChildMessage): void {
		if (typeof message?.type !== "string") {
			return;
		}
		switch (message.type) {
			case "ready": {
				return;
			}
			case "spawn-result": {
				const pending = this.pending.get(message.requestId);
				if (pending === undefined) {
					return;
				}
				this.pending.delete(message.requestId);
				clearTimeout(pending.timer);
				pending.resolve({ pid: message.pid, shell: message.shell });
				return;
			}
			case "spawn-error": {
				// requestId 为 -1 表示原生模块没能加载，这台主机的终端整体不可用
				if (message.requestId < 0) {
					this.failure = `这台主机的终端不可用：${message.message}`;
					this.failAll(this.failure);
					return;
				}
				const pending = this.pending.get(message.requestId);
				if (pending === undefined) {
					return;
				}
				this.pending.delete(message.requestId);
				clearTimeout(pending.timer);
				pending.reject(new Error(message.message));
				return;
			}
			case "data": {
				this.push(message.id, message.text);
				return;
			}
			case "exit": {
				const terminal = this.live.get(message.id);
				if (terminal === undefined) {
					return;
				}
				this.live.delete(message.id);
				this.flush(terminal);
				terminal.exited = true;
				terminal.sink.exit({ exitCode: message.exitCode, signal: message.signal });
				return;
			}
		}
	}

	/** 起一次合批窗口，窗口关掉时把攒下的输出一次交出去。 */
	private push(id: string, text: string): void {
		const terminal = this.live.get(id);
		if (terminal === undefined || terminal.exited) {
			return;
		}
		terminal.parts.push(text);
		if (terminal.timer !== undefined) {
			return;
		}
		terminal.timer = setTimeout(() => {
			terminal.timer = undefined;
			this.flush(terminal);
		}, BATCH_MS);
		terminal.timer.unref?.();
	}

	/** 立即排空某个终端攒下的输出，进程退出前调用，避免尾部输出丢掉。 */
	private flush(terminal: LiveTerminal): void {
		if (terminal.timer !== undefined) {
			clearTimeout(terminal.timer);
			terminal.timer = undefined;
		}
		if (terminal.parts.length === 0) {
			return;
		}
		const text = terminal.parts.join("");
		terminal.parts = [];
		terminal.sink.data(text);
	}
}

/** 没有装 pty 子进程时的后端：终端能力关掉并给出原因。 */
export class DisabledPtyBackend implements PtyBackend {
	readonly unavailable: string | undefined;

	constructor(reason: string) {
		this.unavailable = reason;
	}

	async spawn(): Promise<PtyHandle> {
		throw new Error(this.unavailable ?? "终端不可用");
	}

	dispose(): void {
		// 没有子进程要停
	}
}

/**
 * 找 pty 子进程的入口文件。
 *
 * 与主机入口放在同一个目录：打包后是 `out/main/pty-host.js`，直接跑源码时是同目录的
 * `pty-host-child.ts`（Node 24 默认能执行 TypeScript）。目录取自 `process.argv[1]`，两种
 * 运行方式都对得上。用 `FACET_PTY_HOST` 可以直接指定。
 */
function resolveEntry(): string {
	const override = process.env.FACET_PTY_HOST?.trim();
	if (override !== undefined && override.length > 0) {
		return override;
	}
	const hostEntry = process.argv[1];
	const directory = hostEntry === undefined ? process.cwd() : dirname(hostEntry);
	const bundled = join(directory, "pty-host.js");
	if (existsSync(bundled)) {
		return bundled;
	}
	return join(directory, "pty-host-child.ts");
}
