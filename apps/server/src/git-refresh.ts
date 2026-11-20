/**
 * 按仓库给 git 探测排队。
 *
 * 工作树的信号是一串一串来的：编辑器保存、格式化工具回写、git 自己写文件，一次操作能在
 * 一两秒里打出一堆事件。每来一个信号就拉起 git，等于让主机替这些写盘反复扫一遍工作树。
 *
 * 同一个仓库有两条互不挡住的车道：
 *
 * - **状态**：便宜而频繁，冷却 `1500ms`；
 * - **提交历史**：要读完整 log，每条提交还算一次 diff 规模，贵一个量级，冷却 `5000ms`。
 *
 * 两条各排各的单飞锁——状态刷新不会被提交历史的冷却拖住，反过来也一样。每条车道内：
 *
 * - 同一时刻同一个仓库只跑一次；
 * - 每次跑完冷却一段时间，这期间来的请求不拉新进程；
 * - 冷却期或运行期来的请求并成最多一次尾随执行，所有等待者共享那一次的结果；
 * - `force`（用户重新聚焦或明说要刷新）跳过冷却，立刻执行；碰上正在跑的就排到它结束后
 *   马上跑一次。
 *
 * 尾随那一次用的是那一刻的仓库，所以并发等待者拿到的状态不比请求时刻更旧。
 */
import type { GitCommits, GitStatus } from "@facet/protocol";
import { gitCommits, gitStatus } from "./git.ts";

/** 状态车道跑完一轮的冷却窗口，毫秒。 */
const DEFAULT_STATUS_COOLDOWN_MS = 1500;

/** 提交历史车道跑完一轮的冷却窗口，毫秒：它比状态贵得多，只值得更久地等一次。 */
const DEFAULT_COMMITS_COOLDOWN_MS = 5000;

/** 每条车道最多同时记多少个仓库；超了先清掉已经空闲的。 */
const MAX_ENTRIES = 64;

/** 一次待执行的尾随探测，以及等它的调用方。 */
interface Pending<T> {
	/** 所有等待者共享的 Promise */
	readonly promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
	/** 有调用方要求跳过冷却 */
	force: boolean;
}

/** 一个仓库在一条车道上的调度状态。 */
interface Entry<T> {
	/** 正在跑的那一次 */
	current: Promise<T> | undefined;
	/** 冷却结束时刻，Unix 毫秒 */
	readyAt: number;
	/** 排队中的那一次 */
	pending: Pending<T> | undefined;
	/** 排队的定时器与它要到点的时刻 */
	timer: ReturnType<typeof setTimeout> | undefined;
	fireAt: number;
}

/**
 * 一条车道。
 *
 * 同一个键同一时刻只跑一次；跑完冷却 `cooldownMs`；运行期与冷却期来的请求并成一次尾随。
 */
class Lane<T> {
	private readonly cooldownMs: number;
	private readonly probe: (key: string) => Promise<T>;
	private readonly entries = new Map<string, Entry<T>>();

	constructor(cooldownMs: number, probe: (key: string) => Promise<T>) {
		this.cooldownMs = cooldownMs;
		this.probe = probe;
	}

	/** 取一个键的结果；并发请求共用一次探测。 */
	async run(key: string, force: boolean): Promise<T> {
		const entry = this.entryFor(key);
		if (entry.current !== undefined) {
			return this.enqueue(entry, key, force);
		}
		if (!force && Date.now() < entry.readyAt) {
			return this.enqueue(entry, key, force);
		}
		return this.begin(entry, key);
	}

	/** 有几个键在跑或排队。 */
	get busyCount(): number {
		let count = 0;
		for (const entry of this.entries.values()) {
			if (entry.current !== undefined || entry.pending !== undefined) {
				count += 1;
			}
		}
		return count;
	}

	/** 取这个键的调度状态，必要时建一条；表太大时先清空闲的。 */
	private entryFor(key: string): Entry<T> {
		const existing = this.entries.get(key);
		if (existing !== undefined) {
			return existing;
		}
		if (this.entries.size >= MAX_ENTRIES) {
			this.prune();
		}
		const entry: Entry<T> = {
			current: undefined,
			readyAt: 0,
			pending: undefined,
			timer: undefined,
			fireAt: 0,
		};
		this.entries.set(key, entry);
		return entry;
	}

	/** 清掉已经空闲的记录：不跑的、不排队的，冷却也过了。 */
	private prune(): void {
		const now = Date.now();
		for (const [key, entry] of this.entries) {
			if (entry.current === undefined && entry.pending === undefined && now >= entry.readyAt) {
				this.entries.delete(key);
			}
		}
	}

