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
	SessionStatus,
	ThinkingLevel,
	ToolInfo,
} from "@facet/protocol";
import { toMessage, toMessages, toModelInfo } from "./convert.ts";
import { toSessionEvents } from "./events.ts";
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
	/** 已派生的状态，只在变化时对外发事件 */
	private status: SessionStatus = "idle";
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
		this.status = this.computeStatus();
		this.unsubscribeSession = this.session.subscribe((event) => {
			this.handleSessionEvent(event);
		});
	}

	/** 会话文件路径，内存会话为空 */
	get file(): string | undefined {
		return this.session.sessionFile;
	}

	/** 会话展示名，未命名为空 */
	get name(): string | undefined {
		return this.session.sessionName;
	}

	/** 当前生效的系统提示词，含尚未发送给模型的部分 */
	get systemPrompt(): string {
		return this.session.systemPrompt;
	}

	get currentStatus(): SessionStatus {
		return this.status;
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

	/** 会话仍在推进:运行中、压缩中,或工具在等审批。 */
	get isBusy(): boolean {
		return this.status !== "idle";
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
	 */
	async prompt(text: string, options: PromptOptions = {}): Promise<PromptDisposition> {
		this.assertAlive();
		if (this.session.isStreaming && !options.streamingBehavior) {
			throw new Error("prompt rejected: the session is streaming and no streamingBehavior was given");
		}
		let disposition: PromptDisposition | undefined;
		await this.session.prompt(text, {
			images: options.images,
			streamingBehavior: options.streamingBehavior,
			preflightResult: (value) => {
				disposition = value;
			},
		});
		return disposition ?? "started";
	}

	/** 排队一条消息，在当前助手回合的工具调用执行完后插入。 */
	async steer(text: string, images?: ImageBlock[]): Promise<QueueDisposition> {
		return await this.session.steer(text, images);
	}

	/** 排队一条消息，在本轮全部工作完成后插入。 */
	async followUp(text: string, images?: ImageBlock[]): Promise<QueueDisposition> {
		return await this.session.followUp(text, images);
	}

	/** 中止当前操作并等待会话空闲。 */
	async abort(): Promise<void> {
		await this.session.abort();
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
		this.emit({ type: "model", model: info });
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
		this.emit({ type: "model", model: info });
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
	 * 读取持久化条目。
	 *
	 * 条目 id 稳定且只追加，传入上次见过的 id 即可增量拉取，跨进程重启仍然有效。
	 * leafId 指出活跃分支的末端，用于判断分支是否移动。
	 */
	entries(since?: string): { entries: Entry[]; leafId: string | null } {
		const all = this.session.sessionManager.getEntries();
		const leafId = this.session.sessionManager.getLeafId();
		if (since === undefined) {
			return { entries: all.map(toEntry), leafId };
		}
		const index = all.findIndex((entry) => entry.id === since);
		if (index < 0) {
			throw new Error(`unknown session entry: ${since}`);
		}
		return { entries: all.slice(index + 1).map(toEntry), leafId };
	}

	contextUsage(): ContextUsage | undefined {
		return this.session.getContextUsage();
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
			status: this.status,
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

	/**
	 * 派生当前状态。
	 *
	 * 审批优先于压缩与运行：等待审批时运行仍在进行，若先判运行会看不到审批态。
	 */
	private computeStatus(): SessionStatus {
		if (this.session.isCompacting) {
			return "compacting";
		}
		if (this.session.isStreaming) {
			return "running";
		}
		return "idle";
	}

	/** 状态未变时不发事件，避免高频运行期刷出大量重复状态。 */
	private refreshStatus(): void {
		const next = this.computeStatus();
		if (next === this.status) {
			return;
		}
		this.status = next;
		this.emit({ type: "status", status: next });
	}

	/** 一个 pi 事件可能转成多条对外事件，也可能只用于触发状态刷新。 */
	private handleSessionEvent(event: AgentSessionEvent): void {
		for (const mapped of toSessionEvents(event)) {
			this.emit(mapped);
		}
		this.refreshStatus();
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
