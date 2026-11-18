/**
 * 端点接入。
 *
 * 一条 WebSocket 连接对应一个端。连接建立后主机先发 hello(带本次连接的端标识)，
 * 之后端点发请求、主机回响应;状态变更走 action 帧,按通道定序推给订阅者。
 * 断线时该端的订阅全部解除,会话本身继续在主机上运行。
 *
 * 这个文件只负责承载：切帧、认证、心跳与监听。请求与动作的分发在 `rpc/gateway.ts`，
 * 各领域的实现在 `rpc/handlers/`，Web 静态资源在 `http/static.ts`。
 */
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createSocketServer, type Socket } from "node:net";
import { dirname, join } from "node:path";
import type { PiAgentFactory } from "@facet/agent";
import {
	type ClientRole,
	encodeFrame,
	FrameDecoder,
	type HelloFrame,
	type OutboundFrame,
	PROTOCOL_VERSION,
} from "@facet/protocol";
import { WebSocket, WebSocketServer } from "ws";
import { AuditLog } from "./audit.ts";
import type { ServerConfig } from "./config.ts";
import type { HostSource } from "./host-identity.ts";
import { serveWebRequest } from "./http/static.ts";
import type { ProjectStore } from "./project-store.ts";
import { DisabledPtyBackend } from "./pty-server.ts";
import { type Connection, canManage, RequestError, type RpcContext, toProtocolError } from "./rpc/context.ts";
import { grantedRole, handleDispatch, handleRequest, matchesToken } from "./rpc/gateway.ts";
import { unsubscribeChannel } from "./rpc/helpers.ts";
import type { SessionHub } from "./session-hub.ts";
import type { SessionsChannel } from "./sessions-channel.ts";
import type { SettingsStore } from "./settings-store.ts";
import { TerminalService } from "./terminals.ts";

/** Web 接入的 WebSocket 路径，与字节流那条共用同一套帧。 */
const ENDPOINT_PATH = "/endpoint";

/** 当前主机已实现的能力。未列入的入口由端点隐藏。 */
const BASE_CAPABILITIES = ["dispatch", "tools", "compaction", "extensionUi"] as const;

/**
 * 本次连接能用的能力。
 *
 * 终端依赖 pty 子进程里的原生模块，加载不起来（运行时版本不匹配、缺编译产物）时如实报缺，
 * 界面据此隐藏终端入口并显示原因，而不是让它连上再报错。
 */
function capabilitiesFor(context: RpcContext): HelloFrame["capabilities"] {
	return context.terminals.unavailable === undefined
		? [...BASE_CAPABILITIES, "terminal"]
		: [...BASE_CAPABILITIES];
}

/** 这个对端地址是否是回环地址。IPv4、IPv6 与 IPv4 映射地址都算。 */
export function isLoopbackAddress(address: string | undefined): boolean {
	if (address === undefined) {
		return false;
	}
	const normalized = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
	return normalized === "::1" || normalized === "localhost" || normalized.startsWith("127.");
}

/**
 * 这个监听位置是不是 Windows 命名管道。
 *
 * 命名管道不是文件系统里的东西：没有目录、没有权限位，监听之前也不需要清理上次的残留，
 * 这些文件系统操作在管道上一律跳过，失败信息只会盖住真正的原因。
 */
export function isNamedPipePath(path: string): boolean {
	return path.startsWith("\\\\");
}

export interface EndpointHandle {
	/** 实际监听的端口,配置为 0 时由系统分配；本地 socket 模式下为 0 */
	readonly port: number;
	readonly host: string;
	/** 本地 socket 路径或管道名，TCP 模式下没有 */
	readonly socketPath?: string;
	/** Web 接入的端口，未开启时没有 */
	readonly webPort?: number;
	/** 关闭监听并断开所有连接。会话由调用方负责释放。 */
	close(): Promise<void>;
}

/** 一条帧的粗形状，认证与前级分发只认这几个字段。 */
interface RawFrame {
	type?: unknown;
	id?: unknown;
	method?: unknown;
	params?: unknown;
	token?: unknown;
	role?: unknown;
	entry?: unknown;
	channel?: unknown;
	action?: unknown;
	clientSeq?: unknown;
}

/**
 * 处理一条帧。
 *
 * 未认证时只认认证帧；认证之后请求走 `handleRequest`，动作走 `handleDispatch`。
 * 帧本身解不出来或形状不对时按协议约定断开连接。
 */
