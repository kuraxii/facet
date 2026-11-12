/**
 * 本机主机的拉起与接管。
 *
 * 主机是能独立于桌面运行的进程：桌面拉起它时让它自己成一组进程，日志写进数据目录的
 * host.log，就绪信息通过数据目录里的 endpoint.json 交接。桌面退出后主机继续跑，下次启动
 * 按发现文件重新接上，会话与运行中的任务都还在。
 *
 * 桌面运行期间仍然看着它：进程退出后按退避间隔重新拉起；主动结束时不再拉起。
 */

import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { connect as connectSocket } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { type DiscoveryRecord, parseDiscovery } from "@facet/server";
import { StreamTransport } from "@facet/transport";

/** 发现文件名，与主机侧独立入口的约定一致。 */
const DISCOVERY_FILE = "endpoint.json";

/** 就绪等待的上限，超时按启动失败处理。 */
const READY_TIMEOUT_MS = 20_000;

/** 探测已有主机的握手超时，短一些，免得启动时久等。 */
const PROBE_TIMEOUT_MS = 800;

/** 重启退避：首次很快，连续失败时放慢到上限。 */
const RESTART_DELAYS_MS = [200, 500, 1000, 2000, 5000, 10_000];

/** endpoint.json 里的内容，格式由主机侧定义。 */
export type HostDiscovery = DiscoveryRecord;

/**
 * 按 XDG 规范取应用数据目录，与主机侧的规则保持一致。
 *
 * 桌面要靠这个目录找 endpoint.json，两边算法不一致就接不上已经跑着的主机。
 */
export function resolveDataDir(env: Record<string, string | undefined>): string {
	const explicit = env.FACET_DATA_DIR?.trim();
	if (explicit !== undefined && explicit.length > 0) {
		return explicit;
	}
	const xdg = env.XDG_DATA_HOME?.trim();
	const base = xdg !== undefined && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "share");
	return join(base, "facet");
}

/** 解析发现文件的内容，缺字段或读不懂时返回 undefined。 */
export function readDiscoveryFile(text: string): HostDiscovery | undefined {
	return parseDiscovery(text);
}

/** 这条发现记录对应的连接地址，日志与界面里显示它。 */
export function discoveryAddress(discovery: HostDiscovery): string {
	return discovery.endpoint.transport === "unix" ? discovery.endpoint.path : discovery.endpoint.url;
}

/**
 * 按发现记录建一个已连好的传输，连不上时抛错。
 *
 * unix socket 走字节流，TCP 走 WebSocket；两者都要带连接令牌。
 */
