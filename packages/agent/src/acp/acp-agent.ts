/**
 * 外部 ACP（Agent Client Protocol）代理会话实现。
 *
 * 将单个外部 ACP 会话（如 `agy acp`）包装为 Facet 的 `ManagedAgent`，隔离子进程、
 * `@agentclientprotocol/sdk` JSON-RPC 2.0、权限审批桥接（`session/request_permission`）
 * 与回合状态机。
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import {
	type AgentApp,
	type ClientConnection,
	client,
	ndJsonStream,
	PROTOCOL_VERSION,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionUpdate,
	type Stream,
} from "@agentclientprotocol/sdk";
import {
	type AcpBackendProfile,
	type AcpConfigOption,
	type AcpModeState,
	type AgentCapabilities,
	type ContextBreakdown,
	type ContextUsage,
	DEFAULT_ACP_CAPABILITIES,
	type Entry,
	type ExtensionUiState,
	type Maintenance,
	type ModelInfo,
	type ModelRef,
	makeAcpLocator,
	type PromptDisposition,
	type QueueDisposition,
	type QueuedInput,
	type SessionEvent,
	type SessionEventListener,
	type SessionInitialization,
	type SessionSnapshot,
	type SessionStats,
	type SlashCommand,
	type ThinkingLevel,
	type ToolInfo,
	type TurnPhase,
	type UiPrompt,
	type UiResponse,
} from "@facet/protocol";
import type { ManagedAgent } from "../agent-contract.ts";
import type { QueuedMessageItem } from "../queue-state.ts";
import type { ModelMutationOptions, PromptOptions } from "../types.ts";
import {
	type AcpBackendAdapter,
	AcpStreamBuilder,
	isCanonicalAcpModeId,
	normalizeAcpSessionState,
	permissionPromptFromAcp,
	toAcpPromptBlocks,
} from "./acp-events.ts";
import { resolveCommandPath } from "./acp-registry.ts";
import { spawnAcpProcess, terminateAcpProcess } from "./acp-spawn.ts";

/** stderr 环形诊断缓冲保留上限。 */
const MAX_STDERR_LINES = 25;

/** 进程退出等待宽限期（毫秒）。 */
const KILL_GRACE_MS = 1500;

/** 挂起中的 ACP 权限请求条目。 */
interface PendingPermission {
	readonly prompt: UiPrompt;
	readonly labelToOptionId: Map<string, string>;
	readonly defaultDenyOptionId: string | undefined;
	resolve(response: RequestPermissionResponse): void;
}

/** `AcpAgent` 连接目标工厂：生产用 stdio 子进程，测试可注入内存 `AgentApp` 或自定义 `Stream`。 */
export type AcpTransportTarget =
	| { kind: "spawn"; profile: AcpBackendProfile; cwd: string }
	| { kind: "stream"; stream: Stream; profile: AcpBackendProfile; cwd: string }
	| { kind: "in_process"; app: AgentApp; profile: AcpBackendProfile; cwd: string };

/** 构造 `AcpAgent` 的选项。 */
export interface AcpAgentOptions {
	/** Facet 内部分配的稳定会话标识 */
	id: string;
	/** 后端配置 */
	profile: AcpBackendProfile;
	/** 工作目录 */
	cwd: string;
	/** 恢复已有 ACP 会话时的外部 sessionId；缺省表示新建 */
	externalSessionId?: string;
	/** 会话展示名 */
	name?: string;
	/** 测试可覆写传输连接目标 */
	transport?: AcpTransportTarget;
	/** 后端专属行为适配器（可选） */
	adapter?: AcpBackendAdapter;
	/** 会话建好或每轮收尾后通知上层刷新轻量索引 */
	onIndexSync?: (info: {
		backendId: string;
		externalSessionId: string;
		cwd: string;
		name?: string;
		firstMessage: string;
	}) => void;
	onError?: (error: unknown) => void;
}

/** 从 stderr 与登录指引拼出清晰可读的失败原因。 */
export function formatAcpInitFailure(
	error: unknown,
	stderrLines: readonly string[],
	profile: AcpBackendProfile,
): string {
	const base = error instanceof Error ? error.message : String(error);
	const detail = stderrLines.slice(-6).join("\n").trim();
	const parts = [detail.length > 0 ? `${base}\n${detail}` : base];
	if (profile.loginHint) {
		parts.push(`Hint: ${profile.loginHint}`);
	}
	return parts.join("\n");
}

