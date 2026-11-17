/**
 * RPC 层的共用形状。
 *
 * 连接、主机上下文与错误映射都放这里：网关与各领域处理器只依赖这些类型，不依赖端点的
 * 承载方式（WebSocket / 字节流 / HTTP 升级）。
 */
import { InvalidProviderError, type PiAgentFactory } from "@facet/agent";
import type { Channel, ClientEntry, ClientRole, ErrorCode, OutboundFrame } from "@facet/protocol";
import type { AuditLog } from "../audit.ts";
import type { ServerConfig } from "../config.ts";
import type { HostSource } from "../host-identity.ts";
import { ProjectExistsError, ProjectNotFoundError, type ProjectStore } from "../project-store.ts";
import { RevealFailedError } from "../reveal.ts";
import {
	type ActionSink,
	ChannelNotFoundError,
	SessionBoundaryNotFoundError,
	SessionBusyError,
	SessionEntryNotFoundError,
	SessionFileMissingError,
	type SessionHub,
	SessionNotFoundError,
} from "../session-hub.ts";
import type { SessionsChannel } from "../sessions-channel.ts";
import type { SettingsStore } from "../settings-store.ts";
import type { TerminalService } from "../terminals.ts";

/**
 * 一条连接。
 *
 * 承载方式只影响怎么收发字节，连接本身只认「发一帧」与「关掉」。
 */
export interface Connection {
	/** 本次连接的端标识,写进回放动作的 origin */
	readonly clientId: string;
	/** 对端地址，只有回环地址能结束主机 */
	readonly remoteAddress: string | undefined;
	/** 已订阅的通道与其转发函数,用于取消订阅与断线清理 */
	readonly subscriptions: Map<Channel, ActionSink>;
	/** 令牌是否已校验通过，通过之后才发 hello 并接受请求 */
	authenticated: boolean;
	/**
	 * 这条连接是否已经由内核确认过身份。
	 *
	 * unix socket 是 `0600`、所在目录 `0700`，别的用户连不上，能连上就说明是本用户，
	 * 应用层不再要令牌；TCP 与 Web 入口拿不到对端身份，仍按令牌校验。
	 */
	readonly trusted: boolean;
	/** 这条连接能做什么：认证帧里声明的档位，主机会按配置收窄 */
	role: ClientRole;
	/** 这条连接从哪来：桌面主进程的通道，或浏览器页面 */
	entry: ClientEntry;
	/** 发一帧给对端 */
	send(frame: OutboundFrame): void;
	/** 关掉连接，参数是给对端看的说明 */
	close(code: number, reason: string): void;
}

/** 主机侧的上下文，一次端点启动一份。 */
export interface RpcContext {
	readonly config: ServerConfig;
	readonly factory: PiAgentFactory;
	readonly hub: SessionHub;
	readonly projectStore: ProjectStore;
	readonly settingsStore: SettingsStore;
	readonly hostId: string;
	/** 主机标识的派生来源，诊断里说明这台机器有没有 machine-id */
	readonly hostSource: HostSource;
	readonly connections: Set<Connection>;
	/** 会话清单通道，所有端订阅同一条 */
	readonly sessions: SessionsChannel;
	/** 终端登记与终端通道 */
	readonly terminals: TerminalService;
	/** 远程操作审计 */
	readonly audit: AuditLog;
	/** 一次清单请求处理完之后的回调，用来在背景里补齐还没定下来的数据 */
	readonly onSessionsListed?: () => void;
}

/** 请求被拒绝时带出的错误。未捕获的其他错误统一归类为内部错误。 */
export class RequestError extends Error {
	readonly code: ErrorCode;

	constructor(code: ErrorCode, message: string) {
		super(message);
		this.code = code;
	}
}

/** 把任意错误映射成协议错误码。 */
export function toProtocolError(error: unknown): { code: ErrorCode; message: string } {
	if (error instanceof RequestError) {
		return { code: error.code, message: error.message };
	}
	if (error instanceof SessionNotFoundError) {
		return { code: "unknown_session", message: error.message };
	}
	if (error instanceof ChannelNotFoundError) {
		return { code: "unknown_channel", message: error.message };
	}
	if (error instanceof InvalidProviderError) {
		return { code: "rejected", message: error.message };
	}
	if (
		error instanceof ProjectExistsError ||
		error instanceof ProjectNotFoundError ||
		error instanceof RevealFailedError
	) {
		return { code: "rejected", message: error.message };
	}
	if (
		error instanceof SessionEntryNotFoundError ||
		error instanceof SessionBoundaryNotFoundError ||
		error instanceof SessionBusyError ||
		error instanceof SessionFileMissingError
	) {
		return { code: "rejected", message: error.message };
	}
	return { code: "internal", message: error instanceof Error ? error.message : String(error) };
}

/**
 * 这条连接能不能改主机配置：设置、凭证、项目清单与诊断导出。
 *
 * 桌面入口放行：本机 socket 与 SSH 隧道都算，SSH 本身已经是一道认证。浏览器入口只有一个
 * 令牌，不放行。只读档什么时候都不放行。
 */
export function canManage(connection: Connection): boolean {
	return connection.entry === "desktop" && connection.role !== "viewer";
}

/** 远程连接的写操作记一笔，本机连接不记。 */
export function auditRemote(
	context: RpcContext,
	connection: Connection,
	name: string,
	failure?: string,
): void {
	if (connection.role === "admin") {
		return;
	}
	context.audit.record({
		at: Date.now(),
		clientId: connection.clientId,
		role: connection.role,
		name,
		ok: failure === undefined,
		...(failure === undefined ? {} : { reason: failure }),
	});
}
