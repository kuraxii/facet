/**
 * 工作树的改动。
 *
 * 变更侧栏只看 git：工作树相对 HEAD 的差异，已暂存与未暂存合成一份。主机侧执行 git 命令，
 * 远端主机读的是它自己的仓库；非仓库、超时、输出超限都收成明确的结果，不往界面上抛原始报错。
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	GitCommit,
	GitCommitDetail,
	GitCommitStats,
	GitCommits,
	GitDiff,
	GitFileChange,
	GitFileStatus,
	GitStatus,
} from "@facet/protocol";

/** 单次 git 命令的超时，毫秒。 */
const GIT_TIMEOUT_MS = 3000;

/** stdout 的上限，超出按失败处理，避免一个巨大 diff 把内存吃满。 */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/** 全部提交历史的输出上限，比单次 diff 放宽。 */
const MAX_LOG_BYTES = 64 * 1024 * 1024;

/** 取提交历史时可以多等一会：带上改动规模之后每条提交都要算一次 diff。 */
const GIT_LOG_TIMEOUT_MS = 20_000;

/** 补丁内容的返回上限，超出截断。 */
const MAX_PATCH_BYTES = 400 * 1024;

/** 未跟踪文件统计行数时最多读这么多。 */
const MAX_UNTRACKED_BYTES = 1024 * 1024;

/** 一次 git 调用的结果。 */
interface GitResult {
	/** 进程退出码；被信号结束时为 null */
	code: number | null;
	/** 标准输出 */
	stdout: string;
}

/** 运行时的可替换点，测试里不需要替换。 */
export interface GitOptions {
	/** 工作目录 */
	cwd: string;
	/** 超时，毫秒 */
	timeoutMs?: number;
	/** stdout 上限，缺省用单次 diff 的上限 */
	maxBuffer?: number;
}

/**
 * 跑一条 git 命令。
 *
 * 不经 shell，参数逐个传入；`GIT_TERMINAL_PROMPT=0` 保证不会卡在要密码的提示上，
 * `GIT_OPTIONAL_LOCKS=0` 避免顺手刷新索引。
 */
function runGit(args: readonly string[], options: GitOptions): Promise<GitResult> {
	return new Promise((resolvePromise, reject) => {
		execFile(
			"git",
			["-C", options.cwd, "--no-pager", ...args],
			{
				timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
				maxBuffer: options.maxBuffer ?? MAX_BUFFER_BYTES,
				windowsHide: true,
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
			},
			(error, stdout) => {
				if (error === null) {
					resolvePromise({ code: 0, stdout });
					return;
				}
				// git 用退出码 1 表示「有差异」这类正常结果，只有起不来或超时才当失败
				const code = (error as NodeJS.ErrnoException & { code?: number | string }).code;
				if (typeof code === "number" && code !== 127) {
					resolvePromise({ code, stdout });
					return;
				}
				reject(error);
			},
		);
	});
}

/** 项目根是不是 git 仓库。 */
export async function isGitRepository(cwd: string): Promise<boolean> {
	try {
		const result = await runGit(["rev-parse", "--is-inside-work-tree"], { cwd });
		return result.code === 0 && result.stdout.trim() === "true";
	} catch {
		return false;
	}
}

/** 两条状态字母合成一个对外状态。 */
function statusOf(index: string, worktree: string): GitFileStatus {
	if (
		index === "U" ||
		worktree === "U" ||
		(index === "A" && worktree === "A") ||
		(index === "D" && worktree === "D")
	) {
		return "conflicted";
	}
	if (index === "R" || index === "C") {
		return "renamed";
	}
	if (index === "D" || worktree === "D") {
		return "deleted";
	}
	if (index === "A") {
		return "added";
	}
	return "modified";
}

/** 一条 `--porcelain=v2 -z` 记录。 */
interface StatusRecord {
	/** 对外状态 */
	status: GitFileStatus;
	/** 相对路径 */
	path: string;
	/** 重命名前的路径 */
	oldPath?: string;
}

/**
 * 解析 `git status --porcelain=v2 -z` 的输出。
 *
 * 记录按 NUL 分隔：普通改动是 `1 <XY> … <path>`，重命名是 `2 <XY> … <path>` 后面再跟一个
 * NUL 分隔的旧路径，未跟踪是 `? <path>`，冲突是 `u …`。`#` 开头的是分支信息，跳过。
 */