/** 单个外部 ACP Agent 会话适配器。 */
export class AcpAgent implements ManagedAgent {
	readonly id: string;
	readonly backendId: string;
	readonly cwd: string;
	private readonly profile: AcpBackendProfile;
	private readonly transportTarget: AcpTransportTarget;
	private readonly adapter?: AcpBackendAdapter;
	private readonly onIndexSync?: AcpAgentOptions["onIndexSync"];
	private readonly onError?: (error: unknown) => void;

	private externalSessionId: string | undefined;
	private customName: string | undefined;
	private caps: AgentCapabilities = { ...DEFAULT_ACP_CAPABILITIES };
	private modeState: AcpModeState | undefined;
	private modeConfigId: string | undefined;
	private configOptions: AcpConfigOption[] = [];
	private initialization: SessionInitialization = { kind: "starting" };
	private phase: TurnPhase = "idle";
	private abortRequested = false;
	private disposed = false;
	private activePrompt: Promise<PromptDisposition> | undefined;
	private replayingHistory = false;
	private updateChain: Promise<void> = Promise.resolve();

	private child: ChildProcessWithoutNullStreams | undefined;
	private connection: ClientConnection | undefined;
	private readonly stderrLines: string[] = [];
	private readonly listeners = new Set<SessionEventListener>();
	private readonly pendingPermissions = new Map<string, PendingPermission>();
	private readonly builder: AcpStreamBuilder;
	private messageSeq = 0;
	private currentAssistantSeq: number | undefined;
	private currentUserSeq: number | undefined;
	private initPromise: Promise<void> | undefined;

	constructor(options: AcpAgentOptions) {
		this.id = options.id;
		this.backendId = options.profile.id;
		this.profile = options.profile;
		this.cwd = options.cwd;
		this.externalSessionId = options.externalSessionId;
		this.customName = options.name;
		this.transportTarget = options.transport ?? {
			kind: "spawn",
			profile: options.profile,
			cwd: options.cwd,
		};
		this.adapter = options.adapter;
		this.onIndexSync = options.onIndexSync;
		this.onError = options.onError;
		this.builder = new AcpStreamBuilder(this.backendId, this.adapter?.toCanonicalModeId);
	}

	get file(): string | undefined {
		return this.externalSessionId === undefined
			? undefined
			: makeAcpLocator(this.backendId, this.externalSessionId);
	}

	get name(): string | undefined {
		return this.customName ?? this.builder.title;
	}

	get capabilities(): AgentCapabilities {
		return { ...this.caps };
	}

	get isStreaming(): boolean {
		return this.phase === "running" || this.phase === "stopping";
	}

	get pendingPromptCount(): number {
		return 0;
	}

	get isBusy(): boolean {
		return this.phase !== "idle" || this.activePrompt !== undefined;
	}

	get currentMaintenance(): Maintenance | undefined {
		return undefined;
	}

	/** 对外读取当前外部 ACP 会话标识（初始化成功后一定有值）。 */
	get sessionExternalId(): string | undefined {
		return this.externalSessionId;
	}

	async initialize(): Promise<void> {
		if (this.initPromise !== undefined) {
			return await this.initPromise;
		}
		this.initPromise = this.runInitialize();
		return await this.initPromise;
	}

