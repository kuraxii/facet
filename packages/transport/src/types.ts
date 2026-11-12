/**
 * 传输层的公共形状。
 *
 * 传输只负责把帧搬到对端并维护连接状态,不理解动作含义。底层 socket 用最小接口描述,
 * 浏览器、Electron 与 Node 各自的 WebSocket 实现都能装上,测试里也可以换成桩。
 */
import type {
	Action,
	ActionFrame,
	Capability,
	Channel,
	RequestMethod,
	RequestParams,
	RequestResults,
} from "@facet/protocol";

/** 连接状态。ready 表示握手完成,可以发请求与动作。 */
export type ConnectionState = "connecting" | "ready" | "closed";

/** 握手结果,来自主机发出的 hello 帧。 */
export interface Handshake {
	/** 主机实现的协议版本 */
	protocolVersion: number;
	/** 主机标识,同一台主机重启后可能变化 */
	hostId: string;
	/** 主机展示名 */
	hostName: string;
	/** 本次连接分配的端标识,回放动作的来源用它归因 */
	clientId: string;
	/** 主机已实现的能力 */
	capabilities: readonly Capability[];
}

/** 底层 WebSocket 的最小形状。 */
export interface SocketLike {
	/** 与 WebSocket 规范一致,1 表示已打开 */
	readonly readyState: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	onopen: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: ((event: { code: number; reason?: string }) => void) | null;
	onerror: ((event: unknown) => void) | null;
}

/** 创建底层 socket。缺省用运行时自带的 WebSocket。 */
export type SocketFactory = (url: string) => SocketLike;

/**
 * 一条双向字节流。
 *
 * unix socket、命名管道、SSH 通道、进程的标准输入输出都能收成这个形状；帧按行编码，
 * 与 WebSocket 传输共用同一套状态机。
 */
export interface StreamLike {
	/** 写一段文本。连接已断时抛错。 */
	write(text: string): void;
	/** 订阅收到的文本片段，返回取消订阅的函数 */
	onData(listener: (chunk: string) => void): () => void;
	/** 订阅连接关闭，参数是原因 */
	onClose(listener: (reason: string) => void): () => void;
	/** 关闭连接 */
	close(): void;
}

/** 建立一条字节流。 */
export type StreamFactory = () => Promise<StreamLike>;

/** 主机端点的客户端。 */
export interface Transport {
	readonly state: ConnectionState;
	/** 握手结果,连接就绪前为空 */
	readonly handshake: Handshake | undefined;
	/**
	 * 建立连接并等待握手。
	 *
	 * 连接关闭后可以再次调用完成重连。传输本身不做退避重试,节奏由调用方掌握。
	 */
	connect(): Promise<Handshake>;
	/** 发一个请求并等待对应响应。连接未就绪或连接关闭时拒绝。 */
	request<M extends RequestMethod>(method: M, params?: RequestParams[M]): Promise<RequestResults[M]>;
	/** 派发一条动作。受理即返回,不等待执行结果;返回本次使用的端内序号。 */
	dispatch(channel: Channel, action: Action): number;
	/** 订阅主机推送的动作帧。 */
	onAction(listener: (frame: ActionFrame) => void): () => void;
	/** 订阅连接状态变化。 */
	onStateChange(listener: (state: ConnectionState) => void): () => void;
	/** 主动关闭连接,不再重连。 */
	close(): void;
}

/** 传输层错误。code 取自主机的错误分类,本地错误没有 code。 */
export class TransportError extends Error {
	readonly code: string | undefined;

	constructor(message: string, code?: string) {
		super(message);
		this.name = "TransportError";
		this.code = code;
	}
}