export function parseStatusRecords(output: string): StatusRecord[] {
	const tokens = output.split("\u0000");
	const records: StatusRecord[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token === undefined || token.length === 0 || token.startsWith("#")) {
			continue;
		}
		const kind = token[0];
		if (kind === "?") {
			records.push({ status: "untracked", path: token.slice(2) });
			continue;
		}
		if (kind === "!") {
			continue;
		}
		if (kind === "u") {
			// 冲突记录的路径是第 11 段
			const path = token.split(" ").slice(10).join(" ");
			if (path.length > 0) {
				records.push({ status: "conflicted", path });
			}
			continue;
		}
		if (kind === "1" || kind === "2") {
			const fields = token.split(" ");
			const xy = fields[1] ?? "..";
			// 重命名记录在路径前多一段 `<X><score>`（例如 R100）
			const path = fields.slice(kind === "2" ? 9 : 8).join(" ");
			if (path.length === 0) {
				continue;
			}
			const status = statusOf(xy[0] ?? ".", xy[1] ?? ".");
			if (kind === "2") {
				const oldPath = tokens[index + 1];
				index += 1;
				records.push({ status, path, ...(oldPath === undefined ? {} : { oldPath }) });
				continue;
			}
			records.push({ status, path });
		}
	}
	return records;
}

/** 一个文件的增删行数。 */
interface NumstatEntry {
	added: number;
	removed: number;
	binary: boolean;
}

/**
 * 解析 `git diff --numstat -z HEAD` 的输出。
 *
 * 普通记录是 `增\t删\t路径`；重命名的路径段为空，后面两个 NUL 字段分别是旧路径与新路径。
 * 二进制文件的增删位是 `-`。
 */
export function parseNumstat(output: string): Map<string, NumstatEntry> {
	const tokens = output.split("\u0000");
	const entries = new Map<string, NumstatEntry>();
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token === undefined || token.length === 0) {
			continue;
		}
		const firstTab = token.indexOf("\t");
		const secondTab = token.indexOf("\t", firstTab + 1);
		if (firstTab < 0 || secondTab < 0) {
			continue;
		}
		const addedText = token.slice(0, firstTab);
		const removedText = token.slice(firstTab + 1, secondTab);
		let path = token.slice(secondTab + 1);
		if (path.length === 0) {
			index += 2;
			path = tokens[index] ?? "";
		}
		if (path.length === 0) {
			continue;
		}
		const binary = addedText === "-" || removedText === "-";
		entries.set(path, {
			added: binary ? 0 : Number.parseInt(addedText, 10) || 0,
			removed: binary ? 0 : Number.parseInt(removedText, 10) || 0,
			binary,
		});
	}
	return entries;
}