	private async runInitialize(): Promise<void> {
		try {
			const connection = this.openConnection();
			this.connection = connection;

			const initResult = await connection.agent.request("initialize", {
				protocolVersion: PROTOCOL_VERSION,
				clientInfo: { name: "facet", version: "0.1.0" },
				clientCapabilities: {},
			});
			const agentCaps = initResult.agentCapabilities;
			const supportsHistoryLoad = Boolean(agentCaps?.loadSession);
			const supportsImages = Boolean(agentCaps?.promptCapabilities?.image);
			this.caps = {
				...DEFAULT_ACP_CAPABILITIES,
				supportsHistoryLoad,
				supportsImages,
			};

			if (this.adapter?.auth !== undefined) {
				await connection.agent.request("authenticate", {
					methodId: this.adapter.auth.methodId,
				});
			}

			if (this.externalSessionId !== undefined) {
				await this.attachExistingSession(
					connection,
					this.externalSessionId,
					supportsHistoryLoad,
					Boolean(agentCaps?.sessionCapabilities?.resume),
				);
			} else {
				const created = await connection.agent.request("session/new", {
					cwd: this.cwd,
					mcpServers: [],
				});
				this.externalSessionId = created.sessionId;
				const normalized = normalizeAcpSessionState(
					created.modes,
					created.configOptions,
					this.adapter?.toCanonicalModeId,
				);
				this.modeState = normalized.mode;
				this.modeConfigId = normalized.modeConfigId;
				this.configOptions = normalized.configOptions;
			}

			this.initialization = { kind: "ready" };
			this.emit({ type: "initialized", initialization: this.initialization });
			if (this.modeState !== undefined || this.configOptions.length > 0) {
				this.emit({
					type: "acp_state",
					...(this.modeState === undefined ? {} : { mode: this.modeState }),
					configOptions: this.configOptions,
				});
			}
			this.syncIndex();
		} catch (error) {
			const message = formatAcpInitFailure(error, this.stderrLines, this.profile);
			this.initialization = { kind: "failed", message };
			this.emit({ type: "initialized", initialization: this.initialization });
			this.cleanupConnection();
			throw new Error(message);
		}
	}

	private async attachExistingSession(
		connection: ClientConnection,
		externalSessionId: string,
		supportsHistoryLoad: boolean,
		supportsResume: boolean,
	): Promise<void> {
		if (supportsHistoryLoad) {
			this.replayingHistory = true;
			try {
				const loaded = await connection.agent.request("session/load", {
					sessionId: externalSessionId,
					cwd: this.cwd,
					mcpServers: [],
				});
				await this.updateChain;
				this.builder.finishTurn({ replay: true });
				const normalized = normalizeAcpSessionState(
					loaded?.modes,
					loaded?.configOptions,
					this.adapter?.toCanonicalModeId,
				);
				this.modeState = normalized.mode;
				this.modeConfigId = normalized.modeConfigId;
				this.configOptions = normalized.configOptions;
				return;
			} finally {
				this.replayingHistory = false;
			}
		}
		if (supportsResume) {
			const resumed = await connection.agent.request("session/resume", {
				sessionId: externalSessionId,
				cwd: this.cwd,
			});
			const normalized = normalizeAcpSessionState(
				resumed.modes,
				resumed.configOptions,
				this.adapter?.toCanonicalModeId,
			);
			this.modeState = normalized.mode;
			this.modeConfigId = normalized.modeConfigId;
			this.configOptions = normalized.configOptions;
			return;
		}
		// 后端既不支持 loadSession 也不支持 resume 时退回新建外部会话并继承定位记录
		const created = await connection.agent.request("session/new", {
			cwd: this.cwd,
			mcpServers: [],
		});
		this.externalSessionId = created.sessionId;
		const normalized = normalizeAcpSessionState(
			created.modes,
			created.configOptions,
			this.adapter?.toCanonicalModeId,
		);
		this.modeState = normalized.mode;
		this.modeConfigId = normalized.modeConfigId;
		this.configOptions = normalized.configOptions;
	}

	private openConnection(): ClientConnection {
		const app = client({ name: "facet" })
			.onRequest("session/request_permission", async ({ params }) => {
				return await this.handlePermissionRequest(params);
			})
			.onNotification("session/update", async ({ params }) => {
				if (params.sessionId !== this.externalSessionId) {
					return;
				}
				const replay = this.replayingHistory;
				this.updateChain = this.updateChain.then(() => {
					this.handleUpdate(params.update, replay);
				});
				await this.updateChain;
			});

		let connection: ClientConnection;
		if (this.transportTarget.kind === "in_process") {
			connection = app.connect(this.transportTarget.app);
		} else if (this.transportTarget.kind === "stream") {
			connection = app.connect(this.transportTarget.stream);
		} else {
			const { profile, cwd } = this.transportTarget;
			const child = spawnAcpProcess({
				command: profile.command,
				args: profile.args,
				cwd,
				profileEnv: profile.env,
				prepareEnv: this.adapter?.auth?.prepareEnv,
				resolveCommand: (cmd) => resolveCommandPath(cmd),
				onStderrLine: (line) => {
					this.stderrLines.push(line);
					if (this.stderrLines.length > MAX_STDERR_LINES) {
						this.stderrLines.shift();
					}
				},
				onSpawnError: (error) => {
					this.stderrLines.push(error.message);
					if (this.stderrLines.length > MAX_STDERR_LINES) {
						this.stderrLines.shift();
					}
					if (!this.disposed && this.phase !== "idle") {
						this.emit({
							type: "notice",
							level: "error",
							message: `ACP process failed to start: ${error.message}`,
						});
					}
				},
			});
			this.child = child;
			child.on("exit", (code, signal) => {
				if (this.disposed) {
					return;
				}
				this.cancelUi();
				if (this.phase !== "idle") {
					this.emit({
						type: "notice",
						level: "error",
						message: `ACP process exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "none"})`,
					});
				}
			});
			const readable = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
			const writable = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
			connection = app.connect(ndJsonStream(writable, readable));
		}

		void connection.closed.then(() => {
			if (!this.disposed) {
				this.cancelUi();
			}
		});
		return connection;
	}

