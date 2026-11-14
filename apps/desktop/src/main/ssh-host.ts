/**
 * 通过 SSH 连远程主机。
 *
 * 远程主机只监听自己的 unix socket，桌面用 SSH 协议直接在该 socket 上开一条通道
 * （OpenSSH 的 streamlocal 转发），本地不开端口、远端也不开端口。主机是 Windows、只监听
 * TCP 回环时退回 direct-tcpip，同样不落地任何监听。
 *
 * 认证复用系统的 SSH 配置、ssh-agent 与 ~/.ssh 下的私钥，没有可用凭据时问一次密码。
 * 主机公钥不做校验：能连上这台机器就等于拿到那台机器的账户权限，再叠一层主机制约没有意义。
 *
 * 主机的位置是固定契约：优先 `$XDG_RUNTIME_DIR/facet.sock`（开发实例 `facet-dev.sock`），
 * 没有运行目录时是 `<家目录>/.local/share/facet/facet.sock`。远端用一小段 shell 脚本按同一
 * 顺序找出实际在跑的那条，脚本从标准输入喂给 `/bin/sh`，不拼进命令行。
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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

/** 远端脚本的超时，毫秒。 */
const RUN_TIMEOUT_MS = 8_000;

/** 主机 socket 的文件名，两端共用的约定。 */
const SOCKET_FILE = "facet.sock";

/**
 * 在远端找出实际在跑的主机 socket。
 *
 * 脚本从标准输入喂给 `/bin/sh`，不参与命令行拼装，所以可以随便写长、写多行；只用 POSIX
 * 语法，极简容器里也能跑。顺序与桌面本机的推导一致：运行目录里的两条优先（发布实例在前），
 * 其次家目录下的两条。命中就打印那一行，没有就什么都不打印。
 */
export const REMOTE_SOCKET_SCRIPT = `set -u
runtime=\${XDG_RUNTIME_DIR:-}
home=\${HOME:-}
for path in \
  \${runtime:+"$runtime/${SOCKET_FILE}"} \
  \${runtime:+"$runtime/facet-dev.sock"} \
  \${home:+"$home/.local/share/facet/${SOCKET_FILE}"} \
  \${home:+"$home/.local/share/facet-dev/${SOCKET_FILE}"}; do
  if [ -S "$path" ]; then
    printf '%s\n' "$path"
    break
  fi
done
`;

/**
 * 在远端把没在跑的主机拉起来。
 *
 * 只在已经装了 facet 的机器上成立：包安装目录里有独立主机产物（`bin/node` + `lib/host.mjs`）。
 * 找不到安装就打 `none`，客户端据此报「这台机器上没有安装 facet」，不做任何上传与安装。
 * 起来之后日志写进数据目录的 host.log，进程 detached，SSH 断开也不带走它。
 */
export const REMOTE_START_SCRIPT = `set -u
for dir in /opt/Facet/resources/host "\${XDG_DATA_HOME:-$HOME/.local/share}/facet/host"; do
  if [ -x "$dir/bin/node" ] && [ -f "$dir/lib/host.mjs" ]; then
    install="$dir"
    break
  fi
done
if [ "\${install:-}" = "" ]; then
  printf 'none\n'
  exit 0
fi
data="\${FACET_DATA_DIR:-$HOME/.local/share/facet}"
mkdir -p "$data" 2>/dev/null || true
if command -v setsid >/dev/null 2>&1; then
  setsid "$install/bin/node" "$install/lib/host.mjs" >>"$data/host.log" 2>&1 </dev/null &
else
  nohup "$install/bin/node" "$install/lib/host.mjs" >>"$data/host.log" 2>&1 </dev/null &
fi
printf 'started\n'
`;

/** 取脚本输出的第一行非空内容，就是 socket 路径。 */
export function parseSocketPath(text: string): string | undefined {
	const line = text
		.split("\n")
		.map((item) => item.trim())
		.find((item) => item.length > 0);
	return line;
}

/** 一条 SSH 连接上用到的两件事。 */
export interface SshClientLike {
	/** 在远端把一段脚本喂给 `/bin/sh`，返回标准输出 */
	run(script: string): Promise<string>;
	/** 连接到远端的一个 unix socket */
	openStreamLocal(path: string): Promise<StreamLike>;
	/** 断开 */
	close(): void;
}

/** 建立 SSH 连接。测试里换成本地实现。 */
export type SshConnector = (config: ConnectConfig) => Promise<SshClientLike>;

