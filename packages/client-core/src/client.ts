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
	Capability,
	Channel,
	Entry,
	FacetSettings,
	ModelInfo,
	ModelRef,
	ProjectInfo,
	ProviderInfo,
	RequestMethod,
	RequestParams,
	RequestResults,
	SessionSnapshot,
	SessionSummary,
	ThinkingLevel,
} from "@facet/protocol";
import { makeChannel, parseChannel } from "@facet/protocol";
import { debugLog } from "./log.ts";
import type { ChatView, SessionView } from "./state.ts";
import type { ChannelGap } from "./store.ts";
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
	/** 连接状态变化。给出时,重新连上会自动续订并重新对齐。 */
	onStateChange?(listener: (state: string) => void): () => void;
}

export interface SessionClientOptions {
	transport: SessionTransport;
	/** 打开会话时装载的页数,缺省取完所有历史 */
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

const DEFAULT_PAGE_SIZE = 50;

/**
 * 设备是不是不认识这个会话。
 *
 * 传输层把设备的错误码带在 error.code 上;这里按码判断,不依赖具体传输实现。
 */
function isUnknownSession(error: unknown): boolean {
	return (
		typeof error === "object" && error !== null && (error as { code?: unknown }).code === "unknown_session"
	);
}

export class SessionClient {
	private readonly transport: SessionTransport;
	private readonly initialPages: number;
	private readonly pageSize: number;
	private readonly state = new SessionStore();
	private readonly stops: (() => void)[] = [];
	/** 动作订阅,重连时替换 */
	private stopActions: (() => void) | undefined;
	/** 连接状态订阅,只挂一次 */
	private stopState: (() => void) | undefined;
	/** 缺口补齐进行中的通道,避免叠加请求 */
	private readonly resyncing = { session: false, chat: false };
	private handshake: DeviceHandshake | undefined;
	private opened: OpenedSession | undefined;
	/** 等待设备确认的输入:turn 等消息入对话,steering 等队列里出现这段文字 */
	private pendingSend: { clientSeq: number; text: string; kind: "turn" | "steering" } | undefined;
	private readonly sentListeners = new Set<(text: string) => void>();
	/** 是否已经挂了缺口监听,避免重复注册 */
	private isGapWatched = false;
	/** 下一页更早历史的游标,为空表示已经到最早 */
	private olderCursor: string | undefined;
	/** 已提交到视图的末条目 id,提升实时消息时作为边界传给设备 */
	private lastEntryId: string | undefined;
	/** 串行执行提升,避免连续 settled 时请求交错 */
	private commitChain: Promise<void> = Promise.resolve();
	/** 会话级操作排队执行,快速切换时按到达顺序收尾 */
	private lifecycle: Promise<unknown> = Promise.resolve();