	private handleUpdate(update: SessionUpdate, replay: boolean): void {
		const events = this.builder.applyUpdate(update, { replay });
		for (const event of events) {
			if (event.type === "acp_state") {
				if (event.mode !== undefined) {
					const available = this.modeState?.availableModes ?? [];
					this.modeState = {
						currentModeId: event.mode.currentModeId,
						availableModes: event.mode.availableModes.length > 0 ? event.mode.availableModes : available,
					};
				}
				if (event.configOptions !== undefined) {
					this.configOptions = event.configOptions;
				}
				if (!replay) {
					this.emit({
						type: "acp_state",
						...(this.modeState === undefined ? {} : { mode: this.modeState }),
						configOptions: this.configOptions,
					});
				}
				continue;
			}
			if (replay) {
				continue;
			}
			this.emitTrackedEvent(event);
		}
	}

	private emitTrackedEvent(event: SessionEvent): void {
		if (event.type === "message_start") {
			this.messageSeq += 1;
			if (event.message.role === "assistant") {
				this.currentAssistantSeq = this.messageSeq;
			} else if (event.message.role === "user") {
				this.currentUserSeq = this.messageSeq;
			}
			this.emit(event);
			return;
		}
		if (event.type === "entry_committed") {
			const role = event.entry.message?.role;
			const messageSeq =
				role === "assistant" ? this.currentAssistantSeq : role === "user" ? this.currentUserSeq : undefined;
			if (role === "assistant") {
				this.currentAssistantSeq = undefined;
			} else if (role === "user") {
				this.currentUserSeq = undefined;
			}
			this.emit({
				type: "entry_committed",
				entry: event.entry,
				...(messageSeq === undefined ? {} : { messageSeq }),
			});
			return;
		}
		this.emit(event);
	}

	private async handlePermissionRequest(
		request: RequestPermissionRequest,
	): Promise<RequestPermissionResponse> {
		const currentModeId = this.modeState?.currentModeId;
		const canonicalModeId = isCanonicalAcpModeId(currentModeId) ? currentModeId : undefined;
		const decision = this.adapter?.decidePermission(request, canonicalModeId) ?? "ask";
		if (decision === "allow") {
			const allowOption = request.options.find(
				(opt) => opt.kind === "allow_once" || opt.kind === "allow_always",
			);
			if (allowOption !== undefined) {
				return { outcome: { outcome: "selected", optionId: allowOption.optionId } };
			}
		} else if (decision === "deny") {
			const denyOption = request.options.find(
				(opt) => opt.kind === "reject_once" || opt.kind === "reject_always",
			);
			return denyOption !== undefined
				? { outcome: { outcome: "selected", optionId: denyOption.optionId } }
				: { outcome: { outcome: "cancelled" } };
		}

		const requestId = `perm-${randomUUID()}`;
		const mapped = permissionPromptFromAcp(requestId, request);
		const defaultDenyOptionId = mapped.options.find(
			(opt) => opt.kind === "reject_once" || opt.kind === "reject_always",
		)?.optionId;
		return await new Promise<RequestPermissionResponse>((resolve) => {
			this.pendingPermissions.set(requestId, {
				prompt: mapped.prompt,
				labelToOptionId: mapped.labelToOptionId,
				defaultDenyOptionId,
				resolve,
			});
			this.emit({ type: "ui", ui: this.uiStateSnapshot() });
		});
	}

