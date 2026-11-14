/**
 * 通过 SSH 连远程主机。
 *
 * 远程主机只监听自己的 unix socket，桌面用 SSH 协议直接在该 socket 上开一条通道
 * （OpenSSH 的 streamlocal 转发），本地不开端口、远端也不开端口。主机是 Windows、只监听
 * TCP 回环时退回 direct-tcpip，同样不落地任何监听。
 *
 * 认证复用系统的 SSH 配置、ssh-agent 与 ~/.ssh 下的私钥，没有可用凭据时问一次密码。
 * 主机公钥不做校验：能连上这台机器就等于拿到那台机器的账户权限，再叠一层主机制约没有意义。
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type DiscoveryRecord, parseDiscovery } from "@facet/server";
import type { StreamLike } from "@facet/transport";
import { Client, type ConnectConfig } from "ssh2";

/** SSH 目标：用户名、主机与端口。 */
export interface SshTarget {
	/** 登录用户名 */
	user: string | undefined;
	/** 主机名或 IP */
	host: string;
	/** 端口，缺省 22 */
	port: number;
}

/** 目标写法的前缀。 */
const SSH_SCHEME = "ssh://";

/**
 * 解析 `user@host`、`user@host:port` 与 `ssh://user@host:port`。
 *
 * 只接受 ASCII；没有端口时按 22 处理。解析不出返回 undefined。
 */
export function parseSshTarget(input: string): SshTarget | undefined {
	let text = input.trim();
	if (/^[\x20-\x7e]+$/.test(text) === false || text.length === 0) {
		return undefined;
	}
	if (text.toLowerCase().startsWith(SSH_SCHEME)) {
		text = text.slice(SSH_SCHEME.length);
	}
	const at = text.lastIndexOf("@");
	const user = at > 0 ? text.slice(0, at) : undefined;
	const rest = at >= 0 ? text.slice(at + 1) : text;
	// IPv6 写法带方括号，端口在方括号之后
	const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(rest);
	const plain = /^([^:\s/]+)(?::(\d+))?$/.exec(rest);
	const matched = bracketed ?? plain;
	if (matched === null) {
		return undefined;
	}
	const host = matched[1] as string;
	const port = matched[2] === undefined ? 22 : Number(matched[2]);
	if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
		return undefined;
	}
	return { user, host, port };
}

/** 这个目标写法是否指 SSH 主机。 */
export function isSshTarget(text: string): boolean {
	return text.toLowerCase().startsWith(SSH_SCHEME);
}

/** 目标给人看的写法。 */
export function sshTargetLabel(target: SshTarget): string {
	const host = target.port === 22 ? target.host : `${target.host}:${target.port}`;
	return target.user === undefined ? host : `${target.user}@${host}`;
}

/** 一条 SSH 配置记录里我们用得上的字段。 */
export interface SshHostConfig {
	/** 真正的连接地址 */
	hostName: string | undefined;
	/** 登录用户名 */
	user: string | undefined;
	/** 端口 */
	port: number | undefined;
	/** 私钥路径 */
	identityFiles: string[];
}

/**
 * 解析 ssh_config。
 *
 * 只认 Host 块里的 HostName、User、Port、IdentityFile，支持 `*` 通配；其余指令忽略。
 * 同一个字段后出现的覆盖先出现的，与 OpenSSH 一致。
 */
export function parseSshConfig(text: string): Map<string, SshHostConfig> {
	const result = new Map<string, SshHostConfig>();
	let patterns: string[] = [];
	const flush = (): void => {
		for (const pattern of patterns) {
			if (!result.has(pattern)) {
				result.set(pattern, { hostName: undefined, user: undefined, port: undefined, identityFiles: [] });
			}
		}
	};
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (line.length === 0 || line.startsWith("#")) {
			continue;
		}
		const [rawKey, ...rest] = line.split(/\s+/);
		const value = rest.join(" ");
		if (value.length === 0 || rawKey === undefined) {
			continue;
		}
		const key = rawKey.toLowerCase();
		if (key === "host") {
			patterns = rest;
			flush();
			continue;
		}
		for (const pattern of patterns) {
			const entry = result.get(pattern);
			if (entry === undefined) {
				continue;
			}
			if (key === "hostname") {
				entry.hostName = value;
			} else if (key === "user") {
				entry.user = value;
			} else if (key === "port") {
				const port = Number(value);
				if (Number.isInteger(port) && port > 0 && port <= 65_535) {
					entry.port = port;
				}
			} else if (key === "identityfile") {
				entry.identityFiles.push(value.replace(/^~/, homedir()));
			}
		}
	}
	return result;
}

/** 按主机名挑一条配置：先精确匹配，再按通配符匹配。 */
export function matchSshConfig(config: Map<string, SshHostConfig>, host: string): SshHostConfig | undefined {
	const exact = config.get(host);
	if (exact !== undefined) {
		return exact;
	}
	for (const [pattern, entry] of config) {
		if (pattern.includes("*") && new RegExp(`^${pattern.replace(/\*/g, ".*")}$`).test(host)) {
			return entry;
		}
	}
	return undefined;
}