export interface SshHostOptions {
	/** 连接超时，毫秒 */
	connectTimeoutMs?: number;
	/** 拉起远端主机后等 socket 出现的上限，毫秒 */
	socketWaitMs?: number;
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
		/** 这台机器上没有安装 facet，拉不起来 */
		| "not_installed"
		/** 装了也拉不起来，或者 socket 一直不出现 */
		| "no_socket"
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
		address: string;
	}> {
		const target = parseSshTarget(targetText);
		if (target === undefined) {
			throw new SshHostError("no_target", `主机地址看不懂:${targetText}`);
		}
		const localHome = this.options.home ?? homedir();
		const env = this.options.env ?? process.env;
		const readLocal = this.options.readLocalFile ?? readOptionalFile;
		const config = matchSshConfig(
			parseSshConfig((await readLocal(join(localHome, ".ssh", "config"))) ?? ""),
			target.host,
		);
		const host = config?.hostName ?? target.host;
		const port = target.port === 22 ? (config?.port ?? 22) : target.port;
		const user = target.user ?? config?.user ?? env.USER ?? env.LOGNAME;
		const identityFiles = [
			...(config?.identityFiles ?? []),
			join(localHome, ".ssh", "id_ed25519"),
			join(localHome, ".ssh", "id_ecdsa"),
			join(localHome, ".ssh", "id_rsa"),
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

		const label = sshTargetLabel(target);
		let output: string;
		try {
			output = await client.run(REMOTE_SOCKET_SCRIPT);
		} catch (error) {
			client.close();
			throw new SshHostError("no_socket", `${label} 上查不到主机位置:${messageOf(error)}`);
		}
		let path = parseSocketPath(output);
		if (path === undefined) {
			// 没在跑就拉起来：本地桌面也是这么做的，远端同样交给已安装的那份主机
			const started = await startRemoteHost(client, label);
			if (started !== undefined) {
				throw started;
			}
			path = await waitForRemoteSocket(client, this.options.socketWaitMs ?? SOCKET_WAIT_MS);
		}
		if (path === undefined) {
			client.close();
			throw new SshHostError(
				"no_socket",
				`${label} 上拉起了 facet 主机，但 ${this.options.socketWaitMs ?? SOCKET_WAIT_MS} 毫秒内没等到 socket`,
			);
		}

		try {
			const stream = await client.openStreamLocal(path);
			return { stream, address: path };
		} catch (error) {
			client.close();
			throw new SshHostError("no_socket", `${label} 上的 ${path} 连不上:${messageOf(error)}`);
		}
	}
}

/** 拉起远端主机后等 socket 出现的上限与轮询间隔。 */
const SOCKET_WAIT_MS = 12_000;
const SOCKET_POLL_MS = 400;

/**
 * 在远端启动主机。
 *
 * 返回 SshHostError 表示这一次不该继续等 socket（没装 facet）；返回 undefined 表示已经发出
 * 启动命令，接下来轮询 socket 即可。
 */
async function startRemoteHost(client: SshClientLike, label: string): Promise<SshHostError | undefined> {
	let output: string;
	try {
		output = await client.run(REMOTE_START_SCRIPT);
	} catch (error) {
		return new SshHostError("no_socket", `${label} 上启动 facet 主机失败:${messageOf(error)}`);
	}
	if (output.includes("none")) {
		return new SshHostError("not_installed", `${label} 上没有安装 facet，先在那边装好再来添加`);
	}
	return undefined;
}

/** 轮询远端，等主机把 socket 建出来。 */
async function waitForRemoteSocket(client: SshClientLike, waitMs: number): Promise<string | undefined> {
	const deadline = Date.now() + waitMs;
	while (Date.now() < deadline) {
		await new Promise((done) => setTimeout(done, SOCKET_POLL_MS));
		try {
			const found = parseSocketPath(await client.run(REMOTE_SOCKET_SCRIPT));
			if (found !== undefined) {
				return found;
			}
		} catch {
			// 主机还没起来，下一次再问
		}
	}
	return undefined;
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
		// 脚本从标准输入喂进去：命令行只有一个 /bin/sh，没有引号转义的坑，
		// 脚本里要加多少步都行
		run: (script) =>
			new Promise<string>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error("远端脚本超时")), RUN_TIMEOUT_MS);
				client.exec("/bin/sh", (error, channel) => {
					if (error !== undefined) {
						clearTimeout(timer);
						reject(error);
						return;
					}
					let text = "";
					let stderr = "";
					let exitCode: number | undefined;
					channel.setEncoding("utf8");
					channel.on("data", (chunk: string) => {
						text += chunk;
					});
					channel.stderr.on("data", (chunk: Buffer) => {
						stderr += chunk.toString("utf8");
					});
					channel.on("exit", (code: number) => {
						exitCode = code;
					});
					channel.once("close", () => {
						clearTimeout(timer);
						// 没有输出属于正常结果（比如「现在没有 socket」），只有退出码非 0 才算脚本失败
						if (text.length === 0 && exitCode !== undefined && exitCode !== 0) {
							reject(new Error(stderr.trim() || `远端脚本退出码 ${exitCode}`));
							return;
						}
						resolve(text);
					});
					channel.end(script);
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
