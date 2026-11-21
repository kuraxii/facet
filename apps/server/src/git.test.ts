/**
 * 工作树改动的测试。
 *
 * 每个用例现建一个临时仓库，覆盖未跟踪、已修改、已删除、重命名、二进制与非仓库这几种情况。
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	gitCommit,
	gitCommitDiff,
	gitCommits,
	gitDiff,
	gitStatus,
	parseCommitLog,
	parseCommitNameStatus,
	parseNumstat,
	parseStatusRecords,
	remoteWebUrl,
	StatusParser,
} from "./git.ts";

const roots: string[] = [];

/**
 * 在临时仓库里跑一条 git 命令。
 *
 * 全局与系统配置一律屏蔽、提交身份钉死：跑测试的机器上常常没有配置 `user.name`（CI 上就是
 * 空的），也可能配了 `commit.gpgsign` 或各种默认钩子，用例不能受这些影响。
 */
function git(root: string, ...args: string[]): void {
	execFileSync("git", ["-C", root, ...args], {
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "facet",
			GIT_AUTHOR_EMAIL: "facet@example.com",
			GIT_COMMITTER_NAME: "facet",
			GIT_COMMITTER_EMAIL: "facet@example.com",
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_SYSTEM: "/dev/null",
		},
	});
}

/** 建一个临时仓库并提交一次，返回它的根目录。 */
async function createRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "facet-git-"));
	roots.push(root);
	git(root, "init", "-b", "main");
	await writeFile(join(root, "tracked.txt"), "第一行\n第二行\n", "utf8");
	git(root, "add", ".");
	git(root, "commit", "-m", "初始提交");
	return root;
}

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("parseStatusRecords", () => {
	it("认出普通改动、重命名与未跟踪", () => {
		const output = [
			"# branch.head main",
			"1 .M N... 100644 100644 100644 aaa bbb src/a.ts",
			"2 R. N... 100644 100644 100644 aaa bbb R100 src/新.ts",
			"src/旧.ts",
			"? src/新文件.ts",
			"",
		].join("\u0000");
		expect(parseStatusRecords(output)).toEqual([
			{ status: "modified", path: "src/a.ts" },
			{ status: "renamed", path: "src/新.ts", oldPath: "src/旧.ts" },
			{ status: "untracked", path: "src/新文件.ts" },
		]);
	});

	it("冲突与删除各自归类", () => {
		const output = [
			"u UU N... 100644 100644 100644 100644 aaa bbb ccc src/冲突.ts",
			"1 D. N... 100644 100644 100644 aaa bbb src/删掉.ts",
			"",
		].join("\u0000");
		expect(parseStatusRecords(output)).toEqual([
			{ status: "conflicted", path: "src/冲突.ts" },
			{ status: "deleted", path: "src/删掉.ts" },
		]);
	});
});

describe("StatusParser", () => {
	it("按块喂进来也能解析，跨块的一条不会被切断", () => {
		const parser = new StatusParser(100);
		const records = [
			"# branch.oid 0123456\0",
			"# branch.head main\0",
			"# branch.upstream origin/main\0",
			"# branch.ab +2 -3\0",
			"1 .M N... 100644 100644 100644 aaa bbb src/a.ts\0",
			"2 R. N... 100644 100644 100644 aaa bbb R100 src/新.ts\0",
			"src/旧.ts\0",
		];
		// 每 5 个字符切一块，保证有记录横跨块边界
		const text = records.join("");
		for (let index = 0; index < text.length; index += 5) {
			parser.push(text.slice(index, index + 5));
		}
		expect(parser.records).toEqual([
			{ status: "modified", path: "src/a.ts" },
			{ status: "renamed", path: "src/新.ts", oldPath: "src/旧.ts" },
		]);
		expect(parser.branch).toBe("main");
		expect(parser.upstream).toEqual({ name: "origin/main", ahead: 2, behind: 3 });
		expect(parser.isFull).toBe(false);
	});

	it("正好等于上限时不算超", () => {
		const parser = new StatusParser(2);
		parser.push(
			["1 .M N... 100644 100644 100644 a b 一.ts\0", "1 .M N... 100644 100644 100644 a b 二.ts\0"].join(""),
		);
		expect(parser.records).toHaveLength(2);
		expect(parser.isFull).toBe(false);
	});

	it("超过上限就报满，多出来的那一条不留", () => {
		const parser = new StatusParser(2);
		const text = [
			"1 .M N... 100644 100644 100644 a b 一.ts\0",
			"1 .M N... 100644 100644 100644 a b 二.ts\0",
			"1 .M N... 100644 100644 100644 a b 三.ts\0",
		].join("");
		expect(parser.push(text)).toBe(true);
		expect(parser.records.map((record) => record.path)).toEqual(["一.ts", "二.ts"]);
	});
});

