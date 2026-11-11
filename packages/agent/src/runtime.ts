/**
 * 会话工厂与共享资源。
 *
 * 进程内只建一份 ModelRuntime，凭证、模型目录与可用性检查由所有会话共用；
 * 每个会话自己的资源加载器按工作目录单独构造。这里不登记建好的会话，
 * 谁活着、何时回收由设备侧决定。
 */
import { open } from "node:fs/promises";
import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionUIContext,
	hasTrustRequiringProjectResources,
	type InlineExtension,
	ModelRuntime,
	ProjectTrustStore,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ModelInfo, ModelRef, ProviderInfo, SessionSummary, ThinkingLevel } from "@facet/protocol";
import { toModelInfo } from "./convert.ts";
import { FileCredentialStore } from "./credential-store.ts";
import {
	type CustomProviderEntry,
	InvalidProviderError,
	ModelConfigStore,
	normalizeBaseUrl,
} from "./model-config-store.ts";
import { applyAgentDir } from "./paths.ts";
import { PiAgent } from "./pi-agent.ts";
import { normalizeProjectPath, type SessionProject, scanSessionProjects } from "./projects.ts";

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
	uiContext?: ExtensionUIContext;
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
	stored: "本机保存的密钥",
	runtime: "本次运行里设置的密钥",
	environment: "环境变量",
	fallback: "内置缺省凭证",
	models_json_key: "模型配置里的密钥",
	models_json_command: "模型配置里的取密钥命令",
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

export class PiAgentFactory {
	/** 全局配置目录 */
	readonly agentDir: string;
	/** 会话文件目录，未指定时按工作目录分组 */
	readonly sessionDir: string | undefined;
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
		this.onError = options.onError;
		this.trustStore = new ProjectTrustStore(agentDir);
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
				"提供方标识只能用小写字母、数字、点、下划线与连字符，且以字母或数字开头",
			);
		}
		const isKnownCustom = await this.modelConfig.isCustom(id);
		if (!isKnownCustom && this.modelRuntime.getProvider(id) !== undefined) {
			throw new InvalidProviderError(`提供方标识与内置提供方重名:${id}`);
		}
		const name = input.name.trim();
		if (name.length === 0) {
			throw new InvalidProviderError("提供方名称不能为空");
		}
		const baseUrl = normalizeBaseUrl(input.baseUrl);
		if (baseUrl === undefined) {
			throw new InvalidProviderError("接口地址不能为空");
		}
		const api = input.api.trim();
		if (!KNOWN_APIS.includes(api)) {
			throw new InvalidProviderError(`接口协议不支持:${api}`);
		}
		const models = input.models.map((model) => ({ ...model, id: model.id.trim() }));
		if (models.length === 0) {
			throw new InvalidProviderError("至少要有一个模型");
		}
		for (const model of models) {
			if (model.id.length === 0) {
				throw new InvalidProviderError("模型标识不能为空");
			}
		}
		await this.modelConfig.saveProvider({ id, name, baseUrl, api, models });
		this.customBaseUrls[id] = baseUrl;
		await this.modelRuntime.refresh({ allowNetwork: false });
	}

	/** 删除一个自定义提供方：配置、凭证与运行态一起清掉。 */
	async removeCustomProvider(providerId: string): Promise<void> {
		if (!(await this.modelConfig.isCustom(providerId))) {
			throw new InvalidProviderError(`不是自定义提供方:${providerId}`);
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
			throw new Error("凭证内容不能为空");
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
				return { ok: false, latencyMs, message: reply.errorMessage ?? "请求失败" };
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
			sessionsDir: this.sessionDir ?? join(this.agentDir, "sessions"),
		});
	}

	/** 列出会话。指定 cwd 时只列该目录的会话，否则列出全部。 */
	async listSessions(cwd?: string): Promise<SessionSummary[]> {
		const infos = cwd
			? await SessionManager.list(cwd, this.sessionDir)
			: this.sessionDir
				? await SessionManager.listAll(this.sessionDir)
				: await SessionManager.listAll();
		return infos.map((info) => ({
			id: info.id,
			path: info.path,
			cwd: normalizeProjectPath(info.cwd),
			// pi 会用 null 表示没有名字，协议里缺省就是 undefined
			name: info.name ?? undefined,
			parentSessionPath: info.parentSessionPath,
			created: info.created.getTime(),
			modified: info.modified.getTime(),
			messageCount: info.messageCount,
			firstMessage: info.firstMessage,
		}));
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
	 * 只读会话文件的第一行,取出会话 id。
	 *
	 * 建立会话要先知道它的 id 才能确定登记键,而 id 在文件头部,这里只读一小段。
	 * 文件不是会话文件时抛错。
	 */
	async peekSessionId(file: string): Promise<string> {
		let handle: Awaited<ReturnType<typeof open>>;
		try {
			handle = await open(file, "r");
		} catch (error) {
			// 文件被删或路径写错是最常见的原因,给一句能看懂的说明
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new Error(`会话文件不存在:${file}`);
			}
			throw error;
		}
		try {
			const buffer = Buffer.alloc(4096);
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
			const text = buffer.subarray(0, bytesRead).toString("utf8");
			const line = text.slice(0, text.indexOf("\n") < 0 ? text.length : text.indexOf("\n"));
			let header: { type?: unknown; id?: unknown };
			try {
				header = JSON.parse(line) as { type?: unknown; id?: unknown };
			} catch {
				throw new Error(`不是会话文件:${file}`);
			}
			if (header.type !== "session" || typeof header.id !== "string") {
				throw new Error(`不是会话文件:${file}`);
			}
			return header.id;
		} finally {
			await handle.close();
		}
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
			throw new Error("会话还没有消息,无法分叉");
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
			throw new Error("会话工厂已关闭");
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
			extensionFactories: [...(options.extensionFactories ?? [])],
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
		const agent = new PiAgent({
			session,
			modelRuntime: this.modelRuntime,
			modelFallbackMessage,
			extensionIssues: [
				...extensionsResult.errors.map((issue) => `${issue.path}: ${issue.error}`),
				...(extensionsResult.warnings ?? []).map((issue) => `${issue.path}: ${issue.warning}`),
			],
			onError,
		});

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

		return agent;
	}
}
