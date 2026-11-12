/**
 * 主机清单。
 *
 * 清单记在这一台机器上：本机用固定标识本地表示，地址与令牌由主进程按发现文件给出；远程
 * 主机由用户自己添加，只存 `host:port`。连接凭据不进清单（远程接入走 SSH，见需求 FR-XDEV）。
 */

/** 一台已保存的主机。 */
export interface SavedHost {
	/** 清单内的稳定标识 */
	id: string;
	/** 显示名 */
	name: string;
	/** 主机地址，形如 host:port */
	endpoint: string;
}

/** 主机清单的状态。 */
export interface HostListState {
	/** 已保存的远程主机，本机不在其中 */
	hosts: readonly SavedHost[];
	/** 当前连着的端点；切换主机时以它为准 */
	activeEndpoint: string;
}

/** 本地存储的键。 */
const HOSTS_KEY = "facet.hosts";
const ACTIVE_KEY = "facet.hosts.active";

/** 读写本地存储的最小接口，测试里换成假实现。 */
export interface HostListStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
}

/**
 * 把用户填的地址收成主机地址。
 *
 * 接受 `host:port`，也接受带协议写法的 `ws://host:port`、`http://host:port` 与它们的
 * `/endpoint` 路径，一律化成 `host:port`。没写端口、含非 ASCII 字符的一律按填错处理。
 */
export function normalizeEndpoint(input: string): string | undefined {
	const text = input.trim();
	if (text.length === 0) {
		return undefined;
	}
	// 主机名与端口是 ASCII；含其它字符的一律当写错，别让 it 变成 punycode 域名
	if (!/^[\x20-\x7e]+$/.test(text)) {
		return undefined;
	}
	const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `tcp://${text}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		return undefined;
	}
	if (url.hostname.length === 0) {
		return undefined;
	}
	// 主机端点都是自选端口；没写端口的按填错处理，免得把路径当成主机名
	if (url.port.length === 0) {
		return undefined;
	}
	return `${url.hostname}:${url.port}`;
}

/** 端点给人看的写法：本机显示名字，其余就是 host:port。 */
export function endpointLabel(endpoint: string): string {
	return endpoint;
}

/** 从本地存储读主机清单；读不懂的条目跳过。 */
export function readHostList(storage: HostListStorage, fallbackEndpoint: string): HostListState {
	const active = storage.getItem(ACTIVE_KEY);
	let hosts: SavedHost[] = [];
	try {
		const raw: unknown = JSON.parse(storage.getItem(HOSTS_KEY) ?? "[]");
		if (Array.isArray(raw)) {
			hosts = raw.flatMap((item) => {
				if (typeof item !== "object" || item === null) {
					return [];
				}
				const record = item as { id?: unknown; name?: unknown; endpoint?: unknown };
				if (
					typeof record.id !== "string" ||
					typeof record.name !== "string" ||
					typeof record.endpoint !== "string"
				) {
					return [];
				}
				return [{ id: record.id, name: record.name, endpoint: record.endpoint }];
			});
		}
	} catch {
		hosts = [];
	}
	return { hosts, activeEndpoint: active === null || active.length === 0 ? fallbackEndpoint : active };
}

/** 写回主机清单。 */
export function writeHostList(storage: HostListStorage, state: HostListState): void {
	storage.setItem(HOSTS_KEY, JSON.stringify(state.hosts));
	storage.setItem(ACTIVE_KEY, state.activeEndpoint);
}

/** 清单里是否已经有这个端点。 */
export function hasEndpoint(state: HostListState, endpoint: string, localEndpoint: string): boolean {
	return endpoint === localEndpoint || state.hosts.some((host) => host.endpoint === endpoint);
}
