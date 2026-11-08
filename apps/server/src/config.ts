/**
 * 设备侧配置。
 *
 * 全部来自环境变量，缺省值面向本机嵌入运行：只监听回环地址，端口由系统分配。
 */

/** 设备的运行配置。 */
export interface ServerConfig {
	/** 监听地址，缺省 127.0.0.1；远程接入需要显式改动并配合 SSH 通道 */
	host: string;
	/** 监听端口，0 表示由系统分配 */
	port: number;
	/** 全局配置目录，内含凭证与模型配置 */
	agentDir: string | undefined;
	/** 会话文件目录，缺省按工作目录分组存放 */
	sessionDir: string | undefined;
	/** 每个会话保留的事件条数，超出后丢弃最旧的，端点据此判断是否需要重新同步 */
	replayLimit: number;
	/** 设备展示名 */
	hostName: string;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 0;
const DEFAULT_REPLAY_LIMIT = 512;

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
		agentDir: env.FACET_AGENT_DIR?.trim() || undefined,
		sessionDir: env.FACET_SESSION_DIR?.trim() || undefined,
		replayLimit: readInt(env.FACET_REPLAY_LIMIT, DEFAULT_REPLAY_LIMIT) || DEFAULT_REPLAY_LIMIT,
		hostName: hostName && hostName.length > 0 ? hostName : "facet",
	};
}