	constructor(options: SessionClientOptions) {
		this.transport = options.transport;
		this.initialPages = options.initialPages ?? Number.POSITIVE_INFINITY;
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

	/**
	 * 记录握手结果并开始接收动作。重连之后再次调用即可换到新连接:
	 * 上一条动作订阅会被替换,断线重连时自动续订并重新对齐。
	 */
	attach(handshake: DeviceHandshake): void {
		this.handshake = handshake;
		this.stopActions?.();
		this.stopActions = this.transport.onAction((frame) => {
			if (frame.rejectionReason !== undefined) {
				this.handleRejection(frame, frame.rejectionReason);
				return;
			}
			this.state.apply(frame);
			this.observe(frame);
			this.confirmSend(frame);
		});
		this.stopState ??= this.transport.onStateChange?.((state) => {
			if (state === "ready") {
				// 续订失败交给宿主处理:会话文件不在盘上时界面要回到没有会话的状态
				void this.resume().catch((error: unknown) => {
					debugLog("client", "自动续订失败", { error: String(error) });
				});
			}
		});
	}

	/** 列出会话。指定 cwd 时只列该目录,设备上的全部会话用空参数。 */
	async listSessions(cwd?: string): Promise<SessionSummary[]> {
		const result = await this.transport.request("listSessions", cwd === undefined ? {} : { cwd });
		return result.sessions;
	}

	/** 列出用户添加的项目。 */
	async listProjects(): Promise<ProjectInfo[]> {
		const result = await this.transport.request("listProjects", {});
		return result.projects;
	}

	/** 添加项目，目录重复时设备侧拒绝。 */
	async addProject(input: { cwd: string; name?: string }): Promise<ProjectInfo> {
		return await this.transport.request("addProject", input);
	}

	/** 重命名项目，名称为空时恢复目录名。 */
	async renameProject(id: string, name?: string): Promise<ProjectInfo> {
		return await this.transport.request("renameProject", name === undefined ? { id } : { id, name });
	}

	/** 移除项目。 */
	async removeProject(id: string): Promise<void> {
		await this.transport.request("removeProject", { id });
	}

	/** 查目录的项目级资源需不需要信任，以及此前的决定。 */
	async projectTrust(cwd: string): Promise<{ hasProjectResources: boolean; trusted: boolean | undefined }> {
		return await this.transport.request("projectTrust", { cwd });
	}

	/** 记下目录的信任决定。 */
	async setProjectTrust(cwd: string, trusted: boolean): Promise<void> {
		await this.transport.request("setProjectTrust", { cwd, trusted });
	}

	/** 提供方清单，含是否已配置凭证与模型数量。 */
	async listProviders(): Promise<ProviderInfo[]> {
		const result = await this.transport.request("providers", {});
		return result.providers;
	}

	/** 保存提供方凭证，返回更新后的提供方清单。密钥只上行，不回传。 */
	async saveCredential(providerId: string, apiKey: string): Promise<ProviderInfo[]> {
		const result = await this.transport.request("saveCredential", { providerId, apiKey });
		return result.providers;
	}

	/** 删除提供方凭证，返回更新后的提供方清单。 */
	async deleteCredential(providerId: string): Promise<ProviderInfo[]> {
		const result = await this.transport.request("deleteCredential", { providerId });
		return result.providers;
	}

	/** 模型清单，指定提供方时只列该提供方的模型。 */
	async listModels(providerId?: string): Promise<ModelInfo[]> {
		const result = await this.transport.request("models", providerId === undefined ? {} : { providerId });
		return result.models;
	}

	/** 用指定模型发一次最小请求，返回是否成功、耗时与失败原因。 */
	async testModel(ref: ModelRef): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
		return await this.transport.request("testModel", { provider: ref.provider, id: ref.id });
	}

	/** 取一份诊断文本，由宿主决定写到哪个文件。 */
	async diagnostics(): Promise<string> {
		const result = await this.transport.request("diagnostics", {});
		return result.text;
	}

	/** 读设备上保存的界面偏好设置。 */
	async getSettings(): Promise<FacetSettings> {
		const result = await this.transport.request("getSettings", {});
		return result.settings;
	}

	/** 整份保存界面偏好设置，返回设备实际存下的那份。 */
	async saveSettings(settings: FacetSettings): Promise<FacetSettings> {
		const result = await this.transport.request("updateSettings", { settings });
		return result.settings;
	}

	/** 在设备的文件管理器里打开项目目录。 */
	async revealProject(id: string): Promise<void> {
		await this.transport.request("revealProject", { id });
	}

	/**
	 * 会话改名。
	 *
	 * 排在会话级队列里执行，改名与切换不会互相插队；已打开的会话由设备改运行态，没打开的
	 * 会话离线追加一条会话信息条目。
	 */
	async renameSession(sessionFile: string, name: string | undefined): Promise<void> {
		await this.exclusive(
			async () =>
				await this.transport.request(
					"renameSession",
					name === undefined ? { sessionFile } : { sessionFile, name },
				),
		);
	}

	/**
	 * 删除会话。
	 *
	 * 删的是当前打开的会话时，连接上的订阅与本地投影一并清掉，界面回到没有会话的状态。
	 */
	async deleteSession(sessionFile: string): Promise<void> {
		await this.exclusive(async () => {
			await this.transport.request("deleteSession", { sessionFile });
			const opened = this.opened;
			if (opened !== undefined && opened.file === sessionFile) {
				await this.release();
			}
		});
	}

