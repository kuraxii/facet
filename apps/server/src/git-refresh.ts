/**
 * 按仓库给 git 查询排队。
 *
 * 工作树的信号是一串一串来的：编辑器保存、格式化工具回写、git 自己写文件，一次操作能在
 * 一两秒里打出一堆事件。每来一个信号就拉起 git，等于让主机替这些写盘反复扫一遍工作树。
 *
 * 每条车道按**仓库根目录**隔离，同一时刻同一个仓库只跑一次，跑完冷却一段时间。合并方式按
 * 数据的性质分两种：
 *
 * - **可变的工作区态**（`status`、工作区单文件 `diff`）走 latest-wins：新请求到来时把在途的
 *   那一条子进程 `abort()` 掉，所有等在它上面的人一起改拿最新那一次的结果。旧快照不能复用，
 *   Agent 高频连写文件的时候那样会漏掉最新的改动；子进程也不会堆起来——同一仓库最多一条。
 * - **不可变的历史态**（某个提交的详情、某个提交里某个文件的补丁）走 single-flight：同一个
 *   `(仓库, 提交)` 在途时，新请求直接搭那一趟，鼠标划来划去不会反复派生进程。
 *
 * 不管哪种，用户拿到的都是「不比请求时刻更旧」的结果：被取代的那一轮即使跑完了也不作数，
 * 由下一轮结算这一批等待者。
 */
import type { GitCommitDetail, GitCommits, GitDiff, GitStatus } from "@facet/protocol";
import { gitCommit, gitCommitDiff, gitCommits, gitDiff, gitStatus } from "./git.ts";
import { GitAbortedError, gitExec } from "./git-exec.ts";

/** 状态车道跑完一轮的冷却窗口，毫秒。 */
const DEFAULT_STATUS_COOLDOWN_MS = 1500;

/** 提交历史车道跑完一轮的冷却窗口，毫秒：它比状态贵得多，只值得更久地等一次。 */
const DEFAULT_COMMITS_COOLDOWN_MS = 5000;

/** 每条车道最多同时记多少个键；超了先清掉已经空闲的。 */
const MAX_ENTRIES = 64;

/** 同键在途请求的合并方式。 */
type LaneMode =
	/** 新请求取代在途那一次：终止它的子进程，这一批等到最新一轮再结算 */
	| "latest-wins"
	/** 新请求搭在途那一次：同一个 Promise 交出去 */
	| "single-flight";

/** 一批等待者共享的结果。 */
interface Batch<T> {
	/** 所有等待者共享的 Promise */
	readonly promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
	/** 有调用方要求跳过冷却 */
	force: boolean;
	/** 这一批要跑的任务 */
	task: (signal: AbortSignal) => Promise<T>;
}

/** 一个键在一条车道上的调度状态。 */
interface Entry<T> {
	/** 在途那一次：结果不直接交给调用方，交给它的是批次 */
	inflight: { readonly controller: AbortController; readonly generation: number } | undefined;
	/** 当前这一批等待者 */
	batch: Batch<T> | undefined;
	/** 冷却结束时刻，Unix 毫秒 */
	readyAt: number;
	/** 排队那一次的发车定时器与它要到点的时刻 */
	timer: ReturnType<typeof setTimeout> | undefined;
	fireAt: number;
	/** 开工次数：在途那一次跑完时对不上号就说明它已经被取代了 */
	generation: number;
}

/**
 * 一条车道。
 *
 * 同一个键同一时刻只跑一次；跑完冷却 `cooldownMs`；运行期与冷却期来的请求并成一批。
 */
class Lane<T> {
	private readonly cooldownMs: number;
	private readonly mode: LaneMode;
	private readonly entries = new Map<string, Entry<T>>();

	constructor(cooldownMs: number, mode: LaneMode) {
		this.cooldownMs = cooldownMs;
		this.mode = mode;
	}

