/**
 * 会话清单的缓存。
 *
 * 会话文件只在有写入时变化，而清单会被反复取：端连上来要一份、一轮结束要补一条、
 * 断线重连还要对账。这里按文件缓存摘要，用大小与写入时间判断是否还能用，只有变过的
 * 文件才重新读。
 *
 * 缓存不主动过期：文件被删、被改都由调用方给出信号（监听会话目录或会话变化），
 * 找不到文件时也算一次信号，直接丢掉那一条。
 */
import { join } from "node:path";
import type { SessionSummary } from "@facet/protocol";
import { mapLimit } from "./limit.ts";
import { listSessionFiles, normalizeProjectPath } from "./projects.ts";
import { readSessionNameFully, readSessionSummary, statSessionFile } from "./session-scan.ts";

/** 缓存参数。 */
export interface SessionCatalogOptions {
	/** 会话根目录，其下一层目录对应一个工作目录 */
	sessionsDir: string;
	/** 同时读取的文件数上限，缺省 8 */
	concurrency?: number;
}

/** 一条缓存：摘要与读它时的文件状态。 */
interface CachedSummary {
	/** 文件字节数 */
	size: number;
	/** 文件写入时间，Unix 毫秒 */
	mtimeMs: number;
	summary: SessionSummary;
	/** 名字是否已经确定：false 表示名字可能落在没有扫到的中段 */
	nameComplete: boolean;
}

/** 缺省的并发读取数。 */
const DEFAULT_CONCURRENCY = 8;

export class SessionCatalog {
	private readonly options: SessionCatalogOptions;
	private readonly cache = new Map<string, CachedSummary>();
	/** 正在读的文件，同一个文件同时只读一次 */
	private readonly pending = new Map<string, Promise<SessionSummary | undefined>>();

	constructor(options: SessionCatalogOptions) {
		this.options = options;
	}

	/** 会话根目录。 */
	get sessionsDir(): string {
		return this.options.sessionsDir;
	}

	/**
	 * 列出会话，按修改时间倒序。
	 *
	 * 指定 cwd 时只返回该目录下的会话，与 pi 的过滤语义一致：比较的是清理过的绝对路径。
	 */
	async list(cwd?: string): Promise<SessionSummary[]> {
		const files = await listSessionFiles(this.options.sessionsDir);
		const want = cwd === undefined ? undefined : normalizeProjectPath(cwd);
		const summaries = await mapLimit(files, this.options.concurrency ?? DEFAULT_CONCURRENCY, (file) =>
			this.summaryOf(file),
		);
		const result = summaries.filter((summary): summary is SessionSummary => {
			if (summary === undefined) {
				return false;
			}
			return want === undefined || summary.cwd === want;
		});
		// 最近改过的排前面，界面按这个顺序铺开
		return result.sort((left, right) => right.modified - left.modified);
	}

	/** 取单个文件的摘要，命中缓存时不读盘。 */
	async summaryOf(file: string): Promise<SessionSummary | undefined> {
		const running = this.pending.get(file);
		if (running !== undefined) {
			return await running;
		}
		const task = this.read(file);
		this.pending.set(file, task);
		try {
			return await task;
		} finally {
			this.pending.delete(file);
		}
	}

	/** 丢掉一个文件的缓存，下次取时重读。文件已经不在时顺带清掉这条摘要。 */
	invalidate(file: string): void {
		this.cache.delete(file);
	}

	/** 丢掉全部缓存，换主机或换会话目录时用。 */
	clear(): void {
		this.cache.clear();
	}

	/** 会话目录里现有的全部会话文件。 */
	async files(): Promise<string[]> {
		return await listSessionFiles(this.options.sessionsDir);
	}

	/**
	 * 补齐还没确认名字的会话。
	 *
	 * 尾部没命中时头尾两段给的名字未必是最后一条，只能整份扫。这件事不影响清单可用，
	 * 所以放到背景里做，名字改了的会话按变化返回给调用方推送。
	 */
	async fillNames(concurrency = 2): Promise<SessionSummary[]> {
		const targets: string[] = [];
		for (const [file, cached] of this.cache) {
			if (!cached.nameComplete) {
				targets.push(file);
			}
		}
		const updated = await mapLimit(targets, concurrency, async (file) => {
			const cached = this.cache.get(file);
			if (cached === undefined) {
				return undefined;
			}
			const name = await readSessionNameFully(file);
			const current = this.cache.get(file);
			// 期间文件又变了就不动，等下一次读取自己重算
			if (current === undefined || current.size !== cached.size || current.mtimeMs !== cached.mtimeMs) {
				return undefined;
			}
			current.nameComplete = true;
			if (name === current.summary.name) {
				return undefined;
			}
			// 名字确定后首条消息不再被用到，不再为标题保留一份
			current.summary = {
				...current.summary,
				name,
				firstMessage: name === undefined ? current.summary.firstMessage : "",
			};
			return current.summary;
		});
		return updated.filter((summary): summary is SessionSummary => summary !== undefined);
	}

	/** 读一份摘要，文件状态没变时直接用缓存。 */
	private async read(file: string): Promise<SessionSummary | undefined> {
		const stats = await statSessionFile(file);
		if (stats === undefined) {
			this.cache.delete(file);
			return undefined;
		}
		const cached = this.cache.get(file);
		if (cached !== undefined && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
			return cached.summary;
		}
		const summary = await readSessionSummary(file, stats);
		if (summary === undefined) {
			this.cache.delete(file);
			return undefined;
		}
		this.cache.set(file, {
			size: stats.size,
			mtimeMs: stats.mtimeMs,
			summary: summary.summary,
			nameComplete: summary.nameComplete,
		});
		return summary.summary;
	}
}

/** 会话根目录的默认位置，供调用方在未指定时使用。 */
export function defaultSessionsDir(agentDir: string): string {
	return join(agentDir, "sessions");
}
