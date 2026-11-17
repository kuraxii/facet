/**
 * 会话客户端。
 *
 * 把传输、订阅与状态拼成界面能直接用的一个对象:打开会话时取快照、订阅两条通道、
 * 装载最近若干页历史;之后主机推来的动作直接进 store。翻页与重新同步的游标都在这里,
 * 界面不必知道协议细节。
 *
 * 传输按结构约定,不引入 transport 包,两者处于同一层。
 */
import type {
	Action,
	ActionFrame,
	Capability,
	Channel,
	ClientRole,
	CustomProviderInfo,
	CustomProviderInput,
	Entry,
	FacetSettings,
	FileContent,
	FileEntry,
	FileWriteResult,
	GitCommitDetail,
	GitCommits,
	GitDiff,
	GitStatus,
	ImageBlock,
	ModelInfo,
	ModelRef,
	ProjectInfo,
	ProviderInfo,
	RequestMethod,
	RequestParams,
	RequestResults,
	SessionListItem,
	SessionSnapshot,
	SessionSummary,
	SlashCommand,
	ThinkingLevel,
	UiResponse,
} from "@facet/protocol";
import { makeChannel, parseChannel, sessionsChannelFor } from "@facet/protocol";
import { debugLog, errorLog } from "./log.ts";
import { isHistoryMessageId } from "./message-id.ts";
import type { ChatView, SessionView } from "./state.ts";
import type { ChannelGap } from "./store.ts";
import { SessionStore } from "./store.ts";

/** 日志里条目 id 列表的折行宽度，够宽到一行放得下十来个短 id。 */
const COMMIT_LOG_WIDTH = 120;

/**
 * 把一次提交的结果排版成多行日志。
 *
 * 条目数量随会话增长，默认的 JSON 输出会变成一长串读不出结构的字符串，所以这里先给一行摘要，
 * 再把「实时消息 id → 条目 id」按行宽折开：条目多时也能一眼扫到前几个、确认提升从哪开始。
 */
export function formatCommitLog(
	title: string,
	promotedCount: number,
	leafId: string | null | undefined,
	boundary: string | null | undefined,
	items: readonly ChatView["items"][number][],
): string {
	const ids = items.map((item) => `${item.id}${item.entry === undefined ? "" : `→${item.entry.id}`}`);
	const lines: string[] = [];
	let line = "";
	for (const id of ids) {
		if (line.length > 0 && line.length + id.length + 1 > COMMIT_LOG_WIDTH) {
			lines.push(`  ${line}`);
			line = id;
			continue;
		}
		line = line.length === 0 ? id : `${line} ${id}`;
	}
	if (line.length > 0) {
		lines.push(`  ${line}`);
	}
	const raised = items.filter((item) => item.entry !== undefined).length;
	const head = [
		title,
		`turn ${promotedCount} items`,
		`leaf ${leafId ?? "none"}`,
		`boundary ${boundary ?? "none"}`,
		`view ${items.length} items, ${raised} promoted`,
	].join(" · ");
	return lines.length === 0 ? head : `${head}\n${lines.join("\n")}`;
}

/** 发一条消息时的选项。 */
export interface SendOptions {
	/** 随消息一起发出去的图片，按用户选择的顺序 */
	images?: readonly ImageBlock[];
	/** 会话正在运行时用什么方式投递：插入当前回合，或排到本轮之后 */
	streamingBehavior?: "steer" | "followUp";
}

/** 握手结果,与 hello 帧去掉判别字段后的形状一致。 */
export interface HostHandshake {
	readonly protocolVersion: number;
	readonly hostId: string;
	readonly hostName: string;
	readonly clientId: string;
	/** 这条连接能做什么：本机管理档、远程操作档或远程只读档 */
	readonly role: ClientRole;
	/** 这条连接能不能改设置、凭证与项目清单 */
	readonly canManage: boolean;
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
	/** 打开会话时装载的页数,缺省 2 */
	initialPages?: number;
	/** 每页条数,缺省 50 */
	pageSize?: number;
	/** 关闭标签后保留会话的时间，缺省 3 分钟 */
	sessionRetentionMs?: number;
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
const DEFAULT_INITIAL_PAGES = 2;
const DEFAULT_SESSION_RETENTION_MS = 3 * 60 * 1000;

/** 一条等待主机确认的发送。 */
interface PendingSend {
	/** 端点派发时分配的序号，确认与拒绝都按它核销 */
	clientSeq: number;
	/** 发出去的文本，界面收起草稿时按它回调 */
	text: string;
	/** 走的是起一轮还是排队 */
	kind: "turn" | "steering";
}

/** 一条已建立订阅的会话，切换标签时保留这些状态。 */
interface SessionRuntime {
	readonly opened: OpenedSession;
	/** 下一页更早历史的游标，为空表示已经到最早 */
	olderCursor: string | undefined;
	/** 已提交到视图的末条目 id，提升实时消息时作为边界传给主机 */
	lastEntryId: string | undefined;
	/** 串行执行提升，避免连续 settled 时请求交错 */
	commitChain: Promise<void>;
	/** 串行执行历史重载，避免同一会话并发请求 */
	reloadChain: Promise<void>;
	/** 历史视图的代次，重载或释放后旧响应不再写入 */
	historyEpoch: number;
	/** 正在进行的向前翻页请求 */
	olderTask: Promise<{ loaded: number; hasMore: boolean }> | undefined;
	/** 缺口补齐进行中的通道 */
	resyncing: { session: boolean; chat: boolean };
	/**
	 * 等待主机确认的输入，按 clientSeq 索引。
	 *
	 * 同一会话可以连着发多条，各自等各自的确认；用单槽会在第二条发出时把第一条挤掉，
	 * 那条消息的确认回来时找不到记录，草稿就永远收不起来。
	 */
	pendingSend: Map<number, PendingSend>;
	/** 命令清单缓存，每个会话只取一次；扩展重新初始化或会话释放时丢弃 */
	commands: SlashCommand[] | undefined;
	/** 关闭标签后的保留定时器 */
	retainTimer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * 主机是不是不认识这个会话。
 *
 * 传输层把主机的错误码带在 error.code 上;这里按码判断,不依赖具体传输实现。
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
	private readonly sessionRetentionMs: number;
	private readonly state = new SessionStore();
	/** 正在进行的续订，重复触发时共用同一次 */
	private resuming: Promise<void> | undefined;
	private readonly stops: (() => void)[] = [];
	/** 动作订阅,重连时替换 */
	private stopActions: (() => void) | undefined;
	/** 连接状态订阅,只挂一次 */
	private stopState: (() => void) | undefined;
	private handshake: HostHandshake | undefined;
	/** 已订阅的会话，按会话 id 保留视图与分页状态 */
	private readonly runtimes = new Map<string, SessionRuntime>();
	/** 当前激活的会话 id */
	private activeId: string | undefined;
	private readonly sentListeners = new Set<(text: string) => void>();
	/** 是否已经挂了缺口监听,避免重复注册 */
	private isGapWatched = false;
	/** 项目信任查询缓存，切换标签时不重复请求 */
	private readonly trustCache = new Map<
		string,
		{ hasProjectResources: boolean; trusted: boolean | undefined }
	>();
	/** 会话级操作排队执行,快速切换时按到达顺序收尾 */
	private lifecycle: Promise<unknown> = Promise.resolve();

