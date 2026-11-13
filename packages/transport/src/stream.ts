/**
 * 字节流传输。
 *
 * 帧按行编码，跑在任意双向字节流上：unix socket、Windows 命名管道、SSH 通道、进程的
 * 标准输入输出都行。这样远端可以不监听任何 TCP 端口，协议本身也不用改。
 */

import type {
	Action,
	ActionFrame,
	Channel,
	ClientEntry,
	RequestMethod,
	RequestParams,
	RequestResults,
} from "@facet/protocol";
import { FrameDecoder } from "@facet/protocol";
import { TransportCore } from "./core.ts";
import type { ConnectionState, Handshake, StreamFactory, StreamLike, Transport } from "./types.ts";
import { TransportError } from "./types.ts";

/** 传输配置。 */
export interface StreamTransportOptions {
	/** 建立一条字节流，每次 connect 调用一次 */
	createStream: StreamFactory;
	/** 连接令牌，主机校验通过才回 hello */
	token?: string;
	/** 请求的权限档：远程端声明自己要用只读或操作档 */
	role?: "operator" | "viewer";
	/** 连接来源，缺省按 desktop 算 */
	entry?: ClientEntry;
	/** 握手超时，毫秒，缺省 10 秒 */
	handshakeTimeoutMs?: number;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;

export class StreamTransport implements Transport {
	private readonly options: StreamTransportOptions;
	private readonly core = new TransportCore();
	private readonly decoder = new FrameDecoder();
	private stream: StreamLike | undefined;
	private stops: (() => void)[] = [];

	constructor(options: StreamTransportOptions) {
		this.options = options;
	}

	get state(): ConnectionState {
		return this.core.state;
	}

	get handshake(): Handshake | undefined {
		return this.core.handshake;
	}

	/** 换连接令牌、权限档与入口，下一次 connect 生效。 */
	setToken(token: string | undefined, role?: "operator" | "viewer", entry?: ClientEntry): void {
		this.options.token = token;
		this.options.role = role;
		this.options.entry = entry;
	}

	/** 建立连接并等待 hello。重复调用会先关掉上一条连接。 */
	async connect(): Promise<Handshake> {
		this.core.resetClosedByCaller();
		this.dropStream();
		const stream = await this.options.createStream();
		this.stream = stream;

		return await new Promise<Handshake>((resolve, reject) => {
			let settled = false;
			const timeout = setTimeout(() => {
				if (!settled) {
					settled = true;
					reject(new TransportError("握手超时"));
					this.dropStream();
				}
			}, this.options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS);

			this.stops.push(
				stream.onData((chunk) => {
					let lines: string[];
					try {
						lines = this.decoder.push(chunk);
					} catch {
						this.dropStream();
						if (!settled) {
							settled = true;
							clearTimeout(timeout);
							reject(new TransportError("帧超过上限"));
						}
						return;
					}
					for (const line of lines) {
						let parsed: unknown;
						try {
							parsed = JSON.parse(line);
						} catch {
							continue;
						}
						const handshake = this.core.receive(parsed);
						if (handshake !== undefined && !settled) {
							settled = true;
							clearTimeout(timeout);
							resolve(handshake);
						}
					}
				}),
			);
			this.stops.push(
				stream.onClose((reason) => {
					this.core.handleClose(`连接已断开:${reason}`, this.core.isClosedByCaller);
					this.stream = undefined;
					if (!settled) {
						settled = true;
						clearTimeout(timeout);
						reject(new TransportError(`连接已关闭:${reason}`));
					}
				}),
			);
			this.core.markOpen(
				(text) => stream.write(text),
				this.options.token,
				this.options.role,
				this.options.entry,
			);
		});
	}

	request<M extends RequestMethod>(method: M, params?: RequestParams[M]): Promise<RequestResults[M]> {
		return this.core.request(method, params);
	}

	dispatch(channel: Channel, action: Action): number {
		return this.core.dispatch(channel, action);
	}

	onAction(listener: (frame: ActionFrame) => void): () => void {
		return this.core.onAction(listener);
	}

	onStateChange(listener: (state: ConnectionState) => void): () => void {
		return this.core.onStateChange(listener);
	}

	close(): void {
		this.core.markClosedByCaller();
		this.dropStream();
	}

	private dropStream(): void {
		for (const stop of this.stops) {
			stop();
		}
		this.stops = [];
		const stream = this.stream;
		this.stream = undefined;
		this.decoder.clear();
		try {
			stream?.close();
		} catch {
			// 已经关掉的流再关一次由实现抛错，这里忽略
		}
		// 主动断开：状态回到 closed，在途请求一律失败
		this.core.handleClose("连接已关闭", false);
	}
}