export function connectToDiscovery(discovery: HostDiscovery, timeoutMs = PROBE_TIMEOUT_MS) {
	const target =
		discovery.endpoint.transport === "unix"
			? { path: discovery.endpoint.path }
			: {
					host: new URL(discovery.endpoint.url).hostname,
					port: Number(new URL(discovery.endpoint.url).port),
				};
	return new StreamTransport({
		token: discovery.token,
		handshakeTimeoutMs: timeoutMs,
		createStream: async () => openStream(target),
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
async function defaultProbe(discovery: HostDiscovery): Promise<boolean> {
	const transport = connectToDiscovery(discovery);
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
	/** 数据目录，发现文件在这里 */
	dataDir: string;
	/** 握手探测，测试里换成本地实现 */
	probe?: (discovery: HostDiscovery) => Promise<boolean>;
}

/**
 * 找一台已经在跑的主机。
 *
 * 发现文件指向的进程已经不在、或握手不通时删掉发现文件，按没有主机处理。
 */
export async function findRunningHost(options: RunningHostOptions): Promise<HostDiscovery | undefined> {
	const file = join(options.dataDir, DISCOVERY_FILE);
	let text: string;
	try {
		text = await readFile(file, "utf8");
	} catch {
		return undefined;
	}
	const discovery = readDiscoveryFile(text);
	if (discovery === undefined || !isProcessAlive(discovery.pid)) {
		await rm(file, { force: true }).catch(() => undefined);
		return undefined;
	}
	const probe = options.probe ?? defaultProbe;
	if (!(await probe(discovery))) {
		await rm(file, { force: true }).catch(() => undefined);
		return undefined;
	}
	return discovery;
}

/** 读发现文件，不问进程是否还在，测试用来断言写入结果。 */
export async function readDiscovery(dataDir: string): Promise<HostDiscovery | undefined> {
	try {
		return readDiscoveryFile(await readFile(join(dataDir, DISCOVERY_FILE), "utf8"));
	} catch {
		return undefined;
	}
}

export interface HostDaemonOptions {
	/** 主机入口脚本，打包前后都是 out/main/host.js */
	entry: string;
	/** 数据目录 */
	dataDir: string;
	/** 追加给主机进程的环境变量 */
	env?: NodeJS.ProcessEnv;
	/** 主机就绪，参数是发现文件里的内容 */
	onReady(info: HostDiscovery): void;
	/** 主机退出；restarting 为 true 表示随后会自动重启 */
	onExit(code: number | null, restarting: boolean): void;
	/** 日志行，来自 host.log 之外的主进程 */
	log(line: string): void;
	/** 找已存在的主机与判断就绪，测试里换成本地实现 */
	probe?: (discovery: HostDiscovery) => Promise<boolean>;
}

export class HostDaemon {
	private readonly options: HostDaemonOptions;
	private child: ReturnType<typeof spawn> | undefined;
	/** 主动停止中，退出后不再重启 */
	private stopping = false;
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

	/** 发现文件路径。 */
	get discoveryFile(): string {
		return join(this.options.dataDir, DISCOVERY_FILE);
	}

	/** 拉起主机。已在运行时什么都不做。 */
	start(): void {
		if (this.child !== undefined) {
			return;
		}
		this.stopping = false;
		// 日志写文件：主机要能脱离桌面继续跑，桌面的管道关掉之后不该再有写入
		const logFile = openSync(join(this.options.dataDir, "host.log"), "a");
		// 用 Electron 自己的可执行文件当 Node 跑，打包后不需要额外的 node 安装
		const child = spawn(process.execPath, [this.options.entry], {
			cwd: this.options.dataDir,
			env: {
				...process.env,
				...this.options.env,
				ELECTRON_RUN_AS_NODE: "1",
			},
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
			const restarting = !this.stopping;
			this.options.onExit(code, restarting);
			if (restarting) {
				this.scheduleRestart();
			}
		});
	}

	/**
	 * 结束主机。
	 *
	 * 先按发现文件里的进程标识请它自己收尾（删发现文件、关端点），进程不在了就算了；
	 * 收尾期间一直在等，超时补一次 SIGTERM。
	 */
	async stop(): Promise<void> {
		this.stopping = true;
		this.clearTimers();
		this.child = undefined;
		await stopDiscoveredHost(this.options.dataDir);
	}

	/** 等发现文件出现并与主机握手，就绪后回调一次。 */
	private async watch(): Promise<void> {
		const probe = this.options.probe ?? defaultProbe;
		while (this.child !== undefined && this.readyTimer !== undefined) {
			const discovery = await readDiscovery(this.options.dataDir);
			if (discovery !== undefined && discovery.pid !== undefined && (await probe(discovery))) {
				this.clearTimers();
				this.restartCount = 0;
				this.options.onReady(discovery);
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

/**
 * 结束数据目录里记着的那台主机。
 *
 * 这台主机可能是本次拉起的，也可能是上次留下的，按发现文件里的进程标识处理。
 */
export async function stopDiscoveredHost(dataDir: string): Promise<void> {
	const discovery = await readDiscovery(dataDir);
	if (discovery === undefined || !isProcessAlive(discovery.pid)) {
		return;
	}
	const pid = discovery.pid;
	// 请主机自己收尾，它会把发现文件删掉、端点关干净；信号对它不一定送达
	if (await requestShutdown(discovery)) {
		await waitForExit(pid, 3000);
		if (!isProcessAlive(pid)) {
			return;
		}
	}
	await stopProcess(pid);
}

/** 发一个结束主机的请求，连不上或超时返回 false。 */
async function requestShutdown(discovery: HostDiscovery): Promise<boolean> {
	const transport = connectToDiscovery(discovery);
	try {
		await transport.connect();
		await transport.request("shutdownHost", {});
		return true;
	} catch {
		return false;
	} finally {
		transport.close();
	}
}

/** 等进程退出，超时返回。 */
async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isProcessAlive(pid)) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

/** 请一个进程退出：SIGTERM 后还在就 SIGKILL。 */
async function stopProcess(pid: number): Promise<void> {
	if (!isProcessAlive(pid)) {
		return;
	}
	await new Promise<void>((resolve) => {
		const timer = setInterval(() => {
			if (!isProcessAlive(pid)) {
				clearInterval(timer);
				resolve();
			}
		}, 100);
		process.kill(pid, "SIGTERM");
		setTimeout(() => {
			if (isProcessAlive(pid)) {
				process.kill(pid, "SIGKILL");
			}
		}, 3000).unref();
		setTimeout(() => {
			clearInterval(timer);
			resolve();
		}, 5000).unref();
	});
}