/**
 * 读远端发现文件用的命令。
 *
 * 数据目录按与主机相同的规则取（FACET_DATA_DIR，其次 XDG_DATA_HOME，最后家目录），
 * 打印整份 endpoint.json；文件不在时 cat 报错，调用方按「没有主机」处理。
 */
export function remoteDiscoveryCommand(): string {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: 这是远端 shell 的变量展开，不是模板串
	return 'd="${FACET_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/facet}"; cat "$d/endpoint.json"';
}

/** 一条 SSH 连接上能做的三件事。 */
export interface SshClientLike {
	/** 在远端执行一条命令并取回输出 */
	exec(command: string): Promise<string>;
	/** 连接到远端的一个 unix socket */
	openStreamLocal(path: string): Promise<StreamLike>;
	/** 连接到远端的一个 TCP 地址 */
	openTcp(host: string, port: number): Promise<StreamLike>;
	/** 断开 */
	close(): void;
}

/** 建立 SSH 连接。测试里换成本地实现。 */
export type SshConnector = (config: ConnectConfig) => Promise<SshClientLike>;

export interface SshHostOptions {
	/** 连接超时，毫秒 */
	connectTimeoutMs?: number;
	/** 执行远端命令的超时，毫秒 */
	execTimeoutMs?: number;
	/** 建立 SSH 连接，缺省用 ssh2 */
	connect?: SshConnector;
	/** 读本地文件，缺省用 fs */
	readLocalFile?: (path: string) => Promise<string | undefined>;
	/** 家目录 */
	home?: string;
	/** 环境变量，取 SSH_AUTH_SOCK 与 USER */
	env?: Record<string, string | undefined>;
}

/** 远端主机连不上时抛出的错误。code 供界面区分原因。 */
export class SshHostError extends Error {
	readonly code:
		| "no_target"
		| "no_known_host"
		/** 缺登录凭据或凭据被拒，界面据此问密码 */
		| "need_password"
		| "no_discovery"
		| "connect_failed"
		| "forward_failed";

	constructor(code: SshHostError["code"], message: string) {
		super(message);
		this.name = "SshHostError";
		this.code = code;
	}
}

/**
 * 打开一条到远程主机的字节流。
 *
 * 先按 SSH 连上，再读远端的发现文件拿到 socket 路径与令牌，最后在 socket 上开通道；
 * 远端只监听 TCP 时退回 direct-tcpip。令牌带回给调用方，用于协议首帧的认证。
 */
export class SshHosts {
	private readonly options: SshHostOptions;

	constructor(options: SshHostOptions = {}) {
		this.options = options;
	}

	/**
	 * 连到远程主机，返回字节流与连接令牌。
	 *
	 * 给了 `password` 就按密码登录，否则用 ssh-agent 或 ~/.ssh 下的私钥；两者都没有、或
	 * 被服务器拒绝时抛 `need_password`，由界面问一次密码。密码只在调用方内存里留存在
	 * 本机，不写进任何清单。
	 */
	async open(
		targetText: string,
		password?: string,
	): Promise<{
		stream: StreamLike;
		token: string | undefined;
		address: string;
	}> {
		const target = parseSshTarget(targetText);
		if (target === undefined) {
			throw new SshHostError("no_target", `主机地址看不懂:${targetText}`);
		}
		const home = this.options.home ?? homedir();
		const env = this.options.env ?? process.env;
		const readLocal = this.options.readLocalFile ?? readOptionalFile;
		const config = matchSshConfig(
			parseSshConfig((await readLocal(join(home, ".ssh", "config"))) ?? ""),
			target.host,
		);
		const host = config?.hostName ?? target.host;
		const port = target.port === 22 ? (config?.port ?? 22) : target.port;
		const user = target.user ?? config?.user ?? env.USER ?? env.LOGNAME;
		const identityFiles = [
			...(config?.identityFiles ?? []),
			join(home, ".ssh", "id_ed25519"),
			join(home, ".ssh", "id_ecdsa"),
			join(home, ".ssh", "id_rsa"),
		];

		const build = async (): Promise<ConnectConfig> => {
			const login: ConnectConfig = {};
			if (password !== undefined && password.length > 0) {
				login.password = password;
				// 有的服务器只开 keyboard-interactive，ssh2 在 tryKeyboard 下会自动用这个密码回
				login.tryKeyboard = true;
			} else {
				const privateKey = await firstReadable(identityFiles, readLocal);
				const agent = env.SSH_AUTH_SOCK;
				if (privateKey === undefined && agent === undefined) {
					throw new SshHostError("need_password", `需要 ${sshTargetLabel(target)} 的登录密码`);
				}
				if (privateKey !== undefined) {
					login.privateKey = privateKey;
				}
				if (agent !== undefined) {
					login.agent = agent;
				}
			}
			return {
				host,
				port,
				...(user === undefined ? {} : { username: user }),
				...login,
				readyTimeout: this.options.connectTimeoutMs ?? 10_000,
			};
		};

		const connector = this.options.connect ?? defaultConnector;
		let client: SshClientLike;
		try {
			client = await connector(await build());
		} catch (error) {
			// 建连接之前就判定缺凭据的情况，理由已经写好了，别再包一层
			if (error instanceof SshHostError) {
				throw error;
			}
			if (isAuthFailure(error)) {
				// 密码给过还被拒，就是密码不对；没给过就去问一次
				throw new SshHostError(
					"need_password",
					password === undefined || password.length === 0
						? `需要 ${sshTargetLabel(target)} 的登录密码`
						: `${sshTargetLabel(target)} 的密码不对`,
				);
			}
			throw new SshHostError("connect_failed", `连不上 ${sshTargetLabel(target)}:${messageOf(error)}`);
		}

		try {
			const text = await client.exec(remoteDiscoveryCommand());
			const discovery: DiscoveryRecord | undefined = parseDiscovery(text);
			if (discovery === undefined) {
				throw new SshHostError("no_discovery", `${sshTargetLabel(target)} 上没有运行中的 facet 主机`);
			}
			const stream =
				discovery.endpoint.transport === "unix"
					? await client.openStreamLocal(discovery.endpoint.path)
					: await client.openTcp(
							new URL(discovery.endpoint.url).hostname,
							Number(new URL(discovery.endpoint.url).port),
						);
			return {
				stream,
				token: discovery.token,
				address: discovery.endpoint.transport === "unix" ? discovery.endpoint.path : discovery.endpoint.url,
			};
		} catch (error) {
			client.close();
			if (error instanceof SshHostError) {
				throw error;
			}
			throw new SshHostError("forward_failed", `打开通道失败:${messageOf(error)}`);
		}
	}
}

