/**
 * 嵌入主机的子进程。
 *
 * 桌面端把主机当作独立进程拉起：主机崩掉时桌面界面还在，主进程负责重启并把新的端点地址
 * 通知界面。子进程就绪后打印一行 `facet-host-ready` 加 JSON，其余输出直接转到桌面端的日志，
 * 前面加 `[host]` 便于分辨。
 */
import { type ChildProcess, spawn } from "node:child_process";

/** 就绪行的标记，与主机的独立入口约定一致。 */
const READY_MARKER = "facet-host-ready";

/** 子进程就绪后报告的内容。 */
export interface HostReadyInfo {
	/** WebSocket 端点地址 */
	endpoint: string;
	/** 主机标识 */
	hostId: string;
	/** 实际生效的 pi 数据目录 */
	agentDir: string;
	/** 子进程标识 */
	pid: number;
}

/** 就绪超时，超时按崩溃处理。 */
const READY_TIMEOUT_MS = 20_000;

/** 重启退避：首次很快，连续失败时放慢到上限。 */
const RESTART_DELAYS_MS = [200, 500, 1000, 2000, 5000, 10_000];

export interface HostProcessOptions {
	/** 子进程入口脚本，打包前后都是 out/main/host.js */
	entry: string;
	/** 追加给子进程的环境变量 */
	env?: NodeJS.ProcessEnv;
	/** 子进程就绪，参数是主机报告的端点信息 */
	onReady(info: HostReadyInfo): void;
	/** 子进程退出；restarting 为 true 表示随后会自动重启 */
	onExit(code: number | null, restarting: boolean): void;
	/** 子进程的普通输出 */
	log(line: string): void;
	/** 子进程的错误输出 */
	error(line: string): void;
}

/** 从一行输出里取就绪信息，不是就绪行时不返回。 */
export function parseReadyLine(line: string): HostReadyInfo | undefined {
	if (!line.startsWith(READY_MARKER)) {
		return undefined;
	}
	let data: unknown;
	try {
		data = JSON.parse(line.slice(READY_MARKER.length).trim());
	} catch {
		return undefined;
	}
	if (typeof data !== "object" || data === null) {
		return undefined;
	}
	const record = data as Record<string, unknown>;
	if (typeof record.endpoint !== "string" || typeof record.hostId !== "string") {
		return undefined;
	}
	return {
		endpoint: record.endpoint,
		hostId: record.hostId,
		agentDir: typeof record.agentDir === "string" ? record.agentDir : "",
		pid: typeof record.pid === "number" ? record.pid : 0,
	};
}

export class HostProcess {
	private readonly options: HostProcessOptions;
	private child: ChildProcess | undefined;
	/** 主动停止中，退出后不再重启 */
	private stopping = false;
	/** 连续重启的次数，就绪后清零 */
	private restartCount = 0;
	private restartTimer: NodeJS.Timeout | undefined;
	private readyTimer: NodeJS.Timeout | undefined;

	constructor(options: HostProcessOptions) {
		this.options = options;
	}

	/** 子进程是否还在运行。 */
	get isRunning(): boolean {
		return this.child !== undefined;
	}

	/** 拉起子进程。已在运行时什么都不做。 */
	start(): void {
		if (this.child !== undefined) {
			return;
		}
		this.stopping = false;
		// 用 Electron 自己的可执行文件当 Node 跑，打包后不需要额外的 node 安装
		const child = spawn(process.execPath, [this.options.entry], {
			env: {
				...process.env,
				...this.options.env,
				ELECTRON_RUN_AS_NODE: "1",
				FACET_PARENT_PID: String(process.pid),
			},
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child = child;
		this.collect(child.stdout, (line) => this.handleLine(line));
		this.collect(child.stderr, (line) => this.options.error(line));
		this.readyTimer = setTimeout(() => {
			this.options.error(`主机 ${READY_TIMEOUT_MS} 毫秒内没有就绪，按崩溃处理`);
			child.kill("SIGKILL");
		}, READY_TIMEOUT_MS);
		child.on("exit", (code) => {
			this.clearTimers();
			if (this.child === child) {
				this.child = undefined;
			}
			const restarting = !this.stopping;
			this.options.onExit(code, restarting);
			if (restarting) {
				this.scheduleRestart();
			}
		});
	}

	/**
	 * 停止子进程。
	 *
	 * 先通过标准输入让它自己收尾（Electron 以 Node 方式运行时信号不一定送到 JS 层），
	 * 超时再依次补 SIGTERM 与 SIGKILL。
	 */
	async stop(): Promise<void> {
		this.stopping = true;
		this.clearTimers();
		const child = this.child;
		if (child === undefined) {
			return;
		}
		this.child = undefined;
		await new Promise<void>((resolve) => {
			child.once("exit", () => resolve());
			child.stdin?.write("stop\n");
			setTimeout(() => child.kill("SIGTERM"), 3000).unref();
			setTimeout(() => child.kill("SIGKILL"), 6000).unref();
		});
	}

	/** 按流里的换行切行。 */
	private collect(stream: NodeJS.ReadableStream | null, handle: (line: string) => void): void {
		if (stream === null) {
			return;
		}
		let buffer = "";
		stream.setEncoding("utf8");
		stream.on("data", (chunk: string) => {
			buffer += chunk;
			let index = buffer.indexOf("\n");
			while (index >= 0) {
				handle(buffer.slice(0, index).trimEnd());
				buffer = buffer.slice(index + 1);
				index = buffer.indexOf("\n");
			}
		});
	}

	/** 处理一行输出：就绪行转成事件，其余当日志。 */
	private handleLine(line: string): void {
		if (line.length === 0) {
			return;
		}
		const ready = parseReadyLine(line);
		if (ready === undefined) {
			this.options.log(line);
			return;
		}
		this.clearTimers();
		this.restartCount = 0;
		this.options.onReady(ready);
	}

	/** 排一次重启，连续失败时逐步放慢。 */
	private scheduleRestart(): void {
		const index = Math.min(this.restartCount, RESTART_DELAYS_MS.length - 1);
		this.restartCount += 1;
		const delay = RESTART_DELAYS_MS[index] ?? 10_000;
		this.restartTimer = setTimeout(() => {
			this.restartTimer = undefined;
			this.start();
		}, delay);
	}

	private clearTimers(): void {
		if (this.readyTimer !== undefined) {
			clearTimeout(this.readyTimer);
			this.readyTimer = undefined;
		}
		if (this.restartTimer !== undefined) {
			clearTimeout(this.restartTimer);
			this.restartTimer = undefined;
		}
	}
}
