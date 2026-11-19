/**
 * 每台主机一套的运行时。
 *
 * 传输、会话客户端、终端客户端与连接链路都绑死在一台主机上：切到别的主机只是换哪一套在
 * 前台，后台那套照常收动作、照常续订、掉线照常按退避重连，切回来接着用。只有用户显式
 * 断开某台主机时才拆掉它。
 *
 * 这里不碰 React，也不读界面语言：连接态、主机上的设置与模型目录都存在自己的状态里，
 * 组件通过 `subscribe` 拿快照。这样切走再切回来看到的还是同一份，只是重新挂了一次界面。
 */
import {
	ConnectionLink,
	type HostHandshake,
	type LinkHooks,
	type LinkSnapshot,
	SessionClient,
	TerminalClient,
} from "@facet/client-core";
import { DEFAULT_SETTINGS, type FacetSettings, type ModelInfo } from "@facet/protocol";
import { type HostChannelBridge, makeTransport } from "./host-connection.ts";
import { createWorkspaceSnapshot, type HostWorkspaceSnapshot } from "./workspace-state.ts";

/** 连接屏显示哪一屏。ready 表示这台主机已经可以收发。 */
export type HostPhase = "connecting" | "ready" | "failed";

/** 一次连接失败：给界面看的说明，以及分类码。 */
export interface HostFailure {
	/** 失败原因，来自传输层或主进程 */
	readonly message: string;
	/** 分类码，`need_password` 表示要问一次 SSH 密码 */
	readonly code: string | undefined;
}

/** 要问 SSH 密码的那台主机。 */
export interface SshAuthPrompt {
	/** 连接目标，提交密码时原样带上 */
	readonly target: string;
	/** 弹窗里显示的主机名 */
	readonly host: string;
	/** 上一次是不是已经用密码试过，弹窗据此提示重输 */
	readonly isRetry: boolean;
}

/** 主机上的模型目录与各提供方的凭证状态。 */
export interface ProviderCatalog {
	/** 可选的模型，只列已经配好凭证的提供方 */
	readonly models: readonly ModelInfo[];
	/** 提供方标识到是否可用，用来标注当前模型 */
	readonly auth: Record<string, boolean>;
}

/** 运行时的可观察状态。字段变化时整体换一个新对象。 */
export interface HostRuntimeState {
	/** 连接屏显示哪一屏 */
	readonly phase: HostPhase;
	/** 最近一次连不上的原因 */
	readonly failure: HostFailure | undefined;
	/** 握手结果，连上之前为空 */
	readonly handshake: HostHandshake | undefined;
	/** 主机上的偏好设置 */
	readonly settings: FacetSettings;
	/** 模型目录与凭证状态 */
	readonly catalog: ProviderCatalog;
	/** 链路自己的状态：是否在退避重连、下一次什么时候试 */
	readonly link: LinkSnapshot;
	/** 这台主机连上过的次数；变一次上层就把属于主机的数据重取一遍 */
	readonly connectEpoch: number;
	/** 要问 SSH 密码的那台主机 */
	readonly sshAuthPrompt: SshAuthPrompt | undefined;
}

/** 运行时给界面留的钩子。字段在组件挂载之后才填上。 */
export interface HostRuntimeHandlers {
	/** 续订回不来（典型情形是会话文件已经不在了）时退回没有会话的状态 */
	onSessionLost?: () => void;
}

/** 建一个运行时需要的环境。 */
export interface HostRuntimeOptions {
	/** 主进程给的通道桥 */
	bridge: HostChannelBridge;
	/** 主机端点，与主机清单里的写法一致 */
	endpoint: string;
	/** 是不是本机 */
	isLocal: boolean;
	/** 读这次握手要用的 SSH 密码 */
	readPassword?: () => string | undefined;
}

/** 端点给人看的写法，与主机清单里的规则一致。 */
function labelOf(endpoint: string): string {
	return endpoint.toLowerCase().startsWith("ssh://") ? endpoint.slice("ssh://".length) : endpoint;
}

export class HostRuntime {
	/** 主机端点 */
	readonly endpoint: string;
	/** 是不是本机 */
	readonly isLocal: boolean;
	/** 这台主机的传输，一个实例只连一台主机 */
	readonly transport: ReturnType<typeof makeTransport>;
	/** 会话客户端 */
	readonly client: SessionClient;
	/** 终端客户端 */
	readonly terminalClient: TerminalClient;
	/** 连接链路：退避重连、续订与状态快照都在它手里 */
	readonly connection: ConnectionLink;
	/** 链路回调，字段可以在构造之后替换 */
	readonly linkHooks: LinkHooks = {};
	/** 界面挂上来的钩子 */
	readonly handlers: HostRuntimeHandlers = {};
	/** 这台主机的工作区快照：切走时留着，切回来接着用 */
	readonly workspace: HostWorkspaceSnapshot = createWorkspaceSnapshot();