	/**
	 * 取一个键的结果；并发请求按车道的合并方式处理。
	 *
	 * `task` 由调用方给：搭车的那一方不跑自己的那份闭包，只等这一批的结果。
	 */
	async run(key: string, task: (signal: AbortSignal) => Promise<T>, force = false): Promise<T> {
		const entry = this.entryFor(key);
		const superseded = this.mode === "latest-wins" && entry.inflight !== undefined;
		if (superseded) {
			// 取代在途那一次：子进程收掉，它跑完也不结算这一批
			entry.generation += 1;
			entry.inflight?.controller.abort();
		}
		const batch = this.batchFor(entry, task);
		// 被取代说明这一批已经等过一次了：冷却管的是「连着来的新请求」，不该再让它等
		if (force || superseded) {
			batch.force = true;
		}
		this.arm(entry, key);
		return await batch.promise;
	}

	/** 有几个键在跑或排队。 */
	get busyCount(): number {
		let count = 0;
		for (const entry of this.entries.values()) {
			if (entry.inflight !== undefined || entry.batch !== undefined) {
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
			inflight: undefined,
			batch: undefined,
			readyAt: 0,
			timer: undefined,
			fireAt: 0,
			generation: 0,
		};
		this.entries.set(key, entry);
		return entry;
	}

	/** 清掉已经空闲的记录：不跑的、不排队的，冷却也过了。 */
	private prune(): void {
		const now = Date.now();
		for (const [key, entry] of this.entries) {
			if (entry.inflight === undefined && entry.batch === undefined && now >= entry.readyAt) {
				this.entries.delete(key);
			}
		}
	}

	/** 取当前批次；还没有就建一个，并把这一批要跑的任务记下来。 */
	private batchFor(entry: Entry<T>, task: (signal: AbortSignal) => Promise<T>): Batch<T> {
		const existing = entry.batch;
		if (existing !== undefined) {
			return existing;
		}
		let resolve: (value: T) => void = () => undefined;
		let reject: (error: unknown) => void = () => undefined;
		const promise = new Promise<T>((settle, fail) => {
			resolve = settle;
			reject = fail;
		});
		const batch: Batch<T> = { promise, resolve, reject, force: false, task };
		entry.batch = batch;
		return batch;
	}

	/**
	 * 安排这一批发车。
	 *
	 * 正在跑就等它收尾（收尾时会再调一次这里）；冷却中等到冷却结束；有调用方要求跳过冷却就
	 * 立刻发车。已经排过的定时器只有在新时刻更早时才重排。
	 */
	private arm(entry: Entry<T>, key: string): void {
		const batch = entry.batch;
		if (batch === undefined || entry.inflight !== undefined) {
			return;
		}
		const now = Date.now();
		const fireAt = batch.force ? now : Math.max(now, entry.readyAt);
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
				this.begin(entry, key);
			},
			Math.max(0, fireAt - now),
		);
		// 冷却窗口不该拖住主机退出：进程要停的时候不必等它
		entry.timer.unref?.();
	}

	/** 真跑一次；结果只在「没有被取代」时结算这一批。 */
	private begin(entry: Entry<T>, key: string): void {
		const batch = entry.batch;
		if (batch === undefined) {
			return;
		}
		const controller = new AbortController();
		const generation = entry.generation;
		entry.inflight = { controller, generation };
		/** 这一轮结束：让出在途位，并把还等着的那一批安排上。 */
		const release = (): void => {
			if (entry.inflight?.controller === controller) {
				entry.inflight = undefined;
			}
			this.arm(entry, key);
		};
		batch.task(controller.signal).then(
			(value) => {
				if (entry.generation !== generation) {
					// 已经被更新的请求取代：这一份不作数，下一轮去结算
					release();
					return;
				}
				entry.readyAt = Date.now() + this.cooldownMs;
				entry.batch = undefined;
				batch.resolve(value);
				release();
			},
			(error: unknown) => {
				// 被取代（或自己中止）的那一轮不算失败，也留给它取代者的那一轮
				if (entry.generation !== generation || error instanceof GitAbortedError) {
					release();
					return;
				}
				// 真失败也开冷却窗口：坏掉的仓库不该被反复重试
				entry.readyAt = Date.now() + this.cooldownMs;
				entry.batch = undefined;
				batch.reject(error);
				release();
			},
		);
	}
}