	constructor(options: SessionClientOptions) {
		this.transport = options.transport;
		const pages = options.initialPages ?? DEFAULT_INITIAL_PAGES;
		this.initialPages = Number.isFinite(pages) ? Math.max(1, Math.trunc(pages)) : DEFAULT_INITIAL_PAGES;
		this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
		this.sessionRetentionMs = options.sessionRetentionMs ?? DEFAULT_SESSION_RETENTION_MS;
	}

	/** 为一次新订阅建立运行时状态。 */
	private createRuntime(opened: OpenedSession): SessionRuntime {
		return {
			opened,
			olderCursor: undefined,
			lastEntryId: undefined,
			commitChain: Promise.resolve(),
			reloadChain: Promise.resolve(),
			historyEpoch: 0,
			olderTask: undefined,
			resyncing: { session: false, chat: false },
			pendingSend: new Map(),
			commands: undefined,
			retainTimer: undefined,
		};
	}

	/** 激活一个已经建立订阅的会话。 */
	private activate(runtime: SessionRuntime): void {
		if (runtime.retainTimer !== undefined) {
			clearTimeout(runtime.retainTimer);
			runtime.retainTimer = undefined;
		}
		this.activeId = runtime.opened.sessionId;
	}

	/** 按会话文件找已缓存的运行时。 */
	private runtimeForFile(file: string): SessionRuntime | undefined {
		for (const runtime of this.runtimes.values()) {
			if (runtime.opened.file === file) return runtime;
		}
		return undefined;
	}

	/** 按通道找所属会话。 */
	private runtimeForChannel(channel: Channel): SessionRuntime | undefined {
		const parsed = parseChannel(channel);
		return parsed === undefined ? undefined : this.runtimes.get(parsed.id);
	}

	/** 从登记表移除运行时，不负责退订。 */
	private removeRuntime(runtime: SessionRuntime): void {
		if (runtime.retainTimer !== undefined) {
			clearTimeout(runtime.retainTimer);
			runtime.retainTimer = undefined;
		}
		this.runtimes.delete(runtime.opened.sessionId);
		runtime.pendingSend.clear();
		if (this.active === runtime) {
			this.activeId = undefined;
		}
	}

	/** 当前激活的会话。 */
	private get active(): SessionRuntime | undefined {
		return this.activeId === undefined ? undefined : this.runtimes.get(this.activeId);
	}

	private get opened(): OpenedSession | undefined {
		return this.active?.opened;
	}

	private get olderCursor(): string | undefined {
		return this.active?.olderCursor;
	}

	/** 状态持有者,界面从这里读视图并订阅变化。 */
	get store(): SessionStore {
		return this.state;
	}

	/** 当前打开的会话,未打开时为空。 */
	get current(): OpenedSession | undefined {
		return this.opened;
	}

	/** 指定文件是否已经有缓存会话。 */
	hasSession(file: string): boolean {
		return this.runtimeForFile(file) !== undefined;
	}

	/** 直接激活已缓存的会话；用于标签切换，避免再走一次打开队列。 */
	activateSession(file: string): OpenedSession | undefined {
		const runtime = this.runtimeForFile(file);
		if (runtime === undefined) return undefined;
		this.activate(runtime);
		return runtime.opened;
	}

	/** 标记标签已关闭；会话保留一段时间，期间重新打开仍然命中缓存。 */
	closeSession(file: string): void {
		const runtime = this.runtimeForFile(file);
		if (runtime === undefined) return;
		if (runtime.retainTimer !== undefined) clearTimeout(runtime.retainTimer);
		runtime.retainTimer = setTimeout(() => {
			runtime.retainTimer = undefined;
			runtime.pendingSend.clear();
			if (this.active === runtime) {
				this.closeSession(file);
				return;
			}
			void this.exclusive(() => this.releaseRuntime(runtime)).catch(() => undefined);
		}, this.sessionRetentionMs);
		const timer: unknown = runtime.retainTimer;
		if (typeof timer === "object" && timer !== null && "unref" in timer) {
			(timer as { unref: () => void }).unref();
		}
	}

