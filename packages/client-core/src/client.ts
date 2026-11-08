/**
 * 会话客户端。
 *
 * 把传输、订阅与状态拼成界面能直接用的一个对象:打开会话时取快照、订阅两条通道、
 * 装载最近若干页历史;之后设备推来的动作直接进 store。翻页与重新同步的游标都在这里,
 * 界面不必知道协议细节。
 *
 * 传输按结构约定,不引入 transport 包,两者处于同一层。
 */
import type {
	Action,
	ActionFrame,
	ApprovalDecision,
	Capability,
	Channel,
	Entry,
	ModelRef,
	RequestMethod,
	RequestParams,
	RequestResults,
	SessionSnapshot,
	SessionSummary,
} from "@facet/protocol";
import type { ChatView, SessionView } from "./state.ts";
import { SessionStore } from "./store.ts";

/** 握手结果,与 hello 帧去掉判别字段后的形状一致。 */
export interface DeviceHandshake {
	readonly protocolVersion: number;
	readonly hostId: string;
	readonly hostName: string;
	readonly clientId: string;
	readonly capabilities: readonly Capability[];
}

/** 会话客户端需要的传输能力,与 transport 包的 Transport 形状一致。 */
export interface SessionTransport {
	request<M extends RequestMethod>(method: M, params?: RequestParams[M]): Promise<RequestResults[M]>;
	dispatch(channel: Channel, action: Action): number;
	onAction(listener: (frame: ActionFrame) => void): () => void;
}

export interface SessionClientOptions {
	transport: SessionTransport;
	/** 打开会话时装载的页数,缺省 2 */
	initialPages?: number;
	/** 每页条数,缺省 50 */
	pageSize?: number;
}

/** 打开一个会话后的句柄。 */
export interface OpenedSession {
	readonly sessionId: string;
	/** 会话文件路径 */
	readonly file: string | undefined;
	readonly sessionChannel: Channel;
	readonly chatChannel: Channel;
	readonly snapshot: SessionSnapshot;
}

const DEFAULT_INITIAL_PAGES = 2;
const DEFAULT_PAGE_SIZE = 50;

export class SessionClient {
	private readonly transport: SessionTransport;
	private readonly initialPages: number;
	private readonly pageSize: number;
	private readonly state = new SessionStore();
	private readonly stops: (() => void)[] = [];
	private handshake: DeviceHandshake | undefined;
	private opened: OpenedSession | undefined;
	/** 是否已经挂了缺口监听,避免重复注册 */
	private isGapWatched = false;
	/** 下一页更早历史的游标,为空表示已经到最早 */
	private olderCursor: string | undefined;

	constructor(options: SessionClientOptions) {
		this.transport = options.transport;
		this.initialPages = options.initialPages ?? DEFAULT_INITIAL_PAGES;
		this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
	}

	/** 状态持有者,界面从这里读视图并订阅变化。 */
	get store(): SessionStore {
		return this.state;
	}

	/** 当前打开的会话,未打开时为空。 */
	get current(): OpenedSession | undefined {
		return this.opened;
	}

	get device(): DeviceHandshake | undefined {
		return this.handshake;
	}

	/** 是否还有更早的历史可以加载。 */
	get hasMore(): boolean {
		return this.olderCursor !== undefined;
	}

	sessionView(): SessionView | undefined {
		return this.opened ? this.state.sessionView(this.opened.sessionChannel) : undefined;
	}

	chatView(): ChatView | undefined {
		return this.opened ? this.state.chatView(this.opened.chatChannel) : undefined;
	}

	/** 记录握手结果并开始接收动作。重连后再次调用即可换到新连接。 */
	attach(handshake: DeviceHandshake): void {
		this.handshake = handshake;
		this.stops.push(this.transport.onAction((frame) => this.state.apply(frame)));
	}

	/** 列出会话。指定 cwd 时只列该目录,设备上的全部会话用空参数。 */
	async listSessions(cwd?: string): Promise<SessionSummary[]> {
		const result = await this.transport.request("listSessions", cwd === undefined ? {} : { cwd });
		return result.sessions;
	}