/** 调度参数。 */
export interface GitRefreshOptions {
	/** 状态车道的冷却窗口，毫秒，缺省 1500 */
	cooldownMs?: number;
	/** 提交历史车道的冷却窗口，毫秒，缺省 5000 */
	commitsCooldownMs?: number;
	/** 把调用方给的目录换成仓库根；缺省走 `git rev-parse --show-toplevel`（有缓存） */
	resolveKey?: (cwd: string) => Promise<string>;
	/** 真正去探状态的方法，缺省是 `gitStatus` */
	probeStatus?: (repoRoot: string, signal: AbortSignal) => Promise<GitStatus>;
	/** 真正去取提交历史的方法，缺省是 `gitCommits` */
	probeCommits?: (
		repoRoot: string,
		page: { limit?: number; skip?: number },
		signal: AbortSignal,
	) => Promise<GitCommits>;
	/** 真正去取工作区补丁的方法，缺省是 `gitDiff` */
	probeDiff?: (repoRoot: string, path: string, untracked: boolean, signal: AbortSignal) => Promise<GitDiff>;
	/** 真正去取提交详情的方法，缺省是 `gitCommit` */
	probeCommit?: (repoRoot: string, sha: string, signal: AbortSignal) => Promise<GitCommitDetail>;
	/** 真正去取提交内补丁的方法，缺省是 `gitCommitDiff` */
	probeCommitDiff?: (
		repoRoot: string,
		sha: string,
		path: string,
		oldPath: string | undefined,
		signal: AbortSignal,
	) => Promise<GitDiff>;
}

/** 一次查询的通用参数。 */
export interface GitQueryOptions {
	/** 跳过冷却，立刻执行 */
	force?: boolean;
}

export class GitRefreshService {
	/** 把调用方给的目录换成仓库根 */
	private readonly resolveKey: (cwd: string) => Promise<string>;
	private readonly statusProbe: (repoRoot: string, signal: AbortSignal) => Promise<GitStatus>;
	private readonly commitsProbe: (
		repoRoot: string,
		page: { limit?: number; skip?: number },
		signal: AbortSignal,
	) => Promise<GitCommits>;
	private readonly diffProbe: (
		repoRoot: string,
		path: string,
		untracked: boolean,
		signal: AbortSignal,
	) => Promise<GitDiff>;
	private readonly commitProbe: (
		repoRoot: string,
		sha: string,
		signal: AbortSignal,
	) => Promise<GitCommitDetail>;
	private readonly patchProbe: (
		repoRoot: string,
		sha: string,
		path: string,
		oldPath: string | undefined,
		signal: AbortSignal,
	) => Promise<GitDiff>;
	private readonly statusLane: Lane<GitStatus>;
	private readonly commitsLane: Lane<GitCommits>;
	private readonly pageLane: Lane<GitCommits>;
	private readonly diffLane: Lane<GitDiff>;
	private readonly commitLane: Lane<GitCommitDetail>;
	private readonly patchLane: Lane<GitDiff>;

