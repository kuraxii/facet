/**
 * 项目目录的监听。
 *
 * 变更页要跟着工作树自己更新，而工作树在主机上。这里逐个目录挂 `fs.watch`，不用递归模式：
 * 递归会把 `node_modules` 这类被忽略的目录一并挂上，几个大仓就能把 inotify 额度吃光。
 *
 * 一次保存往往连着好几条事件，git 自己也连写几个文件，所以变化先在一个时间片里合并，
 * 到点只发一次。`history` 单独标出来：只有 HEAD、索引或引用动过才可能影响提交历史，而
 * 提交历史要读全量 log，比工作树状态贵得多，不该为每一次保存重取。
 *
 * 新建的子目录在下一批事件里补挂，删掉的顺手摘掉；目录数超过上限就不再往下挂，宁可漏掉
 * 几处深处的变化，也不要把用户的 inotify 额度用光。
 */
import { type FSWatcher, watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { debugLog } from "./log.ts";

/** 一批变化。 */
export interface ProjectChange {
	/** HEAD、索引或引用动过，提交历史也可能变了 */
	history: boolean;
}

/** 监听参数。 */
export interface ProjectWatchOptions {
	/** 项目根目录 */
	cwd: string;
	/** 不挂监听的目录名，与文件树共用一份 */
	ignored: ReadonlySet<string>;
	/** 合并窗口，毫秒，缺省 500 */
	debounceMs?: number;
	/** 一批变化 */
	onChange: (change: ProjectChange) => void;
}

/** 版本库目录名：它有自己的事件分类，不参与工作树那一套目录遍历。 */
const GIT_DIR = ".git";

/**
 * `.git` 根上代表「当前分支或引用动过」的文件。
 *
 * 不在这里的一律不算：`objects/`、`logs/`、`COMMIT_EDITMSG`、各种 `.lock` 每次 git 操作都
 * 连写一串；`index` 也不看——`git add` 只动它，而变更页比的是工作树相对 HEAD，索引怎么变
 * 都不改那一份结果，反过来 `git status` 自己会刷新索引，盯着它等于自己给自己发信号。
 */
const GIT_HISTORY_FILES = new Set([
	"HEAD",
	"packed-refs",
	"ORIG_HEAD",
	"FETCH_HEAD",
	"MERGE_HEAD",
	"CHERRY_PICK_HEAD",
	"REVERT_HEAD",
]);

/** 最多挂多少个目录的监听。超大仓会停在浅层，深处的变化就漏了。 */
const MAX_WATCHED_DIRS = 1024;

/** 缺省合并窗口：一次保存在磁盘上常常是临时文件加一次 rename。 */
const DEFAULT_DEBOUNCE_MS = 500;

/** 一次目录监听要按哪套规则解读事件。 */
type WatchKind =
	/** 工作树里的普通目录 */
	| "tree"
	/** `.git` 的根与 `refs` 子树 */
	| "git";

export class ProjectWatch {
	private readonly options: ProjectWatchOptions;
	/** 已挂上的目录，键是绝对路径 */
	private readonly watchers = new Map<string, FSWatcher>();
	/** `.git` 的绝对路径，只在它是目录时才记下来 */
	private gitRoot: string | undefined;
	/** 这批变化里有没有工作树的改动 */
	private pendingTree = false;
	/** 这批变化里有没有引用改动 */
	private pendingHistory = false;
	/** 出过事件的目录，下一个时间片里对一遍它们的子目录 */
	private readonly dirty = new Set<string>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private stopped = false;
	private capped = false;

	constructor(options: ProjectWatchOptions) {
		this.options = options;
	}

	/** 建起监听：先铺开工作树，再挂上版本库。目录不存在时直接抛错，由调用方决定怎么说。 */
	async start(): Promise<void> {
		this.stopped = false;
		const info = await stat(this.options.cwd).catch(() => undefined);
		if (info === undefined || !info.isDirectory()) {
			throw new Error(`Not a directory: ${this.options.cwd}`);
		}
		await this.walkTree(this.options.cwd);
		await this.watchGit();
	}

	/** 停掉监听并清空记账，可以再 `start` 一次。 */
	stop(): void {
		this.stopped = true;
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		for (const watcher of this.watchers.values()) {
			watcher.close();
		}
		this.watchers.clear();
		this.dirty.clear();
		this.gitRoot = undefined;
		this.pendingTree = false;
		this.pendingHistory = false;
		this.capped = false;
	}

	/** 当前挂着多少个目录，日志与测试用。 */
	get watchedCount(): number {
		return this.watchers.size;
	}

	/** 这个目录名要不要跳过：被忽略的构建产物与依赖，以及版本库目录自己。 */
	private isIgnored(name: string): boolean {
		return name === GIT_DIR || this.options.ignored.has(name);
	}

	/** 铺开一棵子树；目录数到上限就停下，后续不再往下挂。 */
	private async walkTree(root: string): Promise<void> {
		const queue = [root];
		while (queue.length > 0) {
			const dir = queue.shift() as string;
			this.addWatcher(dir, "tree");
			const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined);
			if (entries === undefined) {
				continue;
			}
			for (const entry of entries) {
				// 只跟真实目录：符号链接一律不跟随，免得指到项目外面去
				if (entry.isDirectory() && !this.isIgnored(entry.name)) {
					queue.push(join(dir, entry.name));
				}
			}
		}
	}

	/** 挂上版本库：`.git` 的根，加 `refs` 子树。 */
	private async watchGit(): Promise<void> {
		const gitDir = join(this.options.cwd, GIT_DIR);
		const info = await stat(gitDir).catch(() => undefined);
		// `.git` 可能是文件（子模块、linked worktree），那种情况取不到引用，就不挂了
		if (info === undefined || !info.isDirectory()) {
			return;
		}
		this.gitRoot = gitDir;
		this.addWatcher(gitDir, "git");
		await this.walkRefs(join(gitDir, "refs"));
	}

	/** 铺开 `refs` 子树：按远端与分支分层，深度很浅。 */
	private async walkRefs(root: string): Promise<void> {
		const queue = [root];
		while (queue.length > 0) {
			const dir = queue.shift() as string;
			this.addWatcher(dir, "git");
			const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined);
			if (entries === undefined) {
				continue;
			}
			for (const entry of entries) {
				if (entry.isDirectory()) {
					queue.push(join(dir, entry.name));
				}
			}
		}
	}

	/** 挂一个目录；重复挂、到上限、目录刚好不在了都只是跳过。 */
	private addWatcher(dir: string, kind: WatchKind): void {
		if (this.stopped || this.watchers.has(dir)) {
			return;
		}
		if (this.watchers.size >= MAX_WATCHED_DIRS) {
			if (!this.capped) {
				this.capped = true;
				debugLog("project-watch", "Watch limit reached, deeper directories are not followed", {
					cwd: this.options.cwd,
					limit: MAX_WATCHED_DIRS,
				});
			}
			return;
		}
		try {
			const watcher = watch(dir, { persistent: true }, (_event, filename) => {
				this.onEvent(dir, kind, filename);
			});
			watcher.on("error", () => this.dropWatcher(dir));
			this.watchers.set(dir, watcher);
		} catch (error) {
			// 目录已经被删掉或没有权限：少一处监听不影响其余部分
			debugLog("project-watch", "Failed to watch a directory", { dir, error: String(error) });
		}
	}

	/** 摘掉一个目录的监听。 */
	private dropWatcher(dir: string): void {
		const watcher = this.watchers.get(dir);
		if (watcher === undefined) {
			return;
		}
		watcher.close();
		this.watchers.delete(dir);
	}

	/** 收到一条事件：归类、记账，再把发车时刻定下来。 */
	private onEvent(dir: string, kind: WatchKind, filename: string | null): void {
		if (this.stopped) {
			return;
		}
		if (kind === "tree") {
			/*
			 * 被忽略的目录名不算工作树改动。
			 *
			 * NTFS 上父目录会为子目录里的写入补一条「这个子目录变了」的事件：往 `.git` 里写
			 * 索引、`git` 连写 `objects/` 时，项目根上的监听就会收到 `change .git`。这些内容
			 * 各有自己的通道（版本库是下面那一支，依赖与产物根本不看），当成工作树改动会白跑
			 * 一次状态刷新；Linux 上多数时候收不到这类事件，两边行为也应当一致。
			 */
			if (filename !== null && this.isIgnored(filename)) {
				return;
			}
			this.pendingTree = true;
			this.dirty.add(dir);
			this.schedule();
			return;
		}
		// `refs` 子树里的任何变化都是引用变化；`.git` 根上只看那几个关键文件
		const isRoot = dir === this.gitRoot;
		const relevant = filename === null || (isRoot ? GIT_HISTORY_FILES.has(filename) : true);
		if (!relevant) {
			return;
		}
		this.pendingHistory = true;
		this.schedule();
	}

	/** 一个时间片只发一次。 */
	private schedule(): void {
		if (this.timer !== undefined) {
			return;
		}
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.flush();
		}, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
	}

	/** 到点：先把出过事件的目录对一遍，再把这一批变化交出去。 */
	private flush(): void {
		if (this.stopped) {
			return;
		}
		const tree = this.pendingTree;
		const history = this.pendingHistory;
		this.pendingTree = false;
		this.pendingHistory = false;
		void this.reconcile();
		if (!tree && !history) {
			return;
		}
		this.options.onChange({ history });
	}

	/** 对一遍出过事件的目录：新出现的子目录补挂，已经不在了的摘掉。 */
	private async reconcile(): Promise<void> {
		const dirs = [...this.dirty];
		this.dirty.clear();
		for (const dir of dirs) {
			const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined);
			if (entries === undefined) {
				this.dropWatcher(dir);
				continue;
			}
			const present = new Set<string>();
			for (const entry of entries) {
				if (!entry.isDirectory() || this.isIgnored(entry.name)) {
					continue;
				}
				const child = join(dir, entry.name);
				present.add(child);
				if (!this.watchers.has(child)) {
					// 新目录可能是一整棵搬进来的，照样铺开
					await this.walkTree(child);
				}
			}
			const prefix = `${dir}${sep}`;
			for (const watched of [...this.watchers.keys()]) {
				const name = watched.startsWith(prefix) ? watched.slice(prefix.length) : undefined;
				// 只看直接子目录：更深层的由它们自己的父目录负责
				if (name !== undefined && !name.includes(sep) && !present.has(watched)) {
					this.dropWatcher(watched);
				}
			}
		}
	}
}
