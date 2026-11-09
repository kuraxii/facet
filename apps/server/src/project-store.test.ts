import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdOf } from "@facet/agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectExistsError, ProjectNotFoundError, ProjectStore } from "./project-store.ts";

let root: string;
let file: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "facet-projects-store-"));
	file = join(root, "projects.json");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("项目清单", () => {
	it("添加后按添加顺序列出，标识由目录派生", async () => {
		const store = await ProjectStore.open({ file });
		const first = await store.add({ cwd: "/work/a" });
		const second = await store.add({ cwd: "/work/b", name: " 压测 " });

		expect(first.id).toBe(projectIdOf("/work/a"));
		expect(first.name).toBeUndefined();
		expect(first.createdAt).toBeGreaterThan(0);
		expect(second.name).toBe("压测");
		expect(store.list().map((project) => project.cwd)).toEqual(["/work/a", "/work/b"]);
		expect(store.get(second.id)?.cwd).toBe("/work/b");
	});

	it("末尾斜杠与已有目录视为同一个", async () => {
		const store = await ProjectStore.open({ file });
		await store.add({ cwd: "/work/a" });
		await expect(store.add({ cwd: "/work/a/" })).rejects.toBeInstanceOf(ProjectExistsError);
	});

	it("拒绝相对路径", async () => {
		const store = await ProjectStore.open({ file });
		await expect(store.add({ cwd: "work/a" })).rejects.toThrow("绝对路径");
	});

	it("改名与清除自定义名", async () => {
		const store = await ProjectStore.open({ file });
		const project = await store.add({ cwd: "/work/a" });
		const renamed = await store.rename(project.id, "主应用");
		expect(renamed.name).toBe("主应用");
		const cleared = await store.rename(project.id, "   ");
		expect(cleared.name).toBeUndefined();
		await expect(store.rename("missing", "x")).rejects.toBeInstanceOf(ProjectNotFoundError);
	});

	it("移除后不再出现在清单里", async () => {
		const store = await ProjectStore.open({ file });
		const project = await store.add({ cwd: "/work/a" });
		await store.remove(project.id);
		expect(store.list()).toEqual([]);
		await expect(store.remove(project.id)).rejects.toBeInstanceOf(ProjectNotFoundError);
	});

	it("重新打开后清单与自定义名都在", async () => {
		const store = await ProjectStore.open({ file });
		const project = await store.add({ cwd: "/work/a", name: "主应用" });

		const reopened = await ProjectStore.open({ file });
		expect(reopened.list()).toEqual([
			{ id: project.id, cwd: "/work/a", name: "主应用", createdAt: project.createdAt },
		]);
	});

	it("读取时跳过不合法的记录", async () => {
		await writeFile(
			file,
			JSON.stringify({
				version: 1,
				projects: [{ cwd: "/work/a", createdAt: 1 }, { cwd: 123 }, { name: "没有目录" }, "不是对象"],
			}),
			"utf8",
		);
		const store = await ProjectStore.open({ file });
		expect(store.list()).toEqual([
			{ id: projectIdOf("/work/a"), cwd: "/work/a", name: undefined, createdAt: 1 },
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

	it("写出的文件带版本号", async () => {
		const store = await ProjectStore.open({ file });
		await store.add({ cwd: "/work/a" });
		const written = JSON.parse(await readFile(file, "utf8")) as { version: number; projects: unknown[] };
		expect(written.version).toBe(1);
		expect(written.projects).toHaveLength(1);
	});
});