describe("parseNumstat", () => {
	it("读出增删行数，重命名取新路径，二进制标出来", () => {
		const output = ["3\t1\tsrc/a.ts", "5\t0\t\0src/旧.ts\0src/新.ts", "-\t-\timage.png", ""].join("\u0000");
		const entries = parseNumstat(output);
		expect(entries.get("src/a.ts")).toEqual({ added: 3, removed: 1, binary: false });
		expect(entries.get("src/新.ts")).toEqual({ added: 5, removed: 0, binary: false });
		expect(entries.get("image.png")).toEqual({ added: 0, removed: 0, binary: true });
	});
});

describe("gitStatus", () => {
	it("不是仓库时给 isRepo false", async () => {
		const root = await mkdtemp(join(tmpdir(), "facet-norepo-"));
		roots.push(root);
		expect(await gitStatus(root)).toEqual({ isRepo: false, files: [] });
	});

	it("裸仓库和不是仓库一样按 isRepo false 处理", async () => {
		const root = await mkdtemp(join(tmpdir(), "facet-bare-"));
		roots.push(root);
		git(root, "init", "--bare");
		expect(await gitStatus(root)).toEqual({ isRepo: false, files: [] });
	});

	it("干净的工作树没有改动", async () => {
		const root = await createRepo();
		const status = await gitStatus(root);
		expect(status.isRepo).toBe(true);
		expect(status.branch).toBe("main");
		expect(status.files).toEqual([]);
	});

	it("列出修改、未跟踪与删除，并带上增删行数", async () => {
		const root = await createRepo();
		await writeFile(join(root, "tracked.txt"), "第一行\n改过的第二行\n新增第三行\n", "utf8");
		await writeFile(join(root, "untracked.txt"), "新文件一行\n", "utf8");
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src", "gone.ts"), "一行\n", "utf8");
		git(root, "add", "src/gone.ts");
		git(root, "commit", "-m", "加一个文件");
		await rm(join(root, "src", "gone.ts"));

		const status = await gitStatus(root);
		const byPath = new Map(status.files.map((file) => [file.path, file]));
		expect(byPath.get("tracked.txt")).toMatchObject({ status: "modified", added: 2, removed: 1 });
		expect(byPath.get("untracked.txt")).toMatchObject({ status: "untracked", added: 1, removed: 0 });
		expect(byPath.get("src/gone.ts")).toMatchObject({ status: "deleted" });
	});

	it("重命名的旧路径一起给出", async () => {
		const root = await createRepo();
		git(root, "mv", "tracked.txt", "renamed.txt");
		const status = await gitStatus(root);
		expect(status.files).toEqual([
			expect.objectContaining({ path: "renamed.txt", status: "renamed", oldPath: "tracked.txt" }),
		]);
	});
});

