/**
 * 文件浏览。
 *
 * 目录列举与读文件都在主机上做：路径一律相对项目根，`realpath` 之后仍必须落在根内，符号
 * 链接指到根外一律拒绝。重目录与版本库目录不出现在列举里，读取有大小上限，二进制文件只
 * 给类型与大小。
 */
import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FileContent, FileEntry } from "@facet/protocol";

/** 列举时不出现的目录名：版本库、依赖与构建产物。 */
const IGNORED_DIRECTORIES = new Set([
	".git",
	".hg",
	".svn",
	"node_modules",
	"out",
	"dist",
	"build",
	"target",
	".venv",
	"venv",
	"__pycache__",
	"coverage",
]);

/** 一层目录最多返回多少项，超出截断。 */
const MAX_ENTRIES = 500;

/** 文本文件的大小上限，超过只给类型与大小。 */
const MAX_TEXT_BYTES = 1024 * 1024;

/** 判断二进制时检查的前缀长度。 */
const BINARY_SNIFF_BYTES = 8192;

/** 路径不在项目内、或不存在之类的问题。 */
export class FileAccessError extends Error {
	/** 对外给的错误码，界面按它决定提示 */
	readonly code: "outside_project" | "file_not_found" | "not_a_file" | "not_a_directory";

	constructor(code: FileAccessError["code"], message: string) {
		super(message);
		this.name = "FileAccessError";
		this.code = code;
	}
}

/**
 * 把相对路径收进项目根。
 *
 * 先做纯字符串层面的包含判断，再 `realpath` 一次防住符号链接指到根外的情形；目标不存在时
 * 按文件不存在报错。根目录自身始终允许。
 */
export async function resolveInsideProject(cwd: string, path: string): Promise<string> {
	if (isAbsolute(path)) {
		throw new FileAccessError("outside_project", `路径必须是相对项目根的路径:${path}`);
	}
	const root = await realpath(cwd);
	const target = resolve(root, path);
	if (target !== root && !target.startsWith(`${root}${sep}`)) {
		throw new FileAccessError("outside_project", `路径不在项目内:${path}`);
	}
	let real: string;
	try {
		real = await realpath(target);
	} catch {
		throw new FileAccessError("file_not_found", `找不到:${path}`);
	}
	if (real !== root && !real.startsWith(`${root}${sep}`)) {
		throw new FileAccessError("outside_project", `路径指向项目外:${path}`);
	}
	return real;
}

/** 把绝对路径换回相对项目根的斜杠路径。 */
function toRelative(root: string, absolute: string): string {
	const rel = relative(root, absolute);
	return rel.split(sep).join("/");
}

/**
 * 列出一个目录。
 *
 * 目录在前、文件在后，各自按名称排序；重目录与版本库目录跳过。一层最多 500 项。
 */
export async function listDirectory(cwd: string, path: string): Promise<FileEntry[]> {
	const root = await realpath(cwd);
	const target = await resolveInsideProject(cwd, path);
	const info = await stat(target);
	if (!info.isDirectory()) {
		throw new FileAccessError("not_a_directory", `不是目录:${path}`);
	}
	const dirents = await readdir(target, { withFileTypes: true });
	const entries: FileEntry[] = [];
	for (const dirent of dirents) {
		if (dirent.isDirectory() && IGNORED_DIRECTORIES.has(dirent.name)) {
			continue;
		}
		// 符号链接按它指向的东西归类；指向项目外的直接跳过
		let isDirectory = dirent.isDirectory();
		if (dirent.isSymbolicLink()) {
			const linkTarget = await realpath(resolve(target, dirent.name)).catch(() => undefined);
			if (linkTarget === undefined || (linkTarget !== root && !linkTarget.startsWith(`${root}${sep}`))) {
				continue;
			}
			const linkInfo = await stat(linkTarget).catch(() => undefined);
			if (linkInfo === undefined) {
				continue;
			}
			isDirectory = linkInfo.isDirectory();
		} else if (!dirent.isFile() && !dirent.isDirectory()) {
			// 套接字、管道这类东西不给界面看
			continue;
		}
		entries.push({
			name: dirent.name,
			path: toRelative(root, resolve(target, dirent.name)),
			kind: isDirectory ? "directory" : "file",
		});
	}
	entries.sort((left, right) => {
		if (left.kind !== right.kind) {
			return left.kind === "directory" ? -1 : 1;
		}
		return left.name.localeCompare(right.name);
	});
	return entries.slice(0, MAX_ENTRIES);
}

/** 前缀里有没有 NUL 字节，用来区分二进制。 */
function looksBinary(buffer: Buffer): boolean {
	return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/**
 * 读一个文件。
 *
 * 超过 1 MB 给 `tooLarge`，含 NUL 字节给 `binary`，其余按 UTF-8 解码；`revision` 是内容
 * 的 sha1，写回时用来发现外部改动。
 */
export async function readTextFile(cwd: string, path: string): Promise<FileContent> {
	const target = await resolveInsideProject(cwd, path);
	const info = await stat(target);
	if (!info.isFile()) {
		throw new FileAccessError("not_a_file", `不是文件:${path}`);
	}
	if (info.size > MAX_TEXT_BYTES) {
		return { kind: "tooLarge", size: info.size };
	}
	const buffer = await readFile(target);
	const revision = createHash("sha1").update(buffer).digest("hex");
	if (looksBinary(buffer)) {
		return { kind: "binary", size: info.size, revision, modifiedAt: Math.round(info.mtimeMs) };
	}
	return {
		kind: "text",
		content: buffer.toString("utf8"),
		size: info.size,
		revision,
		modifiedAt: Math.round(info.mtimeMs),
	};
}