	private state: HostRuntimeState;
	private readonly listeners = new Set<(state: HostRuntimeState) => void>();
	/** 正在进行的连接，重复调用共用同一次 */
	private connecting: Promise<void> | undefined;
	/** 这次握手要用的密码，由密码弹窗填进来 */
	private password: string | undefined;
	/** 本机主机重新拉起后换地址的通知订阅 */
	private readonly stopLocalHost: (() => void) | undefined;
	private disposed = false;

	constructor(options: HostRuntimeOptions) {
		this.endpoint = options.endpoint;
		this.isLocal = options.isLocal;
		this.password = options.readPassword?.();
		this.transport = makeTransport(options.bridge, options.endpoint, () => this.password);
		this.client = new SessionClient({ transport: this.transport, pageSize: 200, initialPages: 2 });
		this.terminalClient = new TerminalClient({ transport: this.transport });
		this.connection = new ConnectionLink({
			transport: this.transport,
			session: this.client,
			hooks: this.linkHooks,
			// 缺密码时重试没有意义，停下来让界面问一次
			retryable: (error) => (error as { code?: unknown } | undefined)?.code !== "need_password",
		});
		this.state = {
			phase: "connecting",
			failure: undefined,
			handshake: undefined,
			settings: DEFAULT_SETTINGS,
			catalog: { models: [], auth: {} },
			link: this.connection.snapshot,
			connectEpoch: 0,
			sshAuthPrompt: undefined,
		};

		this.connection.subscribe((link) => {
			this.patch({ link });
		});
		this.linkHooks.onReady = (handshake, resumeFailed) => {
			void this.handleReady(handshake, resumeFailed);
		};
		this.linkHooks.onFailure = (error, willRetry) => {
			if (willRetry) {
				// 重连失败的原因留在控制台，便于排查连不上的问题
				console.log("[connection] Retry failed", error instanceof Error ? error.message : String(error));
				return;
			}
			this.handleFailure(error);
		};
		// 本机主机被重新拉起后端口与令牌都会变：按新的发现记录再握手，会话由链路续订
		this.stopLocalHost = this.isLocal
			? options.bridge.onLocalHostChanged(() => {
					if (this.disposed) {
						return;
					}
					// 会话还在屏幕上时不退回连接屏，只把状态换成「重连中」
					this.patch({ phase: this.state.phase === "failed" ? "connecting" : this.state.phase });
					void this.connection.reconnectNow();
				})
			: undefined;
	}

	/** 此刻的状态。内容没变时是同一个对象。 */
	getSnapshot(): HostRuntimeState {
		return this.state;
	}

