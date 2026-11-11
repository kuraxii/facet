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
	type InlineExtension,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ModelInfo, ModelRef, ProviderInfo, SessionSummary, ThinkingLevel } from "@facet/protocol";
import { toModelInfo } from "./convert.ts";
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

export class PiAgentFactory {
	/** 全局配置目录 */
	readonly agentDir: string;
	/** 会话文件目录，未指定时按工作目录分组 */
	readonly sessionDir: string | undefined;
	private readonly modelRuntime: ModelRuntime;
	private readonly onError: ((error: unknown) => void) | undefined;
	private disposed = false;

	private constructor(modelRuntime: ModelRuntime, options: PiAgentFactoryOptions, agentDir: string) {
		this.modelRuntime = modelRuntime;
		this.agentDir = agentDir;
		this.sessionDir = options.sessionDir;
		this.onError = options.onError;
	}

	/** 建立共享资源。凭证与模型配置的路径由 agentDir 推出。 */
	static async create(options: PiAgentFactoryOptions = {}): Promise<PiAgentFactory> {
		const agentDir = applyAgentDir(options.agentDir);
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
			allowModelNetwork: options.allowModelNetwork,
		});
		return new PiAgentFactory(modelRuntime, options, agentDir);
	}

	/** 提供方清单，附带是否已配置凭证，用于设置面板与模型选择器分组。 */
	providers(): ProviderInfo[] {
		return this.modelRuntime.getProviders().map((provider) => ({
			id: provider.id,
			name: provider.name,
			authenticated: this.modelRuntime.hasConfiguredAuth(provider.id),
			modelCount: provider.getModels().length,
		}));
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
			name: info.name,
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
			thinkingLevel: options.thinkingLevel,
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
