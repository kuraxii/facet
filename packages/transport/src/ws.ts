/**
 * WebSocket 传输。
 *
 * 浏览器、Electron 渲染进程与 Node 都自带 WebSocket,缺省直接用它;测试与特殊运行时
 * 通过 createSocket 换成别的实现。连接关闭后 connect 可以再次调用完成重连,
 * 需要记住的订阅由调用方在重新握手后恢复。
 */
import type {
	Action,
	ActionFrame,
	Channel,
	HelloFrame,
	RequestMethod,
	RequestParams,
	RequestResults,
	ServerFrame,
} from "@facet/protocol";
import type { ConnectionState, Handshake, SocketFactory, SocketLike, Transport } from "./types.ts";
import { TransportError } from "./types.ts";

const READY_STATE_OPEN = 1;

/** 传输配置。 */
export interface WsTransportOptions {
	/** 端点地址,例如 ws://127.0.0.1:8080/endpoint */
	url: string;
	/** 自定义 socket 工厂,缺省用运行时自带的 WebSocket */
	createSocket?: SocketFactory;
	/** 握手超时,毫秒,缺省 10 秒 */
	handshakeTimeoutMs?: number;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;

function defaultSocketFactory(url: string): SocketLike {
	const ctor = (globalThis as { WebSocket?: new (url: string) => SocketLike }).WebSocket;
	if (!ctor) {
		throw new TransportError("当前运行时不提供 WebSocket,需要通过 createSocket 指定实现");
	}
	return new ctor(url);
}

export class WsTransport implements Transport {
	private readonly options: WsTransportOptions;
	private readonly createSocket: SocketFactory;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly actionListeners = new Set<(frame: ActionFrame) => void>();
	private readonly stateListeners = new Set<(state: ConnectionState) => void>();
	private socket: SocketLike | null = null;
	private currentState: ConnectionState = "closed";
	private currentHandshake: Handshake | undefined;
	private requestCount = 0;
	private clientSeq = 0;
	private closedByCaller = false;

	constructor(options: WsTransportOptions) {
		this.options = options;
		this.createSocket = options.createSocket ?? defaultSocketFactory;
	}

	get state(): ConnectionState {
		return this.currentState;
	}

	/** 端点地址，下一次 connect 用它。 */
	get url(): string {
		return this.options.url;
	}

	/**
	 * 换一个端点地址。
	 *
	 * 已经建立的连接不受影响，下一次 connect 才连到新地址；嵌入主机被重新拉起后端口会变，
	 * 调用方据此重新握手。
	 */
	setUrl(url: string): void {
		this.options.url = url;
	}

	get handshake(): Handshake | undefined {
		return this.currentHandshake;
	}

	/** 建立连接并等待 hello。重复调用会先关掉上一条连接。 */
	async connect(): Promise<Handshake> {
		this.closedByCaller = false;
		this.dropSocket();
		this.setState("connecting");
		const socket = this.createSocket(this.options.url);
		this.socket = socket;

		const handshake = await new Promise<Handshake>((resolve, reject) => {
			let settled = false;
			const timeout = setTimeout(() => {
				if (!settled) {
					settled = true;
					reject(new TransportError("握手超时"));
					this.dropSocket();
				}
			}, this.options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS);

			socket.onopen = () => {};
			socket.onerror = () => {
				if (!settled) {
					settled = true;
					clearTimeout(timeout);
					reject(new TransportError("连接失败"));
				}
			};
			socket.onclose = (event) => {
				this.handleClose(event.code, event.reason);
				if (!settled) {
					settled = true;
					clearTimeout(timeout);
					reject(new TransportError(`连接已关闭:${event.reason || event.code}`));
				}
			};
			socket.onmessage = (event) => {
				const frame = this.parseFrame(event.data);
				if (!frame) {
					return;
				}
				if (frame.type === "hello") {
					if (!settled) {
						settled = true;
						clearTimeout(timeout);
						const accepted = this.acceptHello(frame);
						resolve(accepted);
					}
					return;
				}
				this.handleFrame(frame);
			};
		});

		this.setState("ready");
		return handshake;
	}

