/**
 * 本机主机的拉起与接管。
 *
 * 主机是能独立于桌面运行的进程：桌面拉起它时让它自己成一组进程，日志写进数据目录的
 * server.log。连接位置是固定契约——数据目录下的 `facet.sock`——桌面上来就连，连得上说明主机
 * 在跑，连不上就自己拉起一个。数据目录里的 `endpoint.json` 只留作排障用，不参与连接。
 *
 * 桌面运行期间仍然看着它：进程退出后按退避间隔重新拉起；主动结束时不再拉起。
 */

import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { connect as connectSocket } from "node:net";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { type DiscoveryRecord, parseDiscovery } from "@facet/server";
import { StreamTransport } from "@facet/transport";

/** 发现文件名，与主机侧独立入口的约定一致；只用于排障，不参与连接。 */
const DISCOVERY_FILE = "endpoint.json";

/** 主机 socket 文件名，与主机侧的固定路径契约一致。 */
const SOCKET_FILE = "facet.sock";

/** 就绪等待的上限，超时按启动失败处理。 */
const READY_TIMEOUT_MS = 20_000;

/** 探测已有主机的握手超时，短一些，免得启动时久等。 */
const PROBE_TIMEOUT_MS = 800;

/** 重启退避：首次很快，连续失败时放慢到上限。 */
const RESTART_DELAYS_MS = [200, 500, 1000, 2000, 5000, 10_000];

/**
 * 本机主机的连接信息。
 *
 * 只有 socket 路径：没有端口也没有令牌，身份由 socket 的 `0600` 与目录的 `0700` 保证。
 */
export interface LocalHost {
	/** unix socket 路径 */
	readonly path: string;
}

/**
 * 本机主机 socket 的固定路径，与主机侧按同一规则推导。
 *
 * 优先运行目录（`$XDG_RUNTIME_DIR/<数据目录名>.sock`），没有时退回数据目录。
 */
export function hostSocketPath(
	dataDir: string,
	env: Record<string, string | undefined> = process.env,
): string {
	const runtime = env.XDG_RUNTIME_DIR?.trim();
	if (runtime !== undefined && runtime.length > 0 && isAbsolute(runtime)) {
		return join(runtime, `${basename(dataDir)}.sock`);
	}
	return join(dataDir, SOCKET_FILE);
}

/**
 * 按 XDG 规范取应用数据目录，与主机侧的规则保持一致。
 *
 * 桌面要靠这个目录找 endpoint.json，两边算法不一致就接不上已经跑着的主机。开发实例与发布
 * 实例分开：目录名带 -dev 后缀，两边的项目清单、设置与主机身份互不覆盖。
 */
export function resolveDataDir(
	env: Record<string, string | undefined>,
	options: { isDev?: boolean } = {},
): string {
	const explicit = env.FACET_DATA_DIR?.trim();
	if (explicit !== undefined && explicit.length > 0) {
		return explicit;
	}
	const xdg = env.XDG_DATA_HOME?.trim();
	const base = xdg !== undefined && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "share");
	return join(base, options.isDev === true ? "facet-dev" : "facet");
}

/** 解析发现文件的内容，缺字段或读不懂时返回 undefined。 */
export function readDiscoveryFile(text: string): DiscoveryRecord | undefined {
	return parseDiscovery(text);
}

/** 连到本机主机：unix socket，不带令牌，身份由内核按文件权限判定。 */
export function connectLocalHost(host: LocalHost, timeoutMs = PROBE_TIMEOUT_MS) {
	return new StreamTransport({
		handshakeTimeoutMs: timeoutMs,
		createStream: async () => openStream({ path: host.path }),
	});
}

/** 按 unix socket 或 TCP 建一条字节流。 */
export async function openStream(target: { path: string } | { host: string; port: number }) {
	const socket =
		"path" in target
			? connectSocket({ path: target.path })
			: connectSocket({ host: target.host, port: target.port });
	socket.setEncoding("utf8");
	await new Promise<void>((resolve, reject) => {
		socket.once("connect", () => resolve());
		socket.once("error", reject);
	});
	return {
		write: (text: string) => socket.write(text),
		onData: (listener: (chunk: string) => void) => {
			socket.on("data", listener);
			return () => socket.off("data", listener);
		},
		onClose: (listener: (reason: string) => void) => {
			socket.on("close", () => listener("closed"));
			return () => socket.removeAllListeners("close");
		},
		close: () => {
			socket.end();
			socket.destroy();
		},
	};
}

