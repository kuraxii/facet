/**
 * 终端客户端。
 *
 * 一个终端一条通道：挂载时先取回滚与当前序号，再按序号订阅增量；之后主机推来的每段输出
 * 交给界面写进 xterm，同时按 50ms 合并一次确认回去，让主机的流控水位能降下来。
 *
 * 传输按结构约定，不引入 transport 包，两者处于同一层。
 */
import type { ActionFrame, Channel, TerminalExit, TerminalInfo } from "@facet/protocol";
import { terminalChannelFor } from "@facet/protocol";
import type { SessionTransport } from "./client.ts";

/** 确认回主机的合并窗口。 */
const ACK_MS = 50;

/** 一个已挂载终端的状态。 */
export interface AttachedTerminal {
	/** 终端状态 */
	readonly info: TerminalInfo;
	/** 回滚文本，挂载时写进 xterm 的初值 */
	readonly text: string;
	/** 回滚覆盖到的通道序号 */
	readonly seq: number;
}

/** 挂载一方要的回调。每个挂载的终端一份，只有挂载过的终端才会有回调。 */
export interface TerminalListener {
	/** 一段新输出 */
	onData(text: string): void;
	/** 进程结束 */
	onExit(exit: TerminalExit): void;
	/** 尺寸被别的端改过 */
	onResized(cols: number, rows: number): void;
	/** 终端被别的端关掉 */
	onClosed(): void;
}

/** 一个终端的挂载状态。 */
interface Mounted {
	channel: Channel;
	info: TerminalInfo;
	listener: TerminalListener;
	/** 已收到的最大序号，确认时用它 */
	seq: number;
	/** 待确认的序号，合并窗口里只保留最新一个 */
	pendingAck: number | undefined;
	ackTimer: ReturnType<typeof setTimeout> | undefined;
}

export class TerminalClient {
	private readonly transport: SessionTransport;
	private readonly mounted = new Map<string, Mounted>();
	private stop: (() => void) | undefined;

	constructor(options: { transport: SessionTransport }) {
		this.transport = options.transport;
	}

	/** 开始接收动作。重连之后再次调用即可换到新连接。 */
	start(): void {
		this.stop?.();
		this.stop = this.transport.onAction((frame) => this.onFrame(frame));
	}

	/** 停止接收动作。 */
	dispose(): void {
		this.stop?.();
		this.stop = undefined;
		for (const mount of this.mounted.values()) {
			if (mount.ackTimer !== undefined) {
				clearTimeout(mount.ackTimer);
			}
		}
		this.mounted.clear();
	}

	/** 主机上的终端清单，含已结束的。 */
	async list(): Promise<TerminalInfo[]> {
		const result = await this.transport.request("listTerminals");
		return result.terminals;
	}

	/** 开一个终端，返回它的状态。cwd 为空时落在主机用户的 home。 */
	async create(cwd: string | undefined, cols: number, rows: number): Promise<TerminalInfo> {
		const result = await this.transport.request("createTerminal", { cwd: cwd ?? "", cols, rows });
		return result.terminal;
	}

	/**
	 * 挂载一个终端：取回滚与序号，再订阅增量。
	 *
	 * 顺序固定先取回滚再订阅：两段之间到达的输出会落在增量里，不会丢也不会重复。
	 */
	async attach(id: string, listener: TerminalListener): Promise<AttachedTerminal> {
		const info = (await this.transport.request("listTerminals")).terminals.find((item) => item.id === id);
		if (info === undefined) {
			throw new Error(`没有这个终端：${id}`);
		}
		const snapshot = await this.transport.request("serializeTerminal", { id });
		const channel = terminalChannelFor(id);
		const subscribe = await this.transport.request("subscribe", { channel, since: snapshot.seq });
		const mount: Mounted = {
			channel,
			info,
			listener,
			seq: Math.max(snapshot.seq, subscribe.seq),
			pendingAck: undefined,
			ackTimer: undefined,
		};
		this.mounted.set(id, mount);
		return { info, text: snapshot.text, seq: snapshot.seq };
	}

	/** 取消挂载并退订。 */
	async detach(id: string): Promise<void> {
		const mount = this.mounted.get(id);
		if (mount === undefined) {
			return;
		}
		this.mounted.delete(id);
		if (mount.ackTimer !== undefined) {
			clearTimeout(mount.ackTimer);
		}
		await this.transport.request("unsubscribe", { channel: mount.channel }).catch(() => undefined);
	}

	/** 写入按键。 */
	write(id: string, data: string): void {
		void this.transport.request("writeTerminal", { id, data }).catch(() => undefined);
	}

	/** 改尺寸。 */
	resize(id: string, cols: number, rows: number): void {
		const mount = this.mounted.get(id);
		if (mount !== undefined) {
			mount.info = { ...mount.info, cols, rows };
		}
		void this.transport.request("resizeTerminal", { id, cols, rows }).catch(() => undefined);
	}

	/** 挂断并取消挂载。 */
	async kill(id: string): Promise<void> {
		await this.transport.request("killTerminal", { id });
		await this.detach(id);
	}

	/** 按通道与动作分派。终端通道之外的动作原样忽略。 */
	private onFrame(frame: ActionFrame): void {
		const channel = frame.channel;
		if (!channel.startsWith("terminal:/")) {
			return;
		}
		const action = frame.action;
		if (action.type === "terminal/data") {
			const mount = this.mounted.get(action.id);
			if (mount === undefined) {
				return;
			}
			mount.listener.onData(action.text);
			this.scheduleAck(action.id, frame.serverSeq);
			return;
		}
		if (action.type === "terminal/exit") {
			const mount = this.mounted.get(action.id);
			if (mount === undefined) {
				return;
			}
			mount.info = { ...mount.info, exit: action.exit };
			mount.listener.onExit(action.exit);
			return;
		}
		if (action.type === "terminal/closed") {
			const mount = this.mounted.get(action.id);
			if (mount === undefined) {
				return;
			}
			this.mounted.delete(action.id);
			mount.listener.onClosed();
			return;
		}
		if (action.type === "terminal/resized") {
			const mount = this.mounted.get(action.id);
			if (mount === undefined) {
				return;
			}
			mount.info = { ...mount.info, cols: action.cols, rows: action.rows };
			mount.listener.onResized(action.cols, action.rows);
		}
	}

	/**
	 * 记下已收到的序号并按窗口合并确认。
	 *
	 * 确认只报最新序号：主机按序号累加字符数，中间跳过的帧已经包含在这个序号里。
	 */
	private scheduleAck(id: string, seq: number): void {
		const mount = this.mounted.get(id);
		if (mount === undefined) {
			return;
		}
		mount.seq = Math.max(mount.seq, seq);
		mount.pendingAck = mount.seq;
		if (mount.ackTimer !== undefined) {
			return;
		}
		mount.ackTimer = setTimeout(() => {
			mount.ackTimer = undefined;
			const target = mount.pendingAck;
			mount.pendingAck = undefined;
			if (target === undefined) {
				return;
			}
			void this.transport.request("ackTerminal", { id, seq: target }).catch(() => undefined);
		}, ACK_MS);
	}
}
