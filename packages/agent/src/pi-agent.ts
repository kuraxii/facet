import { randomUUID } from "node:crypto";
import type {
	AgentSession,
	AgentSessionEvent,
	ExtensionFactory,
	ModelRuntime,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { toAgentMessage, toAgentMessages, toAgentModelInfo } from "./convert.ts";
import { toAgentEvents } from "./events.ts";
import type {
	AgentApprovalDecision,
	AgentApprovalHandler,
	AgentApprovalRequest,
	AgentContextUsage,
	AgentEntry,
	AgentEntryKind,
	AgentEvent,
	AgentEventListener,
	AgentImageBlock,
	AgentMessage,
	AgentModelInfo,
	AgentModelMutationOptions,
	AgentModelRef,
	AgentPromptOptions,
	AgentQueuedInput,
	AgentSnapshot,
	AgentStats,
	AgentStatus,
	AgentToolInfo,
	PromptDisposition,
	QueueDisposition,
	ThinkingLevel,
} from "./types.ts";

export interface ToolGateCall {
	toolCallId: string;
	toolName: string;
	input: unknown;
	parentCallId?: string;
}

export interface ApprovalHook {
	agent?: PiAgent;
}

export function createApprovalExtension(hook: ApprovalHook): ExtensionFactory {
	return (pi) => {
		pi.on("tool_call", async (event) => {
			const agent = hook.agent;
			if (!agent) {
				return undefined;
			}
			return await agent.gateToolCall({
				toolCallId: event.toolCallId,
				parentCallId: event.parentToolCallId,
				toolName: event.toolName,
				input: event.input,
			});
		});
	};
}

export interface PiAgentContext {
	session: AgentSession;
	modelRuntime: ModelRuntime;
	modelFallbackMessage?: string;
	extensionIssues?: string[];
	approvalHandler?: AgentApprovalHandler;
	onError?: (error: unknown) => void;
}

function toAgentEntry(entry: SessionEntry): AgentEntry {
	const base: AgentEntry = {
		id: entry.id,
		parentId: entry.parentId,
		kind: entry.type as AgentEntryKind,
		timestamp: entry.timestamp,
	};
	switch (entry.type) {
		case "message":
			return { ...base, message: toAgentMessage(entry.message) };
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
	readonly id: string;
	readonly cwd: string;
	private readonly session: AgentSession;
	private readonly modelRuntime: ModelRuntime;
	private readonly modelFallbackMessage: string | undefined;
	private readonly extensionIssues: string[];
	private readonly onError: ((error: unknown) => void) | undefined;
	private readonly listeners = new Set<AgentEventListener>();
	private readonly pendingApprovals = new Map<string, AgentApprovalRequest>();
	private readonly unsubscribeSession: () => void;
	private approvalHandler: AgentApprovalHandler | undefined;
	private status: AgentStatus = "idle";
	private disposed = false;

	constructor(context: PiAgentContext) {
		this.session = context.session;
		this.modelRuntime = context.modelRuntime;
		this.modelFallbackMessage = context.modelFallbackMessage;
		this.extensionIssues = context.extensionIssues ?? [];
		this.approvalHandler = context.approvalHandler;
		this.onError = context.onError;
		this.id = this.session.sessionId;
		this.cwd = this.session.sessionManager.getCwd();
		this.status = this.computeStatus();
		this.unsubscribeSession = this.session.subscribe((event) => {
			this.handleSessionEvent(event);
		});
	}

	get file(): string | undefined {
		return this.session.sessionFile;
	}

	get name(): string | undefined {
		return this.session.sessionName;
	}

	get systemPrompt(): string {
		return this.session.systemPrompt;
	}

	get currentStatus(): AgentStatus {
		return this.status;
	}

	get fallbackNotice(): string | undefined {
		return this.modelFallbackMessage;
	}

	get issues(): readonly string[] {
		return this.extensionIssues;
	}

	get isStreaming(): boolean {
		return this.session.isStreaming;
	}

	get isCompacting(): boolean {
		return this.session.isCompacting;
	}

	subscribe(listener: AgentEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	setApprovalHandler(handler: AgentApprovalHandler | undefined): void {
		this.approvalHandler = handler;
	}

	async gateToolCall(call: ToolGateCall): Promise<{ block?: boolean; reason?: string } | undefined> {
		const handler = this.approvalHandler;
		if (!handler) {
			return undefined;
		}
		const request: AgentApprovalRequest = {
			id: randomUUID(),
			callId: call.toolCallId,
			toolName: call.toolName,
			input: call.input,
			cwd: this.cwd,
			parentCallId: call.parentCallId,
		};
		this.pendingApprovals.set(request.id, request);
		this.emit({ type: "approval_request", request });
		this.refreshStatus();
		let decision: AgentApprovalDecision;
		try {
			const outcome = await handler(request);
			decision =
				outcome?.action === "allow"
					? { action: "allow" }
					: { action: "deny", reason: outcome?.reason ?? `${request.toolName} was denied` };
		} catch (error) {
			this.onError?.(error);
			decision = {
				action: "deny",
				reason: error instanceof Error ? error.message : `${request.toolName} was denied`,
			};
		} finally {
			this.pendingApprovals.delete(request.id);
			this.refreshStatus();
		}
		this.emit({ type: "approval_resolved", requestId: request.id, decision });
		if (decision.action === "deny") {
			return { block: true, reason: decision.reason };
		}
		return undefined;
	}

	async prompt(text: string, options: AgentPromptOptions = {}): Promise<PromptDisposition> {
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

	async steer(text: string, images?: AgentImageBlock[]): Promise<QueueDisposition> {
		return await this.session.steer(text, images);
	}

	async followUp(text: string, images?: AgentImageBlock[]): Promise<QueueDisposition> {
		return await this.session.followUp(text, images);
	}

	async abort(): Promise<void> {
		await this.session.abort();
	}

	async waitForIdle(): Promise<void> {
		await this.session.waitForIdle();
	}

	clearQueue(): AgentQueuedInput {
		return this.session.clearQueue();
	}

	queued(): AgentQueuedInput {
		return {
			steering: [...this.session.getSteeringMessages()],
			followUp: [...this.session.getFollowUpMessages()],
		};
	}

	async setModel(ref: AgentModelRef, options: AgentModelMutationOptions = {}): Promise<AgentModelInfo> {
		const model = this.modelRuntime.getModel(ref.provider, ref.id);
		if (!model) {
			throw new Error(`unknown model: ${ref.provider}/${ref.id}`);
		}
		await this.session.setModel(model, { persist: options.persist });
		const info = toAgentModelInfo(model);
		this.emit({ type: "model", model: info });
		return info;
	}

	async cycleModel(
		direction: "forward" | "backward" = "forward",
		options: AgentModelMutationOptions = {},
	): Promise<AgentModelInfo | undefined> {
		const result = await this.session.cycleModel(direction, { persist: options.persist });
		if (!result) {
			return undefined;
		}
		const info = toAgentModelInfo(result.model);
		this.emit({ type: "model", model: info });
		return info;
	}

	setThinkingLevel(level: ThinkingLevel, options: AgentModelMutationOptions = {}): void {
		this.session.setThinkingLevel(level, { persist: options.persist });
	}

	model(): AgentModelInfo | undefined {
		const model = this.session.model;
		return model ? toAgentModelInfo(model) : undefined;
	}

	thinkingLevel(): ThinkingLevel {
		return this.session.thinkingLevel;
	}

	availableThinkingLevels(): ThinkingLevel[] {
		return this.session.getAvailableThinkingLevels();
	}

	activeToolNames(): string[] {
		return this.session.getActiveToolNames();
	}

	tools(): AgentToolInfo[] {
		const active = new Set(this.session.getActiveToolNames());
		return this.session.getAllTools().map((tool) => ({
			name: tool.name,
			description: tool.description,
			active: active.has(tool.name),
		}));
	}

	setActiveTools(names: string[]): void {
		this.session.setActiveToolsByName(names);
	}

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

	setName(name: string): void {
		this.session.setSessionName(name);
	}

	messages(): AgentMessage[] {
		return toAgentMessages(this.session.messages);
	}

	entries(since?: string): { entries: AgentEntry[]; leafId: string | null } {
		const all = this.session.sessionManager.getEntries();
		const leafId = this.session.sessionManager.getLeafId();
		if (since === undefined) {
			return { entries: all.map(toAgentEntry), leafId };
		}
		const index = all.findIndex((entry) => entry.id === since);
		if (index < 0) {
			throw new Error(`unknown session entry: ${since}`);
		}
		return { entries: all.slice(index + 1).map(toAgentEntry), leafId };
	}

	contextUsage(): AgentContextUsage | undefined {
		return this.session.getContextUsage();
	}

	stats(): AgentStats {
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

	snapshot(): AgentSnapshot {
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
			pendingApprovals: [...this.pendingApprovals.values()],
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

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.unsubscribeSession();
		this.listeners.clear();
		this.pendingApprovals.clear();
		this.session.dispose();
	}

	private assertAlive(): void {
		if (this.disposed) {
			throw new Error(`agent ${this.id} has been disposed`);
		}
	}

	private computeStatus(): AgentStatus {
		if (this.pendingApprovals.size > 0) {
			return "awaiting_approval";
		}
		if (this.session.isCompacting) {
			return "compacting";
		}
		if (this.session.isStreaming) {
			return "running";
		}
		return "idle";
	}

	private refreshStatus(): void {
		const next = this.computeStatus();
		if (next === this.status) {
			return;
		}
		this.status = next;
		this.emit({ type: "status", status: next });
	}

	private handleSessionEvent(event: AgentSessionEvent): void {
		for (const mapped of toAgentEvents(event)) {
			this.emit(mapped);
		}
		this.refreshStatus();
	}

	private emit(event: AgentEvent): void {
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch (error) {
				this.onError?.(error);
			}
		}
	}
}
