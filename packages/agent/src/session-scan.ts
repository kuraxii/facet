/**
 * 会话文件摘要的读取。
 *
 * 清单只要几个字段：标识、目录、名字、首条消息与修改时间。pi 的 `SessionManager.list*`
 * 为了统计消息条数会把每个会话整份读一遍，会话目录到 GB 级时这一趟要几秒。这里改成按
 * 字段取：
 *
 * - 标识、目录、创建时间、分叉来源取第一行；
 * - 名字取位置最后的一条 `session_info`，扫描文件头与文件尾两段；
 * - 首条用户消息顺读到命中为止，扫不到就放弃；
 * - 修改时间用文件写入时间代替，主机与命令行工具每次追加都会更新它。
 */

import { type FileHandle, open, stat } from "node:fs/promises";
import { createInterface, type Interface } from "node:readline";
import type { Readable } from "node:stream";
import type { SessionSummary } from "@facet/protocol";
import { normalizeProjectPath } from "./projects.ts";

/** 第一行的读取字节数，头部只有少量字段。 */
const HEADER_BYTES = 4096;

/** 找名字时头部与尾部各扫多大，两段加起来才是一个文件的上限。 */
const NAME_HEAD_BYTES = 256 * 1024;
const NAME_TAIL_BYTES = 64 * 1024;

/** 找首条用户消息的读取上限，超过就当这条会话没有可展示的开头。 */
const FIRST_MESSAGE_MAX_BYTES = 512 * 1024;

/** 会话文件第一行里的字段。 */
export interface SessionFileHeader {
	/** 会话标识，文件名与头部都有 */
	id: string;
	/** 会话创建时的工作目录 */
	cwd: string;
	/** 分叉来源的会话文件路径 */
	parentSessionPath: string | undefined;
	/** 创建时间，Unix 毫秒 */
	created: number;
}

/** 文件大小与写入时间，用来判断摘要缓存是否还能用。 */
export interface SessionFileStats {
	size: number;
	/** Unix 毫秒 */
	mtimeMs: number;
}

/** 读文件里的一段，起点超出文件长度时返回空串。 */
async function readRange(handle: FileHandle, start: number, length: number): Promise<string> {
	if (length <= 0) {
		return "";
	}
	const buffer = Buffer.alloc(length);
	const { bytesRead } = await handle.read(buffer, 0, length, start);
	return buffer.subarray(0, bytesRead).toString("utf8");
}

/** 按行切开，跳过读到的半行（从文件中间开始时第一行是残缺的）。 */
function lines(text: string): string[] {
	return text.split("\n");
}

/**
 * 一段文本里位置最后的一条 `session_info`。
 *
 * 返回 found 用于区分「这段里没有改名记录」与「最后一条就是清空名字」，后者不该再往
 * 别处找旧名字：pi 的语义是最后一条生效。
 */
function lastSessionInfo(text: string): { found: boolean; name: string | undefined } {
	let found = false;
	let name: string | undefined;
	for (const line of lines(text)) {
		// 会话条目写成单行 JSON，先按前缀筛掉绝大多数行再解析
		if (!line.includes('"type":"session_info"')) {
			continue;
		}
		let entry: { type?: unknown; name?: unknown };
		try {
			entry = JSON.parse(line) as { type?: unknown; name?: unknown };
		} catch {
			// 半行、坏行都不算改名记录
			continue;
		}
		if (entry.type !== "session_info") {
			continue;
		}
		found = true;
		name = typeof entry.name === "string" ? entry.name.trim() || undefined : undefined;
	}
	return { found, name };
}

/** 读会话文件的第一行。文件不存在或不是会话文件时抛错，调用方据此判定坏文件。 */
export async function readSessionHeader(file: string): Promise<SessionFileHeader> {
	let handle: FileHandle;
	try {
		handle = await open(file, "r");
	} catch (error) {
		// 文件被删或路径写错是最常见的原因，给一句能看懂的说明
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(`Session file does not exist: ${file}`);
		}
		throw error;
	}
	try {
		const text = await readRange(handle, 0, HEADER_BYTES);
		const line = text.slice(0, text.indexOf("\n") < 0 ? text.length : text.indexOf("\n"));
		let header: { type?: unknown; id?: unknown; cwd?: unknown; timestamp?: unknown; parentSession?: unknown };
		try {
			header = JSON.parse(line) as typeof header;
		} catch {
			throw new Error(`Not a session file: ${file}`);
		}
		if (header.type !== "session" || typeof header.id !== "string" || typeof header.cwd !== "string") {
			throw new Error(`Not a session file: ${file}`);
		}
		const created = typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : Number.NaN;
		return {
			id: header.id,
			cwd: header.cwd,
			parentSessionPath: typeof header.parentSession === "string" ? header.parentSession : undefined,
			created,
		};
	} finally {
		await handle.close();
	}
}

/**
 * 会话名字，取最后一条 `session_info`。
 *
 * 改名记录出现在文件哪个位置取决于改名时机：刚建会话就起名时在开头，改名发生在很久
 * 以后时靠近末尾。先扫尾部，命中就是确定的；尾部没有时只能退回头部那份，但它未必是最
 * 后一条，所以把 complete 置空，由后台再整份确认一次。
 */