describe("gitStatus 的截断", () => {
	it("超过上限时停在半路：给出前一批、标出截断，且不再跑 numstat", async () => {
		const root = await createRepo();
		// 三个文件都改动过，正常探测会带上增删行数
		for (const name of ["a.txt", "b.txt", "c.txt"]) {
			await writeFile(join(root, name), "改过的一行\n", "utf8");
		}

		const status = await gitStatus(root, { limit: 2 });
		expect(status.truncated).toBe(true);
		expect(status.branch).toBe("main");
		expect(status.files).toHaveLength(2);
		// 截断那一轮不跑 diff --numstat，所以统计都是缺省的 0
		expect(status.files.every((file) => file.added === 0 && file.removed === 0)).toBe(true);
	});

	it("默认上限 5000：超过就停在那里，不逐文件读行数", async () => {
		const root = await createRepo();
		execFileSync("bash", ["-c", 'for i in $(seq 1 5001); do echo x > "u$i.txt"; done'], { cwd: root });

		const started = Date.now();
		const status = await gitStatus(root);
		const elapsed = Date.now() - started;

		expect(status.truncated).toBe(true);
		expect(status.files).toHaveLength(5000);
		// 未跟踪文件正常路径会去读文件数行数，截断这一轮不该读：统计全是缺省的 0
		expect(status.files.every((file) => file.added === 0 && file.removed === 0)).toBe(true);
		// 到上限就 kill，不必等 3s 的进程超时
		expect(elapsed).toBeLessThan(3000);
	});

	it("条目回到上限以内时不再标截断", async () => {
		const root = await createRepo();
		await writeFile(join(root, "a.txt"), "一行\n", "utf8");
		await writeFile(join(root, "b.txt"), "一行\n", "utf8");
		const truncated = await gitStatus(root, { limit: 1 });
		expect(truncated.truncated).toBe(true);

		const recovered = await gitStatus(root, { limit: 10 });
		expect(recovered.truncated).toBeUndefined();
		expect(recovered.files).toHaveLength(2);
	});
});

describe("gitDiff", () => {
	it("已跟踪文件的补丁带 hunk 与增删行", async () => {
		const root = await createRepo();
		await writeFile(join(root, "tracked.txt"), "第一行\n改过的第二行\n", "utf8");
		const diff = await gitDiff(root, "tracked.txt");
		expect(diff.binary).toBe(false);
		expect(diff.truncated).toBe(false);
		expect(diff.patch).toContain("@@");
		expect(diff.patch).toContain("-第二行");
		expect(diff.patch).toContain("+改过的第二行");
	});

	it("未跟踪文件按整份新增合成补丁", async () => {
		const root = await createRepo();
		await writeFile(join(root, "fresh.txt"), "甲\n乙\n", "utf8");
		const diff = await gitDiff(root, "fresh.txt", true);
		expect(diff.patch).toContain("--- /dev/null");
		expect(diff.patch).toContain("+++ b/fresh.txt");
		expect(diff.patch).toContain("@@ -0,0 +1,2 @@");
		expect(diff.patch).toContain("+甲");
		expect(diff.patch).toContain("+乙");
	});

	it("二进制文件不给补丁", async () => {
		const root = await createRepo();
		await writeFile(join(root, "blob.bin"), Buffer.from([0, 1, 2, 3]));
		const diff = await gitDiff(root, "blob.bin", true);
		expect(diff.binary).toBe(true);
		expect(diff.patch).toBe("");
	});

	it("不是仓库时给空补丁", async () => {
		const root = await mkdtemp(join(tmpdir(), "facet-norepo-"));
		roots.push(root);
		expect(await gitDiff(root, "a.txt")).toEqual({ patch: "", truncated: false, binary: false });
	});
});

