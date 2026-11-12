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

/** SSH 目标的统一写法，缺省端口 22 省略。 */
export const SSH_PREFIX = "ssh://";

/**
 * 把用户填的地址收成主机地址。
 *
 * 两种写法：`ssh://user@host[:port]` 走 SSH（`user@host` 也可以，缺省补上前缀）；其余
 * 按 `host:port` 走直连。带协议的 `ws://`、`http://` 与它们的 `/endpoint` 路径都化成
 * `host:port`。含非 ASCII 字符、没写端口的一律按填错处理。
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
	if (text.includes("@") || text.toLowerCase().startsWith(SSH_PREFIX)) {
		return normalizeSshTarget(text);
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
	// 直连的主机都是自选端口；没写端口的按填错处理，免得把路径当成主机名
	if (url.port.length === 0) {
		return undefined;
	}
	return `${url.hostname}:${url.port}`;
}

/** 收 SSH 目标：校验用户名、主机与端口，端口 22 不写出来。 */
function normalizeSshTarget(text: string): string | undefined {
	const body = text.toLowerCase().startsWith(SSH_PREFIX) ? text.slice(SSH_PREFIX.length) : text;
	const at = body.lastIndexOf("@");
	const user = at > 0 ? body.slice(0, at) : undefined;
	const rest = at >= 0 ? body.slice(at + 1) : body;
	if (user === undefined && at === 0) {
		return undefined;
	}
	// IPv6 带方括号，端口写在方括号之后
	const matched = /^(?:\[([^\]]+)\]|([^@\s/:[\]]+))(?::(\d+))?$/.exec(rest);
	if (matched === null) {
		return undefined;
	}
	const host = matched[1] ?? matched[2];
	if (host === undefined || host.length === 0) {
		return undefined;
	}
	// IPv6 保留方括号，免得主机与端口分不清
	const shownHost = host.includes(":") ? `[${host}]` : host;
	const prefix = `${SSH_PREFIX}${user === undefined ? "" : `${user}@`}${shownHost}`;
	const port = matched[3];
	if (port === undefined) {
		return prefix;
	}
	const parsed = Number(port);
	if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
		return undefined;
	}
	return parsed === 22 ? prefix : `${prefix}:${parsed}`;
}

/** 端点给人看的写法：SSH 目标去掉前缀，直连就是 host:port。 */
export function endpointLabel(endpoint: string): string {
	return endpoint.toLowerCase().startsWith(SSH_PREFIX) ? endpoint.slice(SSH_PREFIX.length) : endpoint;
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
