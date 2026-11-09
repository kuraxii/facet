/**
 * 会话目录的项目扫描。
 *
 * 会话目录名是工作目录编码后的结果，不能反推路径，所以逐个读取会话文件的第一行取 `cwd`。
 * 这里只做提取与聚合，不过滤目录是否存在，是否采用由使用方判断；坏文件直接跳过。
 */
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { type FileHandle, open, readdir, stat } from "node:fs/promises";
import { join, normalize } from "node:path";

/** 会话头最大读取字节数，头部只有少量字段。 */
const HEADER_BYTES = 4096;

/** 默认的并发读取数，目录多时用来限制同时打开的文件数。 */
const DEFAULT_CONCURRENCY = 16;

/** 从会话目录里提取出来的项目。 */
export interface SessionProject {
	/** 由 cwd 派生的稳定标识，同一路径每次扫描都相同 */
	id: string;
	/** 项目目录，原样取自会话头 */
	cwd: string;
	/** 该项目下的会话文件数 */
	sessionCount: number;
	/** 最近一次会话文件写入时间，Unix 毫秒 */
	lastUsed: number;
}

/** 扫描参数。 */
export interface ScanSessionProjectsOptions {
	/** 会话根目录，其下一层目录对应一个工作目录 */
	sessionsDir: string;
	/** 同时打开的文件数上限 */
	concurrency?: number;
}

/** 清理目录路径:收拢重复斜杠以及 `.`、`..`,去掉末尾斜杠。空串原样返回。 */
export function normalizeProjectPath(cwd: string): string {
	if (cwd.length === 0) {
		return "";
	}
	const normalized = normalize(cwd);
	return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

/** 由 cwd 得到稳定标识,调用方传入已清理的路径。 */
export function projectIdOf(cwd: string): string {
	return createHash("sha1").update(cwd).digest("hex").slice(0, 16);
}

/** 按上限并发执行，保持结果顺序。 */
async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	task: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			results[index] = await task(items[index] as T);
		}
	});
	await Promise.all(workers);
	return results;
}

/** 读会话文件第一行里的 cwd，读不到或格式不符时返回空。 */
async function readSessionCwd(file: string): Promise<string | undefined> {
	let handle: FileHandle | undefined;
	try {
		handle = await open(file, "r");
		const buffer = Buffer.alloc(HEADER_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const text = buffer.subarray(0, bytesRead).toString("utf8");
		const line = text.split("\n", 1)[0] ?? "";
		const header = JSON.parse(line) as { type?: unknown; cwd?: unknown };
		if (header.type !== "session" || typeof header.cwd !== "string" || header.cwd.length === 0) {
			return undefined;
		}
		return header.cwd;
	} catch {
		return undefined;
	} finally {
		if (handle) {
			await handle.close().catch(() => undefined);
		}
	}
}

/** 列出会话根目录下每个子目录里的会话文件。 */
async function listSessionFiles(sessionsDir: string): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(sessionsDir, { withFileTypes: true });
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const entry of entries) {
		// 会话目录是真实目录或指向它的符号链接，其余条目不是会话
		if (!entry.isDirectory() && !entry.isSymbolicLink()) {
			continue;
		}
		const dir = join(sessionsDir, entry.name);
		let names: string[];
		try {
			names = await readdir(dir);
		} catch {
			continue;
		}
		for (const name of names) {
			if (name.endsWith(".jsonl")) {
				files.push(join(dir, name));
			}
		}
	}
	return files;
}

/** 扫描会话根目录，按 cwd 聚合会话数与最近写入时间。 */
export async function scanSessionProjects(options: ScanSessionProjectsOptions): Promise<SessionProject[]> {
	const files = await listSessionFiles(options.sessionsDir);
	const limit = options.concurrency ?? DEFAULT_CONCURRENCY;
	const scanned = await mapLimit(files, limit, async (file) => {
		const headerCwd = await readSessionCwd(file);
		if (headerCwd === undefined) {
			return undefined;
		}
		const cwd = normalizeProjectPath(headerCwd);
		let lastUsed: number;
		try {
			lastUsed = (await stat(file)).mtimeMs;
		} catch {
			return undefined;
		}
		return { cwd, lastUsed };
	});

	const projects = new Map<string, SessionProject>();
	for (const item of scanned) {
		if (item === undefined) {
			continue;
		}
		const known = projects.get(item.cwd);
		if (known) {
			known.sessionCount += 1;
			known.lastUsed = Math.max(known.lastUsed, item.lastUsed);
		} else {
			projects.set(item.cwd, {
				id: projectIdOf(item.cwd),
				cwd: item.cwd,
				sessionCount: 1,
				lastUsed: item.lastUsed,
			});
		}
	}
	return [...projects.values()].sort((left, right) => {
		if (right.lastUsed !== left.lastUsed) {
			return right.lastUsed - left.lastUsed;
		}
		return left.cwd.localeCompare(right.cwd);
	});
}
