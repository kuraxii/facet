/**
 * 桌面本地状态存储引擎（对标 VS Code `FileStorage`）。
 *
 * 维护唯一一份内存快照与序列化串行写队列：常规改动合并防抖（100ms），内容未变时跳过磁盘 I/O；
 * 退出阶段通过 `close()` 立即冲刷并等待原子写入完成，避免 `app.exit(0)` 抢跑丢失状态。
 */
import {
	type LocalSettings,
	readAppearanceSettings,
	readInputSettings,
	readLocalSettings,
	resolveWindowBackgroundColor,
	writeLocalSettings,
} from "./local-settings.ts";

/** 默认防抖间隔，合并连续窗口调整或键入落盘。 */
const DEFAULT_FLUSH_DELAY_MS = 100;

export interface LocalStateStoreOptions {
	/** 持久化文件路径（如 `userData/desktop.json`） */
	readonly file: string;
	/** 防抖延迟，缺省 100ms */
	readonly flushDelayMs?: number;
}

export class LocalStateStore {
	private readonly file: string;
	private readonly flushDelayMs: number;
	private state: LocalSettings = { version: 1 };
	private lastSavedJson = "";
	private flushTimer: ReturnType<typeof setTimeout> | undefined;
	private writeChain: Promise<void> = Promise.resolve();
	private closed = false;

	constructor(options: LocalStateStoreOptions) {
		this.file = options.file;
		this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
	}

	/** 从磁盘读取初始状态。 */
	async init(): Promise<LocalSettings> {
		const loaded = await readLocalSettings(this.file);
		this.state = loaded;
		this.lastSavedJson = JSON.stringify(loaded);
		return loaded;
	}

	/** 获取当前内存快照（浅只读视图）。 */
	snapshot(): LocalSettings {
		return this.state;
	}

	/** 返回与当前主题及系统深浅色匹配的窗口初始背景色。 */
	backgroundColor(systemShouldUseDark: boolean): string {
		return resolveWindowBackgroundColor(this.state.appearance?.theme, systemShouldUseDark);
	}

	/** 更新状态并在非关闭态下安排防抖落盘。 */
	update(updater: (current: LocalSettings) => LocalSettings): LocalSettings {
		this.state = updater(this.state);
		if (!this.closed) {
			this.scheduleFlush();
		}
		return this.state;
	}

	/** 写入或删除指定作用域下的单项键值。 */
	setScopedItem(scope: string, key: string, value: string | null): void {
		this.update((current) => {
			const prevStorage = current.storage ?? {};
			if (scope === "app") {
				const nextApp = { ...(prevStorage.app ?? {}) };
				if (value === null) {
					delete nextApp[key];
				} else {
					nextApp[key] = value;
				}
				return {
					...current,
					storage: {
						...prevStorage,
						app: nextApp,
					},
				};
			}
			const prevWorkspaces = prevStorage.workspaces ?? {};
			const nextWs = { ...(prevWorkspaces[scope] ?? {}) };
			if (value === null) {
				delete nextWs[key];
			} else {
				nextWs[key] = value;
			}
			const nextWorkspaces = { ...prevWorkspaces };
			if (Object.keys(nextWs).length === 0) {
				delete nextWorkspaces[scope];
			} else {
				nextWorkspaces[scope] = nextWs;
			}
			return {
				...current,
				storage: {
					...prevStorage,
					workspaces: nextWorkspaces,
				},
			};
		});
	}

	/** 更新本机外观配置并持久化（会做字段归一化）。 */
	setAppearance(raw: unknown): LocalSettings {
		const clean = readAppearanceSettings(raw);
		if (clean === undefined) {
			return this.state;
		}
		return this.update((current) => ({ ...current, appearance: clean }));
	}

	/** 更新本机输入配置并持久化（会做字段归一化）。 */
	setInput(raw: unknown): LocalSettings {
		const clean = readInputSettings(raw);
		if (clean === undefined) {
			return this.state;
		}
		return this.update((current) => ({ ...current, input: clean }));
	}

	private scheduleFlush(): void {
		if (this.flushTimer !== undefined) {
			clearTimeout(this.flushTimer);
		}
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined;
			void this.flushNow();
		}, this.flushDelayMs);
	}

	/** 立即冲刷当前脏数据到磁盘，所有磁盘写操作按提交顺序串行执行。 */
	flushNow(): Promise<void> {
		if (this.flushTimer !== undefined) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		const target = this.state;
		const serialized = JSON.stringify(target);
		if (serialized === this.lastSavedJson) {
			return this.writeChain;
		}
		this.writeChain = this.writeChain
			.catch(() => undefined)
			.then(async () => {
				const latest = this.state;
				const latestJson = JSON.stringify(latest);
				if (latestJson === this.lastSavedJson) {
					return;
				}
				await writeLocalSettings(this.file, latest);
				this.lastSavedJson = latestJson;
			});
		return this.writeChain;
	}

	/** 退出前调用：立即冲刷挂起变更并等待写盘完成。 */
	async close(): Promise<void> {
		this.closed = true;
		await this.flushNow();
	}
}
