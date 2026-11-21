/**
 * `git` 子进程的唯一出口。
 *
 * 全服的 git 调用都从这里走：参数怎么拼、环境怎么设、超时多长、被取消时怎么收尾，只有这一份
 * 实现。业务层不再自己 `execFile("git", …)`，也就不会各自漏掉某一项加固。
 *
 * 两条通道分开，因为读和写的风险不一样：
 *
 * - **只读**（`rev-parse` / `status` / `diff` / `log` / `show` …）首位加 `--no-optional-locks`
 *   并设 `GIT_OPTIONAL_LOCKS=0`：这些命令本来不该写盘，但 `status` 之类会顺手刷新索引
 *   （`index.lock`）——高频读的时候那就是自己撞自己。
 * - **写入**（`add` / `reset` / `restore` / `commit` …）绝不能加这两项，否则读写混跑时索引
 *   更新会被静默跳过。它换来的是「按仓库根目录串行」：同一仓库的写操作排成一条队，`add` 与
 *   `commit` 不会自己抢 `index.lock`。
 *
 * 两条通道共用同一套环境加固：不允许交互式凭据提示（否则子进程会挂在等 TTY 上），但用户的
 * `PATH` / `SSH_AUTH_SOCK` / `GPG_TTY` 与语言环境原样传下去——签名提交与自定义 hooks 都要用。
 * 语言只按通道收一档：只读钉 `LC_ALL=C` 保证报错是英文，写入只钉 `LC_MESSAGES`，把 `LC_CTYPE`
 * 留给 `pre-commit` 那类脚本。
 */
import { execFile, spawn } from "node:child_process";

/** 只读单次调用的默认超时；具体查询可以按自己的开销放宽。 */
const READ_TIMEOUT_MS = 15_000;

/** 写操作的默认超时。 */
const WRITE_TIMEOUT_MS = 30_000;

/**
 * 会跑仓库钩子的写操作（`commit` / `push`）该用的超时。
 *
 * `pre-commit`、husky、格式化与测试都可能挂在这条命令上，用默认的 30s 会误杀；调用方显式传它。
 */
export const GIT_COMMIT_TIMEOUT_MS = 120_000;

/** 默认的 stdout 上限，超出按显式错误返回，不把服务进程拖垮。 */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/** 中止时先 SIGTERM，等这么久还没退出再 SIGKILL。 */
const KILL_GRACE_MS = 250;

/** 撞上 `index.lock` 之后的重试间隔：两次短退避，还不行就交出去。 */
const LOCK_RETRY_DELAYS_MS = [150, 350] as const;

/** `stderr` 只留尾部这么多字节：出错时给出去的是最后那句话。 */
const STDERR_TAIL_BYTES = 4096;

/** 仓库根缓存的容量。 */
const REPO_ROOT_LIMIT = 64;

/** 这次调用被上层取消（或等价地被打断）了。调用方据此静默处理，不当成故障。 */
export class GitAbortedError extends Error {
	constructor() {
		super("git 调用被中止");
		this.name = "GitAbortedError";
	}
}

/** 输出超过上限。 */
export class GitOutputLimitError extends Error {
	/** 触到的那条上限，字节 */
	readonly limit: number;

	constructor(limit: number) {
		super(`git 输出超过 ${String(limit)} 字节上限`);
		this.name = "GitOutputLimitError";
		this.limit = limit;
	}
}

/** 一条 git 命令超过了给它的时间。 */
export class GitTimeoutError extends Error {
	/** 那次调用的超时，毫秒 */
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		super(`git 调用超过 ${String(timeoutMs)} 毫秒`);
		this.name = "GitTimeoutError";
		this.timeoutMs = timeoutMs;
	}
}

/**
 * `.git/index.lock` 被占着，短退避重试之后仍然拿不到。
 *
 * 只可能来自仓库外面：主机自己发起的写操作已经被串行队列排开了。
 */
export class GitLockedError extends Error {
	/** git 的原话，界面上给的是这最后一句 */
	readonly stderr: string;

	constructor(stderr: string) {
		super(stderr.trim() || "git 索引被占用");
		this.name = "GitLockedError";
		this.stderr = stderr;
	}
}

/** 通道：只读与写入的参数、环境不一样。 */
export type GitChannel = "read" | "write";

/** 一条 git 调用的形态：命令、参数与环境。 */
export interface GitInvocation {
	/** 可执行文件，固定是 `git` */
	command: "git";
	/** 完整参数，全局选项在最前面 */
	args: string[];
	/** 子进程环境 */
	env: Record<string, string | undefined>;
}

/**
 * 组一条 git 调用。
 *
 * 全局选项必须排在子命令之前：`--no-optional-locks`、`-c`、`-C`、`--no-pager` 都是 `git`
 * 自己的开关，位置错了会被当成子命令的参数。
 */
