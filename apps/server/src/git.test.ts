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
import { gitDiff, gitStatus, parseNumstat, parseStatusRecords } from "./git.ts";

const roots: string[] = [];

/** 建一个临时仓库并提交一次，返回它的根目录。 */
async function createRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "facet-git-"));
	roots.push(root);
	const git = (...args: string[]): void => {
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
	};
	git("init", "-b", "main");
	await writeFile(join(root, "tracked.txt"), "第一行\n第二行\n", "utf8");
	git("add", ".");
	git("commit", "-m", "初始提交");
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
		execFileSync("git", ["-C", root, "add", "src/gone.ts"]);
		execFileSync("git", ["-C", root, "commit", "-m", "加一个文件"]);
		await rm(join(root, "src", "gone.ts"));

		const status = await gitStatus(root);
		const byPath = new Map(status.files.map((file) => [file.path, file]));
		expect(byPath.get("tracked.txt")).toMatchObject({ status: "modified", added: 2, removed: 1 });
		expect(byPath.get("untracked.txt")).toMatchObject({ status: "untracked", added: 1, removed: 0 });
		expect(byPath.get("src/gone.ts")).toMatchObject({ status: "deleted" });
	});

	it("重命名的旧路径一起给出", async () => {
		const root = await createRepo();
		execFileSync("git", ["-C", root, "mv", "tracked.txt", "renamed.txt"]);
		const status = await gitStatus(root);
		expect(status.files).toEqual([
			expect.objectContaining({ path: "renamed.txt", status: "renamed", oldPath: "tracked.txt" }),
		]);
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