	respondUi(requestId: string, response: UiResponse): boolean {
		const pending = this.pendingPermissions.get(requestId);
		if (pending === undefined) {
			return false;
		}
		this.pendingPermissions.delete(requestId);
		this.emit({ type: "ui", ui: this.uiStateSnapshot() });

		if (response.kind === "select") {
			const optionId = pending.labelToOptionId.get(response.value);
			if (optionId !== undefined) {
				pending.resolve({ outcome: { outcome: "selected", optionId } });
				return true;
			}
		}
		if (response.kind === "confirm" && !response.confirmed && pending.defaultDenyOptionId !== undefined) {
			pending.resolve({ outcome: { outcome: "selected", optionId: pending.defaultDenyOptionId } });
			return true;
		}
		pending.resolve({ outcome: { outcome: "cancelled" } });
		return true;
	}

	cancelUi(): void {
		if (this.pendingPermissions.size === 0) {
			return;
		}
		const entries = [...this.pendingPermissions.values()];
		this.pendingPermissions.clear();
		this.emit({ type: "ui", ui: this.uiStateSnapshot() });
		for (const item of entries) {
			item.resolve({ outcome: { outcome: "cancelled" } });
		}
	}

	private uiStateSnapshot(): ExtensionUiState {
		return {
			prompts: [...this.pendingPermissions.values()].map((item) => item.prompt),
		};
	}