	/**
	 * 会话级操作排队执行。
	 *
	 * 快速切换时后一次进入要等前一次收尾,最后一次选择的打开结果就是留在界面上的那份;
	 * 上一次失败也不影响下一次进入。
	 */
	private async exclusive<T>(work: () => Promise<T>): Promise<T> {
		const run = this.lifecycle.then(work, work);
		this.lifecycle = run.then(
			() => undefined,
			() => undefined,
		);
		return await run;
	}

	/**
	 * 切到另一个会话。
	 *
	 * 先打开新的,成功之后才放掉旧的:打开失败时原来的会话仍然可用,界面不会变成空白。
	 * 两步在同一次排队里完成,中途不会有另一个切换插进来。
	 */
	async switchSession(sessionFile: string): Promise<OpenedSession> {
		return await this.exclusive(async () => {
			const previous = this.opened;
			const opened = await this.openUnlocked(sessionFile);
			if (previous !== undefined && previous.sessionChannel !== opened.sessionChannel) {
				await this.releaseChannels(previous);
			}
			return opened;
		});
	}

	/**
	 * 打开已有会话。
	 *
	 * 先订阅再取历史:订阅返回的序号作为基线,此后的动作按序应用,历史只补进视图。
	 * 设备报告缓冲缺口时,快照与最近一页历史会重新装载。
	 */
	async openSession(sessionFile: string): Promise<OpenedSession> {
		return await this.exclusive(() => this.openUnlocked(sessionFile));
	}

	/**
	 * 新建会话并进入。
	 *
	 * 参数缺省时由设备取默认工作目录与模型;返回与打开会话相同的句柄。
	 */
	async createSession(params: RequestParams["createSession"] = {}): Promise<OpenedSession> {
		return await this.exclusive(async () => {
			const snapshot = await this.transport.request("createSession", params);
			return await this.beginSession(snapshot);
		});
	}

	private async openUnlocked(sessionFile: string): Promise<OpenedSession> {
		const snapshot = await this.transport.request("openSession", { sessionFile });
		return await this.beginSession(snapshot);
	}

	/**
	 * 订阅两条通道并从基线开始装载历史。打开与新建共用。
	 *
	 * 中途任何一步失败都把已建立的订阅退掉、视图丢掉,不留半个打开状态,调用方可以直接重试。
	 */
	private async beginSession(snapshot: SessionSnapshot): Promise<OpenedSession> {
		// 记下已经订上的通道,失败时逐个退掉,不留半个打开状态
		const subscribed: Channel[] = [];
		const previous = this.opened;
		try {
			return await this.beginSubscribed(snapshot, subscribed);
		} catch (error) {
			await this.abandonSession(snapshot.id, subscribed);
			// 失败不牵连已经打开的会话
			this.opened = previous;
			this.olderCursor = undefined;
			this.lastEntryId = undefined;
			this.pendingSend = undefined;
			throw error;
		}
	}

	/** 退掉已建立的订阅并丢掉这个会话的视图。 */
	private async abandonSession(sessionId: string, subscribed: readonly Channel[]): Promise<void> {
		const channels = SessionStore.channelsFor(sessionId);
		for (const channel of subscribed) {
			try {
				await this.transport.request("unsubscribe", { channel });
			} catch {
				// 退订失败不阻塞清理:连接已经断了,设备侧会按无订阅者回收
			}
		}
		this.state.drop(channels.session);
		this.state.drop(channels.chat);
	}

