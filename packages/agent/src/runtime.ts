/**
 * 会话的创建入口与共享资源。
 *
 * 进程内只建一份 ModelRuntime，凭证、模型目录与可用性检查由所有会话共用；
 * 每个会话自己的资源加载器按工作目录单独构造。会话登记表只用于统一回收，
 * 调度与并发策略由上层决定。
 */
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

/** 运行时的进程级配置。 */
export interface PiAgentRuntimeOptions {
	/** 全局配置目录，凭证与模型配置从这里读，缺省为用户目录下的 agent 目录 */
	agentDir?: string;
	/** 会话文件目录，缺省按工作目录分组存放 */
	sessionDir?: string;
	/** 是否允许启动时联网刷新模型目录，缺省关闭 */
	allowModelNetwork?: boolean;
	/** 全局错误上报，会话未单独指定时继承 */
	onError?: (error: unknown) => void;
}

/** 新建会话的参数。 */
export interface PiAgentLaunchOptions {
	/** 工作目录，缺省为进程当前目录 */
	cwd?: string;
	/** 会话文件目录，覆盖运行时的设置 */
	sessionDir?: string;
	/** 初始模型，缺省用设置里的值，否则取第一个可用模型 */
	model?: AgentModelRef;
	/** 初始思考档位，缺省由模型能力决定 */
	thinkingLevel?: ThinkingLevel;
	/** 允许激活的工具，支持通配 */
	tools?: string[];
	/** 禁止激活的工具，在 tools 之后生效 */
	excludeTools?: string[];
	/** 会话展示名 */
	name?: string;
	/** 工具审批处理函数 */
	approvalHandler?: AgentApprovalHandler;
	/** 扩展交互界面，缺省时扩展的对话框不可用 */
	uiContext?: ExtensionUIContext;
	/** 跳过文件里的扩展，内联扩展仍然加载 */
	noExtensions?: boolean;
	/** 追加的内联扩展 */
	extensionFactories?: InlineExtension[];
	onError?: (error: unknown) => void;
}

/** 打开已有会话的参数。模型、思考档位与工具集从会话记录恢复，不能在这里指定。 */
export interface OpenPiAgentOptions {
	/** 会话文件路径 */
	sessionFile: string;
	/** 覆盖会话记录的工作目录，目录已不存在时使用 */
	cwd?: string;
	sessionDir?: string;
	approvalHandler?: AgentApprovalHandler;
	uiContext?: ExtensionUIContext;
	noExtensions?: boolean;
	extensionFactories?: InlineExtension[];
	onError?: (error: unknown) => void;
}

/** 分叉会话的参数。entryId 指定从哪条历史分叉。 */
export interface ForkPiAgentOptions extends OpenPiAgentOptions {
	entryId: string;
}

export class PiAgentRuntime {
	/** 全局配置目录 */
	readonly agentDir: string;
	/** 会话文件目录，未指定时按工作目录分组 */
	readonly sessionDir: string | undefined;
	private readonly modelRuntime: ModelRuntime;
	private readonly onError: ((error: unknown) => void) | undefined;
	/** 已创建的会话，仅用于统一回收 */
	private readonly agents = new Map<string, PiAgent>();
	private disposed = false;

	private constructor(modelRuntime: ModelRuntime, options: PiAgentRuntimeOptions, agentDir: string) {
		this.modelRuntime = modelRuntime;
		this.agentDir = agentDir;
		this.sessionDir = options.sessionDir;
		this.onError = options.onError;
	}

	/** 建立共享资源。凭证与模型配置的路径由 agentDir 推出。 */
	static async create(options: PiAgentRuntimeOptions = {}): Promise<PiAgentRuntime> {
		const agentDir = options.agentDir ?? getAgentDir();
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
			allowModelNetwork: options.allowModelNetwork,
		});
		return new PiAgentRuntime(modelRuntime, options, agentDir);
	}

	/** 提供方清单，附带是否已配置凭证，用于设置面板与模型选择器分组。 */
	providers(): AgentProviderInfo[] {
		return this.modelRuntime.getProviders().map((provider) => ({
			id: provider.id,
			name: provider.name,
			authenticated: this.modelRuntime.hasConfiguredAuth(provider.id),
			modelCount: provider.getModels().length,
		}));
	}

	/** 目录里的全部模型，含未配置凭证的模型，是否可用由调用方判断。 */
	models(providerId?: string): AgentModelInfo[] {
		return this.modelRuntime.getModels(providerId).map(toAgentModelInfo);
	}

	/** 已配置凭证的模型，用于模型选择器的可选项。 */
	async availableModels(): Promise<AgentModelInfo[]> {
		const models = await this.modelRuntime.getAvailable();
		return models.map(toAgentModelInfo);
	}

	findModel(ref: AgentModelRef): AgentModelInfo | undefined {
		const model = this.modelRuntime.getModel(ref.provider, ref.id);
		return model ? toAgentModelInfo(model) : undefined;
	}

	/** 列出会话。指定 cwd 时只列该目录的会话，否则列出全部。 */
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

	/** 新建会话。会话文件立即建立，后续每条完成的消息追加写盘。 */
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

	/** 打开已有会话。模型回退等提示通过 PiAgent 的 fallbackNotice 取得。 */
	async openAgent(options: OpenPiAgentOptions): Promise<PiAgent> {
		this.assertAlive();
		const sessionManager = SessionManager.open(options.sessionFile, options.sessionDir, options.cwd);
		return await this.launch(sessionManager, options, {});
	}

	/** 从指定条目分叉出新会话，原会话不受影响。 */
	async forkAgent(options: ForkPiAgentOptions): Promise<PiAgent> {
		this.assertAlive();
		const source = SessionManager.open(options.sessionFile, options.sessionDir, options.cwd);
		const forked = source.createBranchedSession(options.entryId);
		if (!forked) {
			throw new Error(`cannot fork session ${options.sessionFile} at entry ${options.entryId}`);
		}
		return await this.openAgent({ ...options, sessionFile: forked });
	}

	/** 回收会话并从登记表移除。 */
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

	/** 回收全部会话，可重复调用。 */
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

	/**
	 * 建会话的共同部分。
	 *
	 * 审批扩展必须先在资源加载器里注册，会话建好后再把 PiAgent 填进 hook，
	 * 因此扩展的加载顺序与 PiAgent 的构造顺序互不依赖。
	 */
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

		// mode 取 rpc：宿主没有终端，扩展的终端专属界面按不可用处理
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