	/** 排队：已经有了就共用一条，`force` 只把发车时刻提前。 */
	private enqueue(entry: Entry<T>, key: string, force: boolean): Promise<T> {
		if (entry.pending === undefined) {
			let resolve: (value: T) => void = () => undefined;
			let reject: (error: unknown) => void = () => undefined;
			const promise = new Promise<T>((settle, fail) => {
				resolve = settle;
				reject = fail;
			});
			entry.pending = { promise, resolve, reject, force };
		} else if (force) {
			entry.pending.force = true;
		}
		this.arm(entry, key);
		const pending = entry.pending as Pending<T>;
		return pending.promise;
	}

	/**
	 * 安排排队那一次的发车时刻。
	 *
	 * 正在跑就等它收尾（收尾时会再调一次这里）；冷却中等到冷却结束；排队者要求跳过冷却就
	 * 立刻发车。已经排过的定时器只有在新时刻更早时才重排。
	 */
	private arm(entry: Entry<T>, key: string): void {
		const pending = entry.pending;
		if (pending === undefined || entry.current !== undefined) {
			return;
		}
		const now = Date.now();
		const fireAt = pending.force ? now : Math.max(now, entry.readyAt);
		if (entry.timer !== undefined) {
			if (entry.fireAt <= fireAt) {
				return;
			}
			clearTimeout(entry.timer);
			entry.timer = undefined;
		}
		entry.fireAt = fireAt;
		entry.timer = setTimeout(
			() => {
				entry.timer = undefined;
				const queued = entry.pending;
				if (queued === undefined) {
					return;
				}
				entry.pending = undefined;
				this.begin(entry, key).then(queued.resolve, queued.reject);
			},
			Math.max(0, fireAt - now),
		);
		// 冷却窗口不该拖住主机退出：进程要停的时候不必等它
		entry.timer.unref?.();
	}

	/** 真跑一次；结束后开冷却窗口，并把排队的那一次安排上。 */
	private begin(entry: Entry<T>, key: string): Promise<T> {
		const run = (async () => {
			try {
				return await this.probe(key);
			} finally {
				entry.readyAt = Date.now() + this.cooldownMs;
			}
		})();
		entry.current = run;
		const settle = (): void => {
			if (entry.current === run) {
				entry.current = undefined;
			}
			this.arm(entry, key);
		};
		run.then(settle, settle);
		return run;
	}
}

/** 调度参数。 */
export interface GitRefreshOptions {
	/** 状态车道的冷却窗口，毫秒，缺省 1500 */
	cooldownMs?: number;
	/** 提交历史车道的冷却窗口，毫秒，缺省 5000 */
	commitsCooldownMs?: number;
	/** 真正去探状态的方法，缺省是 `gitStatus`；测试里换成计数用的假探针 */
	probeStatus?: (repoRoot: string) => Promise<GitStatus>;
	/** 真正去取提交历史的方法，缺省是 `gitCommits`；测试里换成计数用的假探针 */
	probeCommits?: (repoRoot: string) => Promise<GitCommits>;
}

export class GitRefreshService {
	private readonly statusLane: Lane<GitStatus>;
	private readonly commitsLane: Lane<GitCommits>;

	constructor(options: GitRefreshOptions = {}) {
		this.statusLane = new Lane(
			options.cooldownMs ?? DEFAULT_STATUS_COOLDOWN_MS,
			options.probeStatus ?? ((repoRoot) => gitStatus(repoRoot)),
		);
		this.commitsLane = new Lane(
			options.commitsCooldownMs ?? DEFAULT_COMMITS_COOLDOWN_MS,
			options.probeCommits ?? ((repoRoot) => gitCommits(repoRoot)),
		);
	}

	/**
	 * 取一个仓库的状态。
	 *
	 * 同一仓库的并发请求共用一次探测；冷却期内的请求等到冷却结束再一起跑。
	 */
	async status(repoRoot: string, options: { force?: boolean } = {}): Promise<GitStatus> {
		return await this.statusLane.run(repoRoot, options.force === true);
	}

	/**
	 * 取一个仓库的提交历史。
	 *
	 * 与状态分开排队：它贵得多，冷却也更长，但不该拖住状态刷新。
	 */
	async commits(repoRoot: string, options: { force?: boolean } = {}): Promise<GitCommits> {
		return await this.commitsLane.run(repoRoot, options.force === true);
	}

	/** 有几条车道上的仓库在跑或排队，测试与日志用。 */
	get busyCount(): number {
		return this.statusLane.busyCount + this.commitsLane.busyCount;
	}
}