describe("gitCommits", () => {
	it("解析短哈希、说明、正文、作者与改动规模", () => {
		const output = [
			"\u001eaaa\u0000aaa1111\u0000a0a0\u0000HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1\u0000张三\u0000a@example.com\u00002026-01-02T03:04:05+08:00\u0000第二个提交\u0000正文第一段\n\n正文第二段\n\u001f\n\n 2 files changed, 46 insertions(+), 3 deletions(-)\n",
			"\u001ebbb\u0000bbb2222\u0000aaa\u0000\u0000李四\u0000b@example.com\u00002026-01-01T00:00:00+08:00\u0000初始提交\u0000\u001f\n\n 1 file changed, 2 insertions(+)\n",
			"\u001eccc\u0000ccc3333\u0000aaa bbb\u0000HEAD\u0000王五\u0000c@example.com\u00002026-01-01T00:00:00+08:00\u0000合并分支\u0000\u001f\n",
		].join("");
		expect(parseCommitLog(output)).toEqual([
			{
				sha: "aaa",
				shortSha: "aaa1111",
				parents: ["a0a0"],
				refs: [
					{ name: "HEAD", kind: "head" },
					{ name: "main", kind: "branch" },
					{ name: "origin/main", kind: "remote" },
					{ name: "v1", kind: "tag" },
				],
				subject: "第二个提交",
				body: "正文第一段\n\n正文第二段",
				authorName: "张三",
				authorEmail: "a@example.com",
				authorDate: "2026-01-02T03:04:05+08:00",
				stats: { filesChanged: 2, insertions: 46, deletions: 3 },
			},
			{
				sha: "bbb",
				shortSha: "bbb2222",
				parents: ["aaa"],
				subject: "初始提交",
				body: "",
				authorName: "李四",
				authorEmail: "b@example.com",
				authorDate: "2026-01-01T00:00:00+08:00",
				stats: { filesChanged: 1, insertions: 2, deletions: 0 },
			},
			{
				sha: "ccc",
				shortSha: "ccc3333",
				parents: ["aaa", "bbb"],
				refs: [{ name: "HEAD", kind: "head" }],
				subject: "合并分支",
				body: "",
				authorName: "王五",
				authorEmail: "c@example.com",
				authorDate: "2026-01-01T00:00:00+08:00",
			},
		]);
	});

	it("带出父提交与装饰引用：HEAD、本地分支与 Tag 都能分辨", async () => {
		const root = await createRepo();
		git(root, "tag", "v0.1.0");
		await writeFile(join(root, "tracked.txt"), "第三行\n", "utf8");
		git(root, "add", "tracked.txt");
		git(root, "commit", "-m", "第二个提交");
		const [head, first] = (await gitCommits(root)).commits;
		expect(head?.parents).toEqual([first?.sha]);
		expect(head?.refs).toEqual([
			{ name: "HEAD", kind: "head" },
			{ name: "main", kind: "branch" },
		]);
		expect(first?.refs).toEqual([{ name: "v0.1.0", kind: "tag" }]);
		// 根提交没有父提交，图谱据此把它画成一条线的起点
		expect(first?.parents).toEqual([]);
	});

	it("分页：limit 截断并给 hasMore，skip 跳过最新的几条", async () => {
		const root = await createRepo();
		for (const message of ["第二个提交", "第三个提交"]) {
			await writeFile(join(root, "tracked.txt"), `${message}\n`, "utf8");
			git(root, "add", "tracked.txt");
			git(root, "commit", "-m", message);
		}
		const page = await gitCommits(root, { limit: 2 });
		expect(page.commits.map((commit) => commit.subject)).toEqual(["第三个提交", "第二个提交"]);
		expect(page.hasMore).toBe(true);

		const tail = await gitCommits(root, { limit: 2, skip: 2 });
		expect(tail.commits.map((commit) => commit.subject)).toEqual(["初始提交"]);
		expect(tail.hasMore).toBeUndefined();
	});

	it("从新到旧列出提交，带上作者、正文与改动规模", async () => {
		const root = await createRepo();
		await writeFile(join(root, "tracked.txt"), "第三行\n", "utf8");
		git(root, "add", "tracked.txt");
		git(root, "commit", "-m", "第二个提交", "-m", "正文一段");
		const result = await gitCommits(root);
		expect(result.isRepo).toBe(true);
		expect(result.commits.map((commit) => commit.subject)).toEqual(["第二个提交", "初始提交"]);
		expect(result.commits[0]).toMatchObject({
			authorName: "facet",
			authorEmail: "facet@example.com",
			body: "正文一段",
			stats: { filesChanged: 1, insertions: 1, deletions: 2 },
		});
		expect(result.commits[0]?.shortSha.length).toBeGreaterThan(0);
		expect(Number.isNaN(Date.parse(result.commits[0]?.authorDate ?? ""))).toBe(false);
	});

	it("有远端时给出仓库网页地址", async () => {
		const root = await createRepo();
		git(root, "remote", "add", "origin", "git@github.com:ocean/facet.git");
		expect((await gitCommits(root)).webUrl).toBe("https://github.com/ocean/facet");
	});

	it("不是仓库时给 isRepo false", async () => {
		const root = await mkdtemp(join(tmpdir(), "facet-norepo-"));
		roots.push(root);
		expect(await gitCommits(root)).toEqual({ isRepo: false, commits: [] });
	});
});

