/**
 * 主机发现文件。
 *
 * 数据目录里的 endpoint.json 记录主机怎么连：unix socket 路径或 TCP 端点、连接令牌、
 * 主机标识与进程。桌面与其他工具按它发现已经在跑的主机。文件权限收到 0600、目录 0700，
 * 令牌因此只对当前用户可读。
 */
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DiscoveryRecord } from "@facet/protocol";

/** 发现文件的格式、类型与解析在协议包里，主机与端点共用一份。 */
export {
	DISCOVERY_SCHEMA_VERSION,
	type DiscoveryEndpoint,
	type DiscoveryRecord,
	describeDiscovery,
	parseDiscovery,
} from "@facet/protocol";

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

/** 发现文件所在目录。 */
export function discoveryDir(dataDir: string): string {
	return dirname(discoveryFile(dataDir));
}
