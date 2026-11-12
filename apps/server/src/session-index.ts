/**
 * 会话清单的推送。
 *
 * 会话文件落在磁盘上，多个端各自扫盘会看到不同时刻的快照。这里在主机侧维护一份索引：
 * 会话新建、改名、删除或一轮结束时记一笔，攒到一个时间片里合并处理，读一次会话目录再把
 * 变化推给清单通道。这样每个端收到的都是同一份摘要。
 *
 * 只在会话有变化时读盘，没有定时扫描：命令行工具在同一个会话目录里新建的会话，要等到
 * 下一次变化或端主动刷新才出现。
 */
import type { Channel, SessionSummary } from "@facet/protocol";
import { debugLog } from "./log.ts";
import type { SessionsChannel } from "./sessions-channel.ts";

/** 一次变化。changed 表示摘要要刷新，removed 表示文件已经不在了。 */
export type SessionChange = "changed" | "removed";

/** 会话清单的来源：读会话目录、取会话文件的头部、判断会话是否在跑。 */
export interface SessionIndexSource {
	/** 列出一个目录下的会话摘要 */
	listSessions(cwd: string): Promise<SessionSummary[]>;
	/** 读会话文件头部的目录，文件不在了时抛出 */
	peekSessionCwd(file: string): Promise<string>;
	/** 还在跑的会话文件 */
	busyFiles(): string[];
}

export interface SessionIndexOptions {
	readonly source: SessionIndexSource;
	readonly channel: SessionsChannel;
	/** 通道 URI，一个主机一条 */
	readonly uri: Channel;
	/** 合并的时间片，毫秒 */
	readonly debounceMs?: number;
}

/** 缺省合并时间片：一轮里连续产生的事件合成一次读盘。 */
const DEFAULT_DEBOUNCE_MS = 300;

export class SessionIndex {
	private readonly options: SessionIndexOptions;
	/** 待处理的变化，键是会话文件路径 */
	private readonly pending = new Map<string, SessionChange>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	/** 正在处理的变化，处理期间新来的变化攒到下一轮 */
	private flushing = false;

	constructor(options: SessionIndexOptions) {
		this.options = options;
	}

	/** 记一次变化，到时间片结束再处理。 */
	note(file: string, change: SessionChange = "changed"): void {
		// 同一路径先记删除后记变化时以最后一次为准：文件重建的情况少见，按最新的说法处理
		this.pending.set(file, change);
		if (this.timer !== undefined) {
			return;
		}
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.flush();
		}, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
		this.timer.unref?.();
	}

	/** 立即处理攒下的变化，测试与关闭前用。 */
	async flush(): Promise<void> {
		if (this.flushing) {
			return;
		}
		this.flushing = true;
		const batch = [...this.pending];
		this.pending.clear();
		try {
			for (const [file, change] of batch) {
				if (change === "removed") {
					this.options.channel.publish(this.options.uri, { type: "sessions/removed", path: file });
					continue;
				}
				const summary = await this.summaryOf(file);
				if (summary === undefined) {
					this.options.channel.publish(this.options.uri, { type: "sessions/removed", path: file });
					continue;
				}
				const busy = this.options.source.busyFiles().includes(file);
				this.options.channel.publish(this.options.uri, { type: "sessions/changed", summary, busy });
			}
		} catch (error) {
			// 推送失败不该影响会话本身，端还能手工刷新
			debugLog("sessions", "会话清单推送失败", { error: String(error) });
		} finally {
			this.flushing = false;
		}
	}

	/** 停掉待处理的变化，关闭时用。 */
	stop(): void {
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		this.pending.clear();
	}

	/** 找到这个文件对应的摘要，读一次它所在目录。 */
	private async summaryOf(file: string): Promise<SessionSummary | undefined> {
		let cwd: string;
		try {
			cwd = await this.options.source.peekSessionCwd(file);
		} catch {
			return undefined;
		}
		const pool = await this.options.source.listSessions(cwd);
		return pool.find((item) => item.path === file);
	}
}
