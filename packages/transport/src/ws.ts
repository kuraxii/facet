/**
 * WebSocket 传输。
 *
 * 浏览器、Electron 渲染进程与 Node 都自带 WebSocket，缺省直接用它；测试与特殊运行时
 * 通过 createSocket 换成别的实现。连接关闭后 connect 可以再次调用完成重连，
 * 需要记住的订阅由调用方在重新握手后恢复。帧的编解码与状态机在 core 里，与字节流传输共用。
 */
import type {
	Action,
	ActionFrame,
	Channel,
	RequestMethod,
	RequestParams,
	RequestResults,
} from "@facet/protocol";
import { TransportCore } from "./core.ts";
import type { ConnectionState, Handshake, SocketFactory, SocketLike, Transport } from "./types.ts";
import { TransportError } from "./types.ts";

const READY_STATE_OPEN = 1;

/** 传输配置。 */
export interface WsTransportOptions {
	/** 端点地址，例如 ws://127.0.0.1:8080/endpoint */
	url: string;
	/** 连接令牌，主机校验通过才回 hello */
	token?: string;
	/** 自定义 socket 工厂，缺省用运行时自带的 WebSocket */
	createSocket?: SocketFactory;
	/** 握手超时，毫秒，缺省 10 秒 */
	handshakeTimeoutMs?: number;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;

function defaultSocketFactory(url: string): SocketLike {
	const ctor = (globalThis as { WebSocket?: new (url: string) => SocketLike }).WebSocket;
	if (!ctor) {
		throw new TransportError("当前运行时不提供 WebSocket，需要通过 createSocket 指定实现");
	}
	return new ctor(url);
}

export class WsTransport implements Transport {
	private readonly options: WsTransportOptions;
	private readonly createSocket: SocketFactory;
	private readonly core = new TransportCore();
	private socket: SocketLike | null = null;
	/** 去掉行尾再发：WebSocket 一条消息就是一帧 */
	private readonly sendAsMessage = (text: string): void => this.sendFrame(text);

	constructor(options: WsTransportOptions) {
		this.options = options;
		this.createSocket = options.createSocket ?? defaultSocketFactory;
	}

	get state(): ConnectionState {
		return this.core.state;
	}

	get url(): string {
		return this.options.url;
	}

	get handshake(): Handshake | undefined {
		return this.core.handshake;
	}

	/** 换一个端点地址；已经建立的连接不受影响。 */
	setUrl(url: string): void {
		this.options.url = url;
	}

	/** 换连接令牌，下一次 connect 生效。 */
	setToken(token: string | undefined): void {
		this.options.token = token;
	}

	/** 建立连接并等待 hello。重复调用会先关掉上一条连接。 */
	async connect(): Promise<Handshake> {
		this.core.resetClosedByCaller();
		this.dropSocket();
		const socket = this.createSocket(this.options.url);
		this.socket = socket;

		return await new Promise<Handshake>((resolve, reject) => {
			let settled = false;
			const timeout = setTimeout(() => {
				if (!settled) {
					settled = true;
					reject(new TransportError("握手超时"));
					this.dropSocket();
				}
			}, this.options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS);

			socket.onopen = () => {
				this.core.markOpen(this.sendAsMessage, this.options.token);
			};
			socket.onerror = () => {
				if (!settled) {
					settled = true;
					clearTimeout(timeout);
					reject(new TransportError("连接失败"));
				}
			};
			socket.onclose = (event) => {
				this.core.handleClose(`连接已断开:${event.reason || event.code}`, this.core.isClosedByCaller);
				this.socket = null;
				if (!settled) {
					settled = true;
					clearTimeout(timeout);
					reject(new TransportError(`连接已关闭:${event.reason || event.code}`));
				}
			};
			socket.onmessage = (event) => {
				const text =
					typeof event.data === "string"
						? event.data
						: event.data instanceof ArrayBuffer
							? new TextDecoder().decode(event.data)
							: "";
				if (text.length === 0) {
					return;
				}
				let parsed: unknown;
				try {
					parsed = JSON.parse(text);
				} catch {
					return;
				}
				const handshake = this.core.receive(parsed);
				if (handshake !== undefined && !settled) {
					settled = true;
					clearTimeout(timeout);
					resolve(handshake);
				}
			};
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
		this.dropSocket();
	}

	private sendFrame(text: string): void {
		const socket = this.socket;
		if (socket === null || socket.readyState !== READY_STATE_OPEN) {
			throw new TransportError("连接未就绪");
		}
		socket.send(text.endsWith("\n") ? text.slice(0, -1) : text);
	}

	private dropSocket(): void {
		const socket = this.socket;
		this.socket = null;
		if (socket) {
			socket.onopen = null;
			socket.onmessage = null;
			socket.onclose = null;
			socket.onerror = null;
			try {
				socket.close(1000, "client closing");
			} catch {
				// 已关闭的 socket 再关一次由实现抛错，这里忽略
			}
		}
		// 主动断开：状态回到 closed，在途请求一律失败
		this.core.handleClose("连接已关闭", false);
	}
}