	private async beginSubscribed(snapshot: SessionSnapshot, subscribed: Channel[]): Promise<OpenedSession> {
		const channels = SessionStore.channelsFor(snapshot.id);
		this.state.ensureSession(channels.session, snapshot);
		this.state.ensureChat(channels.chat);
		this.olderCursor = undefined;
		this.lastEntryId = undefined;

		const sessionSub = await this.transport.request("subscribe", { channel: channels.session });
		subscribed.push(channels.session);
		this.state.markSeq(channels.session, sessionSub.seq);
		if (sessionSub.session) {
			this.state.ensureSession(channels.session, sessionSub.session);
		}
		const chatSub = await this.transport.request("subscribe", { channel: channels.chat });
		subscribed.push(channels.chat);
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
			this.stops.push(this.state.onGap((gap) => this.handleGap(gap)));
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

	/** 重取会话状态与最近一页历史。 */
	async refresh(): Promise<void> {
		await this.refreshSession();
		const opened = this.requireOpened();
		await this.reloadHistory(opened.chatChannel, opened.sessionId);
	}

	/** 只重取会话状态,不动已装载的历史。状态通道漏帧后用它对齐。 */
	async refreshSession(): Promise<void> {
		const opened = this.requireOpened();
		const snapshot = await this.transport.request("snapshot", { sessionId: opened.sessionId });
		this.state.ensureSession(opened.sessionChannel, snapshot);
	}

	/**
	 * 断线重连之后续订。
	 *
	 * 新连接是新的一端,设备那边没有任何订阅记录。按已收到的最后序号续订,
	 * 缓冲能补齐就只补发,补不上就整体重新对齐。
	 */
	async resume(): Promise<void> {
		const opened = this.opened;
		if (!opened) {
			return;
		}
		try {
			await this.resumeChannels(opened);
		} catch (error) {
			// 设备重启过时它已经不记得这个会话,按文件重新打开一次即可接着用
			if (opened.file !== undefined && isUnknownSession(error)) {
				await this.switchSession(opened.file);
				return;
			}
			throw error;
		}
	}

	/** 按最后收到的序号续订两个通道,缓冲补不上时整体重新对齐。 */
	private async resumeChannels(opened: OpenedSession): Promise<void> {
		const sessionSub = await this.transport.request("subscribe", {
			channel: opened.sessionChannel,
			since: this.state.lastSeq(opened.sessionChannel),
		});
		this.state.markSeq(opened.sessionChannel, sessionSub.seq);
		const chatSub = await this.transport.request("subscribe", {
			channel: opened.chatChannel,
			since: this.state.lastSeq(opened.chatChannel),
		});
		this.state.markSeq(opened.chatChannel, chatSub.seq);
		if (sessionSub.resync || chatSub.resync) {
			await this.refresh();
			return;
		}
		if (sessionSub.session) {
			this.state.ensureSession(opened.sessionChannel, sessionSub.session);
		}
	}

	/**
	 * 发一条消息。
	 *
	 * 界面在设备把这条用户消息放进对话之后才算发出:那之前草稿留在输入框,被拒时用户可以
	 * 直接改或重发。
	 */
	send(text: string): number {
		const clientSeq = this.transport.dispatch(this.requireOpened().chatChannel, {
			type: "chat/turnStarted",
			text,
		});
		this.pendingSend = { clientSeq, text, kind: "turn" };
		return clientSeq;
	}

	/**
	 * 排队一条消息。
	 *
	 * 走 pi 的 steering:这一轮还在跑时插进去,当前助手回合的工具调用执行完后、下一次请求
	 * 模型之前生效,不用等整轮结束。设备把这条文字记进队列后回 session/queueChanged。
	 */
	enqueue(text: string): number {
		const clientSeq = this.transport.dispatch(this.requireOpened().sessionChannel, {
			type: "session/pendingMessageSet",
			kind: "steering",
			text,
		});
		this.pendingSend = { clientSeq, text, kind: "steering" };
		return clientSeq;
	}

	/** 清空排队,界面把内容还原到输入框。 */
	clearQueue(): number {
		return this.transport.dispatch(this.requireOpened().sessionChannel, { type: "session/queueCleared" });
	}

	/** 设备确认收到这条消息后回调,带上当时的文本。 */
	onSent(listener: (text: string) => void): () => void {
		this.sentListeners.add(listener);
		return () => {
			this.sentListeners.delete(listener);
		};
	}

	/** 设备确认消息已进入对话或已进队列,通知界面收起草稿。 */
	private confirmSend(frame: ActionFrame): void {
		const opened = this.opened;
		const pending = this.pendingSend;
		if (opened === undefined || pending === undefined) {
			return;
		}
		const accepted =
			pending.kind === "turn"
				? frame.channel === opened.chatChannel &&
					frame.action.type === "chat/messageAppended" &&
					frame.action.message.role === "user"
				: frame.channel === opened.sessionChannel &&
					frame.action.type === "session/queueChanged" &&
					[...frame.action.steering, ...frame.action.followUp].includes(pending.text);
		if (!accepted) {
			return;
		}
		this.pendingSend = undefined;
		for (const listener of [...this.sentListeners]) {
			listener(pending.text);
		}
	}

	/**
	 * 处理设备拒绝的动作。
	 *
	 * 拒绝帧不进序号流,也不参与归约:这里把原因转成对话视图上的一条错误提示,并让对应的
	 * 发送不再等确认,草稿留在输入框。
	 */
	private handleRejection(frame: ActionFrame, reason: string): void {
		const clientSeq = frame.origin?.clientSeq;
		if (clientSeq !== undefined && this.pendingSend?.clientSeq === clientSeq) {
			this.pendingSend = undefined;
		}
		const label =
			frame.action.type === "chat/turnStarted" || frame.action.type === "session/pendingMessageSet"
				? "发送失败"
				: "操作被拒绝";
		// 提示统一挂在同一会话的对话通道上,会话通道的动作被拒也在这里显示
		const parsed = parseChannel(frame.channel);
		const target = parsed === undefined ? undefined : makeChannel("chat", parsed.id);
		if (target !== undefined) {
			this.state.addNotice(target, { level: "error", message: `${label}:${reason}` });
		}
	}

	/**
	 * 分叉出新会话,并切过去。
	 *
	 * beforeEntryId 是下一轮开始处的条目:分叉点取它之前的那一条,这样这一轮结束后追加的
	 * usage、session_info、compaction 也一并带到新会话。缺省表示复制整条活动分支。
	 * 分叉会在设备侧建出一个新会话文件,原会话保持不动；新会话紧接着被打开订阅,否则它会
	 * 因为没有持有者而在空闲回收的宽限期后关闭。
	 *
	 * 会话正在运行时设备会拒绝分叉:这一轮还没写盘,分叉点对不上。
	 */
	async fork(beforeEntryId?: string): Promise<OpenedSession> {
		const opened = this.requireOpened();
		if (opened.file === undefined) {
			throw new Error("当前会话没有文件,无法分叉");
		}
		const forked = await this.transport.request("forkSession", {
			sessionFile: opened.file,
			...(beforeEntryId === undefined ? {} : { beforeEntryId }),
		});
		if (forked.file === undefined) {
			throw new Error("分叉出的会话没有文件");
		}
		return await this.switchSession(forked.file);
	}

	/**
	 * 中止当前运行。
	 *
	 * 设备受理后把阶段置为 stopping 并广播 session/phase,界面据此显示停止中。
	 */
	cancel(): number {
		return this.transport.dispatch(this.requireOpened().chatChannel, { type: "chat/turnCancelled" });
	}

	/** 切换模型,结果通过 session/modelChanged 回到视图。 */
	setModel(model: ModelRef, persist = false): number {
		return this.transport.dispatch(this.requireOpened().sessionChannel, {
			type: "session/configChanged",
			model,
			persist,
		});
	}

	/** 切换思考档位,结果通过 session/thinkingLevelChanged 回到视图。 */
	setThinkingLevel(level: ThinkingLevel, persist = false): number {
		return this.transport.dispatch(this.requireOpened().sessionChannel, {
			type: "session/configChanged",
			thinkingLevel: level,
			persist,
		});
	}

	/** 退出当前会话:取消订阅并丢掉视图。 */
	async release(): Promise<void> {
		await this.exclusive(() => this.releaseUnlocked());
	}

	/** 退掉这两个通道的订阅并丢掉它们的视图。 */
	private async releaseChannels(opened: OpenedSession): Promise<void> {
		for (const channel of [opened.sessionChannel, opened.chatChannel]) {
			try {
				await this.transport.request("unsubscribe", { channel });
			} catch {
				// 连接已经断开时退订会失败,视图照样丢掉
			}
		}
		this.state.drop(opened.sessionChannel);
		this.state.drop(opened.chatChannel);
	}

	private async releaseUnlocked(): Promise<void> {
		const opened = this.opened;
		this.opened = undefined;
		this.olderCursor = undefined;
		this.lastEntryId = undefined;
		this.pendingSend = undefined;
		if (!opened) {
			return;
		}
		await this.releaseChannels(opened);
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

	/**
	 * 序号缺口。对话通道补最近一页历史,状态通道重取快照;
	 * 同一通道正在补齐时不再叠加请求。
	 */
	private handleGap(gap: ChannelGap): void {
		const opened = this.opened;
		if (!opened) {
			return;
		}
		if (gap.channel === opened.sessionChannel) {
			if (this.resyncing.session) {
				return;
			}
			this.resyncing.session = true;
			void this.refreshSession().finally(() => {
				this.resyncing.session = false;
			});
			return;
		}
		if (gap.channel === opened.chatChannel) {
			if (this.resyncing.chat) {
				return;
			}
			this.resyncing.chat = true;
			void this.reloadHistory(opened.chatChannel, opened.sessionId).finally(() => {
				this.resyncing.chat = false;
			});
		}
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
				const newest = page.entries[page.entries.length - 1];
				this.lastEntryId = newest?.id;
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

	/**
	 * 观察已应用的动作。
	 *
	 * 本轮 settle 之后向设备要一次「边界之后的条目」，把实时消息提升为历史消息：
	 * 之后界面上的消息都带条目 id，分叉、定位这类操作不再区分历史与实时。
	 */
	private observe(frame: ActionFrame): void {
		const opened = this.opened;
		if (!opened || frame.channel !== opened.chatChannel) {
			return;
		}
		if (frame.action.type !== "chat/settled") {
			return;
		}
		debugLog("commit", "本轮结束，准备提升实时消息", { sessionId: opened.sessionId });
		this.commitChain = this.commitChain.then(() => this.runCommit()).catch(() => undefined);
	}

	/**
	 * 拉取边界之后的条目并提升视图。
	 *
	 * 边界是上一次提交到的末条目；设备从叶子沿 parentId 回溯到它为止。条目数量与实时
	 * 消息对不上（漏了事件）或设备拒绝时，整体重新装载历史。
	 */
	private async runCommit(): Promise<void> {
		const opened = this.opened;
		if (!opened) {
			return;
		}
		try {
			debugLog("commit", "请求边界之后的条目", {
				sessionId: opened.sessionId,
				afterEntryId: this.lastEntryId,
			});
			const result = await this.transport.request("entriesAfter", {
				sessionId: opened.sessionId,
				...(this.lastEntryId === undefined ? {} : { afterEntryId: this.lastEntryId }),
			});
			if (this.opened !== opened) {
				return;
			}
			const promoted = this.state.promote(opened.chatChannel, result.entries);
			if (result.leafId !== null) {
				this.lastEntryId = result.leafId;
			}
			debugLog("commit", promoted ? "提升成功" : "提升被拒：条目数与实时消息不符", {
				count: result.entries.length,
				leafId: result.leafId,
				boundary: this.lastEntryId,
				messageIds: this.state
					.chatView(opened.chatChannel)
					?.items.map((item) => `${item.id}${item.entry === undefined ? "" : `→${item.entry.id}`}`),
			});
			if (!promoted) {
				debugLog("commit", "条目数与实时消息不符，重新装载历史");
				await this.reloadHistory(opened.chatChannel, opened.sessionId);
			}
		} catch (error) {
			debugLog("commit", "提升失败，重新装载历史", { error: String(error) });
			if (this.opened === opened) {
				await this.reloadHistory(opened.chatChannel, opened.sessionId);
			}
		}
	}

	/** 重新装载全部历史。 */
	private async reloadHistory(channel: Channel, sessionId: string): Promise<void> {
		this.olderCursor = undefined;
		await this.loadPages(channel, sessionId, Number.POSITIVE_INFINITY, true);
	}
}
