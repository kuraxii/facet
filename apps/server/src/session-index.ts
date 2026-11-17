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
import type { Channel, SessionActivity, SessionSummary } from "@facet/protocol";
import { debugLog } from "./log.ts";
import type { SessionsChannel } from "./sessions-channel.ts";

/** 一次变化。changed 表示摘要要刷新，removed 表示文件已经不在了。 */
export type SessionChange = "changed" | "removed";

/** 会话清单的来源：取会话文件的摘要、判断会话是否在跑。 */
export interface SessionIndexSource {
	/** 取一个会话文件的摘要，读盘与缓存由来源自己负责 */
	summaryOf(file: string): Promise<SessionSummary | undefined>;
	/** 会话文件此刻的活动状态，没装载的会话是 idle */
	activityOf(file: string): SessionActivity;
}

export interface SessionIndexOptions {
	readonly source: SessionIndexSource;
	readonly channel: SessionsChannel;
	/** 通道 URI，一个主机一条 */
	readonly uri: Channel;
	/** 合并的时间片，毫秒 */
	readonly debounceMs?: number;
	/** 读到会话目录时的通知，用于把新目录补进项目清单 */
	readonly onCwd?: (cwd: string) => void;
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

	/**
	 * 推一条活动状态。
	 *
	 * 不走时间片也不读会话文件：状态迁移本来就频繁，走摘要那条路会为一次枚举变化读盘。
	 * 清单里还没有这个文件时端会忽略，等摘要到了自然对齐。
	 */
	noteActivity(file: string, activity: SessionActivity): void {
		this.options.channel.publish(this.options.uri, { type: "sessions/status", path: file, activity });
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
				const activity = this.options.source.activityOf(file);
				this.options.channel.publish(this.options.uri, { type: "sessions/changed", summary, activity });
			}
		} catch (error) {
			// 推送失败不该影响会话本身，端还能手工刷新
			debugLog("sessions", "Failed to publish the session list", { error: String(error) });
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

	/** 找到这个文件对应的摘要。只读这一个文件，不重扫整个目录。 */
	private async summaryOf(file: string): Promise<SessionSummary | undefined> {
		let summary: SessionSummary | undefined;
		try {
			summary = await this.options.source.summaryOf(file);
		} catch (error) {
			// 读不了就当它不在了：端收到删除后会重新拉一份清单
			debugLog("sessions", "Failed to read the session summary", { file, error: String(error) });
			return undefined;
		}
		if (summary !== undefined) {
			this.options.onCwd?.(summary.cwd);
		}
		return summary;
	}
}