	/** 订阅状态变化，返回取消订阅的函数。 */
	subscribe(listener: (state: HostRuntimeState) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** 这一次握手要用哪个密码；没有密码时清空。 */
	setPassword(password: string | undefined): void {
		this.password = password;
	}

	/** 已经握过手：切回这台主机时不必再连一次。 */
	get isReady(): boolean {
		return this.state.phase === "ready" && this.state.handshake !== undefined;
	}

	/**
	 * 连一次。
	 *
	 * 已经连着时直接返回，所以「切回后台主机」不会重复握手；正在连时共用同一次尝试。
	 * 连不上时状态落到 failed，密码类失败另外摆出密码框。
	 */
	async connect(): Promise<void> {
		if (this.disposed || this.isReady) {
			return;
		}
		if (this.connecting !== undefined) {
			return await this.connecting;
		}
		this.patch({ phase: "connecting", failure: undefined, sshAuthPrompt: undefined });
		this.connecting = (async () => {
			try {
				const handshake = await this.connection.open();
				await this.handleReady(handshake, false);
			} catch {
				// 失败已经由 linkHooks.onFailure 翻成状态，这里只把这次尝试收尾
			} finally {
				this.connecting = undefined;
			}
		})();
		return await this.connecting;
	}

	/** 立刻重连，取消等待中的退避。 */
	reconnectNow(): void {
		if (this.disposed) {
			return;
		}
		this.patch({ phase: "connecting", failure: undefined });
		void this.connection.reconnectNow();
	}

	/** 密码框里填的密码：记住这一份再连一次。 */
	submitPassword(password: string): void {
		this.setPassword(password);
		this.patch({ sshAuthPrompt: undefined, phase: "connecting", failure: undefined });
		void this.connection.disconnect();
		void this.connect();
	}

	/** 关掉密码框：停在连不上主机那一屏，重试会再问一次。 */
	cancelPasswordPrompt(): void {
		this.patch({
			sshAuthPrompt: undefined,
			phase: "failed",
			failure: { message: "Login password required", code: "need_password" },
		});
	}

	/** 重取主机上的偏好设置。 */
	async refreshSettings(): Promise<FacetSettings> {
		const settings = await this.client.getSettings().catch(() => this.state.settings);
		this.patch({ settings });
		return settings;
	}

	/** 重取模型目录与各提供方的凭证状态。 */
	async refreshCatalog(): Promise<void> {
		const [models, providers] = await Promise.all([
			this.client.listAvailableModels().catch(() => []),
			this.client.listProviders().catch(() => []),
		]);
		this.patch({
			catalog: {
				models,
				auth: Object.fromEntries(providers.map((provider) => [provider.id, provider.authenticated])),
			},
		});
	}

	/** 设置页保存之后回填，不必再问主机。 */
	applySettings(next: FacetSettings): void {
		this.patch({ settings: next });
	}

	/**
	 * 拆掉这台主机。
	 *
	 * 先把订阅退掉（这时连接还在，主机才会注销它们），再关连接、丢状态与快照。
	 */
	async dispose(): Promise<void> {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.stopLocalHost?.();
		await this.client.disposeHost().catch(() => undefined);
		this.connection.dispose();
		this.listeners.clear();
	}

	/** 连上之后要做的事：登记握手、补齐终端订阅、取回主机级数据。 */
	private async handleReady(handshake: HostHandshake, resumeFailed: boolean): Promise<void> {
		if (this.disposed) {
			return;
		}
		this.terminalClient.start();
		this.patch({
			handshake,
			phase: "ready",
			failure: undefined,
			sshAuthPrompt: undefined,
			connectEpoch: this.state.connectEpoch + 1,
		});
		await Promise.all([this.refreshSettings(), this.refreshCatalog()]);
		if (resumeFailed) {
			this.handlers.onSessionLost?.();
		}
	}

	/** 连接失败：缺密码就摆出密码框，其余落到连不上那一屏。 */
	private handleFailure(error: unknown): void {
		const code = (error as { code?: unknown } | undefined)?.code;
		const message = error instanceof Error ? error.message : String(error);
		if (code === "need_password") {
			this.patch({
				phase: "connecting",
				failure: undefined,
				sshAuthPrompt: {
					target: this.endpoint,
					host: labelOf(this.endpoint),
					isRetry: this.password !== undefined && this.password.length > 0,
				},
			});
			return;
		}
		this.patch({ phase: "failed", failure: { message, code: typeof code === "string" ? code : undefined } });
	}

	/** 合并一次状态变更；内容没变就不通知。 */
	private patch(next: Partial<HostRuntimeState>): void {
		if (this.disposed) {
			return;
		}
		const merged: HostRuntimeState = { ...this.state, ...next };
		if (
			merged.phase === this.state.phase &&
			merged.failure === this.state.failure &&
			merged.handshake === this.state.handshake &&
			merged.settings === this.state.settings &&
			merged.catalog === this.state.catalog &&
			merged.link === this.state.link &&
			merged.connectEpoch === this.state.connectEpoch &&
			merged.sshAuthPrompt === this.state.sshAuthPrompt
		) {
			return;
		}
		this.state = merged;
		for (const listener of [...this.listeners]) {
			listener(merged);
		}
	}
}

/**
 * 一次渲染进程里活着的全部主机。
 *
 * 按端点存取：同一台主机只有一套运行时，切来切去拿到的都是它。断开是唯一会拆掉它的动作，
 * 它那台主机的工作区快照跟着一起丢。
 */
export class HostRuntimeRegistry {
	private readonly runtimes = new Map<string, HostRuntime>();

	/** 取一台主机的运行时，没有就建一个（不自动连接）。 */
	ensure(options: HostRuntimeOptions): HostRuntime {
		const existing = this.runtimes.get(options.endpoint);
		if (existing !== undefined) {
			return existing;
		}
		const runtime = new HostRuntime(options);
		this.runtimes.set(options.endpoint, runtime);
		return runtime;
	}

	/** 按端点取已经建好的运行时。 */
	get(endpoint: string): HostRuntime | undefined {
		return this.runtimes.get(endpoint);
	}

	/** 已经建好运行时的端点，界面据此标出哪几台在后台连着。 */
	endpoints(): readonly string[] {
		return [...this.runtimes.keys()];
	}

	/** 拆掉一台主机并忘掉它；工作区快照跟着运行时一起丢。 */
	async dispose(endpoint: string): Promise<void> {
		const runtime = this.runtimes.get(endpoint);
		this.runtimes.delete(endpoint);
		await runtime?.dispose();
	}

	/** 拆掉全部主机，窗口关闭时用。 */
	async disposeAll(): Promise<void> {
		const all = [...this.runtimes.values()];
		this.runtimes.clear();
		await Promise.all(all.map((runtime) => runtime.dispose()));
	}
}