	constructor(options: GitRefreshOptions = {}) {
		this.resolveKey = options.resolveKey ?? ((cwd) => gitExec.repoRootOf(cwd));
		this.statusProbe = options.probeStatus ?? ((repo, signal) => gitStatus(repo, { signal }));
		this.commitsProbe =
			options.probeCommits ?? ((repo, page, signal) => gitCommits(repo, { ...page, signal }));
		this.diffProbe =
			options.probeDiff ?? ((repo, path, untracked, signal) => gitDiff(repo, path, untracked, signal));
		this.commitProbe = options.probeCommit ?? ((repo, sha, signal) => gitCommit(repo, sha, signal));
		this.patchProbe =
			options.probeCommitDiff ??
			((repo, sha, path, oldPath, signal) => gitCommitDiff(repo, sha, path, oldPath, signal));

		this.statusLane = new Lane(options.cooldownMs ?? DEFAULT_STATUS_COOLDOWN_MS, "latest-wins");
		this.commitsLane = new Lane(options.commitsCooldownMs ?? DEFAULT_COMMITS_COOLDOWN_MS, "latest-wins");
		// 分页请求不进冷却：每页内容都不一样，冷却只会把「加载更多」拖慢
		this.pageLane = new Lane(0, "latest-wins");
		// 工作区补丁是可变的：同一个文件的新请求取代旧的
		this.diffLane = new Lane(0, "latest-wins");
		// 提交详情与提交内补丁是不可变的：在途时直接搭车
		this.commitLane = new Lane(0, "single-flight");
		this.patchLane = new Lane(0, "single-flight");
	}

	/**
	 * 取一个仓库的状态。
	 *
	 * 同一仓库的并发请求合并成一次探测；新的请求会把在途的那条子进程收掉，大家拿最新结果。
	 */
	async status(cwd: string, options: GitQueryOptions = {}): Promise<GitStatus> {
		const repo = await this.resolveKey(cwd);
		return await this.statusLane.run(
			repo,
			(signal) => this.statusProbe(repo, signal),
			options.force === true,
		);
	}

	/**
	 * 取一个仓库的提交历史。
	 *
	 * 与状态分开排队：它贵得多，冷却也更长，但不该拖住状态刷新。分页请求按页单独排队。
	 */
	async commits(
		cwd: string,
		options: GitQueryOptions & { limit?: number; skip?: number } = {},
	): Promise<GitCommits> {
		const repo = await this.resolveKey(cwd);
		const force = options.force === true;
		if (options.limit !== undefined || options.skip !== undefined) {
			const page = {
				...(options.limit === undefined ? {} : { limit: options.limit }),
				...(options.skip === undefined ? {} : { skip: options.skip }),
			};
			const key = [repo, String(options.limit ?? ""), String(options.skip ?? "")].join("\u0000");
			return await this.pageLane.run(key, (signal) => this.commitsProbe(repo, page, signal), true);
		}
		return await this.commitsLane.run(repo, (signal) => this.commitsProbe(repo, {}, signal), force);
	}

	/** 取一个文件相对 HEAD 的补丁；同一个文件的新请求会取代在途的那一条。 */
	async diff(cwd: string, path: string, untracked = false): Promise<GitDiff> {
		const repo = await this.resolveKey(cwd);
		const key = [repo, path, String(untracked)].join("\u0000");
		return await this.diffLane.run(key, (signal) => this.diffProbe(repo, path, untracked, signal));
	}

	/** 取一次提交的详情；同一个提交在途时复用那一次。 */
	async commit(cwd: string, sha: string): Promise<GitCommitDetail> {
		const repo = await this.resolveKey(cwd);
		const key = [repo, sha].join("\u0000");
		return await this.commitLane.run(key, (signal) => this.commitProbe(repo, sha, signal));
	}

	/** 取一次提交里某个文件的补丁；同一个 `(提交, 文件)` 在途时复用那一次。 */
	async commitDiff(cwd: string, sha: string, path: string, oldPath?: string): Promise<GitDiff> {
		const repo = await this.resolveKey(cwd);
		const key = [repo, sha, path, oldPath ?? ""].join("\u0000");
		return await this.patchLane.run(key, (signal) => this.patchProbe(repo, sha, path, oldPath, signal));
	}

	/** 有几条车道上的仓库在跑或排队，测试与日志用。 */
	get busyCount(): number {
		return (
			this.statusLane.busyCount +
			this.commitsLane.busyCount +
			this.pageLane.busyCount +
			this.diffLane.busyCount +
			this.commitLane.busyCount +
			this.patchLane.busyCount
		);
	}
}