/** ssh2 在认证阶段失败时把 level 标成 client-authentication。 */
function isAuthFailure(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { level?: unknown }).level === "client-authentication"
	);
}

/** 默认的 SSH 连接：用 ssh2 连上并包成 SshClientLike。 */
const defaultConnector: SshConnector = async (config) => {
	const client = new Client();
	await new Promise<void>((resolve, reject) => {
		client.once("ready", () => resolve());
		client.once("error", (error: Error) => reject(error));
		client.connect(config);
	});
	return {
		exec: (command) =>
			new Promise<string>((resolve, reject) => {
				client.exec(command, (error, channel) => {
					if (error !== undefined) {
						reject(error);
						return;
					}
					let text = "";
					let stderr = "";
					channel.setEncoding("utf8");
					channel.on("data", (chunk: string) => {
						text += chunk;
					});
					channel.stderr.on("data", (chunk: Buffer) => {
						stderr += chunk.toString("utf8");
					});
					channel.once("close", () => {
						if (text.length === 0) {
							reject(new Error(stderr.trim() || "远端命令没有输出"));
							return;
						}
						resolve(text);
					});
				});
			}),
		openStreamLocal: (path) =>
			new Promise<StreamLike>((resolve, reject) => {
				client.openssh_forwardOutStreamLocal(path, (error, stream) => {
					if (error !== undefined) {
						reject(error);
						return;
					}
					resolve(toStreamLike(stream));
				});
			}),
		openTcp: (host, port) =>
			new Promise<StreamLike>((resolve, reject) => {
				client.forwardOut("127.0.0.1", 0, host, port, (error, stream) => {
					if (error !== undefined) {
						reject(error);
						return;
					}
					resolve(toStreamLike(stream));
				});
			}),
		close: () => client.end(),
	};
};

/** 把 SSH 通道收成字节流。 */
function toStreamLike(stream: NodeJS.ReadWriteStream): StreamLike {
	const dataListeners = new Set<(chunk: string) => void>();
	const closeListeners = new Set<(reason: string) => void>();
	stream.setEncoding?.("utf8");
	stream.on("data", (chunk: string) => {
		for (const listener of dataListeners) {
			listener(chunk);
		}
	});
	stream.on("close", () => {
		for (const listener of closeListeners) {
			listener("closed");
		}
	});
	stream.on("error", (error: Error) => {
		for (const listener of closeListeners) {
			listener(error.message);
		}
	});
	return {
		write: (text: string) => {
			stream.write(text);
		},
		onData: (listener) => {
			dataListeners.add(listener);
			return () => {
				dataListeners.delete(listener);
			};
		},
		onClose: (listener) => {
			closeListeners.add(listener);
			return () => {
				closeListeners.delete(listener);
			};
		},
		close: () => {
			stream.end();
			(stream as NodeJS.ReadWriteStream & { destroy?: () => void }).destroy?.();
		},
	};
}

/** 读文件，不存在时给 undefined。 */
async function readOptionalFile(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return undefined;
	}
}

/** 取第一个读得到的文件内容。 */
async function firstReadable(
	paths: readonly string[],
	read: (path: string) => Promise<string | undefined>,
): Promise<string | undefined> {
	for (const path of paths) {
		const text = await read(path);
		if (text !== undefined) {
			return text;
		}
	}
	return undefined;
}

/** 错误转一句能看懂的说明。 */
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
