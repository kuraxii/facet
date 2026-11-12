/**
 * 主机连接的代理通道。
 *
 * 渲染进程跑在沙箱里，打不开 unix socket，也不该自己拿着主机地址。界面请求一条通道，
 * 主进程按目标连到主机（本机按发现文件走 unix socket 或 TCP，远程按 host:port 走 TCP），
 * 之后两端只搬运帧：界面写进来的行、主机回来的行。
 */
import { connect, type Socket } from "node:net";
import { type DiscoveryRecord, describeDiscovery } from "@facet/server";
import type { WebContents } from "electron";

/** 数据帧事件：通道标识加一段文本。 */
export const HOST_DATA_EVENT = "facet:host-data";
/** 关闭事件：通道标识加原因。 */
export const HOST_CLOSE_EVENT = "facet:host-close";

/** 本机目标的标识，界面用它表示「按发现文件连本机」。 */
export const LOCAL_TARGET = "local";

interface Channel {
	readonly socket: Socket;
	readonly owner: number;
}

/** 解析目标：本机取发现文件，其他按 host:port 走 TCP。 */
export type TargetResolver = (target: string) => DiscoveryRecord | { host: string; port: number } | undefined;

export class HostChannels {
	private next = 1;
	private readonly channels = new Map<number, Channel>();
	private readonly resolve: TargetResolver;

	constructor(resolve: TargetResolver) {
		this.resolve = resolve;
	}

	/** 连到目标，返回通道标识；连不上时抛错，渲染进程据此显示「连不上主机」。 */
	async open(webContents: WebContents, target: string): Promise<number> {
		const resolved = this.resolve(target);
		if (resolved === undefined) {
			throw new Error(target === LOCAL_TARGET ? "没有发现正在运行的主机" : `主机地址无效:${target}`);
		}
		const socket =
			"endpoint" in resolved
				? await connectToDiscovery(resolved)
				: await connectTcp({ host: resolved.host, port: resolved.port });
		const id = this.next;
		this.next += 1;
		this.channels.set(id, { socket, owner: webContents.id });
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			if (!webContents.isDestroyed()) {
				webContents.send(HOST_DATA_EVENT, id, chunk);
			}
		});
		const finish = (reason: string): void => {
			if (!this.channels.delete(id)) {
				return;
			}
			if (!webContents.isDestroyed()) {
				webContents.send(HOST_CLOSE_EVENT, id, reason);
			}
		};
		socket.on("close", () => finish("closed"));
		socket.on("error", (error: Error) => finish(error.message));
		return id;
	}

	/** 把界面写的一段文本转给主机。 */
	write(id: number, text: string): void {
		const channel = this.channels.get(id);
		if (channel !== undefined && !channel.socket.destroyed) {
			channel.socket.write(text);
		}
	}

	/** 关掉一条通道。 */
	close(id: number): void {
		const channel = this.channels.get(id);
		if (channel === undefined) {
			return;
		}
		this.channels.delete(id);
		channel.socket.end();
		channel.socket.destroy();
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
async function connectToDiscovery(record: DiscoveryRecord): Promise<Socket> {
	if (record.endpoint.transport === "unix") {
		return await connectTcp({ path: record.endpoint.path });
	}
	const url = new URL(record.endpoint.url);
	return await connectTcp({ host: url.hostname, port: Number(url.port) });
}

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

/** 发现记录的地址，日志里显示用。 */
export function addressOf(record: DiscoveryRecord): string {
	return describeDiscovery(record);
}