async function handleFrame(context: RpcContext, connection: Connection, text: string): Promise<void> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		connection.close(1003, "invalid json");
		return;
	}
	if (typeof parsed !== "object" || parsed === null) {
		connection.close(1003, "invalid frame");
		return;
	}
	const frame = parsed as RawFrame;
	if (!connection.authenticated) {
		// 首帧必须是认证帧；TCP 与 Web 入口还要带上正确令牌，本地 socket 已由内核或管道 ACL
		// 确认身份
		if (frame.type !== "auth") {
			connection.close(1008, "Authentication required");
			return;
		}
		if (!connection.trusted && (typeof frame.token !== "string" || !matchesToken(context, frame.token))) {
			connection.close(1008, "Token mismatch");
			return;
		}
		connection.authenticated = true;
		connection.role = grantedRole(context, frame.role, connection.role);
		// 只有明确声明 web 才算浏览器入口，缺省按桌面算
		connection.entry = frame.entry === "web" ? "web" : "desktop";
		connection.send({
			type: "hello",
			protocolVersion: PROTOCOL_VERSION,
			hostId: context.hostId,
			hostName: context.config.hostName,
			clientId: connection.clientId,
			role: connection.role,
			canManage: canManage(connection),
			capabilities: capabilitiesFor(context),
			agentDir: context.factory.agentDir,
		} satisfies HelloFrame);
		return;
	}
	if (frame.type === "dispatch") {
		try {
			await handleDispatch(context, connection, frame);
		} catch (error) {
			connection.close(1008, toProtocolError(error).message);
		}
		return;
	}
	if (frame.type !== "request" || typeof frame.id !== "string" || typeof frame.method !== "string") {
		connection.close(1003, "invalid frame");
		return;
	}
	const id = frame.id;
	const method = frame.method;
	try {
		const data = await handleRequest(context, connection, method, frame.params);
		connection.send({ type: "response", id, ok: true, data });
	} catch (error) {
		connection.send({ type: "response", id, ok: false, error: toProtocolError(error) });
	}
}