/** 文本的行数，末尾换行不额外算一行。 */
function countLines(text: string): number {
	if (text.length === 0) {
		return 0;
	}
	return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

/** 未跟踪文件的行数；二进制给 0 并标成二进制。 */
async function countUntracked(cwd: string, path: string): Promise<NumstatEntry> {
	try {
		const buffer = await readFile(join(cwd, path));
		const slice = buffer.subarray(0, MAX_UNTRACKED_BYTES);
		if (slice.includes(0)) {
			return { added: 0, removed: 0, binary: true };
		}
		return { added: countLines(slice.toString("utf8")), removed: 0, binary: false };
	} catch {
		return { added: 0, removed: 0, binary: false };
	}
}

/** 从 `git status -b` 的输出里取分支信息。 */
function parseBranch(output: string): Pick<GitStatus, "branch" | "upstream"> {
	let branch: string | undefined;
	let upstream: GitStatus["upstream"];
	for (const line of output.split("\n")) {
		if (!line.startsWith("# branch.")) {
			continue;
		}
		const fields = line.slice(2).split(" ");
		if (fields[0] === "branch.head") {
			branch = fields[1] === "(detached)" ? "(detached)" : fields[1];
		}
		if (fields[0] === "branch.upstream") {
			upstream = { name: fields.slice(1).join(" "), ahead: 0, behind: 0 };
		}
		if (fields[0] === "branch.ab") {
			const ahead = Number.parseInt((fields[1] ?? "+0").replace("+", ""), 10) || 0;
			const behind = Number.parseInt((fields[2] ?? "-0").replace("-", ""), 10) || 0;
			upstream = { name: upstream?.name ?? "", ahead, behind };
		}
	}
	return { ...(branch === undefined ? {} : { branch }), ...(upstream === undefined ? {} : { upstream }) };
}

/**
 * 读工作树相对 HEAD 的改动。
 *
 * 一次 `git status --porcelain=v2 -z` 拿状态，一次 `git diff --numstat -z HEAD` 拿增删行数；
 * 未跟踪文件不在 numstat 里，单独读文件数行。非 git 仓库返回 `isRepo: false`。
 */
export async function gitStatus(cwd: string): Promise<GitStatus> {
	if (!(await isGitRepository(cwd))) {
		return { isRepo: false, files: [] };
	}
	// -z 模式下 git 不打 # 开头的分支头信息，分支与上游单独用一次非 -z 的 status 取
	const [statusResult, numstatResult, branchResult] = await Promise.all([
		runGit(["status", "--porcelain=v2", "-z", "--untracked-files=all"], { cwd }),
		runGit(["diff", "--numstat", "-z", "HEAD", "--"], { cwd }),
		runGit(["status", "--porcelain=v2", "-b"], { cwd }),
	]);
	const records = parseStatusRecords(statusResult.stdout);
	const numstat = parseNumstat(numstatResult.code === 0 ? numstatResult.stdout : "");
	const files: GitFileChange[] = [];
	for (const record of records) {
		const counts =
			record.status === "untracked"
				? await countUntracked(cwd, record.path)
				: (numstat.get(record.path) ?? { added: 0, removed: 0, binary: false });
		files.push({
			path: record.path,
			status: record.status,
			...(record.oldPath === undefined ? {} : { oldPath: record.oldPath }),
			added: counts.added,
			removed: counts.removed,
			binary: counts.binary,
		});
	}
	files.sort((left, right) => left.path.localeCompare(right.path));
	return { isRepo: true, ...parseBranch(branchResult.stdout), files };
}

/**
 * 取提交历史的格式。
 *
 * 记录之间用 `0x1e` 分隔，字段用 NUL 分隔；末尾的 `0x1f` 把正文与 git 随后追加的
 * `--shortstat` 统计块分开——统计块由 git 自己输出，排版不固定，只能靠这个标记切开。
 */
const COMMIT_FORMAT = "%x1e%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%b%x1f";

/** `--shortstat` 那一行里的文件数与增删行数；只改一行时后面的小句缺省。 */
const SHORT_STAT = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/;

/** 解析 `--shortstat` 输出的统计块；合并提交没有自己的差异，给不出数字。 */
function parseShortStat(text: string): GitCommitStats | undefined {
	const match = SHORT_STAT.exec(text);
	if (match === null) {
		return undefined;
	}
	return {
		filesChanged: Number.parseInt(match[1] ?? "0", 10) || 0,
		insertions: Number.parseInt(match[2] ?? "0", 10) || 0,
		deletions: Number.parseInt(match[3] ?? "0", 10) || 0,
	};
}

/**
 * 解析 `git log` 按 `COMMIT_FORMAT` 输出的记录。
 *
 * 每条记录依次是完整哈希、短哈希、作者名、作者邮箱、作者时间、说明第一行、正文与统计块；
 * 说明里不会出现 NUL 与这两个分隔符，空记录直接跳过。
 */
export function parseCommitLog(output: string): GitCommit[] {
	const commits: GitCommit[] = [];
	for (const record of output.split("\u001e")) {
		if (record.length === 0) {
			continue;
		}
		const fields = record.split("\u0000");
		const [sha, shortSha, authorName, authorEmail, authorDate, subject, rest] = fields;
		if (
			sha === undefined ||
			shortSha === undefined ||
			authorName === undefined ||
			authorEmail === undefined ||
			authorDate === undefined ||
			subject === undefined ||
			rest === undefined
		) {
			continue;
		}
		// 正文与统计块之间是 `0x1f`，正文尾部 git 会留一个换行，显示前去掉
		const cut = rest.indexOf("\u001f");
		const body = (cut < 0 ? rest : rest.slice(0, cut)).replace(/\n+$/, "");
		const stats = cut < 0 ? undefined : parseShortStat(rest.slice(cut + 1));
		commits.push({
			sha,
			shortSha,
			subject,
			body,
			authorName,
			authorEmail,
			authorDate,
			...(stats === undefined ? {} : { stats }),
		});
	}
	return commits;
}

/** 提交里一个文件的状态。 */
export interface CommitStatusEntry {
	/** 改动状态 */
	status: GitFileStatus;
	/** 重命名前的路径 */
	oldPath?: string;
}

/** 提交的 name-status 字母对应的对外状态。 */
function commitStatusOf(letter: string): GitFileStatus {
	if (letter === "A") {
		return "added";
	}
	if (letter === "D") {
		return "deleted";
	}
	if (letter === "R" || letter === "C") {
		return "renamed";
	}
	return "modified";
}

/**
 * 解析 `git diff-tree --name-status -z`。
 *
 * 普通记录是 `状态\0路径\0`，重命名是 `R100\0旧路径\0新路径\0`；返回以新路径为键的表。
 */
export function parseCommitNameStatus(output: string): Map<string, CommitStatusEntry> {
	const tokens = output.split("\u0000");
	const entries = new Map<string, CommitStatusEntry>();
	for (let index = 0; index < tokens.length; index += 1) {
		const statusToken = tokens[index];
		if (statusToken === undefined || statusToken.length === 0) {
			continue;
		}
		const letter = statusToken[0] ?? "M";
		if (letter === "R" || letter === "C") {
			const oldPath = tokens[index + 1];
			const path = tokens[index + 2];
			index += 2;
			if (path !== undefined && path.length > 0) {
				entries.set(path, {
					status: "renamed",
					...(oldPath === undefined ? {} : { oldPath }),
				});
			}
			continue;
		}
		const path = tokens[index + 1];
		index += 1;
		if (path !== undefined && path.length > 0) {
			entries.set(path, { status: commitStatusOf(letter) });
		}
	}
	return entries;
}

/**
 * 远端仓库在浏览器里的地址。
 *
 * 只看 `remote.origin.url` 这一项：`https://host/owner/repo.git`、`git@host:owner/repo.git`
 * 与 `ssh://git@host/owner/repo.git` 都折成 `https://host/owner/repo`，去掉用户名与末尾的
 * `.git`；ssh 与 git 协议里的端口是那个协议的，浏览器打不开，一并去掉。本地路径与认不出来
 * 的形状不给地址。
 */
export function remoteWebUrl(remote: string): string | undefined {
	const text = remote.trim();
	if (text.length === 0) {
		return undefined;
	}
	let host: string | undefined;
	let path: string | undefined;
	if (/^(?:https?|ssh|git|git\+ssh):\/\//i.test(text)) {
		try {
			const url = new URL(text);
			// 只有网页协议保留端口，其余协议的端口换成 https 之后没有意义
			host = url.protocol === "http:" || url.protocol === "https:" ? url.host : url.hostname;
			path = url.pathname;
		} catch {
			return undefined;
		}
	} else {
		// scp 形状：`[user@]host:path`
		const match = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(text);
		if (match === null) {
			return undefined;
		}
		host = match[1];
		path = match[2];
	}
	const trimmed = (path ?? "").replace(/^\/+/, "").replace(/\.git$/, "");
	if (host === undefined || trimmed.length === 0) {
		return undefined;
	}
	return `https://${host.toLowerCase()}/${trimmed}`;
}

/** 当前分支的全部提交，从新到旧；不是仓库时 isRepo 为假。 */
export async function gitCommits(cwd: string): Promise<GitCommits> {
	if (!(await isGitRepository(cwd))) {
		return { isRepo: false, commits: [] };
	}
	const [logResult, remoteResult] = await Promise.all([
		runGit(["log", `--format=${COMMIT_FORMAT}`, "--shortstat"], {
			cwd,
			timeoutMs: GIT_LOG_TIMEOUT_MS,
			maxBuffer: MAX_LOG_BYTES,
		}),
		runGit(["config", "--get", "remote.origin.url"], { cwd }),
	]);
	if (logResult.code !== 0) {
		return { isRepo: true, commits: [] };
	}
	const webUrl = remoteResult.code === 0 ? remoteWebUrl(remoteResult.stdout) : undefined;
	return {
		isRepo: true,
		commits: parseCommitLog(logResult.stdout),
		...(webUrl === undefined ? {} : { webUrl }),
	};
}

/** 校验客户端给来的提交哈希，避免把它当成另一个 git 选项。 */
function requireCommitSha(sha: string): string {
	if (!/^[0-9a-f]{4,40}$/i.test(sha)) {
		throw new Error("invalid commit sha");
	}
	return sha;
}

/** 取一次提交相对第一父提交的改动；根提交按空树比较。 */
export async function gitCommit(cwd: string, sha: string): Promise<GitCommitDetail> {
	const safeSha = requireCommitSha(sha);
	if (!(await isGitRepository(cwd))) {
		throw new Error("not a git repository");
	}
	const [metaResult, statusResult, numstatResult] = await Promise.all([
		runGit(["show", "-s", "--shortstat", `--format=${COMMIT_FORMAT}`, safeSha], { cwd }),
		runGit(
			["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", "--first-parent", "-M", "-z", safeSha],
			{ cwd },
		),
		runGit(
			["diff-tree", "--no-commit-id", "--numstat", "-r", "--root", "--first-parent", "-M", "-z", safeSha],
			{ cwd },
		),
	]);
	const commit = parseCommitLog(metaResult.stdout)[0];
	if (metaResult.code !== 0 || commit === undefined) {
		throw new Error("commit not found");
	}
	const statuses = parseCommitNameStatus(statusResult.code === 0 ? statusResult.stdout : "");
	const counts = parseNumstat(numstatResult.code === 0 ? numstatResult.stdout : "");
	const files: GitFileChange[] = [];
	for (const [path, entry] of statuses) {
		const count = counts.get(path) ?? { added: 0, removed: 0, binary: false };
		files.push({
			path,
			status: entry.status,
			...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
			...count,
		});
	}
	files.sort((left, right) => left.path.localeCompare(right.path));
	return { commit, files };
}

/** 取一次提交里某个文件的补丁；根提交按空树比较。 */
export async function gitCommitDiff(
	cwd: string,
	sha: string,
	path: string,
	oldPath?: string,
): Promise<GitDiff> {
	const safeSha = requireCommitSha(sha);
	if (!(await isGitRepository(cwd))) {
		return { patch: "", truncated: false, binary: false };
	}
	const paths = oldPath === undefined ? [path] : [path, oldPath];
	const result = await runGit(
		["diff-tree", "--no-commit-id", "--root", "--first-parent", "-p", "-M", safeSha, "--", ...paths],
		{ cwd },
	);
	if (result.code !== 0 && result.stdout.length === 0) {
		return { patch: "", truncated: false, binary: false };
	}
	const binary = /^Binary files .* differ$/m.test(result.stdout);
	const truncated = Buffer.byteLength(result.stdout, "utf8") > MAX_PATCH_BYTES;
	return {
		patch: truncated ? result.stdout.slice(0, MAX_PATCH_BYTES) : result.stdout,
		truncated,
		binary,
	};
}

/** 未跟踪文件的补丁：整份文件都算新增。 */
async function untrackedPatch(cwd: string, path: string): Promise<GitDiff> {
	try {
		const buffer = await readFile(join(cwd, path));
		if (buffer.subarray(0, MAX_UNTRACKED_BYTES).includes(0)) {
			return { patch: "", truncated: false, binary: true };
		}
		const text = buffer.toString("utf8");
		const count = countLines(text);
		const body = text
			.split("\n")
			.slice(0, count)
			.map((line) => `+${line}`)
			.join("\n");
		const patch = `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${count} @@\n${body}`;
		const truncated = Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES;
		return {
			patch: truncated ? patch.slice(0, MAX_PATCH_BYTES) : patch,
			truncated,
			binary: false,
		};
	} catch {
		return { patch: "", truncated: false, binary: false };
	}
}

/**
 * 取一个文件相对 HEAD 的补丁。
 *
 * 已跟踪的文件用 `git diff HEAD`，一次覆盖暂存与未暂存；未跟踪的文件由主机按「从空文件新增」
 * 合成补丁，不走 `--no-index`（那个在 Windows 上没有 /dev/null）。截断只按字节数判断。
 */
export async function gitDiff(cwd: string, path: string, untracked = false): Promise<GitDiff> {
	if (!(await isGitRepository(cwd))) {
		return { patch: "", truncated: false, binary: false };
	}
	if (untracked) {
		return await untrackedPatch(cwd, path);
	}
	const result = await runGit(["diff", "HEAD", "--", path], { cwd });
	if (result.code !== 0 && result.stdout.length === 0) {
		return { patch: "", truncated: false, binary: false };
	}
	const binary = /^Binary files .* differ$/m.test(result.stdout);
	const truncated = Buffer.byteLength(result.stdout, "utf8") > MAX_PATCH_BYTES;
	return {
		patch: truncated ? result.stdout.slice(0, MAX_PATCH_BYTES) : result.stdout,
		truncated,
		binary,
	};
}