	get host(): HostHandshake | undefined {
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
	attach(handshake: HostHandshake): void {
		this.handshake = handshake;
		this.trustCache.clear();
		this.stopActions?.();
		this.stopActions = this.transport.onAction((frame) => {
			if (frame.rejectionReason !== undefined) {
				this.handleRejection(frame, frame.rejectionReason);
				return;
			}
			const isNewFrame = frame.serverSeq > this.state.lastSeq(frame.channel);
			const runtime = this.runtimeForChannel(frame.channel);
			const wasCompacting =
				runtime === undefined
					? false
					: this.state.sessionView(runtime.opened.sessionChannel)?.state.maintenance?.kind === "compaction";
			this.state.apply(frame);
			if (isNewFrame && runtime !== undefined) {
				this.observe(frame, wasCompacting, runtime);
			}
			this.confirmSend(frame);
		});
		this.stopState ??= this.transport.onStateChange?.((state) => {
			if (state === "ready") {
				// 续订失败交给宿主处理:会话文件不在盘上时界面要回到没有会话的状态
				void this.resume().catch((error: unknown) => {
					debugLog("client", "Failed to renew automatically", { error: String(error) });
				});
			}
		});
		void this.followSessionList().catch((error: unknown) => {
			debugLog("client", "Failed to subscribe to the session list", { error: String(error) });
		});
	}

	/**
	 * 订阅会话清单。
	 *
	 * 主机把新增、改名、删除与一轮结束的变化推给所有订阅的端，多个端因此看到同一份列表；
	 * 补不上缺口时重新取一份完整清单。
	 */
	async followSessionList(): Promise<void> {
		const hostId = this.handshake?.hostId;
		if (hostId === undefined) {
			return;
		}
		const channel = sessionsChannelFor(hostId);
		const result = await this.transport.request("subscribe", {
			channel,
			since: this.state.sessionListSeq,
		});
		this.state.markSessionListSeq(result.seq);
		if (result.resync || this.state.sessionList().length === 0) {
			await this.refreshSessionList();
		}
	}

	/**
	 * 重取一份完整清单替换本地这份，重连与补齐缺口之后用。
	 *
	 * 替换用的是主机回的摘要与状态，不保留本地那份：断线期间本地可能停在运行中，
	 * 只按本地补状态会让它一直卡在那里。
	 */
	async refreshSessionList(cwd?: string): Promise<readonly SessionSummary[]> {
		const items = await this.listSessions(cwd);
		this.state.replaceSessionList(items);
		return items.map((item) => item.summary);
	}

	/** 列出会话。指定 cwd 时只列该目录,主机上的全部会话用空参数。 */
	async listSessions(cwd?: string): Promise<readonly SessionListItem[]> {
		const result = await this.transport.request("listSessions", cwd === undefined ? {} : { cwd });
		return result.sessions;
	}

	/** 列出用户添加的项目。 */
	async listProjects(): Promise<ProjectInfo[]> {
		const result = await this.transport.request("listProjects", {});
		return result.projects;
	}

	/** 添加项目，目录重复时主机侧拒绝。 */
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
		const cached = this.trustCache.get(cwd);
		if (cached !== undefined) return cached;
		const result = await this.transport.request("projectTrust", { cwd });
		this.trustCache.set(cwd, result);
		return result;
	}

