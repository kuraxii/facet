import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdOf } from "@facet/agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	isProjectDirectory,
	ProjectDirectoryError,
	ProjectExistsError,
	ProjectNotFoundError,
	ProjectStore,
} from "./project-store.ts";

let root: string;
let file: string;

/** 用例里的项目目录：清单只收真实存在的目录，所以每个名字都得先建出来。 */
function dir(name: string): string {
	return join(root, name);
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "facet-projects-store-"));
	file = join(root, "projects.json");
	for (const name of ["a", "b", "c"]) {
		await mkdir(dir(name), { recursive: true });
	}
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("项目清单", () => {
	it("添加后按添加顺序列出，标识由目录派生", async () => {
		const store = await ProjectStore.open({ file });
		const first = await store.add({ cwd: dir("a") });
		const second = await store.add({ cwd: dir("b"), name: " 压测 " });

		expect(first.id).toBe(projectIdOf(dir("a")));
		expect(first.name).toBeUndefined();
		expect(first.createdAt).toBeGreaterThan(0);
		expect(second.name).toBe("压测");
		expect(store.list().map((project) => project.cwd)).toEqual([dir("a"), dir("b")]);
		expect(store.get(second.id)?.cwd).toBe(dir("b"));
	});

	it("末尾斜杠与已有目录视为同一个", async () => {
		const store = await ProjectStore.open({ file });
		await store.add({ cwd: dir("a") });
		await expect(store.add({ cwd: `${dir("a")}/` })).rejects.toBeInstanceOf(ProjectExistsError);
	});

	it("存进去的目录是清理过的", async () => {
		const store = await ProjectStore.open({ file });
		const project = await store.add({ cwd: `${root}//a/./` });
		expect(project.cwd).toBe(dir("a"));
		expect(project.id).toBe(projectIdOf(dir("a")));
		await expect(store.add({ cwd: `${root}/b/../a` })).rejects.toBeInstanceOf(ProjectExistsError);
	});

	it("读取时按目录重算标识", async () => {
		await writeFile(
			file,
			JSON.stringify({
				version: 1,
				projects: [{ id: "写错了的标识", cwd: `${root}//a/./`, name: "旧名字", createdAt: 2 }],
			}),
			"utf8",
		);
		const store = await ProjectStore.open({ file });
		expect(store.list()).toEqual([
			{ id: projectIdOf(dir("a")), cwd: dir("a"), name: "旧名字", createdAt: 2 },
		]);
	});

	it("目录在磁盘上不存在时拒绝，也不写进文件", async () => {
		const store = await ProjectStore.open({ file });
		await expect(store.add({ cwd: join(root, "missing") })).rejects.toBeInstanceOf(ProjectDirectoryError);
		expect(store.list()).toEqual([]);
		// 落盘的文件里也不能多出这一条：下次开机读回来同样不当项目
		const reopened = await ProjectStore.open({ file });
		expect(reopened.list()).toEqual([]);
	});

	it("路径存在但不是目录时同样拒绝", async () => {
		const notDir = join(root, "plain.txt");
		await writeFile(notDir, "x", "utf8");
		const store = await ProjectStore.open({ file });
		await expect(store.add({ cwd: notDir })).rejects.toBeInstanceOf(ProjectDirectoryError);
		expect(await isProjectDirectory(notDir)).toBe(false);
		expect(await isProjectDirectory(dir("a"))).toBe(true);
	});

	it("拒绝相对路径", async () => {
		const store = await ProjectStore.open({ file });
		await expect(store.add({ cwd: "work/a" })).rejects.toThrow("absolute");
	});

	it("改名与清除自定义名", async () => {
		const store = await ProjectStore.open({ file });
		const project = await store.add({ cwd: dir("a") });
		const renamed = await store.rename(project.id, "主应用");
		expect(renamed.name).toBe("主应用");
		const cleared = await store.rename(project.id, "   ");
		expect(cleared.name).toBeUndefined();
		await expect(store.rename("missing", "x")).rejects.toBeInstanceOf(ProjectNotFoundError);
	});

	it("移除后不再出现在清单里", async () => {
		const store = await ProjectStore.open({ file });
		const project = await store.add({ cwd: dir("a") });
		await store.remove(project.id);
		expect(store.list()).toEqual([]);
		await expect(store.remove(project.id)).rejects.toBeInstanceOf(ProjectNotFoundError);
	});

	it("重新打开后清单与自定义名都在", async () => {
		const store = await ProjectStore.open({ file });
		const project = await store.add({ cwd: dir("a"), name: "主应用" });

		const reopened = await ProjectStore.open({ file });
		expect(reopened.list()).toEqual([
			{ id: project.id, cwd: dir("a"), name: "主应用", createdAt: project.createdAt },
		]);
	});

	it("读取时跳过不合法的记录", async () => {
		await writeFile(
			file,
			JSON.stringify({
				version: 1,
				projects: [{ cwd: dir("a"), createdAt: 1 }, { cwd: 123 }, { name: "没有目录" }, "不是对象"],
			}),
			"utf8",
		);
		const store = await ProjectStore.open({ file });
		expect(store.list()).toEqual([
			{ id: projectIdOf(dir("a")), cwd: dir("a"), name: undefined, createdAt: 1 },
		]);
	});

	it("文件无法解析时改名留档并得到空清单", async () => {
		await writeFile(file, "这不是 JSON", "utf8");
		const store = await ProjectStore.open({ file });
		expect(store.list()).toEqual([]);
		const names = await readdir(root);
		expect(names.some((name) => name.startsWith("projects.json.broken-"))).toBe(true);
	});

	it("版本不认识时同样留档", async () => {
		await writeFile(file, JSON.stringify({ version: 99, projects: [] }), "utf8");
		const store = await ProjectStore.open({ file });
		expect(store.list()).toEqual([]);
		const names = await readdir(root);
		expect(names.some((name) => name.startsWith("projects.json.broken-"))).toBe(true);
	});

	it("写入失败时内存保持原状态,修好之后可以重试", async () => {
		const directory = join(root, "dir");
		const nested = join(directory, "projects.json");
		await mkdir(directory);
		const store = await ProjectStore.open({ file: nested });
		// 把清单路径换成目录,改名到它上面必然失败
		await mkdir(nested, { recursive: true });

		await expect(store.add({ cwd: dir("a") })).rejects.toThrow();
		expect(store.list()).toEqual([]);

		await rm(nested, { recursive: true, force: true });
		const project = await store.add({ cwd: dir("a") });
		expect(store.list().map((item) => item.id)).toEqual([project.id]);
	});

	it("改动落盘失败时保留原状态,也不留临时文件", async () => {
		const store = await ProjectStore.open({ file });
		const project = await store.add({ cwd: dir("a"), name: "主应用" });
		const onDisk = await readFile(file, "utf8");
		// 清单路径换成目录,临时文件改名到它上面必然失败
		await rm(file);
		await mkdir(file, { recursive: true });

		await expect(store.rename(project.id, "新名字")).rejects.toThrow();
		expect(store.get(project.id)?.name).toBe("主应用");
		const names = await readdir(root);
		expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([]);

		await rm(file, { recursive: true, force: true });
		await writeFile(file, onDisk, "utf8");
		expect(store.list().map((item) => item.name)).toEqual(["主应用"]);
	});

	it("并发改动按顺序落盘,不丢更新", async () => {
		const store = await ProjectStore.open({ file });
		const added = await Promise.all([
			store.add({ cwd: dir("a") }),
			store.add({ cwd: dir("b") }),
			store.add({ cwd: dir("c") }),
		]);
		await Promise.all([
			store.rename(added[0].id, "甲"),
			store.remove(added[1].id),
			store.rename(added[2].id, "丙"),
		]);

		const reopened = await ProjectStore.open({ file });
		expect(reopened.list().map((item) => [item.cwd, item.name])).toEqual([
			[dir("a"), "甲"],
			[dir("c"), "丙"],
		]);
		expect(store.list().map((item) => [item.cwd, item.name])).toEqual([
			[dir("a"), "甲"],
			[dir("c"), "丙"],
		]);
	});

	it("并发的重复添加只有一个成功", async () => {
		const store = await ProjectStore.open({ file });
		const results = await Promise.allSettled([store.add({ cwd: dir("a") }), store.add({ cwd: dir("a") })]);
		expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
		expect(store.list()).toHaveLength(1);
	});

	it("写出的文件带版本号", async () => {
		const store = await ProjectStore.open({ file });
		await store.add({ cwd: dir("a") });
		const written = JSON.parse(await readFile(file, "utf8")) as { version: number; projects: unknown[] };
		expect(written.version).toBe(1);
		expect(written.projects).toHaveLength(1);
	});
});
