/**
 * 主机侧配置。
 *
 * 全部来自环境变量，缺省值面向本机嵌入运行：只监听回环地址，端口由系统分配，
 * 数据写在 facet 自己的目录，与命令行工具的数据目录分开。
 */
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { DEFAULT_AGENT_DIR } from "@facet/agent";

/** 主机的运行配置。 */
export interface ServerConfig {
	/** 监听地址，缺省 127.0.0.1；远程接入需要显式改动并配合 SSH 通道 */
	host: string;
	/** 监听端口，0 表示由系统分配；给出 socketPath 时不用它 */
	port: number;
	/**
	 * unix socket 路径或 Windows 命名管道名。
	 *
	 * 给出时不再监听 TCP：帧按行直接跑在字节流上，远端可以不开放任何端口。
	 */
	socketPath: string | undefined;
	/**
	 * Web 接入的端口，缺省关闭。
	 *
	 * 给出时同一个端口发页面也接 WebSocket；这是唯一需要接入开关的入口。
	 */
	webPort: number | undefined;
	/** Web 页面的构建产物目录，缺省不提供页面 */
	webRoot: string | undefined;
	/**
	 * 连接令牌，端点握手的第一帧带它，不匹配直接断开。
	 *
	 * 空表示不校验，只用于本机调试；独立运行入口缺省生成一个随机值写进发现文件。
	 */
	token: string | undefined;
	/** 数据目录，内含凭证、模型配置与会话文件；缺省为 facet 的开发目录 */
	agentDir: string | undefined;
	/** 会话文件目录，缺省按工作目录分组存放 */
	sessionDir: string | undefined;
	/** 应用数据目录，缺省按 XDG 规范取 `$XDG_DATA_HOME/facet` */
	dataDir: string;
	/**
	 * 远程连接的权限上限。
	 *
	 * 远程端在认证帧里声明要用只读还是操作档，主机按这里收窄：view 时一律只读，
	 * operate 时才允许它自称操作档。改设置、凭证、增删项目与结束主机只允许本机。
	 */
	remotePermission: "view" | "operate";
	/** 每个会话保留的事件条数，超出后丢弃最旧的，端点据此判断是否需要重新同步 */
	replayLimit: number;
	/** 没人订阅且不在运行后，等多久回收会话，毫秒 */
	sessionIdleMs: number;
	/** 主机展示名 */
	hostName: string;
	/** 是否输出开发期日志，由嵌入方在开发启动时打开 */
	debug: boolean;
}

const DEFAULT_HOST = "127.0.0.1";

/** 数据目录里固定使用的主机 socket 文件名。 */
const SOCKET_FILE = "facet.sock";
const DEFAULT_PORT = 0;
const DEFAULT_REPLAY_LIMIT = 512;
const DEFAULT_SESSION_IDLE_MS = 3000;

/** 生成连接令牌，独立运行入口与桌面拉起的主机都用它。 */
export function generateToken(): string {
	return randomBytes(24).toString("base64url");
}

/** 读取布尔开关，未设置或为空按关闭处理。 */
function readFlag(value: string | undefined): boolean {
	const normalized = value?.trim().toLowerCase();
	return normalized === "1" || normalized === "true";
}

/**
 * 本机 unix socket 的固定路径。
 *
 * 契约：优先 `$XDG_RUNTIME_DIR/<数据目录名>.sock`（运行目录随登录会话创建、退出即清理），
 * 没有运行目录时退回 `<数据目录>/facet.sock`。名字里的 `facet` / `facet-dev` 取自数据目录，
 * 开发实例与发布实例因此不会抢同一个 socket。
 *
 * `FACET_DATA_DIR` / `FACET_SOCKET` 可以覆盖，覆盖之后两端得自己对齐。
 */
export function defaultSocketPath(env: Record<string, string | undefined>, dataDir: string): string {
	const runtime = env.XDG_RUNTIME_DIR?.trim();
	if (runtime !== undefined && runtime.length > 0 && isAbsolute(runtime)) {
		return join(runtime, `${basename(dataDir)}.sock`);
	}
	return join(dataDir, SOCKET_FILE);
}

/** 按 XDG 规范取应用数据目录，非绝对路径的 XDG_DATA_HOME 按未设置处理。 */
function defaultDataDir(env: Record<string, string | undefined>): string {
	const xdg = env.XDG_DATA_HOME?.trim();
	const base = xdg !== undefined && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "share");
	return join(base, "facet");
}

function readInt(value: string | undefined, fallback: number): number {
	if (value === undefined || value.trim() === "") {
		return fallback;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** 从环境变量读取配置。 */
export function loadServerConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
	const hostName = env.FACET_HOST_NAME?.trim();
	const dataDir = env.FACET_DATA_DIR?.trim() || defaultDataDir(env);
	// 显式给了监听地址或端口就按 TCP 走；其余情况本机只开 unix socket，不占任何端口
	const wantsTcp = (env.FACET_HOST?.trim() ?? "") !== "" || (env.FACET_PORT?.trim() ?? "") !== "";
	return {
		host: env.FACET_HOST?.trim() || DEFAULT_HOST,
		port: readInt(env.FACET_PORT, DEFAULT_PORT),
		agentDir: env.FACET_AGENT_DIR?.trim() || DEFAULT_AGENT_DIR,
		sessionDir: env.FACET_SESSION_DIR?.trim() || undefined,
		dataDir,
		socketPath: env.FACET_SOCKET?.trim() || (wantsTcp ? undefined : defaultSocketPath(env, dataDir)),
		remotePermission: env.FACET_REMOTE_PERMISSION?.trim() === "operate" ? "operate" : "view",
		webPort: env.FACET_WEB_PORT === undefined ? undefined : readInt(env.FACET_WEB_PORT, 0) || undefined,
		webRoot: env.FACET_WEB_ROOT?.trim() || undefined,
		token: env.FACET_NO_TOKEN === "1" ? undefined : env.FACET_TOKEN?.trim() || generateToken(),
		replayLimit: readInt(env.FACET_REPLAY_LIMIT, DEFAULT_REPLAY_LIMIT) || DEFAULT_REPLAY_LIMIT,
		sessionIdleMs: readInt(env.FACET_SESSION_IDLE_MS, DEFAULT_SESSION_IDLE_MS),
		hostName: hostName && hostName.length > 0 ? hostName : "facet",
		debug: readFlag(env.FACET_DEBUG),
	};
}
