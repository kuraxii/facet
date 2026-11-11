import type {
	AgentSession,
	AgentSessionEvent,
	ModelRuntime,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type {
	ContextUsage,
	Entry,
	EntryKind,
	ImageBlock,
	Maintenance,
	Message,
	ModelInfo,
	ModelRef,
	PromptDisposition,
	QueueDisposition,
	QueuedInput,
	SessionEvent,
	SessionEventListener,
	SessionSnapshot,
	SessionStats,
	ThinkingLevel,
	ToolInfo,
	TurnPhase,
} from "@facet/protocol";
import { toMessage, toMessages, toModelInfo } from "./convert.ts";
import { nextTurnState, type TurnState, toSessionEvents } from "./events.ts";
import { pageOf } from "./paging.ts";
import type { ModelMutationOptions, PromptOptions } from "./types.ts";

/** 构造 PiAgent 所需的会话与共享资源。 */
export interface PiAgentContext {
	/** 已建好的 pi 会话 */
	session: AgentSession;
	/** 进程内共享的模型运行时 */
	modelRuntime: ModelRuntime;
	/** 恢复会话时模型回退的提示 */
	modelFallbackMessage?: string;
	/** 扩展加载期的错误与警告，格式为「路径: 说明」 */
	extensionIssues?: string[];
	/** 内部错误上报，主要是事件监听器抛出的错误 */
	onError?: (error: unknown) => void;
}

/** 把持久化条目转成对外条目，只保留界面需要的字段。 */
function toEntry(entry: SessionEntry): Entry {
	const base: Entry = {
		id: entry.id,
		parentId: entry.parentId,
		kind: entry.type as EntryKind,
		timestamp: entry.timestamp,
	};
	switch (entry.type) {
		case "message":
			return { ...base, message: toMessage(entry.message) };
		case "compaction":
		case "branch_summary":
			return { ...base, summary: entry.summary };
		case "session_info":
			return { ...base, name: entry.name };
		default:
			return base;
	}
}

export class PiAgent {
	/** 会话 id，与持久化文件里的会话 id 一致 */
	readonly id: string;
	/** 会话的工作目录，创建后不再变化 */
	readonly cwd: string;
	private readonly session: AgentSession;
	private readonly modelRuntime: ModelRuntime;
	private readonly modelFallbackMessage: string | undefined;
	private readonly extensionIssues: string[];
	private readonly onError: ((error: unknown) => void) | undefined;
	private readonly listeners = new Set<SessionEventListener>();
	private readonly unsubscribeSession: () => void;
	/** 本轮的生命周期,只在变化时对外发事件 */
	private phase: TurnPhase = "idle";
	/** 与本轮并行的维护动作 */
	private maintenance: Maintenance | undefined;
	private disposed = false;

	/** 构造后立即订阅，保证首次 prompt 之前的运行不会漏事件。 */
	constructor(context: PiAgentContext) {
		this.session = context.session;
		this.modelRuntime = context.modelRuntime;
		this.modelFallbackMessage = context.modelFallbackMessage;
		this.extensionIssues = context.extensionIssues ?? [];
		this.onError = context.onError;
		this.id = this.session.sessionId;
		this.cwd = this.session.sessionManager.getCwd();
		this.unsubscribeSession = this.session.subscribe((event) => {
			this.handleSessionEvent(event);
		});
	}

	/** 会话文件路径，内存会话为空 */
	get file(): string | undefined {
		return this.session.sessionFile;
	}

	/** 会话展示名，未命名或名字被清空时为空 */
	get name(): string | undefined {
		const name = this.session.sessionName;
		return typeof name === "string" && name.trim().length > 0 ? name : undefined;
	}

	/** 当前生效的系统提示词，含尚未发送给模型的部分 */
	get systemPrompt(): string {
		return this.session.systemPrompt;
	}

	/** 本轮的生命周期 */
	get currentPhase(): TurnPhase {
		return this.phase;
	}

	/** 与本轮并行的维护动作 */
	get currentMaintenance(): Maintenance | undefined {
		return this.maintenance;
	}

	/** 恢复会话时模型回退的提示，需要展示给用户 */
	get fallbackNotice(): string | undefined {
		return this.modelFallbackMessage;
	}

	/** 扩展加载期的错误与警告 */
	get issues(): readonly string[] {
		return this.extensionIssues;
	}

	get isStreaming(): boolean {
		return this.session.isStreaming;
	}

	get isCompacting(): boolean {
		return this.session.isCompacting;
	}

	/** 会话仍在推进:本轮未回到 idle,或有维护动作在跑。 */
	get isBusy(): boolean {
		return this.phase !== "idle" || this.maintenance !== undefined;
	}

	/** 订阅事件，返回取消订阅函数。多个订阅方互不影响。 */
	subscribe(listener: SessionEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * 发送用户消息。
	 *
	 * 会话正在运行时必须指定投递方式，缺省直接拒绝，避免消息去向不明。
	 * 返回值说明这次输入是被扩展消费、排队，还是开启了运行。
	 *
	 * 运行一旦开始就立即返回，不等整轮结束：回合的后续进展由事件推送，运行开始之后才出现
	 * 的失败无法再回执，改发一条 notice。这样同一会话的其它动作不会被整轮阻塞，停止请求
	 * 也能落在运行期而不必排在回合之后。
	 */
	async prompt(text: string, options: PromptOptions = {}): Promise<PromptDisposition> {
		this.assertAlive();
		if (this.session.isStreaming && !options.streamingBehavior) {
			throw new Error("prompt rejected: the session is streaming and no streamingBehavior was given");
		}
		// 运行开始之前就置成 starting:界面立刻看到忙碌,空闲回收也会等到这一段落定
		if (!this.session.isStreaming && this.phase === "idle") {
			this.applyTurnState({ phase: "starting", maintenance: this.maintenance });
		}
		let disposition: PromptDisposition | undefined;
		let acceptRun!: (value: PromptDisposition) => void;
		const started = new Promise<PromptDisposition>((resolve) => {
			acceptRun = resolve;
		});
		const run = this.session.prompt(text, {
			images: options.images,
			streamingBehavior: options.streamingBehavior,
			preflightResult: (value) => {
				disposition = value;
				acceptRun(value);
			},
		});
		// 启动之前的失败要回给调用方；启动之后的失败已经无法回执
		const failure: Promise<Error | undefined> = run.then(
			() => undefined,
			(error: unknown) => (error instanceof Error ? error : new Error(String(error))),
		);
		const first = await Promise.race([
			started.then((value) => ({ kind: "accepted" as const, value })),
			failure.then((error) => ({ kind: "failed" as const, error })),
		]);
		if (first.kind === "failed") {
			// 没能进入运行,阶段退回空闲
			this.applyTurnState({ phase: "idle", maintenance: this.maintenance });
			if (first.error === undefined) {
				return disposition ?? "started";
			}
			throw first.error;
		}
		if (first.value !== "started") {
			// 被扩展消费或排队,这一轮没有开始
			this.applyTurnState({ phase: "idle", maintenance: this.maintenance });
		}
		void failure.then((error) => {
			if (error !== undefined && first.value === "started") {
				this.emit({ type: "notice", level: "error", message: error.message });
			}
		});
		return first.value;
	}

	/** 排队一条消息，在当前助手回合的工具调用执行完后插入。 */
	async steer(text: string, images?: ImageBlock[]): Promise<QueueDisposition> {
		return await this.session.steer(text, images);
	}

	/** 排队一条消息，在本轮全部工作完成后插入。 */
	async followUp(text: string, images?: ImageBlock[]): Promise<QueueDisposition> {
		return await this.session.followUp(text, images);
	}

	/**
	 * 中止当前操作并等待会话空闲。
	 *
	 * 请求发出后先进入 stopping,等 pi 的 settled 把阶段收回 idle;没有可中止的运行时不改动阶段。
	 */
	async abort(): Promise<void> {
		const wasActive = this.phase === "running" || this.phase === "starting";
		if (wasActive) {
			this.applyTurnState({ phase: "stopping", maintenance: this.maintenance });
		}
		try {
			await this.session.abort();
		} finally {
			if (wasActive && this.phase === "stopping") {
				this.applyTurnState({ phase: "idle", maintenance: this.maintenance });
			}
		}
	}

	/** 等待会话空闲，不中止正在执行的操作。 */
	async waitForIdle(): Promise<void> {
		await this.session.waitForIdle();
	}

	/** 清空排队并返回其中内容，供界面还原到输入框。 */
	clearQueue(): QueuedInput {
		return this.session.clearQueue();
	}

	queued(): QueuedInput {
		return {
			steering: [...this.session.getSteeringMessages()],
			followUp: [...this.session.getFollowUpMessages()],
		};
	}

	/** 切换模型。pi 不发模型变更事件，这里主动补发，保证订阅方只有一个状态来源。 */
	async setModel(ref: ModelRef, options: ModelMutationOptions = {}): Promise<ModelInfo> {
		const model = this.modelRuntime.getModel(ref.provider, ref.id);
		if (!model) {
			throw new Error(`unknown model: ${ref.provider}/${ref.id}`);
		}
		await this.session.setModel(model, { persist: options.persist });
		const info = toModelInfo(model);
		this.emit({ type: "model", model: info, availableThinkingLevels: this.availableThinkingLevels() });
		return info;
	}

	/** 在可用模型间循环切换。只有一个可用模型时返回空，界面据此关闭循环入口。 */
	async cycleModel(
		direction: "forward" | "backward" = "forward",
		options: ModelMutationOptions = {},
	): Promise<ModelInfo | undefined> {
		const result = await this.session.cycleModel(direction, { persist: options.persist });
		if (!result) {
			return undefined;
		}
		const info = toModelInfo(result.model);
		this.emit({ type: "model", model: info, availableThinkingLevels: this.availableThinkingLevels() });
		return info;
	}

	/** 设置思考档位，超出模型能力时会被夹紧。档位变化由 pi 的会话事件发出。 */
	setThinkingLevel(level: ThinkingLevel, options: ModelMutationOptions = {}): void {
		this.session.setThinkingLevel(level, { persist: options.persist });
	}

	model(): ModelInfo | undefined {
		const model = this.session.model;
		return model ? toModelInfo(model) : undefined;
	}

	thinkingLevel(): ThinkingLevel {
		return this.session.thinkingLevel;
	}

	/** 当前模型支持的档位，用于禁用不可选的档 */
	availableThinkingLevels(): ThinkingLevel[] {
		return this.session.getAvailableThinkingLevels();
	}

	/** 已声明给模型的工具名 */
	activeToolNames(): string[] {
		return this.session.getActiveToolNames();
	}

	/** 全部已注册工具的清单，附带是否激活 */
	tools(): ToolInfo[] {
		const active = new Set(this.session.getActiveToolNames());
		return this.session.getAllTools().map((tool) => ({
			name: tool.name,
			description: tool.description,
			active: active.has(tool.name),
		}));
	}

	/** 设置激活的工具集合，下一次请求生效。 */
	setActiveTools(names: string[]): void {
		this.session.setActiveToolsByName(names);
	}

	/** 手动压缩上下文，可附带摘要指令。 */
	async compact(customInstructions?: string): Promise<void> {
		await this.session.compact(customInstructions);
	}

	abortCompaction(): void {
		this.session.abortCompaction();
	}

	abortRetry(): void {
		this.session.abortRetry();
	}

	setAutoCompaction(enabled: boolean): void {
		this.session.setAutoCompactionEnabled(enabled);
	}

	setAutoRetry(enabled: boolean): void {
		this.session.setAutoRetryEnabled(enabled);
	}

	/** 设置会话展示名，写入一条 session_info 条目，变化由 pi 的会话事件发出。 */
	setName(name: string): void {
		this.session.setSessionName(name);
	}

	/** 当前活跃分支的消息，已按压缩结果重建。完整历史用 entries 读取。 */
	messages(): Message[] {
		return toMessages(this.session.messages);
	}

	/**
	 * 按页读取活动分支的条目。
	 *
	 * 分页从 cursor 指向的条目往更早取，cursor 缺省表示从叶子开始；nextCursor 为空表示
	 * 已经到最早。只在窗口内做 toEntry 映射，整份历史的映射不发生在分页里。
	 * 条目 id 稳定且只追加，因此游标跨进程重启仍然有效。
	 */
	entryPage(cursor: string | undefined, limit: number): { entries: Entry[]; nextCursor: string | undefined } {
		const page = pageOf(this.session.sessionManager.getBranch(), cursor, limit);
		if (page.missing) {
			throw new Error(`unknown session entry: ${cursor}`);
		}
		return { entries: page.window.map(toEntry), nextCursor: page.nextCursor };
	}

	contextUsage(): ContextUsage | undefined {
		return this.session.getContextUsage();
	}

	/**
	 * 取 afterEntryId 之后到叶子的条目，按从早到晚排列。
	 *
	 * 从叶子沿 parentId 往回走，遇到 afterEntryId 即停，所以只走过活动分支，
	 * 条目数上限是分支深度。afterEntryId 给 null 表示整条分支。
	 * 给定了却走不到叶子上时抛错，调用方据此重新装载历史。
	 */
	entriesAfter(afterEntryId: string | null): { entries: Entry[]; leafId: string | null } {
		const manager = this.session.sessionManager;
		const leafId = manager.getLeafId();
		const collected: SessionEntry[] = [];
		let current = manager.getLeafEntry();
		while (current) {
			if (current.id === afterEntryId) {
				return { entries: collected.reverse().map(toEntry), leafId };
			}
			collected.push(current);
			current = current.parentId ? manager.getEntry(current.parentId) : undefined;
		}
		if (afterEntryId !== null) {
			throw new Error(`unknown session entry: ${afterEntryId}`);
		}
		return { entries: collected.reverse().map(toEntry), leafId };
	}

	/** 活动分支的末条目 id，空会话为空。 */
	leafEntryId(): string | null {
		return this.session.sessionManager.getLeafId();
	}

	/**
	 * 活动分支上某个条目前一条的 id，用来把「下一轮开始处」换成「上一轮结束处」。
	 * 条目不在分支上或是分支第一条时返回 null。
	 */
	entryBefore(entryId: string): string | null {
		const branch = this.session.sessionManager.getBranch();
		const index = branch.findIndex((entry) => entry.id === entryId);
		if (index <= 0) {
			return null;
		}
		return branch[index - 1]?.id ?? null;
	}

	/** 统计覆盖整个会话，含已被压缩掉的历史，因此 token 与成本反映实际计费。 */
	stats(): SessionStats {
		const stats = this.session.getSessionStats();
		return {
			sessionId: stats.sessionId,
			sessionFile: stats.sessionFile,
			userMessages: stats.userMessages,
			assistantMessages: stats.assistantMessages,
			toolCalls: stats.toolCalls,
			toolResults: stats.toolResults,
			totalMessages: stats.totalMessages,
			tokens: { ...stats.tokens },
			cost: stats.cost,
			contextUsage: stats.contextUsage ? { ...stats.contextUsage } : undefined,
		};
	}

	/** 新接入方一次拿到的完整状态，不含消息体，历史走 entries。 */
	snapshot(): SessionSnapshot {
		return {
			id: this.id,
			file: this.file,
			cwd: this.cwd,
			name: this.name,
			phase: this.phase,
			maintenance: this.maintenance,
			model: this.model(),
			thinkingLevel: this.thinkingLevel(),
			availableThinkingLevels: this.availableThinkingLevels(),
			activeToolNames: this.activeToolNames(),
			queued: this.queued(),
			contextUsage: this.contextUsage(),
			stats: this.stats(),
			modelFallbackMessage: this.modelFallbackMessage,
		};
	}

	async exportHtml(outputPath?: string): Promise<string> {
		return await this.session.exportToHtml(outputPath);
	}

	exportJsonl(outputPath?: string): string {
		return this.session.exportToJsonl(outputPath);
	}

	/** 释放会话，可重复调用。已完成的消息都已写盘，未完成的运行被中止。 */
	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.unsubscribeSession();
		this.listeners.clear();
		this.session.dispose();
	}

	private assertAlive(): void {
		if (this.disposed) {
			throw new Error(`agent ${this.id} has been disposed`);
		}
	}

	/** 设定阶段与维护动作,并对外发一次 phase 事件。 */
	private applyTurnState(next: TurnState): void {
		if (next.phase === this.phase && next.maintenance === this.maintenance) {
			return;
		}
		this.phase = next.phase;
		this.maintenance = next.maintenance;
		this.emit({ type: "phase", phase: next.phase, maintenance: next.maintenance });
	}

	/** 由 pi 事件推出阶段与维护动作。 */
	private refreshTurnState(event: AgentSessionEvent): void {
		const next = nextTurnState(event, { phase: this.phase, maintenance: this.maintenance });
		if (next) {
			this.applyTurnState(next);
		}
	}

	/** 一个 pi 事件可能转成多条对外事件，也可能只用于触发状态刷新。 */
	private handleSessionEvent(event: AgentSessionEvent): void {
		for (const mapped of toSessionEvents(event)) {
			this.emit(mapped);
		}
		this.refreshTurnState(event);
	}

	/** 逐个通知订阅方。单个订阅方抛错只上报，不影响其余订阅方收到事件。 */
	private emit(event: SessionEvent): void {
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch (error) {
				this.onError?.(error);
			}
		}
	}
}
