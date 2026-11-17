/**
 * 与主机的连接链路。
 *
 * 传输层只管一次连接的状态机，重连节奏由这里掌握：一次连接断掉之后按指数退避再试，
 * 每次连上先把握手交出去、再续订订阅。界面只读快照，不碰定时器。
 */
import type { HostHandshake } from "./client.ts";
import { debugLog } from "./log.ts";

/** 连接的四种状态。`reconnecting` 表示已经断过一次、正在等或正在试。 */
export type LinkStatus = "disconnected" | "connecting" | "ready" | "reconnecting";

/** 连接状态快照，只读。引用只在内容变化时更换，界面据此判断要不要重绘。 */
export interface LinkSnapshot {
	/** 此刻处于哪一个状态 */
	readonly status: LinkStatus;
	/** 连续失败的次数，连上之后归零 */
	readonly attempt: number;
	/** 下一次自动重连的时刻，单位是 epoch 毫秒；不在等待时为 undefined */
	readonly nextRetryAt: number | undefined;
	/** 最近一次失败的原因 */
	readonly lastError: string | undefined;
}

/** 连接链路需要的传输能力：连一次、关一次、听状态。 */
export interface LinkTransport {
	/** 传输此刻的状态，取 `connecting` / `ready` / `closed` */
	readonly state: string;
	/** 连一次并等握手完成；失败时抛出，退避由本模块负责 */
	connect(): Promise<HostHandshake>;
	/** 订阅连接状态变化 */
	onStateChange(listener: (state: string) => void): () => void;
	/** 主动关闭连接 */
	close(): void;
}

/** 连上之后要打交道的会话端：登记握手、续订订阅。 */
export interface LinkSession {
	/** 记下握手，开始接收新连接上的动作 */
	attach(handshake: HostHandshake): void;
	/** 按已收到的最后序号续订订阅 */
	resume(): Promise<void>;
}

/** 宿主接住连接事件的入口。 */
export interface LinkHooks {
	/**
	 * 连上并续订之后。
	 *
	 * `resumeFailed` 表示订阅没能恢复（典型情形是会话文件已经不在了），连接本身照常可用，
	 * 宿主据此决定要不要退回没有会话的状态。
	 */
	onReady?(handshake: HostHandshake, resumeFailed: boolean): void | Promise<void>;
	/** 任意一次失败。`willRetry` 为假表示不会自动再试，宿主可以给出重试入口。 */
	onFailure?(error: unknown, willRetry: boolean): void;
}

export interface ConnectionLinkOptions {
	/** 用来连的传输 */
	transport: LinkTransport;
	/** 连上之后登记握手与续订的对象 */
	session: LinkSession;
	/** 连接事件的处理，字段可以在构造之后替换 */
	hooks?: LinkHooks;
	/** 第一次重试前的等待，之后逐次翻倍 */
	initialDelayMs?: number;
	/** 单次等待的上限 */
	maxDelayMs?: number;
	/** 抖动幅度，0 到 1；让多端同时掉线时不一起打向主机 */
	jitterRatio?: number;
	/** 取 0 到 1 之间的随机数，测试注入固定值 */
	random?: () => number;
	/** 这个错误还值不值得再试。缺省一直重试 */
	retryable?: (error: unknown) => boolean;
}

const DEFAULT_INITIAL_DELAY_MS = 400;
const DEFAULT_MAX_DELAY_MS = 8000;
const DEFAULT_JITTER_RATIO = 0.25;

