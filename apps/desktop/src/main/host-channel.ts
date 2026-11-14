/**
 * 主机连接的代理通道。
 *
 * 渲染进程跑在沙箱里，打不开 unix socket，也不该自己拿着主机地址。界面请求一条通道，
 * 主进程按目标连到主机（本机按发现文件走 unix socket 或 TCP，远程按 host:port 走 TCP），
 * 之后两端只搬运帧：界面写进来的行、主机回来的行。
 */
import { connect, type Socket } from "node:net";
import type { StreamLike } from "@facet/transport";
import type { WebContents } from "electron";
import { isSshTarget, SshHosts } from "./ssh-host.ts";

/** 数据帧事件：通道标识加一段文本。 */
export const HOST_DATA_EVENT = "facet:host-data";
/** 关闭事件：通道标识加原因。 */
export const HOST_CLOSE_EVENT = "facet:host-close";

/** 本机目标的标识，界面用它表示「按发现文件连本机」。 */
export const LOCAL_TARGET = "local";

interface Channel {
	/** 写一段文本给主机 */
	write(text: string): void;
	/** 关掉这条通道 */
	close(): void;
	/** 通道属于哪个窗口 */
	readonly owner: number;
}

/** 解析目标：本机取发现文件，`ssh://` 走 SSH，其余按 host:port 走 TCP。 */
export type TargetResolver = (
	target: string,
) =>
	| { path: string }
	| { host: string; port: number }
	| undefined
	| Promise<{ path: string } | { host: string; port: number } | undefined>;

export class HostChannels {
	private next = 1;
	private readonly channels = new Map<number, Channel>();
	private readonly resolve: TargetResolver;
	private readonly ssh: SshHosts;

	constructor(resolve: TargetResolver, ssh: SshHosts = new SshHosts()) {
		this.resolve = resolve;
		this.ssh = ssh;
	}

	/**
	 * 连到目标，返回通道标识与连接令牌。
	 *
	 * 远程主机走 SSH：先连 SSH，再用通道打开远端的 socket，令牌从远端发现文件里取。
	 * 连不上时抛错，渲染进程据此显示「连不上主机」。
	 */
	async open(
		webContents: WebContents,
		target: string,
		password?: string,
	): Promise<{ id: number; token: string | undefined; role: "operator" | "viewer" | undefined }> {
		if (isSshTarget(target)) {
			const opened = await this.ssh.open(target, password);
			// SSH 通道已经是流，直接按行搬运；能登上那台机器就等于本机使用者，不声明权限档，
			// 也不需要应用层令牌：unix socket 的 0600 + 目录 0700 由内核负责身份
			return this.attach(webContents, { stream: opened.stream }, undefined, undefined);
		}
		const resolved = await this.resolve(target);
		if (resolved === undefined) {
			throw new Error(target === LOCAL_TARGET ? "没有发现正在运行的主机" : `主机地址无效:${target}`);
		}
		const socket =
			"path" in resolved
				? await connectTcp({ path: resolved.path })
				: await connectTcp({ host: resolved.host, port: resolved.port });
		// 本机走固定 socket，身份由文件权限保证，不带令牌
		const token = undefined;
		// 直连的远程主机按操作档申请，主机按自己的配置收窄
		const role = target === LOCAL_TARGET ? undefined : ("operator" as const);
		return this.attach(webContents, { socket }, token, role);
	}

	/** 把一条已建好的连接接上界面：转发数据与关闭事件。 */
	private attach(
		webContents: WebContents,
		source: { socket: Socket } | { stream: StreamLike },
		token: string | undefined,
		role: "operator" | "viewer" | undefined,
	): { id: number; token: string | undefined; role: "operator" | "viewer" | undefined } {
		const id = this.next;
		this.next += 1;
		const finish = (reason: string): void => {
			if (!this.channels.delete(id)) {
				return;
			}
			if (!webContents.isDestroyed()) {
				webContents.send(HOST_CLOSE_EVENT, id, reason);
			}
		};
		const deliver = (chunk: string): void => {
			if (!webContents.isDestroyed()) {
				webContents.send(HOST_DATA_EVENT, id, chunk);
			}
		};
		if ("socket" in source) {
			const socket = source.socket;
			socket.setEncoding("utf8");
			socket.on("data", deliver);
			socket.on("close", () => finish("closed"));
			socket.on("error", (error: Error) => finish(error.message));
			this.channels.set(id, {
				owner: webContents.id,
				write: (text) => socket.write(text),
				close: () => {
					socket.end();
					socket.destroy();
				},
			});
		} else {
			const stream = source.stream;
			stream.onData(deliver);
			stream.onClose((reason) => finish(reason));
			this.channels.set(id, {
				owner: webContents.id,
				write: (text) => stream.write(text),
				close: () => stream.close(),
			});
		}
		return { id, token, role };
	}

	/** 把界面写的一段文本转给主机。 */
	write(id: number, text: string): void {
		this.channels.get(id)?.write(text);
	}

	/** 关掉一条通道。 */
	close(id: number): void {
		const channel = this.channels.get(id);
		if (channel === undefined) {
			return;
		}
		this.channels.delete(id);
		channel.close();
	}

	/** 窗口关掉时清掉它名下的通道。 */
	closeFor(webContentsId: number): void {
		for (const [id, channel] of [...this.channels]) {
			if (channel.owner === webContentsId) {
				this.close(id);
			}
		}
	}

	/** 退出时全部断开。 */
	dispose(): void {
		for (const id of [...this.channels.keys()]) {
			this.close(id);
		}
	}
}

/** 连发现文件记着的主机：unix socket 直接连，TCP 也是同一套按行协议。 */

/** 建一条 TCP 或 unix 连接。 */
function connectTcp(target: { host: string; port: number } | { path: string }): Promise<Socket> {
	return new Promise<Socket>((resolve, reject) => {
		const socket =
			"path" in target ? connect({ path: target.path }) : connect({ host: target.host, port: target.port });
		socket.once("connect", () => {
			socket.off("error", reject);
			resolve(socket);
		});
		socket.once("error", reject);
	});
}
