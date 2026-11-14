/** pi 的交互 API 与可序列化会话状态之间的适配。 */
import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import type { ExtensionUiState, NoticeLevel, UiNotice, UiPrompt, UiResponse } from "@facet/protocol";

type PromptInput =
	| { kind: "select"; title: string; options: string[] }
	| { kind: "confirm"; title: string; message: string }
	| { kind: "input"; title: string; placeholder?: string }
	| { kind: "editor"; title: string; prefill?: string };

type PendingPrompt = {
	/** 对外发布的请求。 */
	prompt: UiPrompt;
	/** 消费请求，同时清理 timer 和 AbortSignal listener。 */
	finish(response: UiResponse): void;
};

/** Promise、超时与中止的单一所有者；断线不改变待答请求。 */
export class ExtensionUi {
	/** 交给 bindExtensions 的 RPC 模式实现。 */
	readonly context: ExtensionUIContext;
	private readonly pending = new Map<string, PendingPrompt>();
	private editor: ExtensionUiState["editor"];
	private readonly notices: UiNotice[] = [];
	private readonly listeners = new Set<(state: ExtensionUiState) => void>();
	private readonly recentNotices = new Map<string, number>();
	private lifecycle: "active" | "cancelled" | "disposed" = "active";

	constructor(base: ExtensionUIContext) {
		this.context = {
			...base,
			select: async (title, options, opts) => {
				const result = await this.ask({ kind: "select", title, options: [...options] }, opts);
				return result.kind === "select" ? result.value : undefined;
			},
			confirm: async (title, message, opts) => {
				const result = await this.ask({ kind: "confirm", title, message }, opts);
				return result.kind === "confirm" && result.confirmed;
			},
			input: async (title, placeholder, opts) => {
				const result = await this.ask(
					{
						kind: "input",
						title,
						...(placeholder === undefined ? {} : { placeholder: stripVTControlCharacters(placeholder) }),
					},
					opts,
				);
				return result.kind === "input" ? result.value : undefined;
			},
			editor: async (title, prefill) => {
				const result = await this.ask({
					kind: "editor",
					title,
					...(prefill === undefined ? {} : { prefill }),
				});
				return result.kind === "editor" ? result.value : undefined;
			},
			notify: (message, level = "info") => this.notify(level, stripVTControlCharacters(message)),
			setEditorText: (text) => this.setEditor(text),
			pasteToEditor: (text) => this.setEditor(text),
		};
	}

	/** 当前操作是否已被停止；新操作 resume 后恢复。 */
	get isCancelled(): boolean {
		return this.lifecycle !== "active";
	}

	/** 快照保留发起顺序与完整预填内容。 */
	snapshot(): ExtensionUiState {
		return {
			prompts: [...this.pending.values()].map((item) => item.prompt),
			...(this.editor === undefined ? {} : { editor: this.editor }),
			notices: [...this.notices],
		};
	}

	/** 监听状态变化，返回退订函数。 */
	subscribe(listener: (state: ExtensionUiState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** 第一份有效应答生效；超时、重复与已取消的请求返回 false。 */
	respond(requestId: string, response: UiResponse): boolean {
		const pending = this.pending.get(requestId);
		if (pending === undefined) return false;
		if (pending.prompt.expiresAt !== undefined && Date.now() >= pending.prompt.expiresAt) {
			pending.finish({ kind: "cancel" });
			return false;
		}
		if (response.kind !== "cancel" && response.kind !== pending.prompt.kind) {
			throw new Error("应答类型与请求类型不一致");
		}
		if (
			pending.prompt.kind === "select" &&
			response.kind === "select" &&
			!pending.prompt.options.includes(response.value)
		) {
			throw new Error("选项不在请求列表中");
		}
		pending.finish(response);
		return true;
	}

	/** 取消全部请求；同一操作随后发起的询问也立即返回取消。 */
	cancel(): void {
		if (this.lifecycle === "disposed") return;
		this.lifecycle = "cancelled";
		for (const item of [...this.pending.values()]) item.finish({ kind: "cancel" });
	}

	/** 新操作开始时重新接受交互。 */
	resume(): void {
		if (this.lifecycle !== "disposed") this.lifecycle = "active";
	}

	/** 释放全部等待者与运行内状态，可重复调用。 */
	dispose(): void {
		this.cancel();
		this.lifecycle = "disposed";
		this.editor = undefined;
		this.listeners.clear();
		this.notices.length = 0;
		this.recentNotices.clear();
	}

	private ask(input: PromptInput, opts?: ExtensionUIDialogOptions): Promise<UiResponse> {
		if (this.lifecycle !== "active" || opts?.signal?.aborted) return Promise.resolve({ kind: "cancel" });
		if (this.pending.size >= 64) return Promise.resolve({ kind: "cancel" });
		const timeout = opts?.timeout;
		if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0))
			return Promise.resolve({ kind: "cancel" });
		const requestId = randomUUID();
		const expiresAt = timeout === undefined ? undefined : Date.now() + timeout;
		const prompt: UiPrompt = {
			...input,
			title: stripVTControlCharacters(input.title),
			...(input.kind === "confirm" ? { message: stripVTControlCharacters(input.message) } : {}),
			requestId,
			...(expiresAt === undefined ? {} : { expiresAt }),
		};
		return new Promise((resolve) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const onAbort = () => finish({ kind: "cancel" });
			const finish = (response: UiResponse) => {
				if (!this.pending.delete(requestId)) return;
				if (timer !== undefined) clearTimeout(timer);
				opts?.signal?.removeEventListener("abort", onAbort);
				resolve(response);
				this.publish();
			};
			// Node 的 timer 有单次时长上限，较长的超时按同一个截止时刻分段等待。
			const armTimer = () => {
				if (expiresAt === undefined) return;
				const remaining = expiresAt - Date.now();
				if (remaining <= 0) {
					onAbort();
					return;
				}
				timer = setTimeout(armTimer, Math.min(remaining, 2_147_483_647));
			};
			this.pending.set(requestId, { prompt, finish });
			opts?.signal?.addEventListener("abort", onAbort, { once: true });
			armTimer();
			this.publish();
		});
	}

	private setEditor(text: string): void {
		if (this.lifecycle !== "active") return;
		this.editor = { id: randomUUID(), text };
		this.publish();
	}

	private publish(): void {
		const state = this.snapshot();
		for (const listener of this.listeners) listener(state);
	}

	private notify(level: NoticeLevel, message: string): void {
		if (this.lifecycle === "disposed") return;
		const now = Date.now();
		for (const [key, time] of this.recentNotices) {
			if (now - time >= 5000) this.recentNotices.delete(key);
		}
		const key = `${level}:${message}`;
		if (this.recentNotices.has(key) || this.recentNotices.size >= 20) return;
		this.recentNotices.set(key, now);
		const existing = this.notices.findIndex((notice) => notice.level === level && notice.message === message);
		if (existing >= 0) this.notices.splice(existing, 1);
		this.notices.push({ id: randomUUID(), level, message });
		if (this.notices.length > 20) this.notices.shift();
		this.publish();
	}
}
