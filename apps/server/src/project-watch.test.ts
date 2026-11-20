/**
 * 项目目录监听的测试。
 *
 * 覆盖工作树写入、被忽略的目录、`.git` 里的引用变化与历史无关的变化、合并时间片与停止。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ProjectChange, ProjectWatch } from "./project-watch.ts";

const roots: string[] = [];
const watches: ProjectWatch[] = [];

/** 建一个临时项目目录，测试里被忽略的目录名与主机侧一致。 */
async function tempProject(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "facet-project-"));
	roots.push(dir);
	return dir;
}

/** 缺省的忽略名单，与 `files.ts` 里那份同口径。 */
const IGNORED: ReadonlySet<string> = new Set([".git", "node_modules", "out", "dist", "build"]);

afterEach(async () => {
	for (const watch of watches.splice(0)) {
		watch.stop();
	}
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** 起一份监听，窗口给短一点，测试不必干等。 */
async function start(cwd: string): Promise<{ batches: ProjectChange[] }> {
	const batches: ProjectChange[] = [];
	const watch = new ProjectWatch({
		cwd,
		ignored: IGNORED,
		debounceMs: 40,
		onChange: (change) => batches.push(change),
	});
	watches.push(watch);
	await watch.start();
	return { batches };
}

describe("ProjectWatch", () => {
	it("工作树里的文件写入报一批变化，且不标历史", async () => {
		const cwd = await tempProject();
		await mkdir(join(cwd, "src"), { recursive: true });
		const { batches } = await start(cwd);

		await writeFile(join(cwd, "src", "a.ts"), "a");
		await vi.waitFor(() => expect(batches.length).toBeGreaterThan(0), { timeout: 5000, interval: 25 });
		expect(batches[0]?.history).toBe(false);
	});

	it("新目录建出来之后，里的写入也能报出来", async () => {
		const cwd = await tempProject();
		const { batches } = await start(cwd);

		await mkdir(join(cwd, "fresh", "deep"), { recursive: true });
		await vi.waitFor(() => expect(batches.length).toBeGreaterThan(0), { timeout: 5000, interval: 25 });
		const seen = batches.length;
		await writeFile(join(cwd, "fresh", "deep", "b.ts"), "b");
		await vi.waitFor(() => expect(batches.length).toBeGreaterThan(seen), { timeout: 5000, interval: 25 });
	});

	it("被忽略的目录里的写入不报", async () => {
		const cwd = await tempProject();
		await mkdir(join(cwd, "node_modules", "pkg"), { recursive: true });
		const { batches } = await start(cwd);

		await writeFile(join(cwd, "node_modules", "pkg", "index.js"), "x");
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(batches).toEqual([]);
	});

	it(".git 里的引用变化标出历史", async () => {
		const cwd = await tempProject();
		await mkdir(join(cwd, ".git", "refs", "heads"), { recursive: true });
		const { batches } = await start(cwd);

		await writeFile(join(cwd, ".git", "refs", "heads", "main"), "0123456789\n");
		await vi.waitFor(() => expect(batches.length).toBeGreaterThan(0), { timeout: 5000, interval: 25 });
		expect(batches.every((batch) => batch.history)).toBe(true);
	});

	it(".git 里与提交历史无关的写入不报", async () => {
		const cwd = await tempProject();
		await mkdir(join(cwd, ".git", "objects"), { recursive: true });
		await writeFile(join(cwd, ".git", "COMMIT_EDITMSG"), "msg\n");
		const { batches } = await start(cwd);

		await writeFile(join(cwd, ".git", "COMMIT_EDITMSG"), "another\n");
		await writeFile(join(cwd, ".git", "index.lock"), "");
		// `git add` 只动索引，而变更页比的是工作树相对 HEAD，索引变了这一份结果不变；
		// 反过来 `git status` 自己会刷新索引，盯着它等于自己给自己发信号
		await writeFile(join(cwd, ".git", "index"), "");
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(batches).toEqual([]);
	});

	it("停掉之后不再报变化", async () => {
		const cwd = await tempProject();
		const { batches } = await start(cwd);
		const watch = watches[watches.length - 1];
		watch?.stop();

		await writeFile(join(cwd, "a.ts"), "a");
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(batches).toEqual([]);
	});

	it("目录不存在时 start 抛错", async () => {
		await expect(start(join(tmpdir(), "facet-missing-project"))).rejects.toThrow(/Not a directory/);
	});
});