export function gitInvocation(channel: GitChannel, cwd: string, args: readonly string[]): GitInvocation {
	const global =
		channel === "read"
			? ["--no-optional-locks", "-c", "core.quotepath=false", "-C", cwd, "--no-pager"]
			: ["-c", "core.quotepath=false", "-C", cwd, "--no-pager"];
	return {
		command: "git",
		args: [...global, ...args],
		env: {
			// 用户的环境照传：SSH 与 GPG 签名都靠它，清空等于把提交签名弄坏
			...process.env,
			// 任何要输入的凭据提示都直接失败，别让子进程挂在 TTY 上
			GIT_TERMINAL_PROMPT: "0",
			GCM_INTERACTIVE: "never",
			/*
			 * 语言分两档：
			 *
			 * - 只读把整份 `LC_ALL` 钉成 C：报错要是英文，解析器与 `not a git repository`
			 *   这类判定才不跟着系统语言变；
			 * - 写入只钉 `LC_MESSAGES`，**不碰 `LC_ALL`**：`commit` 会连带跑 `pre-commit`、
			 *   husky、格式化这些仓库自己的脚本，把 `LC_CTYPE` 一起压成 ASCII 会让它们处理
			 *   UTF-8 文件名与中文输出时出岔子。
			 */
			...(channel === "read" ? { LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" } : { LC_MESSAGES: "C" }),
		},
	};
}

/** 子进程怎么跑。 */
export interface GitRunOptions {
	/** 超时，毫秒 */
	timeoutMs: number;
	/** stdout 上限，字节；流式调用不攒 buffer，用不上 */
	maxBuffer: number;
	/** 取消信号 */
	signal?: AbortSignal | undefined;
	/** 流式消费 stdout：返回真表示不必再读，进程会被停下 */
	onStdout?: ((chunk: string) => boolean) | undefined;
}

/** 子进程跑完之后的样子。 */
export interface GitProcessResult {
	/** 退出码；被信号结束时为空 */
	code: number | null;
	/** 标准输出；流式调用为空 */
	stdout: string;
	/** 标准错误（只留尾部） */
	stderr: string;
	/** 停下来的原因：跑完了为空 */
	stopped: "limit" | "timeout" | "abort" | null;
}

/** 真正起进程的那一层。测试里换成记录参数与环境的假实现，不必真跑 git。 */
export interface GitRunner {
	run(invocation: GitInvocation, options: GitRunOptions): Promise<GitProcessResult>;
}

/** 一次只读调用的参数。 */
export interface GitReadOptions {
	/** 超时，毫秒，缺省 {@link READ_TIMEOUT_MS} */
	timeoutMs?: number;
	/** stdout 上限，缺省 {@link MAX_BUFFER_BYTES} */
	maxBuffer?: number;
	/** 取消信号 */
	signal?: AbortSignal | undefined;
}

/** 一次流式只读调用的参数。 */
export interface GitReadStreamingOptions extends GitReadOptions {
	/** 每读到一段就交出去；返回真表示已经够了 */
	onStdout: (chunk: string) => boolean;
}

/** 一次写调用的参数。 */
export interface GitWriteOptions {
	/** 超时，毫秒，缺省 {@link WRITE_TIMEOUT_MS}；会跑 hooks 的操作自己放宽 */
	timeoutMs?: number;
	/** 取消信号 */
	signal?: AbortSignal | undefined;
}

/** 一次调用的结果；退出码原样给出，由业务层判断 0 / 1 / 128 各自的含义。 */
export interface GitResult {
	/** 退出码；被信号结束时为空 */
	code: number | null;
	/** 标准输出 */
	stdout: string;
	/** 标准错误 */
	stderr: string;
}

/** 流式调用的结果。 */
export interface GitStreamingResult {
	/** 退出码 */
	code: number | null;
	/** 标准错误 */
	stderr: string;
	/** 停下来的原因：跑完了为空 */
	stopped: "limit" | "timeout" | "abort" | null;
}

/** 执行器：业务层拿到的唯一入口。 */
export interface GitExec {
	/** 只读调用 */
	runRead(cwd: string, args: readonly string[], options?: GitReadOptions): Promise<GitResult>;
	/** 流式只读调用：大仓库的 `status` 边读边解析，到上限就停 */
	runReadStreaming(
		cwd: string,
		args: readonly string[],
		options: GitReadStreamingOptions,
	): Promise<GitStreamingResult>;
	/** 写调用：同一仓库根目录严格串行，撞锁短退避重试 */
	runWrite(cwd: string, args: readonly string[], options?: GitWriteOptions): Promise<GitResult>;
	/** 规范化后的仓库根目录；不是仓库时退回 `cwd` 本身 */
	repoRootOf(cwd: string): Promise<string>;
}

/**
 * 造一个执行器。
 *
 * 传入 `runner` 就能换成假实现：参数与环境对不对、写操作有没有排队、撞锁重试了几次，都可以
 * 不跑真 git 断言。
 */
export function createGitExec(options: { runner?: GitRunner } = {}): GitExec {
	const runner = options.runner ?? nodeRunner;
	/** 仓库根缓存：键是调用方给的目录，值是 `rev-parse --show-toplevel` 的结果 */
	const repoRoots = new Map<string, string>();
	/** 每个仓库根一条写队列：排队的是「上一次写结束」，不是它的结果 */
	const writeQueues = new Map<string, Promise<void>>();

	/** 一条调用：起进程、把「被取消 / 超时 / 输出超限」翻译成可识别的错误。 */
	const invoke = async (
		channel: GitChannel,
		cwd: string,
		args: readonly string[],
		runOptions: GitRunOptions,
	): Promise<GitResult> => {
		const result = await runner.run(gitInvocation(channel, cwd, args), runOptions);
		if (result.stopped === "abort") {
			throw new GitAbortedError();
		}
		if (result.stopped === "timeout") {
			throw new GitTimeoutError(runOptions.timeoutMs);
		}
		if (result.stopped === "limit") {
			throw new GitOutputLimitError(runOptions.maxBuffer);
		}
		return { code: result.code, stdout: result.stdout, stderr: result.stderr };
	};

	/** 取仓库根；不是仓库就退回目录本身，写队列至少还能按目录隔开。 */
	const repoRootOf = async (cwd: string): Promise<string> => {
		const cached = repoRoots.get(cwd);
		if (cached !== undefined) {
			// 用过就挪到队尾：淘汰从最久没碰过的开始
			repoRoots.delete(cwd);
			repoRoots.set(cwd, cached);
			return cached;
		}
		let root = cwd;
		try {
			const result = await invoke("read", cwd, ["rev-parse", "--show-toplevel"], {
				timeoutMs: READ_TIMEOUT_MS,
				maxBuffer: MAX_BUFFER_BYTES,
			});
			const text = result.stdout.trim();
			if (result.code === 0 && text.length > 0) {
				root = text;
			}
		} catch {
			// 不是仓库、超时、git 不在：都按「就地当根」，调用方自己会再判一次
		}
		repoRoots.set(cwd, root);
		for (const oldest of repoRoots.keys()) {
			if (repoRoots.size <= REPO_ROOT_LIMIT) {
				break;
			}
			repoRoots.delete(oldest);
		}
		return root;
	};

	/**
	 * 写一次，撞上 `index.lock` 就短退避重试。
	 *
	 * 锁只可能来自仓库外面（Agent 的终端、别的编辑器）：主机自己的写操作已经排成一条队。
	 */
	const writeWithRetry = async (
		cwd: string,
		args: readonly string[],
		runOptions: GitRunOptions,
	): Promise<GitResult> => {
		for (let attempt = 0; ; attempt += 1) {
			const result = await invoke("write", cwd, args, runOptions);
			if (result.code === 0 || !isLockConflict(result.stderr)) {
				return result;
			}
			const delay = LOCK_RETRY_DELAYS_MS[attempt];
			if (delay === undefined) {
				throw new GitLockedError(result.stderr);
			}
			await wait(delay);
		}
	};

	return {
		runRead: async (cwd, args, readOptions = {}) =>
			await invoke("read", cwd, args, {
				timeoutMs: readOptions.timeoutMs ?? READ_TIMEOUT_MS,
				maxBuffer: readOptions.maxBuffer ?? MAX_BUFFER_BYTES,
				signal: readOptions.signal,
			}),
		runReadStreaming: async (cwd, args, streamingOptions) => {
			const result = await runner.run(gitInvocation("read", cwd, args), {
				timeoutMs: streamingOptions.timeoutMs ?? READ_TIMEOUT_MS,
				maxBuffer: streamingOptions.maxBuffer ?? MAX_BUFFER_BYTES,
				signal: streamingOptions.signal,
				onStdout: streamingOptions.onStdout,
			});
			if (result.stopped === "abort") {
				throw new GitAbortedError();
			}
			return { code: result.code, stderr: result.stderr, stopped: result.stopped };
		},
		runWrite: async (cwd, args, writeOptions = {}) => {
			const root = await repoRootOf(cwd);
			const runOptions: GitRunOptions = {
				timeoutMs: writeOptions.timeoutMs ?? WRITE_TIMEOUT_MS,
				maxBuffer: MAX_BUFFER_BYTES,
				signal: writeOptions.signal,
			};
			return await serialized(writeQueues, root, async () => await writeWithRetry(cwd, args, runOptions));
		},
		repoRootOf,
	};
}

/** 把一条任务接到某个键的队尾；前一条失败也不挡下一条。 */
async function serialized<T>(
	queues: Map<string, Promise<void>>,
	key: string,
	task: () => Promise<T>,
): Promise<T> {
	const previous = queues.get(key) ?? Promise.resolve();
	// 队列里只记「上一次结束了」，错误由各自的调用方收下
	const current = previous.then(task, task);
	const tail = current.then(
		() => undefined,
		() => undefined,
	);
	queues.set(key, tail);
	void tail.then(() => {
		// 队尾就是自己时清掉这一条：不留下空队列
		if (queues.get(key) === tail) {
			queues.delete(key);
		}
	});
	return await current;
}

/** 这句话是不是「索引被别的进程叼着」。 */
function isLockConflict(stderr: string): boolean {
	return /index\.lock/i.test(stderr);
}

/** 等一会儿再重试。 */
function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/** 一次跑完再收结果：`execFile` 不经过 shell，参数逐个传入。 */
function runBuffered(invocation: GitInvocation, options: GitRunOptions): Promise<GitProcessResult> {
	return new Promise((resolve, reject) => {
		let aborted = false;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const child = execFile(
			invocation.command,
			invocation.args,
			{
				env: invocation.env,
				timeout: options.timeoutMs,
				maxBuffer: options.maxBuffer,
				killSignal: "SIGTERM",
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				clearTimeout(killTimer);
				options.signal?.removeEventListener("abort", stop);
				if (error === null) {
					resolve({ code: 0, stdout, stderr, stopped: null });
					return;
				}
				const failure = error as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
				if (aborted) {
					resolve({ code: null, stdout, stderr, stopped: "abort" });
					return;
				}
				if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
					resolve({ code: null, stdout: "", stderr, stopped: "limit" });
					return;
				}
				if (failure.killed === true) {
					resolve({ code: null, stdout, stderr, stopped: "timeout" });
					return;
				}
				// git 用非零退出码表达「有差异」这类正常结果，交给业务层判断
				if (typeof failure.code === "number" && failure.code !== 127) {
					resolve({ code: failure.code, stdout, stderr, stopped: null });
					return;
				}
				reject(error);
			},
		);
		/** 先 SIGTERM 再 SIGKILL：git 收尾时也可能卡住。 */
		const stop = (): void => {
			aborted = true;
			child.kill("SIGTERM");
			killTimer = setTimeout(() => {
				child.kill("SIGKILL");
			}, KILL_GRACE_MS);
			killTimer.unref?.();
		};
		if (options.signal?.aborted === true) {
			stop();
		} else {
			options.signal?.addEventListener("abort", stop, { once: true });
		}
	});
}

/** 边读边交给调用方；stdin 直接关掉，免得哪个子命令等着输入。 */
function runStreaming(invocation: GitInvocation, options: GitRunOptions): Promise<GitProcessResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(invocation.command, invocation.args, {
			env: invocation.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		const stdout = child.stdout;
		const stderrStream = child.stderr;
		if (stdout === null || stderrStream === null) {
			// 拿不到管道就没有流式可言：按起不来处理
			child.kill("SIGKILL");
			reject(new Error("git 子进程没有可读的管道"));
			return;
		}
		let stderr = "";
		let stopped: GitProcessResult["stopped"] = null;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const kill = (): void => {
			child.kill("SIGTERM");
			killTimer = setTimeout(() => {
				child.kill("SIGKILL");
			}, KILL_GRACE_MS);
			killTimer.unref?.();
		};
		const timer = setTimeout(() => {
			stopped = "timeout";
			kill();
		}, options.timeoutMs);
		const stop = (): void => {
			stopped = "abort";
			kill();
		};
		if (options.signal?.aborted === true) {
			stop();
		} else {
			options.signal?.addEventListener("abort", stop, { once: true });
		}
		stdout.setEncoding("utf8");
		stdout.on("data", (chunk: string) => {
			if (stopped !== null) {
				return;
			}
			if (options.onStdout?.(chunk) === true) {
				stopped = "limit";
				kill();
			}
		});
		stderrStream.setEncoding("utf8");
		stderrStream.on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-STDERR_TAIL_BYTES);
		});
		const settle = (code: number | null): void => {
			clearTimeout(timer);
			clearTimeout(killTimer);
			options.signal?.removeEventListener("abort", stop);
			resolve({ code, stdout: "", stderr, stopped });
		};
		child.on("error", (error: unknown) => {
			if (stopped !== null) {
				settle(null);
				return;
			}
			reject(error);
		});
		child.on("close", (code) => {
			settle(code);
		});
	});
}

/** 真起进程的那一份。 */
const nodeRunner: GitRunner = {
	run(invocation, options) {
		return options.onStdout === undefined
			? runBuffered(invocation, options)
			: runStreaming(invocation, options);
	},
};

/** 默认执行器：业务层用的就是这一份。 */
export const gitExec: GitExec = createGitExec();
