/**
 * 提供方登录的编排。
 *
 * pi 把登录拆成两半：provider 自己走流程（浏览器授权、设备码、粘贴回调地址各不相同），
 * 宿主只管把过程中要问的、要显示的转给界面。这里就是那一层转接——把 `prompt` 变成一条
 * 待答请求、把 `notify` 变成一条进展事件，再把界面的回答送回去。
 *
 * 两条约束写在实现里：
 *
 * - 同一提供方同时只跑一条登录：浏览器回调要占固定的回环端口，并发登录只会互相打断。
 * - 中止只有一条路：取消整条登录靠 `AbortSignal`，单个 prompt 被 provider 收掉时（回调先
 *   回来就是这样）只撤那一条请求，不连带中止。
 */
import { randomUUID } from "node:crypto";
import type { AuthEvent, AuthInteraction, AuthPrompt, Credential } from "@earendil-works/pi-ai";
import type {
	ProviderLoginEvent,
	ProviderLoginOption,
	ProviderLoginPrompt,
	ProviderLoginType,
} from "@facet/protocol";

/** 登录用到的运行时能力，收窄成结构类型以便测试注入假实现。 */
export interface ProviderLoginRuntime {
	login(
		providerId: string,
		type: ProviderLoginType,
		interaction: AuthInteraction,
		options: { getDeviceId?: () => string },
	): Promise<Credential>;
}

/** 一条登录的对外形状。 */
export interface ProviderLoginStart {
	/** 这一次登录的标识，后续应答与取消都用它 */
	loginId: string;
}

/** 一条进展：属于哪次登录、哪个提供方，以及具体是什么。 */
export interface ProviderLoginUpdate {
	loginId: string;
	providerId: string;
	event: ProviderLoginEvent;
}

/** 登录进展的订阅方。 */
export type ProviderLoginListener = (update: ProviderLoginUpdate) => void;

/** 同一条提供方已有登录在跑。 */
export class ProviderLoginBusyError extends Error {
	constructor(providerId: string) {
		super(`A login is already in progress for ${providerId}`);
	}
}

/** 一步等待回答的请求。 */
interface PendingPrompt {
	/** 回答这一步；同一 promptId 重复应答由这里挡住 */
	settle(value: string): void;
	/** 收掉这一步：被 provider 撤销或整条登录中止 */
	abandon(reason: Error): void;
}

/** 一条正在进行的登录。 */
interface ActiveLogin {
	loginId: string;
	providerId: string;
	/** 中止整条登录 */
	controller: AbortController;
	pending: Map<string, PendingPrompt>;
}

export class ProviderLoginService {
	private readonly runtime: ProviderLoginRuntime;
	/** 给 pi 的稳定设备标识；只有部分流程（OpenAI 的账号登录）要它 */
	private readonly getDeviceId: (() => string) | undefined;
	/** 进行中的登录，按 loginId 索引 */
	private readonly active = new Map<string, ActiveLogin>();
	private readonly listeners = new Set<ProviderLoginListener>();

	constructor(options: { runtime: ProviderLoginRuntime; getDeviceId?: () => string }) {
		this.runtime = options.runtime;
		this.getDeviceId = options.getDeviceId;
	}