	request<M extends RequestMethod>(method: M, params?: RequestParams[M]): Promise<RequestResults[M]> {
		if (this.currentState !== "ready" || !this.socket) {
			return Promise.reject(new TransportError("连接未就绪"));
		}
		this.requestCount += 1;
		const id = `r${this.requestCount}`;
		const frame =
			params === undefined ? { type: "request", id, method } : { type: "request", id, method, params };
		return new Promise<RequestResults[M]>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			try {
				this.sendFrame(frame);
			} catch (error) {
				this.pending.delete(id);
				reject(error instanceof Error ? error : new TransportError(String(error)));
			}
		});
	}

	dispatch(channel: Channel, action: Action): number {
		if (this.currentState !== "ready") {
			throw new TransportError("连接未就绪");
		}
		this.clientSeq += 1;
		this.sendFrame({ type: "dispatch", channel, clientSeq: this.clientSeq, action });
		return this.clientSeq;
	}

	onAction(listener: (frame: ActionFrame) => void): () => void {
		this.actionListeners.add(listener);
		return () => {
			this.actionListeners.delete(listener);
		};
	}

	onStateChange(listener: (state: ConnectionState) => void): () => void {
		this.stateListeners.add(listener);
		return () => {
			this.stateListeners.delete(listener);
		};
	}

	close(): void {
		this.closedByCaller = true;
		this.dropSocket();
		this.setState("closed");
	}

	private acceptHello(frame: HelloFrame): Handshake {
		this.currentHandshake = {
			protocolVersion: frame.protocolVersion,
			hostId: frame.hostId,
			hostName: frame.hostName,
			clientId: frame.clientId,
			capabilities: frame.capabilities,
		};
		return this.currentHandshake;
	}

	private handleFrame(frame: ServerFrame): void {
		if (frame.type === "response") {
			const pending = this.pending.get(frame.id);
			if (!pending) {
				return;
			}
			this.pending.delete(frame.id);
			if (frame.ok) {
				pending.resolve(frame.data);
			} else {
				pending.reject(new TransportError(frame.error.message, frame.error.code));
			}
			return;
		}
		if (frame.type === "action") {
			for (const listener of [...this.actionListeners]) {
				listener(frame);
			}
			return;
		}
		if (frame.type === "hello") {
			this.acceptHello(frame);
		}
	}

	private handleClose(code: number, reason: string | undefined): void {
		this.socket = null;
		this.currentHandshake = undefined;
		const failure = new TransportError(`连接已断开:${reason || code}`);
		for (const pending of this.pending.values()) {
			pending.reject(failure);
		}
		this.pending.clear();
		if (!this.closedByCaller) {
			this.setState("closed");
		}
	}

	private sendFrame(frame: unknown): void {
		if (!this.socket || this.socket.readyState !== READY_STATE_OPEN) {
			throw new TransportError("连接未就绪");
		}
		this.socket.send(JSON.stringify(frame));
	}

	private parseFrame(data: unknown): ServerFrame | undefined {
		const text =
			typeof data === "string" ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : "";
		if (text.length === 0) {
			return undefined;
		}
		try {
			const parsed = JSON.parse(text) as ServerFrame;
			return typeof parsed === "object" && parsed !== null ? parsed : undefined;
		} catch {
			return undefined;
		}
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
				// 已关闭的 socket 再关一次由实现抛错,这里忽略
			}
		}
		const failure = new TransportError("连接已关闭");
		for (const pending of this.pending.values()) {
			pending.reject(failure);
		}
		this.pending.clear();
	}

	private setState(next: ConnectionState): void {
		if (this.currentState === next) {
			return;
		}
		this.currentState = next;
		for (const listener of [...this.stateListeners]) {
			listener(next);
		}
	}
}
