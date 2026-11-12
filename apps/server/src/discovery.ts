/**
 * 主机发现文件。
 *
 * 数据目录里的 endpoint.json 记录主机怎么连：unix socket 路径或 TCP 端点、连接令牌、
 * 主机标识与进程。桌面与其他工具按它发现已经在跑的主机。文件权限收到 0600、目录 0700，
 * 令牌因此只对当前用户可读。
 */
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** 发现文件的格式版本。字段不兼容的改动递增它。 */
export const DISCOVERY_SCHEMA_VERSION = 2;

/** 一条主机的连接方式。 */
export type DiscoveryEndpoint =
	| { readonly transport: "unix"; readonly path: string }
	| { readonly transport: "tcp"; readonly url: string };

/** 远程接入的地址，与连接方式同形。 */
export type RemoteEndpoint =
	| { readonly transport: "unix"; readonly path: string }
	| { readonly transport: "tcp"; readonly port: number };

/** 写进 endpoint.json 的内容。 */
export interface DiscoveryRecord {
	/** 格式版本 */
	schemaVersion: number;
	/** 连接方式 */
	endpoint: DiscoveryEndpoint;
	/** 连接令牌，握手第一帧要带上 */
	token: string | undefined;
	/** 远程接入的地址；未开启时没有，远程端据此判断能不能连 */
	remote?: RemoteEndpoint;
	/** 主机标识 */
	hostId: string;
	/** 实际生效的 pi 数据目录 */
	agentDir: string;
	/** 进程标识，外部工具据此判断发现文件是否还有效 */
	pid: number;
	/** 写入时间，毫秒 */
	startedAt: number;
}

/** 发现文件路径。 */
export function discoveryFile(dataDir: string): string {
	return join(dataDir, "endpoint.json");
}

/** 原子写发现文件并把权限收到仅本人可读。 */
export async function writeDiscovery(dataDir: string, record: DiscoveryRecord): Promise<void> {
	await mkdir(dataDir, { recursive: true, mode: 0o700 });
	// 目录已经存在时 mkdir 不改权限，这里显式收一次，令牌文件所在目录不给别人看
	await chmod(dataDir, 0o700).catch(() => undefined);
	const file = discoveryFile(dataDir);
	const temp = `${file}.tmp`;
	await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	await chmod(temp, 0o600).catch(() => undefined);
	const { rename } = await import("node:fs/promises");
	await rename(temp, file);
	await chmod(file, 0o600).catch(() => undefined);
}

/** 解析发现文件，缺字段或读不懂时返回 undefined。 */
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
	const remoteRaw = record.remote;
	const remoteSection =
		typeof remoteRaw === "object" && remoteRaw !== null ? (remoteRaw as Record<string, unknown>) : undefined;
	const remote: RemoteEndpoint | undefined =
		remoteSection?.transport === "unix" && typeof remoteSection.path === "string"
			? { transport: "unix", path: remoteSection.path }
			: remoteSection?.transport === "tcp" && typeof remoteSection.port === "number"
				? { transport: "tcp", port: remoteSection.port }
				: undefined;
	return {
		schemaVersion: typeof record.schemaVersion === "number" ? record.schemaVersion : 1,
		endpoint: transport,
		...(remote === undefined ? {} : { remote }),
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

/** 发现文件所在目录。 */
export function discoveryDir(dataDir: string): string {
	return dirname(discoveryFile(dataDir));
}