	subscribe(listener: SessionEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async prompt(text: string, options: PromptOptions = {}): Promise<PromptDisposition> {
		this.assertAlive();
		const connection = this.connection;
		const externalSessionId = this.externalSessionId;
		if (this.initialization.kind !== "ready" || connection === undefined || externalSessionId === undefined) {
			throw new Error(
				this.initialization.kind === "failed" ? this.initialization.message : "ACP session is not ready",
			);
		}
		if (options.streamingBehavior !== undefined || this.isBusy) {
			throw new Error("ACP backend does not support queueing while running");
		}
		this.abortRequested = false;
		this.setPhase("starting");
		this.emit({ type: "run_start" });
		this.emit({ type: "turn_start" });
		this.setPhase("running");

		const userEntry = this.builder.recordUserTurn(text, options.images);
		const userMessage = userEntry.message;
		if (userMessage !== undefined) {
			this.emitTrackedEvent({ type: "message_start", message: userMessage });
			this.emitTrackedEvent({ type: "message_end", message: userMessage });
			this.emitTrackedEvent({ type: "entry_committed", entry: userEntry });
		}

		const run = (async (): Promise<PromptDisposition> => {
			let aborted = false;
			let failure: string | undefined;
			try {
				const blocks = toAcpPromptBlocks(text, options.images, this.caps.supportsImages);
				const response = await connection.agent.request("session/prompt", {
					sessionId: externalSessionId,
					prompt: blocks,
				});
				await this.updateChain;
				aborted = this.abortRequested || response.stopReason === "cancelled";
			} catch (error) {
				await this.updateChain;
				aborted = this.abortRequested;
				if (!aborted) {
					failure = error instanceof Error ? error.message : String(error);
					this.emit({ type: "notice", level: "error", message: failure });
				}
			} finally {
				this.cancelUi();
				const tailEvents = this.builder.finishTurn({ replay: false, aborted });
				for (const evt of tailEvents) {
					this.emitTrackedEvent(evt);
				}
				this.activePrompt = undefined;
				this.setPhase("idle");
				this.emit({ type: "run_end", willRetry: false });
				this.emit({ type: "settled", aborted, failure });
				this.syncIndex();
			}
			return "started";
		})();

		this.activePrompt = run;
		return await run;
	}

	async steer(): Promise<QueueDisposition> {
		throw new Error("ACP backend does not support steering");
	}

	async followUp(): Promise<QueueDisposition> {
		throw new Error("ACP backend does not support followUp queue");
	}

	async abort(): Promise<QueuedMessageItem[]> {
		this.abortRequested = true;
		this.cancelUi();
		if (this.phase !== "idle") {
			this.setPhase("stopping");
		}
		if (this.connection !== undefined && this.externalSessionId !== undefined) {
			await this.connection.agent
				.notify("session/cancel", { sessionId: this.externalSessionId })
				.catch(() => undefined);
		}
		return [];
	}

	demoteSteering(): void {
		throw new Error("ACP backend does not support steering demotion");
	}

	clearQueue(): QueuedInput {
		return { steering: [], followUp: [] };
	}

	async promoteFollowUp(): Promise<void> {
		throw new Error("ACP backend does not support followUp queue");
	}

	removeFollowUp(): void {
		throw new Error("ACP backend does not support followUp queue");
	}

	setName(name: string): void {
		const trimmed = name.trim();
		this.customName = trimmed.length > 0 ? trimmed : undefined;
		this.emit({ type: "name", name: this.name });
		this.syncIndex();
	}

	async compact(): Promise<void> {
		throw new Error("ACP backend does not support manual compaction");
	}

	async setModel(_ref: ModelRef, _options?: ModelMutationOptions): Promise<ModelInfo> {
		throw new Error("Use ACP config options instead of setModel");
	}

	setThinkingLevel(_level: ThinkingLevel, _options?: ModelMutationOptions): void {
		throw new Error("Use ACP config options instead of setThinkingLevel");
	}

	tools(): ToolInfo[] {
		return [];
	}

	setActiveTools(): void {
		throw new Error("ACP backend does not support setActiveTools");
	}

	async setAcpMode(modeId: string): Promise<void> {
		this.assertAlive();
		if (this.connection === undefined || this.externalSessionId === undefined) {
			throw new Error("ACP session is not ready");
		}
		const targetModeId =
			this.adapter !== undefined && isCanonicalAcpModeId(modeId) ? this.adapter.toWireModeId(modeId) : modeId;
		if (this.modeConfigId !== undefined) {
			// 优先走 ACP 新版 session/set_config_option（v2 已移除 session/set_mode）
			const response = await this.connection.agent.request("session/set_config_option", {
				sessionId: this.externalSessionId,
				configId: this.modeConfigId,
				value: targetModeId,
			});
			const normalized = normalizeAcpSessionState(
				undefined,
				response.configOptions,
				this.adapter?.toCanonicalModeId,
			);
			const nextBase = normalized.mode ?? this.modeState;
			this.modeState =
				nextBase !== undefined
					? { ...nextBase, currentModeId: modeId }
					: { currentModeId: modeId, availableModes: [] };
			if (normalized.modeConfigId !== undefined) {
				this.modeConfigId = normalized.modeConfigId;
			}
			this.configOptions = normalized.configOptions;
			this.emit({ type: "acp_state", mode: this.modeState, configOptions: this.configOptions });
			return;
		}
		await this.connection.agent.request("session/set_mode", {
			sessionId: this.externalSessionId,
			modeId: targetModeId,
		});
		if (this.modeState !== undefined) {
			this.modeState = { ...this.modeState, currentModeId: modeId };
		} else {
			this.modeState = { currentModeId: modeId, availableModes: [] };
		}
		this.emit({ type: "acp_state", mode: this.modeState, configOptions: this.configOptions });
	}

	async setAcpConfigOption(configId: string, value: string): Promise<void> {
		this.assertAlive();
		if (this.connection === undefined || this.externalSessionId === undefined) {
			throw new Error("ACP session is not ready");
		}
		const response = await this.connection.agent.request("session/set_config_option", {
			sessionId: this.externalSessionId,
			configId,
			value,
		});
		const normalized = normalizeAcpSessionState(
			undefined,
			response.configOptions,
			this.adapter?.toCanonicalModeId,
		);
		if (normalized.mode !== undefined) {
			this.modeState = normalized.mode;
		}
		if (normalized.modeConfigId !== undefined) {
			this.modeConfigId = normalized.modeConfigId;
		}
		this.configOptions = normalized.configOptions;
		this.emit({ type: "acp_state", mode: this.modeState, configOptions: this.configOptions });
	}

	contextUsage(): ContextUsage | undefined {
		return undefined;
	}

	contextBreakdown(): ContextBreakdown {
		return {
			contextWindow: 0,
			reportedTokens: null,
			reportedPercent: null,
			estimatedTokens: 0,
			categories: [],
			hiddenTools: [],
			compactions: 0,
		};
	}

	stats(): SessionStats {
		let userMessages = 0;
		let assistantMessages = 0;
		let toolCalls = 0;
		let toolResults = 0;
		for (const entry of this.builder.entries) {
			const msg = entry.message;
			if (!msg) continue;
			if (msg.role === "user") userMessages += 1;
			else if (msg.role === "assistant") {
				assistantMessages += 1;
				toolCalls += msg.content.filter((b) => b.type === "toolCall").length;
			} else if (msg.role === "toolResult") {
				toolResults += 1;
			}
		}
		return {
			sessionId: this.id,
			sessionFile: undefined,
			userMessages,
			assistantMessages,
			toolCalls,
			toolResults,
			totalMessages: this.builder.entries.length,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			cost: 0,
			contextUsage: undefined,
		};
	}

	commands(): SlashCommand[] {
		return [...this.builder.commands];
	}

	entryPage(cursor: string | undefined, limit: number): { entries: Entry[]; nextCursor: string | undefined } {
		const entries = this.builder.entries;
		const size = Math.max(1, limit);
		if (cursor === undefined) {
			const start = Math.max(0, entries.length - size);
			return {
				entries: entries.slice(start),
				nextCursor: start > 0 ? entries[start]?.id : undefined,
			};
		}
		const index = entries.findIndex((entry) => entry.id === cursor);
		if (index < 0) {
			throw new Error(`unknown session entry: ${cursor}`);
		}
		const start = Math.max(0, index - size);
		return {
			entries: entries.slice(start, index),
			nextCursor: start > 0 ? entries[start]?.id : undefined,
		};
	}

	entriesAfter(afterEntryId: string | null): { entries: Entry[]; leafId: string | null } {
		const entries = this.builder.entries;
		const leafId = entries[entries.length - 1]?.id ?? null;
		if (afterEntryId === null) {
			return { entries: [...entries], leafId };
		}
		const index = entries.findIndex((entry) => entry.id === afterEntryId);
		if (index < 0) {
			throw new Error(`unknown session entry: ${afterEntryId}`);
		}
		return { entries: entries.slice(index + 1), leafId };
	}

	entryBefore(entryId: string): string | null {
		const entries = this.builder.entries;
		const index = entries.findIndex((entry) => entry.id === entryId);
		if (index <= 0) {
			return null;
		}
		return entries[index - 1]?.id ?? null;
	}

	async revertTo(): Promise<string | undefined> {
		throw new Error("ACP backend does not support revertTo");
	}

	leafEntryId(): string | null {
		const entries = this.builder.entries;
		return entries[entries.length - 1]?.id ?? null;
	}

	snapshot(): SessionSnapshot {
		return {
			id: this.id,
			backendId: this.backendId,
			capabilities: this.capabilities,
			...(this.modeState === undefined ? {} : { acpMode: this.modeState }),
			...(this.configOptions.length === 0 ? {} : { acpConfigOptions: this.configOptions }),
			initialization: this.initialization,
			extensionUi: this.uiStateSnapshot(),
			file: this.file,
			cwd: this.cwd,
			name: this.name,
			phase: this.phase,
			maintenance: undefined,
			model: undefined,
			thinkingLevel: "off",
			availableThinkingLevels: [],
			activeToolNames: [],
			queued: { steering: [], followUp: [] },
			contextUsage: undefined,
			stats: this.stats(),
			modelFallbackMessage: undefined,
		};
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.cancelUi();
		this.listeners.clear();
		this.cleanupConnection();
	}

	private cleanupConnection(): void {
		try {
			this.connection?.close();
		} catch {
			// 关闭连接失败不阻塞进程清理
		}
		this.connection = undefined;
		const child = this.child;
		this.child = undefined;
		terminateAcpProcess(child, KILL_GRACE_MS);
	}

	private setPhase(phase: TurnPhase): void {
		if (this.phase === phase) {
			return;
		}
		this.phase = phase;
		this.emit({ type: "phase", phase, maintenance: undefined });
	}

	private syncIndex(): void {
		if (this.externalSessionId === undefined) {
			return;
		}
		this.onIndexSync?.({
			backendId: this.backendId,
			externalSessionId: this.externalSessionId,
			cwd: this.cwd,
			name: this.name,
			firstMessage: this.builder.firstUserText(),
		});
	}

	private emit(event: SessionEvent): void {
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch (error) {
				this.onError?.(error);
			}
		}
	}

	private assertAlive(): void {
		if (this.disposed) {
			throw new Error(`ACP session ${this.id} has been disposed`);
		}
	}
}