/** 从错误里取一句给界面看的说明。 */
function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class ConnectionLink {
	private readonly transport: LinkTransport;
	private readonly session: LinkSession;
	private readonly hooks: LinkHooks;
	private readonly initialDelayMs: number;
	private readonly maxDelayMs: number;
	private readonly jitterRatio: number;
	private readonly random: () => number;
	private readonly retryable: (error: unknown) => boolean;
	private readonly listeners = new Set<(snapshot: LinkSnapshot) => void>();
	private readonly stopStates: () => void;
	/** 当前快照，内容不变时沿用同一个对象 */
	private current: LinkSnapshot = {
		status: "disconnected",
		attempt: 0,
		nextRetryAt: undefined,
		lastError: undefined,
	};
	/** 等待中的重连定时器 */
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	/** 主动断开之后不再自动重连；下一次显式连接把它放回 false */
	private stopped = true;
	/** 有一次 connect 正在路上，此时传输报的 closed 由那次尝试的失败来处理 */
	private inFlight = false;

	constructor(options: ConnectionLinkOptions) {
		this.transport = options.transport;
		this.session = options.session;
		this.hooks = options.hooks ?? {};
		this.initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
		this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
		this.jitterRatio = options.jitterRatio ?? DEFAULT_JITTER_RATIO;
		this.random = options.random ?? Math.random;
		this.retryable = options.retryable ?? (() => true);
		this.stopStates = this.transport.onStateChange((state) => {
			this.handleState(state);
		});
	}

	/** 此刻的连接状态。 */
	get snapshot(): LinkSnapshot {
		return this.current;
	}

	/** 订阅状态变化，返回取消订阅的函数。 */
	subscribe(listener: (snapshot: LinkSnapshot) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * 连一次，失败直接抛出。
	 *
	 * 用于启动与换主机：连不上由宿主决定摆哪一屏，这里不排重试，也不触发 `onReady`
	 * （接下来要拉什么由宿主自己决定）。连上之后掉线才会自动退避。
	 */
	async open(): Promise<HostHandshake> {
		this.stopped = false;
		this.persist({ attempt: 0, nextRetryAt: undefined, lastError: undefined });
		try {
			return await this.connectOnce("connecting", false);
		} catch (error) {
			this.persist({ status: "disconnected", attempt: 0, lastError: errorText(error) });
			this.hooks.onFailure?.(error, false);
			throw error;
		}
	}

	/**
	 * 立刻重连一次，取消等待中的退避。
	 *
	 * 用户点重试、或本机主机被重新拉起时用它。失败时回到退避，不抛给调用方：界面看快照。
	 */
	async reconnectNow(): Promise<void> {
		this.stopped = false;
		this.clearTimer();
		try {
			await this.connectOnce("reconnecting", true);
		} catch (error) {
			this.recordFailure(error);
		}
	}

	/** 主动断开：关掉连接、清掉定时器，之后的掉线不再触发重连。 */
	disconnect(): void {
		this.stopped = true;
		this.clearTimer();
		this.transport.close();
		this.persist({ status: "disconnected", attempt: 0, nextRetryAt: undefined, lastError: undefined });
	}

	/** 彻底放开：断开连接并丢掉状态订阅，之后不再有任何动作。 */
	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disconnect();
		this.disposed = true;
		this.stopStates();
		this.listeners.clear();
	}

	/**
	 * 连一次并续订。成功后快照回到 ready，失败原样抛出。
	 *
	 * `notify` 决定要不要叫宿主的 `onReady`：链路自己发起的重连要叫，宿主自己发起的
	 * `open()` 不叫——那一次接下来要做什么由宿主决定。
	 */
	private async connectOnce(phase: "connecting" | "reconnecting", notify: boolean): Promise<HostHandshake> {
		this.clearTimer();
		this.persist({ status: phase, nextRetryAt: undefined });
		this.inFlight = true;
		let handshake: HostHandshake;
		try {
			handshake = await this.transport.connect();
		} finally {
			this.inFlight = false;
		}
		this.session.attach(handshake);
		// 续订失败不影响连接本身：会话文件不在了就退回没有会话的状态
		const resumeFailed = await this.session.resume().then(
			() => false,
			(error: unknown) => {
				debugLog("link", "Failed to resume after connect", { error: errorText(error) });
				return true;
			},
		);
		this.persist({ status: "ready", attempt: 0, nextRetryAt: undefined, lastError: undefined });
		if (notify) {
			await this.hooks.onReady?.(handshake, resumeFailed);
		}
		return handshake;
	}

	/** 连上之后又断了：排一次退避重连。握手阶段的状态不算断线。 */
	private handleState(state: string): void {
		if (state !== "closed" || this.disposed || this.stopped || this.inFlight) {
			return;
		}
		if (this.current.status !== "ready" && this.current.status !== "reconnecting") {
			// 还没连上过（启动失败、换主机失败）交给宿主决定，这里不自动重试
			return;
		}
		this.scheduleRetry();
	}

	/** 记一次失败：更新快照，能重试就排下一次。 */
	private recordFailure(error: unknown): void {
		const attempt = this.current.attempt + 1;
		const willRetry = !this.disposed && !this.stopped && this.retryable(error);
		this.persist({
			status: willRetry ? "reconnecting" : "disconnected",
			attempt,
			nextRetryAt: undefined,
			lastError: errorText(error),
		});
		this.hooks.onFailure?.(error, willRetry);
		if (willRetry) {
			this.scheduleRetry();
		}
	}

	/**
	 * 按已失败次数算出下一次的等待。
	 *
	 * 刚掉线时计数为 0，等 initialDelayMs；每失败一次翻倍，抖动后仍然不超过上限。
	 */
	private retryDelay(failures: number): number {
		const base = Math.min(this.initialDelayMs * 2 ** failures, this.maxDelayMs);
		const spread = base * this.jitterRatio;
		return Math.max(1, Math.round(base - spread + this.random() * spread * 2));
	}

	/** 排一次重连。已经排着的时候不重复排。 */
	private scheduleRetry(): void {
		if (this.disposed || this.stopped || this.timer !== undefined) {
			return;
		}
		const delay = this.retryDelay(this.current.attempt);
		const timer = setTimeout(() => {
			this.timer = undefined;
			void this.retry();
		}, delay);
		// 只为重连而活的定时器不该拖住进程退出
		const handle: unknown = timer;
		if (typeof handle === "object" && handle !== null && "unref" in handle) {
			(handle as { unref: () => void }).unref();
		}
		this.timer = timer;
		this.persist({ status: "reconnecting", nextRetryAt: Date.now() + delay });
	}

	/** 定时器到点后试一次。 */
	private async retry(): Promise<void> {
		if (this.disposed || this.stopped) {
			return;
		}
		try {
			await this.connectOnce("reconnecting", true);
		} catch (error) {
			this.recordFailure(error);
		}
	}

	private clearTimer(): void {
		if (this.timer === undefined) {
			return;
		}
		clearTimeout(this.timer);
		this.timer = undefined;
	}

	/** 合并一次快照变更，内容没变就沿用原对象、也不通知。 */
	private persist(patch: Partial<LinkSnapshot>): void {
		const next: LinkSnapshot = { ...this.current, ...patch };
		if (
			next.status === this.current.status &&
			next.attempt === this.current.attempt &&
			next.nextRetryAt === this.current.nextRetryAt &&
			next.lastError === this.current.lastError
		) {
			return;
		}
		this.current = next;
		for (const listener of [...this.listeners]) {
			listener(next);
		}
	}
}