	/** 记下目录的信任决定。 */
	async setProjectTrust(cwd: string, trusted: boolean): Promise<void> {
		await this.transport.request("setProjectTrust", { cwd, trusted });
		const cached = this.trustCache.get(cwd);
		if (cached !== undefined) this.trustCache.set(cwd, { ...cached, trusted });
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

	/**
	 * 列出当前可用的模型。
	 *
	 * 只包含已配置凭证的提供方，模型清单也按凭证收窄过（例如按密钥可用的子集），
	 * 模型选择器用它，设置里那份完整清单仍然走 listModels。
	 */
	async listAvailableModels(): Promise<ModelInfo[]> {
		const result = await this.transport.request("availableModels", {});
		return result.models;
	}

	/** 列出项目里的一个目录，path 为空串表示项目根。 */
	async listDirectory(cwd: string, path = ""): Promise<FileEntry[]> {
		const result = await this.transport.request("listDirectory", { cwd, path });
		return result.entries;
	}

	/** 读一个文件；文本按 UTF-8 解码，二进制与超大文件只给类型与大小。 */
	async readFile(cwd: string, path: string): Promise<FileContent> {
		return await this.transport.request("readFile", { cwd, path });
	}

	/**
	 * 写回一个文本文件。
	 *
	 * 带上读或上次写拿到的 revision；磁盘上的内容已经变过时主机回 `file_conflict`。
	 */
	async writeFile(
		cwd: string,
		path: string,
		content: string,
		expectedRevision: string,
	): Promise<FileWriteResult> {
		return await this.transport.request("writeFile", { cwd, path, content, expectedRevision });
	}

	/**
	 * 列出项目工作树相对 HEAD 的改动。
	 *
	 * 口径是 git：已暂存与未暂存合在一份，未跟踪文件单独标出来；不是 git 仓库时
	 * 返回 isRepo 为假。
	 */
	async gitStatus(cwd: string): Promise<GitStatus> {
		return await this.transport.request("gitStatus", { cwd });
	}

	/** 列出当前分支的全部提交，从新到旧。 */
	async gitCommits(cwd: string): Promise<GitCommits> {
		return await this.transport.request("gitCommits", { cwd });
	}

	/** 取一次提交相对第一父提交的改动清单。 */
	async gitCommit(cwd: string, sha: string): Promise<GitCommitDetail> {
		return await this.transport.request("gitCommit", { cwd, sha });
	}

	/** 取一次提交里某个文件的补丁；重命名文件同时带上旧路径。 */
	async gitCommitDiff(cwd: string, sha: string, path: string, oldPath?: string): Promise<GitDiff> {
		return await this.transport.request(
			"gitCommitDiff",
			oldPath === undefined ? { cwd, sha, path } : { cwd, sha, path, oldPath },
		);
	}

	/** 取单个文件的补丁；未跟踪文件由主机按「从空文件新增」合成。 */
	async gitDiff(cwd: string, path: string, untracked = false): Promise<GitDiff> {
		return await this.transport.request(
			"gitDiff",
			untracked ? { cwd, path, untracked: true } : { cwd, path },
		);
	}

	/** 列出用户自己添加的提供方。 */
	async listCustomProviders(): Promise<CustomProviderInfo[]> {
		const result = await this.transport.request("listCustomProviders", {});
		return result.providers;
	}

	/** 新增或修改一个自定义提供方，返回更新后的清单。 */
	async saveCustomProvider(provider: CustomProviderInput): Promise<CustomProviderInfo[]> {
		const result = await this.transport.request("saveCustomProvider", { provider });
		return result.providers;
	}

	/** 删除一个自定义提供方，返回更新后的清单。 */
	async removeCustomProvider(providerId: string): Promise<CustomProviderInfo[]> {
		const result = await this.transport.request("removeCustomProvider", { providerId });
		return result.providers;
	}

	/** 设置提供方的接口地址，空串恢复默认，返回更新后的提供方清单。 */
	async setProviderBaseUrl(providerId: string, baseUrl: string): Promise<ProviderInfo[]> {
		const result = await this.transport.request("setProviderBaseUrl", { providerId, baseUrl });
		return result.providers;
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

	/** 读主机上保存的界面偏好设置。 */
	async getSettings(): Promise<FacetSettings> {
		const result = await this.transport.request("getSettings", {});
		return result.settings;
	}

	/** 整份保存界面偏好设置，返回主机实际存下的那份。 */
	async saveSettings(settings: FacetSettings): Promise<FacetSettings> {
		const result = await this.transport.request("updateSettings", { settings });
		return result.settings;
	}

	/** 在主机的文件管理器里打开项目目录。 */
	async revealProject(id: string): Promise<void> {
		await this.transport.request("revealProject", { id });
	}

	/**
	 * 会话改名。
	 *
	 * 排在会话级队列里执行，改名与切换不会互相插队；已打开的会话由主机改运行态，没打开的
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
	 * 把这些会话标记为已读。
	 *
	 * 水位记在主机上，多端看到同一份未读结果；批量发是因为切换会话时可能一次带上好几条。
	 */
	async markSessionsSeen(sessionFiles: readonly string[]): Promise<void> {
		if (sessionFiles.length === 0) {
			return;
		}
		await this.exclusive(
			async () => await this.transport.request("markSessionsSeen", { sessionFiles: [...sessionFiles] }),
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
			const runtime = this.runtimeForFile(sessionFile);
			if (runtime !== undefined) {
				// 已经在会话队列里，直接释放；再调 release() 会排到当前任务后面形成死锁
				await this.releaseRuntime(runtime);
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
	 * 已经在缓存的会话直接激活，不再重新打开；新会话建立订阅后替换当前视图，
	 * 旧会话保留在缓存里供标签来回切换。
	 */
	async switchSession(sessionFile: string): Promise<OpenedSession> {
		return await this.exclusive(async () => {
			const cached = this.runtimeForFile(sessionFile);
			if (cached !== undefined) {
				this.activate(cached);
				return cached.opened;
			}
			return await this.openUnlocked(sessionFile);
		});
	}

	/**
	 * 打开已有会话。
	 *
	 * 先订阅再取历史:订阅返回的序号作为基线,此后的动作按序应用,历史只补进视图。
	 * 主机报告缓冲缺口时,快照与最近一页历史会重新装载。
	 */
	async openSession(sessionFile: string): Promise<OpenedSession> {
		return await this.switchSession(sessionFile);
	}

	/**
	 * 新建会话并进入。
	 *
	 * 参数缺省时由主机取默认工作目录与模型;返回与打开会话相同的句柄。
	 */
	async createSession(params: RequestParams["createSession"] = {}): Promise<OpenedSession> {
		return await this.exclusive(async () => {
			const snapshot = await this.transport.request("createSession", params);
			return await this.beginSession(snapshot);
		});
	}

	private async openUnlocked(sessionFile: string): Promise<OpenedSession> {
		const cached = this.runtimeForFile(sessionFile);
		if (cached !== undefined) {
			this.activate(cached);
			return cached.opened;
		}
		const snapshot = await this.transport.request("openSession", { sessionFile });
		const existing = this.runtimes.get(snapshot.id);
		if (existing !== undefined) {
			this.activate(existing);
			return existing.opened;
		}
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
		const previous = this.active;
		try {
			return await this.beginSubscribed(snapshot, subscribed);
		} catch (error) {
			await this.abandonSession(snapshot.id, subscribed);
			const failed = this.runtimes.get(snapshot.id);
			if (failed !== undefined) this.removeRuntime(failed);
			// 失败不牵连已经打开的会话
			if (previous !== undefined) this.activate(previous);
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
				// 退订失败不阻塞清理:连接已经断了,主机侧会按无订阅者回收
			}
		}
		this.state.drop(channels.session);
		this.state.drop(channels.chat);
	}

	private async beginSubscribed(snapshot: SessionSnapshot, subscribed: Channel[]): Promise<OpenedSession> {
		const channels = SessionStore.channelsFor(snapshot.id);
		this.state.ensureSession(channels.session, snapshot);
		this.state.ensureChat(channels.chat);

		const sessionSub = await this.transport.request("subscribe", { channel: channels.session });
		subscribed.push(channels.session);
		this.state.markSeq(channels.session, sessionSub.seq);
		if (sessionSub.session) {
			this.state.ensureSession(channels.session, sessionSub.session);
		}
		const chatSub = await this.transport.request("subscribe", { channel: channels.chat });
		subscribed.push(channels.chat);
		this.state.markSeq(channels.chat, chatSub.seq);

		const opened: OpenedSession = {
			sessionId: snapshot.id,
			file: snapshot.file,
			sessionChannel: channels.session,
			chatChannel: channels.chat,
			snapshot,
		};
		const runtime = this.createRuntime(opened);
		this.runtimes.set(snapshot.id, runtime);
		this.activate(runtime);

		if (chatSub.resync) {
			await this.reloadRecent(runtime);
		} else {
			const page = await this.fetchPages(snapshot.id, this.initialPages);
			this.applyHistory(runtime, page);
		}

		if (!this.isGapWatched) {
			this.isGapWatched = true;
			this.stops.push(this.state.onGap((gap) => this.handleGap(gap)));
		}
		return opened;
	}

	/** 往更早的方向再加载一页。 */
	async loadOlder(): Promise<{ loaded: number; hasMore: boolean }> {
		const runtime = this.active;
		if (runtime === undefined) {
			return { loaded: 0, hasMore: false };
		}
		if (runtime.olderTask !== undefined) {
			return await runtime.olderTask;
		}
		const cursor = runtime.olderCursor;
		if (cursor === undefined) {
			return { loaded: 0, hasMore: false };
		}
		const epoch = runtime.historyEpoch;
		const task = this.loadOlderPage(runtime, cursor, epoch);
		runtime.olderTask = task;
		try {
			return await task;
		} finally {
			if (runtime.olderTask === task) {
				runtime.olderTask = undefined;
			}
		}
	}

	private async loadOlderPage(
		runtime: SessionRuntime,
		cursor: string,
		epoch: number,
	): Promise<{ loaded: number; hasMore: boolean }> {
		const opened = runtime.opened;
		const page = await this.transport.request("entries", {
			sessionId: opened.sessionId,
			cursor,
			limit: this.pageSize,
		});
		if (
			this.runtimes.get(opened.sessionId) !== runtime ||
			runtime.historyEpoch !== epoch ||
			runtime.olderCursor !== cursor
		) {
			return { loaded: 0, hasMore: runtime.olderCursor !== undefined };
		}
		this.state.prependHistory(opened.chatChannel, page.entries);
		runtime.olderCursor = page.nextCursor;
		return { loaded: page.entries.length, hasMore: runtime.olderCursor !== undefined };
	}

	/** 重取会话状态与最近的历史。 */
	async refresh(): Promise<void> {
		const runtime = this.requireRuntime();
		await this.refreshRuntime(runtime);
		await this.reloadRecent(runtime);
	}

	/** 只重取会话状态,不动已装载的历史。状态通道漏帧后用它对齐。 */
	async refreshSession(): Promise<void> {
		await this.refreshRuntime(this.requireRuntime());
	}

	private async refreshRuntime(runtime: SessionRuntime): Promise<void> {
		const snapshot = await this.transport.request("snapshot", { sessionId: runtime.opened.sessionId });
		if (this.runtimes.get(runtime.opened.sessionId) === runtime) {
			this.state.ensureSession(runtime.opened.sessionChannel, snapshot);
		}
	}

	/**
	 * 断线重连之后续订，迟到的重复调用共用同一次。
	 *
	 * 新连接是新的一端,主机那边没有任何订阅记录。按已收到的最后序号续订,
	 * 缓冲能补齐就只补发,补不上就整体重新对齐。
	 */
	async resume(): Promise<void> {
		// 连接就绪会同时惊动连接链路与传输状态监听，两边都来续订一次；重复的请求没有意义
		this.resuming ??= this.resumeOnce().finally(() => {
			this.resuming = undefined;
		});
		return this.resuming;
	}

	/** 续订的实际流程，同一时刻只跑一份。 */
	private async resumeOnce(): Promise<void> {
		// 清单通道与打开的会话无关，重连后总要续订一次
		await this.followSessionList().catch((error: unknown) => {
			debugLog("client", "Failed to subscribe to the session list after reconnect", { error: String(error) });
		});
		const runtime = this.active;
		if (runtime === undefined) {
			return;
		}
		// 新连接的主机给了新的 clientId，旧连接的确认回执不会再回来：悬挂的发送就此作废，
		// 否则草稿永远收不起来，界面一直停在「发送中」
		runtime.pendingSend.clear();
		// 新连接没有旧订阅，非当前会话的缓存无法继续接收动作；切回时重新打开
		for (const inactive of [...this.runtimes.values()]) {
			if (inactive !== runtime) await this.releaseRuntime(inactive);
		}
		try {
			await this.resumeChannels(runtime);
		} catch (error) {
			// 主机重启过时它已经不记得这个会话,按文件重新打开一次即可接着用
			if (runtime.opened.file !== undefined && isUnknownSession(error)) {
				const file = runtime.opened.file;
				await this.releaseRuntime(runtime);
				await this.switchSession(file);
				return;
			}
			throw error;
		}
	}

	/** 按最后收到的序号续订两个通道,缓冲补不上时整体重新对齐。 */
	private async resumeChannels(runtime: SessionRuntime): Promise<void> {
		const opened = runtime.opened;
		const wasCompacting =
			this.state.sessionView(opened.sessionChannel)?.state.maintenance?.kind === "compaction";
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
			await this.refreshRuntime(runtime);
			await this.reloadRecent(runtime);
			return;
		}
		if (sessionSub.session) {
			this.state.ensureSession(opened.sessionChannel, sessionSub.session);
			if (wasCompacting && sessionSub.session.maintenance?.kind !== "compaction") {
				runtime.commitChain = runtime.commitChain
					.then(() => this.runCommit(runtime, "checkpoint"))
					.catch(() => undefined);
				await runtime.commitChain;
			}
		}
	}

	/**
	 * 发一条消息。
	 *
	 * 界面在主机把这条用户消息放进对话之后才算发出:那之前草稿留在输入框,被拒时用户可以
	 * 直接改或重发。图片随消息一起发，主机侧会把它交给会话。
	 */
	send(text: string, options: SendOptions = {}): number {
		const runtime = this.requireRuntime();
		const clientSeq = this.transport.dispatch(runtime.opened.chatChannel, {
			type: "chat/turnStarted",
			text,
			...(options.images === undefined || options.images.length === 0 ? {} : { images: [...options.images] }),
			...(options.streamingBehavior === undefined ? {} : { streamingBehavior: options.streamingBehavior }),
		});
		runtime.pendingSend.set(clientSeq, { clientSeq, text, kind: "turn" });
		return clientSeq;
	}

	/**
	 * 排队一条消息。
	 *
	 * 走 pi 的 steering:这一轮还在跑时插进去,当前助手回合的工具调用执行完后、下一次请求
	 * 模型之前生效,不用等整轮结束。主机把这条文字记进队列后回 session/queueChanged。
	 */
	enqueue(text: string): number {
		const runtime = this.requireRuntime();
		const clientSeq = this.transport.dispatch(runtime.opened.sessionChannel, {
			type: "session/pendingMessageSet",
			kind: "steering",
			text,
		});
		runtime.pendingSend.set(clientSeq, { clientSeq, text, kind: "steering" });
		return clientSeq;
	}

	/** 清空排队,界面把内容还原到输入框。 */
	clearQueue(): number {
		return this.transport.dispatch(this.requireOpened().sessionChannel, { type: "session/queueCleared" });
	}

	/** 主机确认收到这条消息后回调,带上当时的文本。 */
	onSent(listener: (text: string) => void): () => void {
		this.sentListeners.add(listener);
		return () => {
			this.sentListeners.delete(listener);
		};
	}

	/**
	 * 主机确认消息已进入对话或已进队列,通知界面收起草稿。
	 *
	 * 认哪一条由帧自己说了算：带 `origin.clientSeq` 的回执精确核销那一条，其余的同会话
	 * 待确认记录一条不动；没有序号的确认（用户消息落库、排队内容变化）按先发先销，
	 * 只销同类里最早的一条。
	 */
	private confirmSend(frame: ActionFrame): void {
		const runtime = this.runtimeForChannel(frame.channel);
		if (runtime === undefined || runtime.pendingSend.size === 0) {
			return;
		}
		const opened = runtime.opened;
		const origin = frame.origin;
		if (frame.action.type === "chat/inputHandled") {
			if (origin === undefined || origin.clientId !== this.handshake?.clientId) {
				return;
			}
			const pending = runtime.pendingSend.get(origin.clientSeq);
			if (pending === undefined) {
				return;
			}
			runtime.pendingSend.delete(pending.clientSeq);
			this.notifySent(pending.text);
			return;
		}
		const fallbackSeq =
			frame.channel === opened.chatChannel && frame.action.type === "chat/messageAppended"
				? frame.action.message.role === "user"
					? this.oldestPending(runtime, "turn")
					: undefined
				: frame.channel === opened.sessionChannel && frame.action.type === "session/queueChanged"
					? this.oldestPending(runtime, "steering", [...frame.action.steering, ...frame.action.followUp])
					: undefined;
		if (fallbackSeq === undefined) {
			return;
		}
		const pending = runtime.pendingSend.get(fallbackSeq);
		runtime.pendingSend.delete(fallbackSeq);
		if (pending !== undefined) {
			this.notifySent(pending.text);
		}
	}

	/** 同类待确认记录里最早的一条；给了 texts 时还要求文本在其中。 */
	private oldestPending(
		runtime: SessionRuntime,
		kind: PendingSend["kind"],
		texts?: readonly string[],
	): number | undefined {
		for (const pending of runtime.pendingSend.values()) {
			if (pending.kind !== kind) {
				continue;
			}
			if (texts !== undefined && !texts.includes(pending.text)) {
				continue;
			}
			return pending.clientSeq;
		}
		return undefined;
	}

	/** 通知界面收起草稿。 */
	private notifySent(text: string): void {
		for (const listener of [...this.sentListeners]) {
			listener(text);
		}
	}

	/**
	 * 处理主机拒绝的动作。
	 *
	 * 拒绝帧不进序号流,也不参与归约:这里把原因转成对话视图上的一条错误提示,并让对应的
	 * 发送不再等确认,草稿留在输入框。
	 */
	private handleRejection(frame: ActionFrame, reason: string): void {
		const clientSeq = frame.origin?.clientSeq;
		const runtime = this.runtimeForChannel(frame.channel);
		if (clientSeq !== undefined && runtime !== undefined) {
			runtime.pendingSend.delete(clientSeq);
		}
		const label =
			frame.action.type === "chat/turnStarted" || frame.action.type === "session/pendingMessageSet"
				? "Send failed"
				: "Action rejected";
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
	 * 分叉会在主机侧建出一个新会话文件,原会话保持不动；新会话紧接着被打开订阅,否则它会
	 * 因为没有持有者而在空闲回收的宽限期后关闭。
	 *
	 * 会话正在运行时主机会拒绝分叉:这一轮还没写盘,分叉点对不上。
	 */
	async fork(beforeEntryId?: string): Promise<OpenedSession> {
		const opened = this.requireOpened();
		if (opened.file === undefined) {
			throw new Error("The current session has no file and cannot be forked");
		}
		const forked = await this.transport.request("forkSession", {
			sessionFile: opened.file,
			...(beforeEntryId === undefined ? {} : { beforeEntryId }),
		});
		if (forked.file === undefined) {
			throw new Error("The forked session has no file");
		}
		return await this.switchSession(forked.file);
	}

	/**
	 * 中止当前运行。
	 *
	 * 主机受理后把阶段置为 stopping 并广播 session/phase,界面据此显示停止中。
	 */
	cancel(): number {
		return this.transport.dispatch(this.requireOpened().chatChannel, { type: "chat/turnCancelled" });
	}

	/** 应答绑定发起时的会话；过期应答重取快照，使弹窗及时关闭。 */
	async respondUi(
		requestId: string,
		response: UiResponse,
		sessionId = this.requireOpened().sessionId,
	): Promise<boolean> {
		const opened = this.requireOpened();
		if (opened.sessionId !== sessionId) return false;
		const { accepted } = await this.transport.request("respondUi", { sessionId, requestId, response });
		if (!accepted && this.opened === opened) await this.refreshSession();
		return accepted;
	}

	/**
	 * 会话里能用的命令：界面自带的几条，加上扩展命令、提示词模板与技能。
	 *
	 * 每个会话只请求一次，切换标签不再重取；扩展重新初始化或会话释放后缓存作废。
	 */
	async listCommands(): Promise<SlashCommand[]> {
		const runtime = this.requireRuntime();
		if (runtime.commands !== undefined) {
			return runtime.commands;
		}
		const result = await this.transport.request("listCommands", { sessionId: runtime.opened.snapshot.id });
		if (this.runtimes.get(runtime.opened.sessionId) === runtime) {
			runtime.commands = result.commands;
		}
		return result.commands;
	}

	/**
	 * 手动压缩上下文。
	 *
	 * 结果通过会话通道回来的 session/usageChanged 与对话通道的压缩条目反映；这一轮还没结束
	 * 时主机会拒绝并给出原因。
	 */
	compact(): number {
		return this.transport.dispatch(this.requireOpened().sessionChannel, { type: "session/compact" });
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

	/**
	 * 回退到某条用户消息之前。
	 *
	 * 主机只挪分支指针,会话文件不动;历史在收到 chat/branchMoved 之后重新装载,调用方不必
	 * 处理返回值。
	 */
	revert(entryId: string): number {
		return this.transport.dispatch(this.requireOpened().chatChannel, {
			type: "chat/revertTo",
			entryId,
		});
	}

	/** 退出全部会话:取消订阅并丢掉视图。 */
	async release(): Promise<void> {
		await this.exclusive(() => this.releaseAllUnlocked());
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

	/** 释放一个会话运行时，先从登记表拿掉，避免重入。 */
	private async releaseRuntime(runtime: SessionRuntime): Promise<void> {
		this.removeRuntime(runtime);
		await this.releaseChannels(runtime.opened);
	}

	private async releaseAllUnlocked(): Promise<void> {
		for (const runtime of [...this.runtimes.values()]) {
			await this.releaseRuntime(runtime);
		}
	}

	/** 停掉全部监听。 */
	dispose(): void {
		for (const runtime of this.runtimes.values()) {
			if (runtime.retainTimer !== undefined) clearTimeout(runtime.retainTimer);
		}
		for (const stop of this.stops.splice(0)) {
			stop();
		}
	}

	private requireOpened(): OpenedSession {
		if (!this.opened) {
			throw new Error("No session is open");
		}
		return this.opened;
	}

	private requireRuntime(): SessionRuntime {
		const runtime = this.active;
		if (runtime === undefined) {
			throw new Error("No session is open");
		}
		return runtime;
	}

	/**
	 * 序号缺口。对话通道补最近一页历史,状态通道重取快照;
	 * 同一通道正在补齐时不再叠加请求。
	 */
	private handleGap(gap: ChannelGap): void {
		const runtime = this.runtimeForChannel(gap.channel);
		if (runtime === undefined) {
			return;
		}
		// 缺口里可能就有这条发送的确认回执，重新对齐之前先作废，免得永远等下去
		runtime.pendingSend.clear();
		const opened = runtime.opened;
		if (gap.channel === opened.sessionChannel) {
			if (runtime.resyncing.session) {
				return;
			}
			runtime.resyncing.session = true;
			void this.refreshRuntime(runtime)
				.catch(() => undefined)
				.finally(() => {
					runtime.resyncing.session = false;
				});
			return;
		}
		if (gap.channel === opened.chatChannel) {
			if (runtime.resyncing.chat) {
				return;
			}
			runtime.resyncing.chat = true;
			void this.reloadRecent(runtime)
				.catch(() => undefined)
				.finally(() => {
					runtime.resyncing.chat = false;
				});
		}
	}

	/** 从最新一页开始往前读取若干页，返回按时间升序排列的条目。 */
	private async fetchPages(
		sessionId: string,
		pages: number,
	): Promise<{ entries: Entry[]; nextCursor: string | undefined }> {
		let cursor: string | undefined;
		let entries: Entry[] = [];
		for (let index = 0; index < pages; index += 1) {
			const page: { entries: Entry[]; nextCursor: string | undefined } = await this.transport.request(
				"entries",
				{
					sessionId,
					limit: this.pageSize,
					...(cursor === undefined ? {} : { cursor }),
				},
			);
			entries = [...page.entries, ...entries];
			cursor = page.nextCursor;
			if (cursor === undefined) {
				break;
			}
		}
		return { entries, nextCursor: cursor };
	}

	/** 把读到的一整段历史替换进视图，并更新翻页游标。 */
	private applyHistory(
		runtime: SessionRuntime,
		page: { entries: readonly Entry[]; nextCursor: string | undefined },
	): void {
		this.state.replaceChat(runtime.opened.chatChannel, page.entries);
		runtime.olderCursor = page.nextCursor;
		runtime.lastEntryId = page.entries[page.entries.length - 1]?.id;
	}

	/**
	 * 观察已应用的动作。
	 *
	 * 本轮 settle 之后向主机要一次「边界之后的条目」，把实时消息提升为历史消息：
	 * 之后界面上的消息都带条目 id，分叉、定位这类操作不再区分历史与实时。
	 */
	private observe(frame: ActionFrame, wasCompacting: boolean, runtime: SessionRuntime): void {
		const opened = runtime.opened;
		// 扩展重新初始化会改变可用命令，下次取命令列表时重新请求
		if (frame.channel === opened.sessionChannel && frame.action.type === "session/initialized") {
			runtime.commands = undefined;
			return;
		}
		if (frame.channel === opened.sessionChannel && frame.action.type === "session/phase") {
			if (wasCompacting && frame.action.maintenance?.kind !== "compaction") {
				runtime.commitChain = runtime.commitChain
					.then(() => this.runCommit(runtime, "checkpoint"))
					.catch(() => undefined);
			}
			return;
		}
		if (frame.channel !== opened.chatChannel) {
			return;
		}
		// 分支指针挪过之后，活动分支换成另一条，已装载的历史整段作废
		if (frame.action.type === "chat/branchMoved") {
			runtime.commitChain = runtime.commitChain
				.then(async () => {
					if (this.runtimes.get(opened.sessionId) === runtime) {
						await this.reloadRecent(runtime, true);
					}
				})
				.catch(() => undefined);
			return;
		}
		if (frame.action.type !== "chat/settled") {
			return;
		}
		if (frame.action.aborted) {
			// 中止时实时消息常与已写入条目对不上，直接取最近页，避免提升失败后重载全部
			debugLog("commit", "Turn aborted; reloading the recent window", { sessionId: opened.sessionId });
			runtime.commitChain = runtime.commitChain
				.then(async () => {
					if (this.runtimes.get(opened.sessionId) === runtime) {
						await this.reloadRecent(runtime);
					}
				})
				.catch(() => undefined);
			return;
		}
		debugLog("commit", "Turn ended; preparing to promote live messages", { sessionId: opened.sessionId });
		runtime.commitChain = runtime.commitChain.then(() => this.runCommit(runtime)).catch(() => undefined);
	}

	/**
	 * 拉取边界之后的条目并提升视图。
	 *
	 * 边界是上一次提交到的末条目；主机从叶子沿 parentId 回溯到它为止。条目数量与实时
	 * 消息对不上（漏了事件）或主机拒绝时，整体重新装载历史。
	 */
	private async runCommit(
		runtime: SessionRuntime,
		mode: "settled" | "checkpoint" = "settled",
	): Promise<void> {
		const opened = runtime.opened;
		if (this.runtimes.get(opened.sessionId) !== runtime) {
			return;
		}
		try {
			debugLog("commit", "Requesting entries after the boundary", {
				sessionId: opened.sessionId,
				afterEntryId: runtime.lastEntryId,
			});
			const result = await this.transport.request("entriesAfter", {
				sessionId: opened.sessionId,
				...(runtime.lastEntryId === undefined ? {} : { afterEntryId: runtime.lastEntryId }),
			});
			if (this.runtimes.get(opened.sessionId) !== runtime) {
				return;
			}
			const checkpoint =
				mode === "checkpoint" ? result.entries.findLastIndex((entry) => entry.kind === "compaction") : -1;
			if (mode === "checkpoint" && checkpoint < 0) {
				return;
			}
			const entries = mode === "checkpoint" ? result.entries.slice(0, checkpoint + 1) : result.entries;
			const promoted = this.state.promote(opened.chatChannel, entries, mode);
			if (!promoted && mode === "checkpoint") {
				return;
			}
			const leafId = mode === "checkpoint" ? entries.at(-1)?.id : result.leafId;
			if (leafId != null) {
				runtime.lastEntryId = leafId;
			}
			debugLog(
				"commit",
				formatCommitLog(
					promoted ? "Promotion succeeded" : "Promotion rejected: entry count does not match live messages",
					entries.length,
					leafId,
					runtime.lastEntryId,
					this.state.chatView(opened.chatChannel)?.items ?? [],
				),
			);
			if (!promoted) {
				const view = this.state.chatView(opened.chatChannel);
				errorLog("commit", "Promotion rejected: entry count does not match live messages", {
					sessionId: opened.sessionId,
					afterEntryId: runtime.lastEntryId,
					entryCount: entries.length,
					messageEntries: entries.filter((entry) => entry.kind === "message" && entry.message !== undefined)
						.length,
					liveItems: view?.items.filter((item) => !isHistoryMessageId(item.id)).length ?? 0,
					leafId,
				});
				debugLog("commit", "Entry count does not match live messages; reloading the recent window");
				await this.reloadRecent(runtime);
			}
		} catch (error) {
			errorLog(
				"commit",
				mode === "settled"
					? "Entries after the boundary failed; reloading the recent window"
					: "Checkpoint sync failed",
				{
					sessionId: opened.sessionId,
					afterEntryId: runtime.lastEntryId,
					error: String(error),
				},
			);
			if (this.runtimes.get(opened.sessionId) === runtime && mode === "settled") {
				await this.reloadRecent(runtime);
			}
		}
	}

	/**
	 * 重新装载最近若干页历史。
	 *
	 * 自动恢复只覆盖最近一屏，更早的内容仍由 loadOlder 向前翻。先读到临时页集合，成功后再
	 * 替换视图，失败时旧视图与旧游标都不动。queued 重载按代次丢弃过期结果。
	 */
	private reloadRecent(runtime: SessionRuntime, reset = false): Promise<void> {
		const epoch = ++runtime.historyEpoch;
		const run = runtime.reloadChain.then(async () => {
			if (this.runtimes.get(runtime.opened.sessionId) !== runtime || runtime.historyEpoch !== epoch) {
				return;
			}
			const page = await this.fetchPages(runtime.opened.sessionId, this.initialPages);
			if (this.runtimes.get(runtime.opened.sessionId) !== runtime || runtime.historyEpoch !== epoch) {
				return;
			}
			if (reset) {
				this.state.resetChat(runtime.opened.chatChannel);
			}
			this.applyHistory(runtime, page);
		});
		runtime.reloadChain = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}
}
