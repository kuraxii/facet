/**
 * 网关与处理器共用的动作。
 *
 * 这些函数不改变权限判定，也不吞错误：只把「目录必须存在」「通道必须可订阅」这类语义约束
 * 变成带协议错误码的拒绝。结构性的形状检查已经由 `generated/checks.ts` 完成。
 */
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { type Channel, type ChannelKind, parseChannel } from "@facet/protocol";
import { FileAccessError } from "../files.ts";
import type { ActionSink } from "../session-hub.ts";
import { type Connection, RequestError, type RpcContext } from "./context.ts";

/** 把文件操作的失败换成端点统一的错误码，界面据此给出不同提示。 */
export async function asFileError<T>(work: Promise<T>): Promise<T> {
	try {
		return await work;
	} catch (error) {
		if (error instanceof FileAccessError) {
			throw new RequestError(error.code, error.message);
		}
		throw error;
	}
}

/**
 * 校验并统一项目目录。
 *
 * 目录不存在或不是目录时直接拒绝；符号链接与 `..` 一律换成实际路径，同一个目录只认一个标识。
 */
export async function resolveProjectDirectory(cwd: string): Promise<string> {
	if (!isAbsolute(cwd)) {
		throw new RequestError("bad_params", `Project directory must be absolute: ${cwd}`);
	}
	let target: string;
	try {
		target = await realpath(cwd);
	} catch {
		throw new RequestError("rejected", `Project directory does not exist: ${cwd}`);
	}
	const info = await stat(target).catch(() => undefined);
	if (info === undefined || !info.isDirectory()) {
		throw new RequestError("rejected", `Not a directory: ${cwd}`);
	}
	return target;
}

/**
 * 终端启动目录。
 *
 * 必须是真实存在的目录：终端以主机用户身份跑 shell，界面上给的路径先在这里核对一遍，
 * 软链接也按实际指向判断。
 */
export async function resolveTerminalCwd(cwd: string): Promise<string> {
	let real: string;
	try {
		real = await realpath(cwd);
	} catch {
		throw new RequestError("file_not_found", `Startup directory does not exist: ${cwd}`);
	}
	const info = await stat(real).catch(() => undefined);
	if (info === undefined || !info.isDirectory()) {
		throw new RequestError("bad_params", `Startup directory is not a directory: ${cwd}`);
	}
	return real;
}

/** 解析通道串并限定允许的种类。格式不符或种类不在名单里时按未知通道拒绝。 */
export function requireChannel(channel: string, allowed: readonly ChannelKind[]): Channel {
	const parsed = parseChannel(channel);
	if (parsed === undefined || !allowed.includes(parsed.kind)) {
		throw new RequestError("unknown_channel", `unsupported channel: ${channel}`);
	}
	return channel as Channel;
}

/** 派发动作只走会话与对话通道。 */
export function requireActionChannel(channel: string): Channel {
	return requireChannel(channel, ["session", "chat"]);
}

/** 订阅与退订另外接受会话清单通道、终端通道与模型通道。 */
export function requireSubscribableChannel(channel: string): Channel {
	return requireChannel(channel, ["session", "chat", "sessions", "terminal", "models"]);
}

/** 退掉一个通道的订阅，会话、对话、清单、终端与模型通道各走各的表。 */
export function unsubscribeChannel(context: RpcContext, channel: Channel, sink: ActionSink): void {
	const kind = parseChannel(channel)?.kind;
	if (kind === "sessions") {
		context.sessions.unsubscribe(sink);
		return;
	}
	if (kind === "models") {
		context.modelLog.unsubscribe(sink);
		return;
	}
	if (kind === "terminal") {
		context.terminals.unsubscribe(channel, sink);
		return;
	}
	context.hub.unsubscribe(channel, sink);
}

/** 把连接包装成通道的转发端。 */
export function toSink(connection: Connection): ActionSink {
	return { id: connection.clientId, send: (frame) => connection.send(frame) };
}
