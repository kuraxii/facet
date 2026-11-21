/**
 * `@` 补全用的文件清单。
 *
 * 目录树是惰性的：点开哪层才取哪层，输入区却要一份能立刻过滤的列表。所以这里按预算把
 * 项目走一遍：跳过依赖与构建目录，最多收这么多条、最深这么几层——够 `@` 用，也不至于
 * 让主机去翻整棵树。取不到的那一层直接跳过，不因为一个目录失败就让整份清单消失。
 */
import type { SessionClient } from "@facet/client-core";
import type { FileEntry } from "@facet/protocol";
import { useEffect, useState } from "react";

/** 清单最多收多少条文件路径。 */
export const MENTION_FILE_LIMIT = 400;

/** 最多往下走几层目录（根目录算第 0 层）。 */
export const MENTION_MAX_DEPTH = 3;

/** 不往里走的目录名：依赖、构建产物、虚拟环境与缓存，`@` 用不上它们。 */
export const MENTION_SKIP_DIRS: readonly string[] = [
	".git",
	".next",
	".turbo",
	".venv",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"out",
	"target",
];

/** 目录名的最后一段。 */
function dirName(path: string): string {
	const cut = path.lastIndexOf("/");
	return cut < 0 ? path : path.slice(cut + 1);
}

/** 这一层还要不要继续往下走：太深或命中跳过表都不走。 */
export function shouldWalkMentionDir(path: string, depth: number): boolean {
	return depth < MENTION_MAX_DEPTH && !MENTION_SKIP_DIRS.includes(dirName(path));
}

/** 取一层目录；失败时给空表，让调用方照常往下走。 */
async function listSafely(
	client: Pick<SessionClient, "listDirectory">,
	cwd: string,
	path: string,
): Promise<FileEntry[]> {
	try {
		return await client.listDirectory(cwd, path);
	} catch {
		return [];
	}
}

/**
 * 按预算走一遍项目根，收文件路径。
 *
 * 广度优先：先收根目录这一层的文件，再逐层往下，所以预算用完时手里是「浅层的全部 + 深层的
 * 一部分」，比一头扎进某个深层目录更有用。
 */
export async function collectMentionFiles(
	client: Pick<SessionClient, "listDirectory">,
	cwd: string,
): Promise<string[]> {
	const files: string[] = [];
	const queue: { path: string; depth: number }[] = [{ path: "", depth: 0 }];
	while (queue.length > 0 && files.length < MENTION_FILE_LIMIT) {
		const next = queue.shift();
		if (next === undefined) {
			break;
		}
		for (const entry of await listSafely(client, cwd, next.path)) {
			if (files.length >= MENTION_FILE_LIMIT) {
				break;
			}
			if (entry.kind === "directory") {
				if (shouldWalkMentionDir(entry.path, next.depth + 1)) {
					queue.push({ path: entry.path, depth: next.depth + 1 });
				}
				continue;
			}
			files.push(entry.path);
		}
	}
	return files;
}

/**
 * 当前会话目录下的文件清单。
 *
 * 只跟着目录变：会话切换才重取一次，`@` 打开菜单时读的是现成的那份。
 */
export function useMentionFiles(client: SessionClient, cwd: string | undefined): readonly string[] {
	const [files, setFiles] = useState<readonly string[]>([]);

	useEffect(() => {
		if (cwd === undefined) {
			setFiles([]);
			return;
		}
		let cancelled = false;
		void collectMentionFiles(client, cwd).then((next) => {
			if (!cancelled) {
				setFiles(next);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [client, cwd]);

	return files;
}