describe("remoteWebUrl", () => {
	it("把 https、ssh 与 scp 三种写法折成网页地址", () => {
		expect(remoteWebUrl("https://github.com/ocean/facet.git")).toBe("https://github.com/ocean/facet");
		expect(remoteWebUrl("https://gitlab.example.com:8443/g/sub/repo")).toBe(
			"https://gitlab.example.com:8443/g/sub/repo",
		);
		expect(remoteWebUrl("ssh://git@github.com:2222/ocean/facet.git")).toBe("https://github.com/ocean/facet");
		expect(remoteWebUrl("git@github.com:ocean/facet.git")).toBe("https://github.com/ocean/facet");
	});

	it("本地路径与空值不给地址", () => {
		expect(remoteWebUrl("")).toBeUndefined();
		expect(remoteWebUrl("/srv/git/facet.git")).toBeUndefined();
		expect(remoteWebUrl("../facet")).toBeUndefined();
	});
});

describe("gitCommit", () => {
	it("解析提交的 name-status，重命名保留旧路径", () => {
		const entries = parseCommitNameStatus(
			"M\u0000a.ts\u0000R100\u0000旧.ts\u0000新.ts\u0000D\u0000删.ts\u0000",
		);
		expect(entries.get("a.ts")).toEqual({ status: "modified" });
		expect(entries.get("新.ts")).toEqual({ status: "renamed", oldPath: "旧.ts" });
		expect(entries.get("删.ts")).toEqual({ status: "deleted" });
	});

	it("根提交把文件都算新增，并给每个文件补丁", async () => {
		const root = await createRepo();
		const [commit] = (await gitCommits(root)).commits;
		expect(commit).toBeDefined();
		const detail = await gitCommit(root, commit?.sha ?? "");
		expect(detail.commit.shortSha).toBe(commit?.shortSha);
		expect(detail.files).toEqual([
			expect.objectContaining({ path: "tracked.txt", status: "added", added: 2, removed: 0 }),
		]);
		const diff = await gitCommitDiff(root, commit?.sha ?? "", "tracked.txt");
		expect(diff.patch).toContain("new file mode");
		expect(diff.patch).toContain("+第一行");
	});

	it("后续提交相对第一父提交给出修改、新增与删除", async () => {
		const root = await createRepo();
		await writeFile(join(root, "tracked.txt"), "第一行\n改过的第二行\n", "utf8");
		await writeFile(join(root, "fresh.txt"), "新文件\n", "utf8");
		git(root, "add", "-A");
		git(root, "commit", "-m", "第二次提交");
		const [commit] = (await gitCommits(root)).commits;
		const detail = await gitCommit(root, commit?.sha ?? "");
		const byPath = new Map(detail.files.map((file) => [file.path, file]));
		expect(byPath.get("tracked.txt")).toMatchObject({ status: "modified", added: 1, removed: 1 });
		expect(byPath.get("fresh.txt")).toMatchObject({ status: "added", added: 1 });
		const diff = await gitCommitDiff(root, commit?.sha ?? "", "tracked.txt");
		expect(diff.patch).toContain("-第二行");
		expect(diff.patch).toContain("+改过的第二行");
	});

	it("重命名文件同时带旧路径才能取到完整补丁", async () => {
		const root = await createRepo();
		git(root, "mv", "tracked.txt", "renamed.txt");
		git(root, "commit", "-m", "重命名");
		const [commit] = (await gitCommits(root)).commits;
		const detail = await gitCommit(root, commit?.sha ?? "");
		const renamed = detail.files.find((file) => file.path === "renamed.txt");
		expect(renamed).toMatchObject({ status: "renamed", oldPath: "tracked.txt" });
		const diff = await gitCommitDiff(root, commit?.sha ?? "", renamed?.path ?? "", renamed?.oldPath);
		expect(diff.patch).toContain("rename from tracked.txt");
		expect(diff.patch).toContain("rename to renamed.txt");
	});

	it("非仓库取提交会失败", async () => {
		const root = await mkdtemp(join(tmpdir(), "facet-norepo-"));
		roots.push(root);
		await expect(gitCommit(root, "abcdef0")).rejects.toThrow("not a git repository");
	});
});

