import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionUIContext,
	getAgentDir,
	type InlineExtension,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { toAgentModelInfo } from "./convert.ts";
import { type ApprovalHook, createApprovalExtension, PiAgent } from "./pi-agent.ts";
import type {
	AgentApprovalHandler,
	AgentModelInfo,
	AgentModelRef,
	AgentProviderInfo,
	AgentSessionSummary,
	ThinkingLevel,
} from "./types.ts";

export interface PiAgentRuntimeOptions {
	agentDir?: string;
	sessionDir?: string;
	allowModelNetwork?: boolean;
	onError?: (error: unknown) => void;
}

export interface PiAgentLaunchOptions {
	cwd?: string;
	sessionDir?: string;
	model?: AgentModelRef;
	thinkingLevel?: ThinkingLevel;
	tools?: string[];
	excludeTools?: string[];
	name?: string;
	approvalHandler?: AgentApprovalHandler;
	uiContext?: ExtensionUIContext;
	noExtensions?: boolean;
	extensionFactories?: InlineExtension[];
	onError?: (error: unknown) => void;
}

export interface OpenPiAgentOptions {
	sessionFile: string;
	cwd?: string;
	sessionDir?: string;
	approvalHandler?: AgentApprovalHandler;
	uiContext?: ExtensionUIContext;
	noExtensions?: boolean;
	extensionFactories?: InlineExtension[];
	onError?: (error: unknown) => void;
}

export interface ForkPiAgentOptions extends OpenPiAgentOptions {
	entryId: string;
}

export class PiAgentRuntime {
	readonly agentDir: string;
	readonly sessionDir: string | undefined;
	private readonly modelRuntime: ModelRuntime;
	private readonly onError: ((error: unknown) => void) | undefined;
	private readonly agents = new Map<string, PiAgent>();
	private disposed = false;

	private constructor(modelRuntime: ModelRuntime, options: PiAgentRuntimeOptions, agentDir: string) {
		this.modelRuntime = modelRuntime;
		this.agentDir = agentDir;
		this.sessionDir = options.sessionDir;
		this.onError = options.onError;
	}

