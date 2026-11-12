/**
 * pty 子进程的入口。
 *
 * 原生模块只在这样一个独立进程里加载：终端会长时间存活、可能瞬间吐出大量字节，也可能让
 * 整个进程崩溃。主机进程里同时跑着所有会话的推理轮次，这些不能被终端带坏。
 *
 * 与父进程的消息（都带 type）：
 *
 * | 方向 | 消息 |
 * | --- | --- |
 * | 父 → 子 | `spawn { requestId, id, options }`、`write { id, data }`、`resize { id, cols, rows }`、`pause { id }`、`resume { id }`、`kill { id }`、`dispose` |
 * | 子 → 父 | `ready`、`spawn-result { requestId, id, pid, shell }`、`spawn-error { requestId, message }`、`data { id, text }`、`exit { id, exitCode, signal }` |
 *
 * 本文件不依赖 Electron，也不读主机数据目录：它是纯执行端，参数全部来自父进程。
 */

/** 开一个终端时父进程给的参数。 */
export interface PtySpawnOptions {
	/** 启动目录，父进程已校验过 */
	cwd: string;
	/** 列数 */
	cols: number;
	/** 行数 */
	rows: number;
	/** shell 路径，缺省取环境变量 SHELL */
	shell?: string;
}

/** 父进程发来的消息。 */
export type PtyParentMessage =
	| { type: "spawn"; requestId: number; id: string; options: PtySpawnOptions }
	| { type: "write"; id: string; data: string }
	| { type: "resize"; id: string; cols: number; rows: number }
	| { type: "pause"; id: string }
	| { type: "resume"; id: string }
	| { type: "kill"; id: string }
	| { type: "dispose" };

/** 子进程发回的消息。 */
export type PtyChildMessage =
	| { type: "ready" }
	| { type: "spawn-result"; requestId: number; id: string; pid: number; shell: string }
	| { type: "spawn-error"; requestId: number; message: string }
	| { type: "data"; id: string; text: string }
	| { type: "exit"; id: string; exitCode: number; signal: number | undefined };

/** node-pty 里用到的部分，单独取出来便于替换成假的实现。 */
interface PtyProcess {
	readonly pid: number;
	onData(handler: (data: string) => void): void;
	onExit(handler: (event: { exitCode: number; signal?: number }) => void): void;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(): void;
	pause(): void;
	resume(): void;
}

interface PtyModule {
	spawn(
		file: string,
		args: string[],
		options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
	): PtyProcess;
}

/** 已开的终端。exited 用来挡掉退出之后的写入与调整，这些都是合法竞态。 */
const terminals = new Map<string, { pty: PtyProcess; exited: boolean }>();

function post(message: PtyChildMessage): void {
	process.send?.(message);
}

/** 缺省 shell：尊重用户的 SHELL，没有就退到 sh。 */
function defaultShell(): string {
	return process.env.SHELL?.trim() || "/bin/sh";
}

/**
 * 加载 node-pty。
 *
 * 用动态导入：模块加载失败（原生模块与运行时版本不匹配、缺编译产物）时能把原因回给父进程，
 * 让主机把终端能力关掉并说明情况，而不是让整个 pty 子进程起不来。
 */
async function loadPty(): Promise<PtyModule> {
	const loaded = (await import("node-pty")) as unknown as PtyModule & { default?: PtyModule };
	return loaded.default ?? loaded;
}

function spawnTerminal(
	module: PtyModule,
	message: { requestId: number; id: string; options: PtySpawnOptions },
): void {
	const shell = message.options.shell?.trim() || defaultShell();
	try {
		const pty = module.spawn(shell, [], {
			name: "xterm-256color",
			cols: Math.max(2, message.options.cols),
			rows: Math.max(2, message.options.rows),
			cwd: message.options.cwd,
			env: process.env,
		});
		const entry = { pty, exited: false };
		terminals.set(message.id, entry);
		pty.onData((text) => {
			post({ type: "data", id: message.id, text });
		});
		pty.onExit(({ exitCode, signal }) => {
			entry.exited = true;
			terminals.delete(message.id);
			post({ type: "exit", id: message.id, exitCode, signal });
		});
		post({ type: "spawn-result", requestId: message.requestId, id: message.id, pid: pty.pid, shell });
	} catch (error) {
		post({
			type: "spawn-error",
			requestId: message.requestId,
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

/** 按 id 取出还活着的终端，退出之后到达的写入与调整直接丢掉。 */
function live(id: string): PtyProcess | undefined {
	const entry = terminals.get(id);
	return entry && !entry.exited ? entry.pty : undefined;
}

/** 父进程断开或收到 dispose 时清场：先挂断每个 shell，再退出。 */
function shutdown(): void {
	for (const { pty } of terminals.values()) {
		try {
			pty.kill();
		} catch {
			// 已经退出的进程再挂断会抛，清场尽力而为
		}
	}
	terminals.clear();
	process.exit(0);
}

async function main(): Promise<void> {
	let module: PtyModule;
	try {
		module = await loadPty();
	} catch (error) {
		// 加载不了就让父进程放弃终端能力，子进程留着等 dispose，避免一上来就重启
		post({
			type: "spawn-error",
			requestId: -1,
			message: error instanceof Error ? error.message : String(error),
		});
		return;
	}
	post({ type: "ready" });
	process.on("message", (message: PtyParentMessage) => {
		switch (message.type) {
			case "spawn": {
				spawnTerminal(module, message);
				break;
			}
			case "write": {
				try {
					live(message.id)?.write(message.data);
				} catch {
					// 进程刚退出时写入会抛，onExit 已经发过，这里丢掉
				}
				break;
			}
			case "resize": {
				try {
					live(message.id)?.resize(Math.max(2, message.cols), Math.max(2, message.rows));
				} catch {
					// 与写入同理
				}
				break;
			}
			case "pause": {
				try {
					live(message.id)?.pause();
				} catch {
					// 暂停失败的退路是不暂停，输出照旧到达后再靠确认自然降速
				}
				break;
			}
			case "resume": {
				try {
					live(message.id)?.resume();
				} catch {
					// 同上
				}
				break;
			}
			case "kill": {
				try {
					live(message.id)?.kill();
				} catch {
					// 已经结束的进程再挂断会抛
				}
				break;
			}
			case "dispose": {
				shutdown();
				break;
			}
		}
	});
	process.on("disconnect", shutdown);
}

void main();
