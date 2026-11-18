/**
 * 主机发现文件的格式。
 *
 * 数据目录里的 `endpoint.json` 记录主机怎么连：本地 socket 位置或 TCP 端点、连接令牌、
 * 主机标识与进程。写盘与权限收窄在主机侧，读与解析在端点侧，两边共用这里的类型与解析，
 * 免得字段各写一份。这里只有纯数据，不碰文件系统。
 */

/** 发现文件的格式版本。字段不兼容的改动递增它。 */
export const DISCOVERY_SCHEMA_VERSION = 2;

/**
 * 一条主机的连接方式。
 *
 * `unix` 这类本地字节流在 Linux 与 macOS 上是 unix socket，Windows 上是命名管道；
 * 两者都只是本机连、不占端口的地址，格式因此共用一条，`path` 里存具体位置。
 */
export type DiscoveryEndpoint =
	| { readonly transport: "unix"; readonly path: string }
	| { readonly transport: "tcp"; readonly url: string };

/** 写进 `endpoint.json` 的内容。 */
export interface DiscoveryRecord {
	/** 格式版本 */
	schemaVersion: number;
	/** 连接方式 */
	endpoint: DiscoveryEndpoint;
	/** 连接令牌，握手第一帧要带上 */
	token: string | undefined;
	/** 主机标识 */
	hostId: string;
	/** 实际生效的 pi 数据目录 */
	agentDir: string;
	/** 进程标识，外部工具据此判断发现文件是否还有效 */
	pid: number;
	/** 写入时间，毫秒 */
	startedAt: number;
}

/** 解析发现文件的内容，缺字段或读不懂时返回 undefined。 */
export function parseDiscovery(text: string): DiscoveryRecord | undefined {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof data !== "object" || data === null) {
		return undefined;
	}
	const record = data as Record<string, unknown>;
	const endpoint = record.endpoint;
	if (typeof endpoint !== "object" || endpoint === null) {
		return undefined;
	}
	const kind = endpoint as Record<string, unknown>;
	const transport =
		kind.transport === "unix" && typeof kind.path === "string"
			? ({ transport: "unix", path: kind.path } as const)
			: kind.transport === "tcp" && typeof kind.url === "string"
				? ({ transport: "tcp", url: kind.url } as const)
				: undefined;
	if (transport === undefined) {
		return undefined;
	}
	if (typeof record.pid !== "number" || !Number.isInteger(record.pid) || record.pid <= 0) {
		return undefined;
	}
	return {
		schemaVersion: typeof record.schemaVersion === "number" ? record.schemaVersion : 1,
		endpoint: transport,
		token: typeof record.token === "string" ? record.token : undefined,
		hostId: typeof record.hostId === "string" ? record.hostId : "",
		agentDir: typeof record.agentDir === "string" ? record.agentDir : "",
		pid: record.pid,
		startedAt: typeof record.startedAt === "number" ? record.startedAt : 0,
	};
}

/** 这条记录指向哪个端点标识，界面与日志里用它显示地址。 */
export function describeDiscovery(record: DiscoveryRecord): string {
	return record.endpoint.transport === "unix" ? record.endpoint.path : record.endpoint.url;
}