	static async create(options: PiAgentRuntimeOptions = {}): Promise<PiAgentRuntime> {
		const agentDir = options.agentDir ?? getAgentDir();
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
			allowModelNetwork: options.allowModelNetwork,
		});
		return new PiAgentRuntime(modelRuntime, options, agentDir);
	}

	providers(): AgentProviderInfo[] {
		return this.modelRuntime.getProviders().map((provider) => ({
			id: provider.id,
			name: provider.name,
			authenticated: this.modelRuntime.hasConfiguredAuth(provider.id),
			modelCount: provider.getModels().length,
		}));
	}

	models(providerId?: string): AgentModelInfo[] {
		return this.modelRuntime.getModels(providerId).map(toAgentModelInfo);
	}

	async availableModels(): Promise<AgentModelInfo[]> {
		const models = await this.modelRuntime.getAvailable();
		return models.map(toAgentModelInfo);
	}

	findModel(ref: AgentModelRef): AgentModelInfo | undefined {
		const model = this.modelRuntime.getModel(ref.provider, ref.id);
		return model ? toAgentModelInfo(model) : undefined;
	}

	async listSessions(cwd?: string): Promise<AgentSessionSummary[]> {
		const infos = cwd
			? await SessionManager.list(cwd, this.sessionDir)
			: this.sessionDir
				? await SessionManager.listAll(this.sessionDir)
				: await SessionManager.listAll();
		return infos.map((info) => ({
			id: info.id,
			path: info.path,
			cwd: info.cwd,
			name: info.name,
			parentSessionPath: info.parentSessionPath,
			created: info.created.getTime(),
			modified: info.modified.getTime(),
			messageCount: info.messageCount,
			firstMessage: info.firstMessage,
		}));
	}

	async createAgent(options: PiAgentLaunchOptions = {}): Promise<PiAgent> {
		this.assertAlive();
		const cwd = options.cwd ?? process.cwd();
		const sessionDir = options.sessionDir ?? this.sessionDir;
		const sessionManager = sessionDir ? SessionManager.create(cwd, sessionDir) : SessionManager.create(cwd);
		const agent = await this.launch(sessionManager, options, {
			model: options.model,
			thinkingLevel: options.thinkingLevel,
			tools: options.tools,
			excludeTools: options.excludeTools,
			name: options.name,
		});
		return agent;
	}

	async openAgent(options: OpenPiAgentOptions): Promise<PiAgent> {
		this.assertAlive();
		const sessionManager = SessionManager.open(options.sessionFile, options.sessionDir, options.cwd);
		return await this.launch(sessionManager, options, {});
	}

	async forkAgent(options: ForkPiAgentOptions): Promise<PiAgent> {
		this.assertAlive();
		const source = SessionManager.open(options.sessionFile, options.sessionDir, options.cwd);
		const forked = source.createBranchedSession(options.entryId);
		if (!forked) {
			throw new Error(`cannot fork session ${options.sessionFile} at entry ${options.entryId}`);
		}
		return await this.openAgent({ ...options, sessionFile: forked });
	}

	releaseAgent(agent: PiAgent): void {
		this.agents.delete(agent.id);
		agent.dispose();
	}

	hasAgent(id: string): boolean {
		return this.agents.has(id);
	}

	agentIds(): string[] {
		return [...this.agents.keys()];
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		for (const agent of [...this.agents.values()]) {
			agent.dispose();
		}
		this.agents.clear();
	}

	private assertAlive(): void {
		if (this.disposed) {
			throw new Error("runtime has been disposed");
		}
	}

	private resolveModel(ref: AgentModelRef) {
		const model = this.modelRuntime.getModel(ref.provider, ref.id);
		if (!model) {
			throw new Error(`unknown model: ${ref.provider}/${ref.id}`);
		}
		return model;
	}

	private async launch(
		sessionManager: SessionManager,
		options: PiAgentLaunchOptions | OpenPiAgentOptions,
		tuning: {
			model?: AgentModelRef;
			thinkingLevel?: ThinkingLevel;
			tools?: string[];
			excludeTools?: string[];
			name?: string;
		},
	): Promise<PiAgent> {
		const cwd = sessionManager.getCwd();
		const hook: ApprovalHook = {};
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir: this.agentDir,
			extensionFactories: [
				{ name: "facet-approval", hidden: true, factory: createApprovalExtension(hook) },
				...(options.extensionFactories ?? []),
			],
			noExtensions: options.noExtensions,
		});
		await resourceLoader.reload();

		const { session, extensionsResult, modelFallbackMessage } = await createAgentSession({
			cwd,
			agentDir: this.agentDir,
			modelRuntime: this.modelRuntime,
			model: tuning.model ? this.resolveModel(tuning.model) : undefined,
			thinkingLevel: tuning.thinkingLevel,
			tools: tuning.tools,
			excludeTools: tuning.excludeTools,
			resourceLoader,
			sessionManager,
		});

		const onError = options.onError ?? this.onError;
		const agent = new PiAgent({
			session,
			modelRuntime: this.modelRuntime,
			modelFallbackMessage,
			extensionIssues: [
				...extensionsResult.errors.map((issue) => `${issue.path}: ${issue.error}`),
				...(extensionsResult.warnings ?? []).map((issue) => `${issue.path}: ${issue.warning}`),
			],
			approvalHandler: options.approvalHandler,
			onError,
		});
		hook.agent = agent;

		await session.bindExtensions({
			uiContext: options.uiContext,
			mode: "rpc",
			abortHandler: () => {
				void agent.abort();
			},
			onError: (error) => onError?.(error),
		});

		if (tuning.name) {
			session.setSessionName(tuning.name);
		}

		this.agents.set(agent.id, agent);
		return agent;
	}
}