	/** 订阅进展，返回取消订阅函数。 */
	subscribe(listener: ProviderLoginListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * 开始一条登录。
	 *
	 * 立刻返回 `loginId`，流程在后台继续，进展与终局都走事件；失败不抛到这里，界面按事件里
	 * 的 `failed` / `cancelled` 收尾。
	 */
	start(providerId: string, authType: ProviderLoginType = "api_key"): ProviderLoginStart {
		for (const login of this.active.values()) {
			if (login.providerId === providerId) {
				throw new ProviderLoginBusyError(providerId);
			}
		}
		const login: ActiveLogin = {
			loginId: randomUUID(),
			providerId,
			controller: new AbortController(),
			pending: new Map(),
		};
		this.active.set(login.loginId, login);
		void this.run(login, authType);
		return { loginId: login.loginId };
	}

	/**
	 * 回答一步。
	 *
	 * 返回假表示这一步已经不需要回答了（浏览器回调先回来，或整条已经收尾），界面按什么都没
	 * 发生处理。`value` 为 null 表示用户在界面上放弃：整条登录一起中止。
	 */
	respond(loginId: string, promptId: string, value: string | null): boolean {
		const login = this.active.get(loginId);
		if (login === undefined) {
			return false;
		}
		if (value === null) {
			this.cancel(loginId);
			return false;
		}
		const pending = login.pending.get(promptId);
		if (pending === undefined) {
			return false;
		}
		login.pending.delete(promptId);
		pending.settle(value);
		return true;
	}

	/** 中止一条登录。已经在收尾的按取消处理，返回假。 */
	cancel(loginId: string): boolean {
		const login = this.active.get(loginId);
		if (login === undefined) {
			return false;
		}
		// 先撤掉待答的请求，再中止流程：这样界面不会留下一条永远等不到答案的输入框
		this.abandonPending(login, new Error("Login cancelled"));
		login.controller.abort();
		return true;
	}

	/** 收尾时清空订阅。 */
	dispose(): void {
		for (const login of [...this.active.values()]) {
			this.cancel(login.loginId);
		}
		this.active.clear();
		this.listeners.clear();
	}

	private async run(login: ActiveLogin, authType: ProviderLoginType): Promise<void> {
		const interaction: AuthInteraction = {
			signal: login.controller.signal,
			prompt: (prompt) => this.askPrompt(login, prompt),
			notify: (event) => this.publishNotify(login, event),
		};
		try {
			await this.runtime.login(login.providerId, authType, interaction, {
				...(this.getDeviceId === undefined ? {} : { getDeviceId: this.getDeviceId }),
			});
			this.emit(login, { type: "done" });
		} catch (error) {
			// 流程自己的中止（含 provider 取消)与用户取消都落到 cancelled,其余才是真失败
			if (login.controller.signal.aborted) {
				this.emit(login, { type: "cancelled" });
			} else {
				this.emit(login, { type: "failed", message: error instanceof Error ? error.message : String(error) });
			}
		} finally {
			this.abandonPending(login, new Error("Login finished"));
			this.active.delete(login.loginId);
		}
	}

	private askPrompt(login: ActiveLogin, input: AuthPrompt): Promise<string> {
		const promptId = randomUUID();
		const prompt = toWirePrompt(promptId, input);
		return new Promise<string>((resolve, reject) => {
			// provider 自己撤这一步时只收掉这一条，不中止整条登录：浏览器回调先回来就是这样
			const onAbort = (): void => {
				if (!login.pending.delete(promptId)) {
					return;
				}
				this.emit(login, { type: "promptResolved", promptId });
				reject(new Error("Login cancelled"));
			};
			input.signal?.addEventListener("abort", onAbort, { once: true });
			if (input.signal?.aborted === true) {
				onAbort();
				return;
			}
			login.pending.set(promptId, {
				settle: (value) => {
					input.signal?.removeEventListener("abort", onAbort);
					resolve(value);
				},
				abandon: (reason) => {
					input.signal?.removeEventListener("abort", onAbort);
					this.emit(login, { type: "promptResolved", promptId });
					reject(reason);
				},
			});
			this.emit(login, { type: "prompt", prompt });
		});
	}

	private abandonPending(login: ActiveLogin, reason: Error): void {
		const pending = [...login.pending.values()];
		login.pending.clear();
		for (const item of pending) {
			item.abandon(reason);
		}
	}

	/** `notify` 是同步回调，事件顺序就是 provider 调用的顺序，这里原样转成线格式。 */
	private publishNotify(login: ActiveLogin, event: AuthEvent): void {
		if (event.type === "info") {
			this.emit(login, {
				type: "info",
				message: event.message,
				...(event.links === undefined ? {} : { links: event.links.map((link) => ({ ...link })) }),
			});
			return;
		}
		if (event.type === "auth_url") {
			this.emit(login, {
				type: "authUrl",
				url: event.url,
				...(event.instructions === undefined ? {} : { instructions: event.instructions }),
			});
			return;
		}
		if (event.type === "device_code") {
			this.emit(login, {
				type: "deviceCode",
				userCode: event.userCode,
				verificationUri: event.verificationUri,
				...(event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds }),
				...(event.expiresInSeconds === undefined ? {} : { expiresInSeconds: event.expiresInSeconds }),
			});
			return;
		}
		this.emit(login, { type: "progress", message: event.message });
	}

	private emit(login: ActiveLogin, event: ProviderLoginEvent): void {
		const update: ProviderLoginUpdate = { loginId: login.loginId, providerId: login.providerId, event };
		for (const listener of [...this.listeners]) {
			listener(update);
		}
	}
}

/** pi 的 prompt 转成线格式：`manual_code` 与 `text` 都是单行输入，只是占位与提示不同。 */
function toWirePrompt(promptId: string, input: AuthPrompt): ProviderLoginPrompt {
	// select 没有 placeholder，其余三种都有
	const placeholder = input.type === "select" ? undefined : input.placeholder;
	const base = {
		promptId,
		message: input.message,
		...(placeholder === undefined ? {} : { placeholder }),
	};
	if (input.type === "select") {
		const options: ProviderLoginOption[] = input.options.map((option) => ({
			id: option.id,
			label: option.label,
			...(option.description === undefined ? {} : { description: option.description }),
		}));
		return { ...base, kind: "select", options };
	}
	if (input.type === "secret") {
		return { ...base, kind: "secret" };
	}
	if (input.type === "manual_code") {
		return { ...base, kind: "manualCode" };
	}
	return { ...base, kind: "text" };
}
