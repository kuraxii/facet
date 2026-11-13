/**
 * 传输的公共状态机。
 *
 * 请求应答、动作分发、连接状态与重连都不依赖具体的承载方式：WebSocket 一条消息一帧，
 * 字节流按行切帧，两者都只提供「发一段文本」「收到一帧」「连上」「断开」四件事。
 * 这里把其余逻辑收在一处，具体传输只做适配。
 */
import type {
	Action,
	ActionFrame,
	Channel,
	ClientEntry,
	HelloFrame,
	RequestMethod,
	RequestParams,
	RequestResults,
} from "@facet/protocol";
import type { ConnectionState, Handshake } from "./types.ts";
import { TransportError } from "./types.ts";

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

/** 具体传输实现要提供的钩子。 */
export interface TransportCoreHost {
	/** 发出已编码的一帧；连接不可写时抛错。 */
	send(text: string): void;
	/** 握手完成后调用，交给核心发首帧令牌。 */
	onOpen(send: (text: string) => void): void;
	/** 结束连接，参数是给调用方的关闭说明。 */
	shutdown(reason: string): void;
}

export class TransportCore {
	private readonly pending = new Map<string, PendingRequest>();
	private readonly actionListeners = new Set<(frame: ActionFrame) => void>();
	private readonly stateListeners = new Set<(state: ConnectionState) => void>();
	private currentState: ConnectionState = "closed";
	private currentHandshake: Handshake | undefined;
	private requestCount = 0;
	private clientSeq = 0;
	private closedByCaller = false;
	/** 当前连接的可写句柄，由具体传输在连上时设置 */
	private sender: ((text: string) => void) | undefined;

	get state(): ConnectionState {
		return this.currentState;
	}

	get handshake(): Handshake | undefined {
		return this.currentHandshake;
	}

	/** 连上之后由具体传输调用，把令牌与请求的权限档交出去并等 hello。 */
	markOpen(
		send: (text: string) => void,
		token: string | undefined,
		role?: "operator" | "viewer",
		entry?: ClientEntry,
	): void {
		this.sender = send;
		this.setState("connecting");
		// 令牌是连接里的第一帧，主机校验通过才回 hello；不给令牌时也发一帧空串
		send(
			`${JSON.stringify({
				type: "auth",
				token: token ?? "",
				...(role === undefined ? {} : { role }),
				...(entry === undefined ? {} : { entry }),
			})}\n`,
		);
	}

	/** 收到一帧解析后的内容。 */
	receive(frame: unknown): Handshake | undefined {
		if (typeof frame !== "object" || frame === null) {
			return undefined;
		}
		const typed = frame as { type?: unknown };
		if (typed.type === "hello") {
			this.currentHandshake = this.acceptHello(frame as HelloFrame);
			this.setState("ready");
			return this.currentHandshake;
		}
		this.handleFrame(frame as Parameters<TransportCore["handleFrame"]>[0]);
		return undefined;
	}

	/** 连接断开：在途请求全部失败，状态回到 closed。 */
	handleClose(reason: string, byCaller: boolean): void {
		this.sender = undefined;
		this.currentHandshake = undefined;
		const failure = new TransportError(reason);
		for (const pending of this.pending.values()) {
			pending.reject(failure);
		}
		this.pending.clear();
		if (!byCaller) {
			this.setState("closed");
		}
	}

	/** 记录调用方主动关闭，后续断开不再触发重连语义。 */
	markClosedByCaller(): void {
		this.closedByCaller = true;
	}

	get isClosedByCaller(): boolean {
		return this.closedByCaller;
	}

	resetClosedByCaller(): void {
		this.closedByCaller = false;
	}

	request<M extends RequestMethod>(method: M, params?: RequestParams[M]): Promise<RequestResults[M]> {
		if (this.currentState !== "ready" || this.sender === undefined) {
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

	private sendFrame(frame: unknown): void {
		const sender = this.sender;
		if (sender === undefined) {
			throw new TransportError("连接未就绪");
		}
		// 帧一律按行编码：WebSocket 传输去掉行尾再发，字节流传输直接用这一行
		sender(`${JSON.stringify(frame)}\n`);
	}

	private acceptHello(frame: HelloFrame): Handshake {
		return {
			protocolVersion: frame.protocolVersion,
			hostId: frame.hostId,
			hostName: frame.hostName,
			clientId: frame.clientId,
			role: frame.role,
			canManage: frame.canManage === true,
			capabilities: frame.capabilities,
		};
	}

	private handleFrame(frame: {
		type: string;
		id?: string;
		ok?: boolean;
		data?: unknown;
		error?: { message: string; code: string };
		[key: string]: unknown;
	}): void {
		if (frame.type === "response") {
			const pending = frame.id === undefined ? undefined : this.pending.get(frame.id);
			if (!pending) {
				return;
			}
			this.pending.delete(frame.id as string);
			if (frame.ok === true) {
				pending.resolve(frame.data);
			} else {
				pending.reject(new TransportError(frame.error?.message ?? "请求失败", frame.error?.code));
			}
			return;
		}
		if (frame.type === "action") {
			for (const listener of [...this.actionListeners]) {
				listener(frame as unknown as ActionFrame);
			}
		}
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
