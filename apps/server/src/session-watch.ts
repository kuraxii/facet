/**
 * 会话目录的监听。
 *
 * 会话文件由主机与命令行工具共同写入，靠定时轮询发现变化要么慢、要么一直占着 CPU。
 * 这里用递归 `fs.watch`：libuv 在整个进程里只开一个 inotify 实例，每个目录只加一条
 * watch，不会把用户的实例额度耗光。事件攒到一个时间片后成批交给调用方，交给调用方之前
 * 已经过滤成会话文件，并按文件现在是否存在分成 changed 与 removed。
 */
import { type FSWatcher, watch } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { errorLog } from "./log.ts";

/** 一个会话文件的变化。 */
export interface SessionFileChange {
	/** 会话文件绝对路径 */
	file: string;
	/** changed 表示内容变了，removed 表示文件已经不在了 */
	kind: "changed" | "removed";
}

/** 监听参数。 */
export interface SessionWatchOptions {
	/** 会话根目录，其下一层目录对应一个工作目录 */
	sessionsDir: string;
	/** 合并的时间片，毫秒，缺省 250 */
	debounceMs?: number;
	/** 一批变化，路径已过滤成会话文件 */
	onChange: (changes: readonly SessionFileChange[]) => void;
}

/** 缺省合并时间片：一次写盘往往产生多条事件。 */
const DEFAULT_DEBOUNCE_MS = 250;

/** 监听建不起来时的重试间隔：目录可能晚一步才被创建。 */
const RETRY_MS = 5000;

export class SessionWatch {
	private readonly options: SessionWatchOptions;
	private watcher: FSWatcher | undefined;
	/** 待处理的变化，键是文件路径 */
	private readonly pending = new Map<string, "changed" | "removed">();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private retryTimer: ReturnType<typeof setTimeout> | undefined;
	private stopped = false;

	constructor(options: SessionWatchOptions) {
		this.options = options;
	}

	/**
	 * 开始监听。
	 *
	 * 会话根目录不存在时先建出来：`fs.watch` 对不存在的路径不报错，但也永远不会有事件，
	 * 直接监一个空位置会把后来的文件全漏掉。
	 */
	async start(): Promise<void> {
		this.stopped = false;
		try {
			await mkdir(this.options.sessionsDir, { recursive: true });
		} catch (error) {
			errorLog("sessions", "Failed to create the session directory", {
				sessionsDir: this.options.sessionsDir,
				error,
			});
		}
		this.attach();
	}

	/** 停止监听，待处理的变化一起丢掉。 */
	stop(): void {
		this.stopped = true;
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		if (this.retryTimer !== undefined) {
			clearTimeout(this.retryTimer);
			this.retryTimer = undefined;
		}
		this.pending.clear();
		this.watcher?.close();
		this.watcher = undefined;
	}

	/** 建一条递归 watch；建不起来时过一会再试。 */
	private attach(): void {
		if (this.stopped) {
			return;
		}
		try {
			this.watcher = watch(this.options.sessionsDir, { recursive: true }, (_event, file) => {
				// 目录级事件的文件名是空的，能落到文件上的已经带相对路径
				if (typeof file !== "string") {
					return;
				}
				this.note(file);
			});
		} catch (error) {
			errorLog("sessions", "Failed to watch the session directory", {
				sessionsDir: this.options.sessionsDir,
				error,
			});
			this.scheduleRetry();
			return;
		}
		// 监听中断后不再有事件，重试一次；端主动刷新仍能拿到最新清单
		this.watcher.on("error", (error) => {
			errorLog("sessions", "Session directory watch failed", {
				sessionsDir: this.options.sessionsDir,
				error,
			});
			this.watcher?.close();
			this.watcher = undefined;
			this.scheduleRetry();
		});
	}

	/** 监听建不起来时的重试，目录可能晚一步才被创建。 */
	private scheduleRetry(): void {
		if (this.stopped || this.retryTimer !== undefined) {
			return;
		}
		this.retryTimer = setTimeout(() => {
			this.retryTimer = undefined;
			void this.reconnect();
		}, RETRY_MS);
		this.retryTimer.unref?.();
	}

	/** 重试之前先把目录建出来，再建 watch。 */
	private async reconnect(): Promise<void> {
		try {
			await mkdir(this.options.sessionsDir, { recursive: true });
		} catch {
			// 建不出来就下次再试
		}
		this.attach();
	}

	/** 记一次变化，到时间片结束再处理。 */
	private note(relative: string): void {
		if (!relative.endsWith(".jsonl")) {
			return;
		}
		// 改名与新建都按「需要重读」记，文件是否还在到时间片结束时再看
		this.pending.set(join(this.options.sessionsDir, relative), "changed");
		if (this.timer !== undefined) {
			return;
		}
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.flush();
		}, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
		this.timer.unref?.();
	}

	/** 把攒下的变化交给调用方。 */
	private async flush(): Promise<void> {
		if (this.stopped) {
			return;
		}
		const batch = [...this.pending.keys()];
		this.pending.clear();
		const changes: SessionFileChange[] = [];
		for (const file of batch) {
			changes.push({ file, kind: (await this.exists(file)) ? "changed" : "removed" });
		}
		if (changes.length === 0) {
			return;
		}
		try {
			this.options.onChange(changes);
		} catch (error) {
			errorLog("sessions", "Failed to apply session directory changes", { error });
		}
	}

	private async exists(file: string): Promise<boolean> {
		try {
			return (await stat(file)).isFile();
		} catch {
			return false;
		}
	}
}