describe("特殊路径与提交说明的解析", () => {
	it("中文、空格、单引号、箭头与重命名的路径都按原样解析", async () => {
		const root = await createRepo();
		await writeFile(join(root, "中文 空格.txt"), "一\n", "utf8");
		await writeFile(join(root, "it's.txt"), "二\n", "utf8");
		await writeFile(join(root, "箭头 -> 文件.txt"), "三\n", "utf8");
		await writeFile(join(root, "原名.txt"), "四\n", "utf8");
		git(root, "add", ".");
		git(root, "commit", "-m", "加上这些文件");

		// 一个已跟踪的改动、一个带箭头的改动、一个重命名
		await writeFile(join(root, "中文 空格.txt"), "一\n改过\n", "utf8");
		await writeFile(join(root, "箭头 -> 文件.txt"), "三\n改过\n", "utf8");
		git(root, "mv", "--", "原名.txt", "改名 后.txt");

		const status = await gitStatus(root);
		expect(status.isRepo).toBe(true);
		const paths = status.files.map((file) => file.path);
		expect(paths).toContain("中文 空格.txt");
		expect(paths).toContain("箭头 -> 文件.txt");
		const renamed = status.files.find((file) => file.status === "renamed");
		expect(renamed?.path).toBe("改名 后.txt");
		expect(renamed?.oldPath).toBe("原名.txt");

		// 单文件补丁按路径取得到，路径原样出现在 diff 头里
		const patch = await gitDiff(root, "中文 空格.txt");
		expect(patch.patch).toContain("中文 空格.txt");
		expect(patch.patch).toContain("+改过");
		expect(patch.binary).toBe(false);

		// 重命名之后取它相对 HEAD 的补丁：旧路径与新路径都能找到
		const moved = await gitDiff(root, "改名 后.txt");
		expect(moved.patch).toContain("改名 后.txt");
	});

	it("提交说明里的竖线与制表符不会让字段错位", async () => {
		const root = await createRepo();
		await writeFile(join(root, "b.txt"), "一\n", "utf8");
		git(root, "add", ".");
		git(root, "commit", "-m", "标题|带竖线", "-m", '正文\t里有制表符与"引号"');

		const commits = await gitCommits(root, { limit: 5 });
		const head = commits.commits[0];
		expect(head?.subject).toBe("标题|带竖线");
		expect(head?.body).toContain("制表符");
		expect(head?.body).toContain('"引号"');
		// 字段没被顶位：作者与时间照样解析得出来
		expect(head?.authorName).toBe("facet");
		expect(head?.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it("提交里的特殊路径也解析得准", async () => {
		const root = await createRepo();
		await writeFile(join(root, "中文 文件.txt"), "一\n", "utf8");
		git(root, "add", ".");
		git(root, "commit", "-m", "加一个中文文件");

		const commits = await gitCommits(root, { limit: 1 });
		const sha = commits.commits[0]?.sha ?? "";
		const detail = await gitCommit(root, sha);
		expect(detail.files.map((file) => file.path)).toContain("中文 文件.txt");

		const patch = await gitCommitDiff(root, sha, "中文 文件.txt");
		expect(patch.patch).toContain("中文 文件.txt");
	});
});
