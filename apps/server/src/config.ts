/**
 * 主机侧配置。
 *
 * 全部来自环境变量，缺省值面向本机嵌入运行：只监听回环地址，端口由系统分配，
 * 数据写在 facet 自己的目录，与命令行工具的数据目录分开。
 */
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { DEFAULT_AGENT_DIR } from "@facet/agent";

/** 主机的运行配置。 */
export interface ServerConfig {
	/** 监听地址，缺省 127.0.0.1；远程接入需要显式改动并配合 SSH 通道 */
	host: string;
	/** 监听端口，0 表示由系统分配 */
	port: number;
	/** 数据目录，内含凭证、模型配置与会话文件；缺省为 facet 的开发目录 */
	agentDir: string | undefined;
	/** 会话文件目录，缺省按工作目录分组存放 */
	sessionDir: string | undefined;
	/** 应用数据目录，缺省按 XDG 规范取 `$XDG_DATA_HOME/facet` */
	dataDir: string;
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
const DEFAULT_PORT = 0;
const DEFAULT_REPLAY_LIMIT = 512;
const DEFAULT_SESSION_IDLE_MS = 3000;

/** 读取布尔开关，未设置或为空按关闭处理。 */
function readFlag(value: string | undefined): boolean {
	const normalized = value?.trim().toLowerCase();
	return normalized === "1" || normalized === "true";
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
	return {
		host: env.FACET_HOST?.trim() || DEFAULT_HOST,
		port: readInt(env.FACET_PORT, DEFAULT_PORT),
		agentDir: env.FACET_AGENT_DIR?.trim() || DEFAULT_AGENT_DIR,
		sessionDir: env.FACET_SESSION_DIR?.trim() || undefined,
		dataDir: env.FACET_DATA_DIR?.trim() || defaultDataDir(env),
		replayLimit: readInt(env.FACET_REPLAY_LIMIT, DEFAULT_REPLAY_LIMIT) || DEFAULT_REPLAY_LIMIT,
		sessionIdleMs: readInt(env.FACET_SESSION_IDLE_MS, DEFAULT_SESSION_IDLE_MS),
		hostName: hostName && hostName.length > 0 ? hostName : "facet",
		debug: readFlag(env.FACET_DEBUG),
	};
}