/** 启动端点监听。返回实际端口,供嵌入方写入自己的握手信息。 */
export async function startEndpoint(options: {
	config: ServerConfig;
	factory: PiAgentFactory;
	hub: SessionHub;
	projectStore: ProjectStore;
	settingsStore: SettingsStore;
	hostId: string;
	/** 主机标识的派生来源，缺省当作由 machine-id 派生 */
	hostSource?: HostSource;
	/** 会话清单通道 */
	sessions: SessionsChannel;
	/** 终端登记与终端通道 */
	terminals?: TerminalService;
	/** 远程操作审计，缺省写到数据目录的 audit.log */
	audit?: AuditLog;
	/** 清单请求之后的回调，主机用它补齐背景数据 */
	onSessionsListed?: () => void;
}): Promise<EndpointHandle> {
	const context: RpcContext = {
		config: options.config,
		factory: options.factory,
		hub: options.hub,
		projectStore: options.projectStore,
		settingsStore: options.settingsStore,
		hostId: options.hostId,
		hostSource: options.hostSource ?? "machine-id",
		connections: new Set(),
		sessions: options.sessions,
		terminals:
			options.terminals ??
			new TerminalService({ backend: new DisabledPtyBackend("This host has no terminal backend") }),
		audit: options.audit ?? new AuditLog(join(options.config.dataDir, "audit.log")),
		onSessionsListed: options.onSessionsListed,
	};

	/** 连接关闭时的清理：退掉订阅、从表里摘掉。 */
	const cleanup = (connection: Connection): void => {
		if (!context.connections.delete(connection)) {
			return;
		}
		for (const [channel, sink] of connection.subscriptions) {
			unsubscribeChannel(context, channel, sink);
		}
		connection.subscriptions.clear();
	};

	/** 建一条连接：收发交给具体承载，其余逻辑各条连接一致。 */
	const makeConnection = (
		remoteAddress: string | undefined,
		send: (frame: OutboundFrame) => void,
		close: (code: number, reason: string) => void,
		/** 认证帧没声明档位时用的档位：Web 连接缺省只读 */
		defaultRole: ClientRole = "admin",
		/** 是否由 unix socket 接入：接入即已通过内核鉴权 */
		trusted = false,
	): Connection => {
		const connection: Connection = {
			clientId: randomUUID(),
			remoteAddress,
			subscriptions: new Map(),
			authenticated: false,
			trusted,
			// 认证帧里声明档位与入口之后才确定
			role: defaultRole,
			entry: "desktop",
			send,
			close: (code, reason) => {
				close(code, reason);
				cleanup(connection);
			},
		};
		context.connections.add(connection);
		return connection;
	};

	// 本地 socket（unix socket 或 Windows 命名管道）只允许本机同一用户连上，身份由内核或
	// 管道 ACL 保证，先在这里定好，accept 时带进每条连接
	const useLocalSocket = options.config.socketPath !== undefined && options.config.socketPath.length > 0;

	const accept = (socket: Socket): void => {
		const connection = makeConnection(
			socket.remoteAddress,
			(frame) => {
				if (!socket.destroyed) {
					socket.write(encodeFrame(frame));
				}
			},
			() => {
				socket.end();
				socket.destroy();
			},
			undefined,
			useLocalSocket,
		);
		const decoder = new FrameDecoder();
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			let lines: string[];
			try {
				lines = decoder.push(chunk);
			} catch {
				connection.close(1009, "Frame exceeds the limit");
				return;
			}
			for (const line of lines) {
				void handleFrame(context, connection, line);
			}
		});
		socket.on("close", () => cleanup(connection));
		socket.on("error", () => cleanup(connection));
	};

	const socketServer = createSocketServer((socket) => accept(socket));

	if (useLocalSocket) {
		const path = options.config.socketPath as string;
		// 命名管道没有文件系统残留：上一次进程异常退出后管道随进程一起消失，直接监听
		if (!isNamedPipePath(path)) {
			// 上一次异常退出可能留下同名的 socket 文件，先清掉再监听
			await rm(path, { force: true }).catch(() => undefined);
			await mkdir(dirname(path), { recursive: true, mode: 0o700 }).catch(() => undefined);
		}
		await new Promise<void>((resolve, reject) => {
			socketServer.once("error", reject);
			socketServer.listen(path, () => {
				socketServer.off("error", reject);
				resolve();
			});
		});
		// socket 本身也收成仅本人可读写，同机的其他用户连不上；管道由创建者的 ACL 把住
		if (!isNamedPipePath(path)) {
			await chmod(path, 0o600).catch(() => undefined);
		}
	} else {
		await new Promise<void>((resolve, reject) => {
			socketServer.once("error", reject);
			socketServer.listen(options.config.port, options.config.host, () => {
				socketServer.off("error", reject);
				resolve();
			});
		});
	}

	/**
	 * Web 接入。
	 *
	 * 只有给出 webPort 时才开：同一个端口既发页面也接 WebSocket，页面的连接走 WS 帧、
	 * 每条消息是一行帧。远程接入的开关与权限档在这里生效，缺省关闭。
	 */
	let webServer: ReturnType<typeof createHttpServer> | undefined;
	let webSockets: WebSocketServer | undefined;
	if (options.config.webPort !== undefined) {
		const root = options.config.webRoot;
		webServer = createHttpServer((request, response) => {
			void serveWebRequest(root, request, response);
		});
		webSockets = new WebSocketServer({ server: webServer, path: ENDPOINT_PATH });
		webSockets.on("connection", (ws: WebSocket) => {
			const connection = makeConnection(
				"web",
				(frame) => {
					if (ws.readyState === WebSocket.OPEN) {
						// 与字节流一样的按行编码：浏览器端用同一个解码器
						ws.send(encodeFrame(frame));
					}
				},
				() => {
					ws.terminate();
				},
				// Web 端是远程入口，没声明档位时按只读
				"viewer",
			);
			ws.on("message", (raw) => {
				void handleFrame(context, connection, raw.toString());
			});
			ws.on("close", () => cleanup(connection));
			ws.on("error", () => cleanup(connection));
		});
		await new Promise<void>((resolve, reject) => {
			webServer?.once("error", reject);
			webServer?.listen(options.config.webPort, options.config.host, () => {
				webServer?.off("error", reject);
				resolve();
			});
		});
	}

	const address = socketServer.address();
	const port = typeof address === "object" && address !== null ? address.port : 0;
	const webAddress = webServer?.address();
	const webPort = typeof webAddress === "object" && webAddress !== null ? webAddress.port : undefined;

	return {
		port,
		host: options.config.host,
		...(useLocalSocket ? { socketPath: options.config.socketPath as string } : {}),
		...(webPort === undefined ? {} : { webPort }),
		close: async () => {
			webSockets?.close();
			await new Promise<void>((resolve) => {
				if (webServer === undefined) {
					resolve();
					return;
				}
				webServer.close(() => resolve());
			});
			for (const connection of [...context.connections]) {
				connection.close(1001, "host shutting down");
			}
			context.connections.clear();
			context.sessions.dropSubscribers();
			await new Promise<void>((resolve) => {
				socketServer.close(() => resolve());
			});
		},
	};
}

/** 端点里仍在用的错误类型，导出给测试与调用方判断拒绝原因。 */
export { RequestError };