	/**
	 * 打开已有会话。
	 *
	 * 先订阅再取历史:订阅返回的序号作为基线,此后的动作按序应用,历史只补进视图。
	 * 设备报告缓冲缺口时,快照与最近一页历史会重新装载。
	 */
	async openSession(sessionFile: string): Promise<OpenedSession> {
		const snapshot = await this.transport.request("openSession", { sessionFile });
		const channels = SessionStore.channelsFor(snapshot.id);
		this.state.ensureSession(channels.session, snapshot);
		this.state.ensureChat(channels.chat);
		this.olderCursor = undefined;

		const sessionSub = await this.transport.request("subscribe", { channel: channels.session });
		this.state.markSeq(channels.session, sessionSub.seq);
		if (sessionSub.session) {
			this.state.ensureSession(channels.session, sessionSub.session);
		}
		const chatSub = await this.transport.request("subscribe", { channel: channels.chat });
		this.state.markSeq(channels.chat, chatSub.seq);

		this.opened = {
			sessionId: snapshot.id,
			file: snapshot.file,
			sessionChannel: channels.session,
			chatChannel: channels.chat,
			snapshot,
		};

		if (chatSub.resync) {
			await this.reloadHistory(channels.chat, snapshot.id);
		} else {
			await this.loadPages(channels.chat, snapshot.id, this.initialPages, true);
		}

		if (!this.isGapWatched) {
			this.isGapWatched = true;
			this.stops.push(
				this.state.onGap((gap) => {
					const current = this.opened;
					if (current && gap.channel === current.chatChannel) {
						void this.reloadHistory(current.chatChannel, current.sessionId);
					}
				}),
			);
		}
		return this.opened;
	}

	/** 往更早的方向再加载一页。 */
	async loadOlder(): Promise<{ loaded: number; hasMore: boolean }> {
		const opened = this.opened;
		if (!opened || this.olderCursor === undefined) {
			return { loaded: 0, hasMore: false };
		}
		const page = await this.transport.request("entries", {
			sessionId: opened.sessionId,
			cursor: this.olderCursor,
			limit: this.pageSize,
		});
		this.state.prependHistory(opened.chatChannel, page.entries);
		this.olderCursor = page.nextCursor;
		return { loaded: page.entries.length, hasMore: this.hasMore };
	}

	/** 重取快照与最近一页历史。 */
	async refresh(): Promise<void> {
		const opened = this.requireOpened();
		const snapshot = await this.transport.request("snapshot", { sessionId: opened.sessionId });
		this.state.ensureSession(opened.sessionChannel, snapshot);
		await this.reloadHistory(opened.chatChannel, opened.sessionId);
	}

	/** 发一条消息。 */
	send(text: string): number {
		return this.transport.dispatch(this.requireOpened().chatChannel, { type: "chat/turnStarted", text });
	}

	/** 中止当前运行。 */
	cancel(): number {
		return this.transport.dispatch(this.requireOpened().chatChannel, { type: "chat/turnCancelled" });
	}

	/** 应答一条工具确认。 */
	respondTool(requestId: string, decision: ApprovalDecision): number {
		return this.transport.dispatch(this.requireOpened().chatChannel, {
			type: "chat/toolCallConfirmed",
			requestId,
			decision,
		});
	}

	/** 切换模型,结果通过 session/modelChanged 回到视图。 */
	setModel(model: ModelRef, persist = false): number {
		return this.transport.dispatch(this.requireOpened().sessionChannel, {
			type: "session/configChanged",
			model,
			persist,
		});
	}

	/** 退出当前会话:取消订阅并丢掉视图。 */
	async release(): Promise<void> {
		const opened = this.opened;
		this.opened = undefined;
		this.olderCursor = undefined;
		if (!opened) {
			return;
		}
		await this.transport.request("unsubscribe", { channel: opened.sessionChannel });
		await this.transport.request("unsubscribe", { channel: opened.chatChannel });
		this.state.drop(opened.sessionChannel);
		this.state.drop(opened.chatChannel);
	}

	/** 停掉全部监听。 */
	dispose(): void {
		for (const stop of this.stops.splice(0)) {
			stop();
		}
	}

	private requireOpened(): OpenedSession {
		if (!this.opened) {
			throw new Error("还没有打开会话");
		}
		return this.opened;
	}

	/** 连续装载若干页,首次装载时整体替换,其余往更早处补。 */
	private async loadPages(
		channel: Channel,
		sessionId: string,
		pages: number,
		replace: boolean,
	): Promise<void> {
		let cursor: string | undefined;
		for (let index = 0; index < pages; index += 1) {
			const page: { entries: Entry[]; nextCursor: string | undefined } = await this.transport.request(
				"entries",
				{
					sessionId,
					limit: this.pageSize,
					...(cursor === undefined ? {} : { cursor }),
				},
			);
			if (index === 0 && replace) {
				this.state.replaceChat(channel, page.entries);
			} else {
				this.state.prependHistory(channel, page.entries);
			}
			cursor = page.nextCursor;
			if (cursor === undefined) {
				break;
			}
		}
		this.olderCursor = cursor;
	}

	/** 重新装载最近一页。 */
	private async reloadHistory(channel: Channel, sessionId: string): Promise<void> {
		this.olderCursor = undefined;
		await this.loadPages(channel, sessionId, 1, true);
	}
}