/** 进程是否还在。权限不足按存活处理，交给后面的握手判断。 */
export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** 握手一次，连不上或超时返回 false。 */
async function defaultProbe(host: LocalHost): Promise<boolean> {
	const transport = connectLocalHost(host);
	try {
		await transport.connect();
		return true;
	} catch {
		return false;
	} finally {
		transport.close();
	}
}

export interface RunningHostOptions {
	/** 数据目录，socket 在这里 */
	dataDir: string;
	/** 握手探测，测试里换成本地实现 */
	probe?: (host: LocalHost) => Promise<boolean>;
}

/**
 * 找一台已经在跑的主机。
 *
 * 判断只看一件事：固定路径上的 socket 能不能握手。连不上就当作没开。
 */
export async function findRunningHost(options: RunningHostOptions): Promise<LocalHost | undefined> {
	const host: LocalHost = { path: hostSocketPath(options.dataDir) };
	const probe = options.probe ?? defaultProbe;
	return (await probe(host)) ? host : undefined;
}

/** 读发现文件，只用于日志与排障，不参与连接。 */
export async function readDiscovery(dataDir: string): Promise<DiscoveryRecord | undefined> {
	try {
		return readDiscoveryFile(await readFile(join(dataDir, DISCOVERY_FILE), "utf8"));
	} catch {
		return undefined;
	}
}

export interface HostDaemonOptions {
	/** 启动命令：指向 server 产物里自带的 node */
	command: string;
	/** 启动参数 */
	args: readonly string[];
	/** 数据目录 */
	dataDir: string;
	/** 追加给主机进程的环境变量 */
	env?: NodeJS.ProcessEnv;
	/** 主机就绪，参数是发现文件里的内容 */
	onReady(info: LocalHost): void;
	/** 主机退出；restarting 为 true 表示随后会自动重启 */
	onExit(code: number | null, restarting: boolean): void;
	/** 日志行，来自 server.log 之外的主进程 */
	log(line: string): void;
	/** 判断就绪，测试里换成本地实现 */
	probe?: (host: LocalHost) => Promise<boolean>;
}

export class HostDaemon {
	private readonly options: HostDaemonOptions;
	private child: ReturnType<typeof spawn> | undefined;
	/** 连续重启的次数，就绪后清零 */
	private restartCount = 0;
	private restartTimer: NodeJS.Timeout | undefined;
	private readyTimer: NodeJS.Timeout | undefined;

	constructor(options: HostDaemonOptions) {
		this.options = options;
	}

	/** 主机进程是否由本进程拉起且还在运行。 */
	get isRunning(): boolean {
		return this.child !== undefined;
	}

	/** 拉起主机。已在运行时什么都不做。 */
	start(): void {
		if (this.child !== undefined) {
			return;
		}
		// 日志写文件：主机要能脱离桌面继续跑，桌面的管道关掉之后不该再有写入
		const logFile = openSync(join(this.options.dataDir, "server.log"), "a");
		// 启动命令与其中要带的变量都由调用方给定：打包后是自带的 node，开发时是 Electron
		const child = spawn(this.options.command, [...this.options.args], {
			cwd: this.options.dataDir,
			env: { ...process.env, ...this.options.env },
			// 自成一组：桌面退出不会把它一起带走
			detached: true,
			stdio: ["ignore", logFile, logFile],
		});
		closeSync(logFile);
		child.unref();
		this.child = child;
		this.readyTimer = setTimeout(() => {
			this.options.log(`主机 ${READY_TIMEOUT_MS} 毫秒内没有就绪，按启动失败处理`);
			child.kill("SIGKILL");
		}, READY_TIMEOUT_MS);
		void this.watch();
		child.on("exit", (code) => {
			this.clearTimers();
			if (this.child === child) {
				this.child = undefined;
			}
			this.options.onExit(code, true);
			this.scheduleRestart();
		});
	}

	/** 等固定路径上的 socket 能握手，就绪后回调一次。 */
	private async watch(): Promise<void> {
		const probe = this.options.probe ?? defaultProbe;
		const host: LocalHost = { path: hostSocketPath(this.options.dataDir) };
		while (this.child !== undefined && this.readyTimer !== undefined) {
			if (await probe(host)) {
				this.clearTimers();
				this.restartCount = 0;
				this.options.onReady(host);
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 150));
		}
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
