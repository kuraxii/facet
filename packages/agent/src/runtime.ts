/**
 * 会话工厂与共享资源。
 *
 * 进程内只建一份 ModelRuntime，凭证、模型目录与可用性检查由所有会话共用；
 * 每个会话自己的资源加载器按工作目录单独构造。这里不登记建好的会话，
 * 谁活着、何时回收由主机侧决定。
 */
import { join } from "node:path";
import {
	createAgentSession,
	createCodemodeExtension,
	createMcpExtension,
	createToolSearchExtension,
	DefaultResourceLoader,
	type ExtensionUIContext,
	hasTrustRequiringProjectResources,
	type InlineExtension,
	type LoadExtensionsResult,
	ModelRuntime,
	ProjectTrustStore,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { facetAskUserQuestion } from "@facet/plugin-ask-user-question";
import sessionNames from "@facet/plugin-session-names";
import type { ModelInfo, ModelRef, ProviderInfo, SessionSummary, ThinkingLevel } from "@facet/protocol";
import { toModelInfo } from "./convert.ts";
import { FileCredentialStore } from "./credential-store.ts";
import { ExtensionUi } from "./extension-ui.ts";
import {
	type CustomProviderEntry,
	InvalidProviderError,
	ModelConfigStore,
	normalizeBaseUrl,
} from "./model-config-store.ts";
import { applyAgentDir } from "./paths.ts";
import { PiAgent } from "./pi-agent.ts";
import { normalizeProjectPath, type SessionProject, scanSessionProjects } from "./projects.ts";
import { SessionCatalog } from "./session-catalog.ts";
import { readSessionHeader } from "./session-scan.ts";

/** 工厂的进程级配置。 */
export interface PiAgentFactoryOptions {
	/** 全局配置目录，凭证、模型配置与会话文件都放在它下面；缺省为 facet 的开发目录 */
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
	model?: ModelRef;
	/** 初始思考档位，缺省由模型能力决定 */
	thinkingLevel?: ThinkingLevel;
	/** 允许激活的工具，支持通配 */
	tools?: string[];
	/** 禁止激活的工具，在 tools 之后生效 */
	excludeTools?: string[];
	/** 会话展示名 */
	name?: string;
	/** 调用方提供的交互实现；缺省由 server 会话使用数据桥。 */
	uiContext?: ExtensionUIContext;
	/** 先返回会话，由登记方在订阅可用后调用 initialize。 */
	deferInitialization?: boolean;
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
	/** 调用方提供的交互实现。 */
	uiContext?: ExtensionUIContext;
	/** 先返回会话，由登记方启动扩展初始化。 */
	deferInitialization?: boolean;
	noExtensions?: boolean;
	extensionFactories?: InlineExtension[];
	onError?: (error: unknown) => void;
}

/** 分叉会话的参数。entryId 缺省时复制整条活动分支。 */
export interface ForkPiAgentOptions extends OpenPiAgentOptions {
	entryId?: string;
}

/** 自定义提供方可以选的接口协议，与 pi 认识的适配器一致。 */
const KNOWN_APIS = [
	"openai-completions",
	"openai-responses",
	"anthropic-messages",
	"google-generative-ai",
	"mistral-conversations",
];

/** 凭证来源的展示名。pi 给的是来源分类，这里换成能看懂的说明。 */
const AUTH_SOURCE_LABELS: Record<string, string> = {
	stored: "Key stored on this device",
	runtime: "Key set for this run",
	environment: "Environment variable",
	fallback: "Built-in fallback credential",
	models_json_key: "Key in the model configuration",
	models_json_command: "Key command in the model configuration",
};

/**
 * 校验思考档位与模型是否相配。
 *
 * 模型支持思考时原样返回；不支持思考或模型未知时丢掉档位，交给 pi 用模型自己的缺省值，
 * 免得把设置里的档位硬套到一个用不上的模型上。
 */
export function thinkingLevelForModel(
	model: { reasoning: boolean } | undefined,
	level: ThinkingLevel | undefined,
): ThinkingLevel | undefined {
	if (level === undefined || model === undefined) {
		return level;
	}
	return model.reasoning ? level : undefined;
}

/**
 * pi 的内置扩展。
 *
 * 命令行入口会自动把它们塞进资源加载器，SDK 这条路要自己加：不加就一个都没有，比如
 * `codemode` 工具根本不会注册（更谈不上激活）。
 *
 * MCP 扩展也在里面，行为与命令行一致：`agentDir/mcp.json`（以及受信任项目里的 `.pi/mcp.json`）
 * 里配了服务器时才会拉起进程。它还负责一件事——服务器的工具只暴露给脚本时（`exposure`
 * 缺省就是这个），自动激活 `codemode`，所以配了 MCP 的目录里 `codemode` 不写 `defaultTools`
 * 也能用。
 */
const BUILTIN_EXTENSIONS: InlineExtension[] = [
	{ name: "codemode", factory: createCodemodeExtension(), builtin: true, replaceable: true },
	{ name: "tool-search", factory: createToolSearchExtension(), builtin: true, replaceable: true },
	{ name: "mcp", factory: createMcpExtension(), builtin: true, replaceable: true },
	{ name: "ask-user-question", factory: facetAskUserQuestion, builtin: true },
	{ name: "session-names", factory: sessionNames, builtin: true, replaceable: true },
];

/** 内置扩展里不允许被同名用户扩展替换的路径。 */
const PRIORITY_BUILTIN_PATHS = new Set(["builtin:ask-user-question"]);

/**
 * 让指定的内置扩展排在其它扩展前面。
 *
 * pi 按扩展顺序取第一个同名工具；内置扩展默认追加在文件扩展之后，同名时会被用户版本盖住。
 * 这里把受影响的内置扩展挪到最前，并去掉因此产生的冲突诊断。
 */
function prioritizeBuiltinExtensions(result: LoadExtensionsResult): LoadExtensionsResult {
	const prioritized = result.extensions.filter((extension) => PRIORITY_BUILTIN_PATHS.has(extension.path));
	if (prioritized.length === 0) return result;
	const names = new Set(prioritized.flatMap((extension) => [...extension.tools.keys()]));
	const isExpectedConflict = (issue: { path: string; error: string }) =>
		PRIORITY_BUILTIN_PATHS.has(issue.path) &&
		[...names].some((name) => issue.error.startsWith(`Tool "${name}" conflicts with`));
	return {
		...result,
		extensions: [
			...prioritized,
			...result.extensions.filter((extension) => !PRIORITY_BUILTIN_PATHS.has(extension.path)),
		],
		errors: result.errors.filter((issue) => !isExpectedConflict(issue)),
	};
}

export class PiAgentFactory {
	/** 全局配置目录 */
	readonly agentDir: string;
	/** 会话文件目录，未指定时按工作目录分组 */
	readonly sessionDir: string | undefined;
	/** 会话根目录：未指定 sessionDir 时落在 agentDir 下的 sessions */
	readonly sessionsDir: string;
	private readonly modelRuntime: ModelRuntime;
	private readonly onError: ((error: unknown) => void) | undefined;
	/** 项目信任记录，与 pi 命令行共用同一份 */
	private readonly trustStore: ProjectTrustStore;
	/** 凭证文件，写盘与运行态更新都经过它 */
	private readonly credentials: FileCredentialStore;
	/** 模型配置里的提供方地址，写盘之后立刻作用到运行态 */
	private readonly modelConfig: ModelConfigStore;
	/** 已生效的地址覆写，键为提供方 id */
	private baseUrlOverrides: Record<string, string>;
	/** 自定义提供方配置里的地址，键为提供方 id；它们的模型不一定带地址，列表要能显示 */
	private customBaseUrls: Record<string, string>;
	/** 会话清单与摘要缓存，按文件缓存读取结果 */
	private readonly sessionCatalog: SessionCatalog;
	private disposed = false;

	private constructor(
		modelRuntime: ModelRuntime,
		credentials: FileCredentialStore,
		modelConfig: ModelConfigStore,
		baseUrlOverrides: Record<string, string>,
		customBaseUrls: Record<string, string>,
		options: PiAgentFactoryOptions,
		agentDir: string,
	) {
		this.modelRuntime = modelRuntime;
		this.credentials = credentials;
		this.modelConfig = modelConfig;
		this.baseUrlOverrides = baseUrlOverrides;
		this.customBaseUrls = customBaseUrls;
		this.agentDir = agentDir;
		this.sessionDir = options.sessionDir;
		this.sessionsDir = options.sessionDir ?? join(agentDir, "sessions");
		this.onError = options.onError;
		this.trustStore = new ProjectTrustStore(agentDir);
		this.sessionCatalog = new SessionCatalog({ sessionsDir: this.sessionsDir });
	}

	/** 建立共享资源。凭证与模型配置的路径由 agentDir 推出。 */
	static async create(options: PiAgentFactoryOptions = {}): Promise<PiAgentFactory> {
		const agentDir = applyAgentDir(options.agentDir);
		const credentials = new FileCredentialStore(join(agentDir, "auth.json"));
		const modelConfig = new ModelConfigStore({ file: join(agentDir, "models.json") });
		const modelRuntime = await ModelRuntime.create({
			credentials,
			modelsPath: join(agentDir, "models.json"),
			allowModelNetwork: options.allowModelNetwork,
		});
		// models.json 里写了地址的提供方启动时就按它生效，与重启之前的行为保持一致
		const baseUrlOverrides = await modelConfig.overrides();
		for (const [providerId, baseUrl] of Object.entries(baseUrlOverrides)) {
			modelRuntime.registerProvider(providerId, { baseUrl });
		}
		const customBaseUrls = Object.fromEntries(
			(await modelConfig.customProviders()).map((entry) => [entry.id, entry.baseUrl]),
		);
		return new PiAgentFactory(
			modelRuntime,
			credentials,
			modelConfig,
			baseUrlOverrides,
			customBaseUrls,
			options,
			agentDir,
		);
	}

	/**
	 * 某个目录的项目级资源需不需要信任。
	 *
	 * 目录里没有需要信任的资源(项目级扩展、MCP 配置、项目内的 skill)时不必询问；有这类资源
	 * 但还没做过决定时，需要界面先问一次。
	 */
	projectTrust(cwd: string): { hasProjectResources: boolean; trusted: boolean | undefined } {
		const decision = this.trustStore.get(cwd);
		return {
			hasProjectResources: hasTrustRequiringProjectResources(cwd),
			trusted: decision === null ? undefined : decision,
		};
	}

	/** 记下某个目录的信任决定，之后建会话按它决定是否加载项目级资源。 */
	setProjectTrust(cwd: string, trusted: boolean): void {
		this.trustStore.set(cwd, trusted);
	}

	/** 提供方清单，附带凭证来源，用于设置面板与模型选择器分组。 */
	providers(): ProviderInfo[] {
		return this.modelRuntime.getProviders().map((provider) => {
			const status = this.modelRuntime.getProviderAuthStatus(provider.id);
			const source =
				status.label ?? (status.source === undefined ? undefined : AUTH_SOURCE_LABELS[status.source]);
			const effective = provider.getModels()[0]?.baseUrl ?? this.customBaseUrls[provider.id];
			const override = this.baseUrlOverrides[provider.id];
			return {
				id: provider.id,
				name: provider.name,
				authenticated: status.configured,
				modelCount: provider.getModels().length,
				...(source === undefined ? {} : { authSource: source }),
				...(this.modelRuntime.isUsingSubscription(provider.id) ? { subscription: true } : {}),
				...(effective === undefined ? {} : { baseUrl: effective }),
				...(override === undefined ? {} : { baseUrlOverride: override }),
			};
		});
	}

	/** 配置里声明了模型清单的提供方，也就是用户自己加的提供方。 */
	async customProviders(): Promise<CustomProviderEntry[]> {
		return await this.modelConfig.customProviders();
	}

	/**
	 * 新增或修改一个自定义提供方。
	 *
	 * 标识、名称、接口地址、协议与模型清单都要合法；标识不能与内置提供方重名，否则会盖掉
	 * 内置的配置。写完重读一次模型目录，新提供方立刻可选。
	 */
	async saveCustomProvider(input: {
		id: string;
		name: string;
		baseUrl: string;
		api: string;
		models: readonly {
			id: string;
			name?: string;
			reasoning?: boolean;
			contextWindow?: number;
			maxTokens?: number;
		}[];
	}): Promise<void> {
		const id = input.id.trim();
		if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
			throw new InvalidProviderError(
				"Provider ID must start with a letter or digit and contain only lowercase letters, digits, dots, underscores, and hyphens",
			);
		}
		const isKnownCustom = await this.modelConfig.isCustom(id);
		if (!isKnownCustom && this.modelRuntime.getProvider(id) !== undefined) {
			throw new InvalidProviderError(`Provider ID conflicts with a built-in provider: ${id}`);
		}
		const name = input.name.trim();
		if (name.length === 0) {
			throw new InvalidProviderError("Provider name is required");
		}
		const baseUrl = normalizeBaseUrl(input.baseUrl);
		if (baseUrl === undefined) {
			throw new InvalidProviderError("Base URL is required");
		}
		const api = input.api.trim();
		if (!KNOWN_APIS.includes(api)) {
			throw new InvalidProviderError(`Unsupported API protocol: ${api}`);
		}
		const models = input.models.map((model) => ({ ...model, id: model.id.trim() }));
		if (models.length === 0) {
			throw new InvalidProviderError("At least one model is required");
		}
		for (const model of models) {
			if (model.id.length === 0) {
				throw new InvalidProviderError("Model ID is required");
			}
		}
		await this.modelConfig.saveProvider({ id, name, baseUrl, api, models });
		this.customBaseUrls[id] = baseUrl;
		await this.modelRuntime.refresh({ allowNetwork: false });
	}

	/** 删除一个自定义提供方：配置、凭证与运行态一起清掉。 */
	async removeCustomProvider(providerId: string): Promise<void> {
		if (!(await this.modelConfig.isCustom(providerId))) {
			throw new InvalidProviderError(`Not a custom provider: ${providerId}`);
		}
		await this.modelConfig.removeProvider(providerId);
		delete this.customBaseUrls[providerId];
		await this.credentials.delete(providerId);
		await this.modelRuntime.removeRuntimeApiKey(providerId);
		await this.modelRuntime.refresh({ allowNetwork: false });
	}

	/**
	 * 设置某个提供方的接口地址。
	 *
	 * 空串恢复默认地址。地址写进 models.json，再注册到运行态，之后的请求立刻按新地址走；
	 * 已经在跑的会话切换模型后同样生效。
	 */
	async setProviderBaseUrl(providerId: string, value: string): Promise<void> {
		const applied = await this.modelConfig.setBaseUrl(providerId, value);
		if (applied === undefined) {
			delete this.baseUrlOverrides[providerId];
			this.modelRuntime.unregisterProvider(providerId);
			// 撤掉覆写之后模型目录要重新组合一次,否则读到的仍是旧地址
			await this.modelRuntime.refresh({ allowNetwork: false });
			return;
		}
		this.baseUrlOverrides[providerId] = applied;
		this.modelRuntime.registerProvider(providerId, { baseUrl: applied });
	}

	/**
	 * 保存 API key。
	 *
	 * 先写进凭证文件，再让运行态立刻用上：写盘保证重启后还在，运行态更新保证当前会话
	 * 马上就能调用。密钥不回显，读回来只有是否已配置与来源。
	 */
	async saveCredential(providerId: string, apiKey: string): Promise<void> {
		const trimmed = apiKey.trim();
		if (trimmed.length === 0) {
			throw new Error("Credential cannot be empty");
		}
		await this.credentials.modify(providerId, async () => ({ type: "api_key", key: trimmed }));
		await this.modelRuntime.setRuntimeApiKey(providerId, trimmed);
	}

	/**
	 * 用指定模型发一次最小请求。
	 *
	 * 请求只带一句话与很小的输出上限，用来确认凭证、地址与网络是否真的可用；耗时按整次调用
	 * 计。失败不抛错，把原因带回给界面显示。
	 */
	async testModel(ref: ModelRef): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
		const model = this.modelRuntime.getModel(ref.provider, ref.id);
		if (!model) {
			return { ok: false, latencyMs: 0, message: `unknown model: ${ref.provider}/${ref.id}` };
		}
		const started = Date.now();
		try {
			const reply = await this.modelRuntime.completeSimple(
				model,
				{ messages: [{ role: "user", content: [{ type: "text", text: "ping" }], timestamp: Date.now() }] },
				{ maxTokens: 16 },
			);
			const latencyMs = Date.now() - started;
			if (reply.stopReason === "error") {
				return { ok: false, latencyMs, message: reply.errorMessage ?? "Request failed" };
			}
			return { ok: true, latencyMs };
		} catch (error) {
			return {
				ok: false,
				latencyMs: Date.now() - started,
				message: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/** 删除提供方的凭证：文件与运行态一起删。 */
	async deleteCredential(providerId: string): Promise<void> {
		await this.credentials.delete(providerId);
		await this.modelRuntime.removeRuntimeApiKey(providerId);
	}

	/** 目录里的全部模型，含未配置凭证的模型，是否可用由调用方判断。 */
	models(providerId?: string): ModelInfo[] {
		return this.modelRuntime.getModels(providerId).map(toModelInfo);
	}

	/** 已配置凭证的模型，用于模型选择器的可选项。 */
	async availableModels(): Promise<ModelInfo[]> {
		const models = await this.modelRuntime.getAvailable();
		return models.map(toModelInfo);
	}

	findModel(ref: ModelRef): ModelInfo | undefined {
		const model = this.modelRuntime.getModel(ref.provider, ref.id);
		return model ? toModelInfo(model) : undefined;
	}

	/**
	 * 扫描会话目录，取出含会话的工作目录。
	 *
	 * 只读每个会话文件的第一行，不校验目录是否存在，坏文件跳过。
	 */
	async scanProjects(): Promise<SessionProject[]> {
		return await scanSessionProjects({
			sessionsDir: this.sessionsDir,
		});
	}

	/**
	 * 列出会话。指定 cwd 时只列该目录的会话，否则列出全部。
	 *
	 * 摘要由缓存给出：没变过的文件不重读，会话目录到 GB 级时也不会卡住。
	 */
	async listSessions(cwd?: string): Promise<SessionSummary[]> {
		return await this.sessionCatalog.list(cwd);
	}

	/** 会话文件变了，丢掉它的摘要缓存，下次取时重读。 */
	invalidateSession(file: string): void {
		this.sessionCatalog.invalidate(file);
	}

	/** 单个会话文件的摘要，读盘结果进缓存。文件不是会话文件时为空。 */
	async sessionSummary(file: string): Promise<SessionSummary | undefined> {
		return await this.sessionCatalog.summaryOf(file);
	}

	/** 背景补齐名字没定下来的会话，返回变得不一样的几条。 */
	async fillSessionNames(): Promise<SessionSummary[]> {
		return await this.sessionCatalog.fillNames();
	}

	/** 新建会话。会话文件立即建立，后续每条完成的消息追加写盘。 */
	async create(options: PiAgentLaunchOptions = {}): Promise<PiAgent> {
		this.assertAlive();
		const cwd = options.cwd ?? process.cwd();
		const sessionDir = options.sessionDir ?? this.sessionDir;
		const sessionManager = sessionDir ? SessionManager.create(cwd, sessionDir) : SessionManager.create(cwd);
		const agent = await this.launch(sessionManager, options, {
			model: options.model,
			thinkingLevel: this.thinkingLevelFor(options.model, options.thinkingLevel),
			tools: options.tools,
			excludeTools: options.excludeTools,
			name: options.name,
		});
		return agent;
	}

	/**
	 * 会话文件里的会话标识。
	 *
	 * 建立会话要先知道它的 id 才能确定登记键，而 id 在文件头部，这里只读一小段。
	 * 文件不是会话文件时抛错。
	 */
	async peekSessionId(file: string): Promise<string> {
		return (await readSessionHeader(file)).id;
	}

	/** 会话文件头部的目录，文件不在了时抛出。 */
	async peekSessionCwd(file: string): Promise<string> {
		return normalizeProjectPath((await readSessionHeader(file)).cwd);
	}

	/** 打开已有会话。模型回退等提示通过 PiAgent 的 fallbackNotice 取得。 */
	async open(options: OpenPiAgentOptions): Promise<PiAgent> {
		this.assertAlive();
		const sessionManager = SessionManager.open(options.sessionFile, options.sessionDir, options.cwd);
		return await this.launch(sessionManager, options, {});
	}

	/**
	 * 分叉出新会话，原会话不受影响。
	 *
	 * entryId 缺省时取会话的叶子，复制整条活动分支；会话还没有任何条目时无从分叉。
	 */
	async fork(options: ForkPiAgentOptions): Promise<PiAgent> {
		this.assertAlive();
		const source = SessionManager.open(options.sessionFile, options.sessionDir, options.cwd);
		const entryId = options.entryId ?? source.getLeafId() ?? undefined;
		if (entryId === undefined) {
			throw new Error("Session has no messages and cannot be forked");
		}
		const forked = source.createBranchedSession(entryId);
		if (!forked) {
			throw new Error(`cannot fork session ${options.sessionFile} at entry ${entryId}`);
		}
		return await this.open({ ...options, sessionFile: forked });
	}

	/** 关闭工厂，之后不再建会话。已建会话的回收由调用方负责。 */
	dispose(): void {
		this.disposed = true;
	}

	private assertAlive(): void {
		if (this.disposed) {
			throw new Error("Session factory is closed");
		}
	}

	private resolveModel(ref: ModelRef) {
		const model = this.modelRuntime.getModel(ref.provider, ref.id);
		if (!model) {
			throw new Error(`unknown model: ${ref.provider}/${ref.id}`);
		}
		return model;
	}

	/** 按模型能力校验新建会话的思考档位。 */
	private thinkingLevelFor(
		ref: ModelRef | undefined,
		level: ThinkingLevel | undefined,
	): ThinkingLevel | undefined {
		if (ref === undefined) {
			return level;
		}
		return thinkingLevelForModel(this.modelRuntime.getModel(ref.provider, ref.id), level);
	}

	/** 建会话的共同部分。 */
	private async launch(
		sessionManager: SessionManager,
		options: PiAgentLaunchOptions | OpenPiAgentOptions,
		tuning: {
			model?: ModelRef;
			thinkingLevel?: ThinkingLevel;
			tools?: string[];
			excludeTools?: string[];
			name?: string;
		},
	): Promise<PiAgent> {
		const cwd = sessionManager.getCwd();
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir: this.agentDir,
			extensionFactories: [...BUILTIN_EXTENSIONS, ...(options.extensionFactories ?? [])],
			extensionsOverride: prioritizeBuiltinExtensions,
			noExtensions: options.noExtensions,
		});
		// 项目级扩展与 MCP 配置只在目录被信任时加载；没做过决定的一律按不信任处理
		await resourceLoader.reload({ resolveProjectTrust: async () => this.trustStore.get(cwd) === true });

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
		const ui =
			options.deferInitialization && options.uiContext === undefined
				? new ExtensionUi(session.extensionRunner.getUIContext())
				: undefined;
		const agent: PiAgent = new PiAgent({
			session,
			modelRuntime: this.modelRuntime,
			modelFallbackMessage,
			extensionIssues: [
				...extensionsResult.errors.map((issue) => `${issue.path}: ${issue.error}`),
				...(extensionsResult.warnings ?? []).map((issue) => `${issue.path}: ${issue.warning}`),
			],
			onError,
			ui,
			initialize: () =>
				session.bindExtensions({
					uiContext: ui?.context ?? options.uiContext,
					mode: "rpc",
					abortHandler: () => {
						void agent.abort();
					},
					onError: (error) => onError?.(error),
				}),
		});

		if (tuning.name) {
			session.setSessionName(tuning.name);
		}

		if (!options.deferInitialization) {
			try {
				await agent.initialize();
			} catch (error) {
				agent.dispose();
				throw error;
			}
		}
		return agent;
	}
}