export async function readSessionName(
	file: string,
	size: number,
): Promise<{ name: string | undefined; complete: boolean }> {
	let handle: FileHandle;
	try {
		handle = await open(file, "r");
	} catch {
		return { name: undefined, complete: false };
	}
	try {
		// 短文件整份读一遍，一次就能定下来
		if (size <= NAME_HEAD_BYTES + NAME_TAIL_BYTES) {
			return { name: lastSessionInfo(await readRange(handle, 0, size)).name, complete: true };
		}
		const tailHit = lastSessionInfo(await readRange(handle, size - NAME_TAIL_BYTES, NAME_TAIL_BYTES));
		if (tailHit.found) {
			return { name: tailHit.name, complete: true };
		}
		// 尾部没有改名记录：头部的未必是最后一条，中段可能还有
		return { name: lastSessionInfo(await readRange(handle, 0, NAME_HEAD_BYTES)).name, complete: false };
	} finally {
		await handle.close();
	}
}

/**
 * 整份扫一遍找会话名字，给头尾两段都没命中的会话用。
 *
 * 只在空闲时跑（背景补齐），逐行过滤后只解析带 `session_info` 的行，不提取消息文本。
 */
export async function readSessionNameFully(file: string): Promise<string | undefined> {
	let handle: FileHandle | undefined;
	let stream: Readable | undefined;
	let reader: Interface | undefined;
	let name: string | undefined;
	try {
		handle = await open(file, "r");
		stream = handle.createReadStream({ start: 0 });
		reader = createInterface({ input: stream, crlfDelay: Infinity });
		for await (const line of reader) {
			if (!line.includes('"type":"session_info"')) {
				continue;
			}
			let entry: { type?: unknown; name?: unknown };
			try {
				entry = JSON.parse(line) as typeof entry;
			} catch {
				continue;
			}
			if (entry.type !== "session_info") {
				continue;
			}
			name = typeof entry.name === "string" ? entry.name.trim() || undefined : undefined;
		}
		return name;
	} catch {
		return name;
	} finally {
		reader?.close();
		stream?.destroy();
		await handle?.close().catch(() => undefined);
	}
}

/** 消息内容里的文本，字符串直接用，块数组只取 text 块。 */
function textOfContent(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	const blocks = content as { type?: unknown; text?: unknown }[];
	return blocks
		.filter((block) => block !== null && typeof block === "object" && block.type === "text")
		.map((block) => (typeof block.text === "string" ? block.text : ""))
		.join(" ");
}

/** 第一条用户消息的文本，扫不到或文件读不了时返回空串。 */
export async function readFirstUserMessage(file: string): Promise<string> {
	let handle: FileHandle | undefined;
	let stream: Readable | undefined;
	let reader: Interface | undefined;
	try {
		handle = await open(file, "r");
		// 只读到上限为止，长会话不必整份读进来找开头
		stream = handle.createReadStream({ start: 0, end: FIRST_MESSAGE_MAX_BYTES - 1 });
		reader = createInterface({ input: stream, crlfDelay: Infinity });
		for await (const line of reader) {
			// 会话条目写成单行 JSON，先按内容筛掉绝大多数行再解析
			if (!line.includes('"role":"user"')) {
				continue;
			}
			let entry: { type?: unknown; message?: { role?: unknown; content?: unknown } };
			try {
				entry = JSON.parse(line) as typeof entry;
			} catch {
				continue;
			}
			if (entry.type !== "message" || entry.message?.role !== "user") {
				continue;
			}
			const text = textOfContent(entry.message.content).trim();
			if (text.length > 0) {
				return text;
			}
		}
		return "";
	} catch {
		return "";
	} finally {
		reader?.close();
		stream?.destroy();
		// 流结束时 fd 已由它关闭，这里的关闭失败可以直接忽略
		await handle?.close().catch(() => undefined);
	}
}

/** 摘要与名字扫描的完整程度。 */
export interface SessionScanResult {
	summary: SessionSummary;
	/** 名字扫描是否覆盖了整份文件；false 表示名字可能落在没有扫到的中段 */
	nameComplete: boolean;
}

/**
 * 一个会话文件的摘要。
 *
 * 文件不是会话文件时返回 undefined，调用方按已删除处理。名字存在时不再去找首条消息：
 * 标题优先用名字，逐条解析用户消息只在这个时候才有意义。
 */
export async function readSessionSummary(
	file: string,
	stats: SessionFileStats,
): Promise<SessionScanResult | undefined> {
	let header: SessionFileHeader;
	try {
		header = await readSessionHeader(file);
	} catch {
		return undefined;
	}
	const scan = await readSessionName(file, stats.size);
	const firstMessage = scan.name === undefined ? await readFirstUserMessage(file) : "";
	return {
		nameComplete: scan.complete,
		summary: {
			id: header.id,
			path: file,
			cwd: normalizeProjectPath(header.cwd),
			name: scan.name,
			parentSessionPath: header.parentSessionPath,
			// 头部时间缺失时退回文件写入时间，保证排序能用
			created: Number.isNaN(header.created) ? stats.mtimeMs : header.created,
			modified: stats.mtimeMs,
			firstMessage,
		},
	};
}

/** 会话文件的大小与写入时间，文件不存在时返回 undefined。 */
export async function statSessionFile(file: string): Promise<SessionFileStats | undefined> {
	try {
		const stats = await stat(file);
		// 抹平亚毫秒部分，摘要里的时间都是整数毫秒
		return { size: stats.size, mtimeMs: Math.round(stats.mtimeMs) };
	} catch {
		return undefined;
	}
}
