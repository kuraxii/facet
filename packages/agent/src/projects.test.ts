import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectIdOf, scanSessionProjects } from "./projects.ts";

let root: string;
let sessionsDir: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "facet-projects-"));
	sessionsDir = join(root, "sessions");
	await mkdir(sessionsDir, { recursive: true });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

/** 写一个会话文件，第一行为头。 */
async function writeSession(dir: string, name: string, cwd: string, modified?: Date): Promise<string> {
	const folder = join(sessionsDir, dir);
	await mkdir(folder, { recursive: true });
	const file = join(folder, name);
	const header = JSON.stringify({ type: "session", version: 3, id: name.replace(".jsonl", ""), cwd });
	await writeFile(file, `${header}\n{"type":"message"}\n`, "utf8");
	if (modified) {
		await utimes(file, modified, modified);
	}
	return file;
}

describe("扫描会话目录", () => {
	it("同一目录下的会话合并成一条，时间取最晚", async () => {
		await writeSession("--a--", "s1.jsonl", "/work/a", new Date("2026-01-01T00:00:00Z"));
		await writeSession("--a--", "s2.jsonl", "/work/a", new Date("2026-02-01T00:00:00Z"));
		await writeSession("--b--", "s3.jsonl", "/work/b", new Date("2026-01-15T00:00:00Z"));

		const projects = await scanSessionProjects({ sessionsDir });
		expect(projects.map((project) => project.cwd)).toEqual(["/work/a", "/work/b"]);
		expect(projects[0]?.sessionCount).toBe(2);
		expect(projects[0]?.lastUsed).toBe(new Date("2026-02-01T00:00:00Z").getTime());
		expect(projects[0]?.id).toBe(projectIdOf("/work/a"));
	});

	it("目录不存在也照样提取", async () => {
		await writeSession("--gone--", "s1.jsonl", "/work/已经删掉的目录");
		const projects = await scanSessionProjects({ sessionsDir });
		expect(projects.map((project) => project.cwd)).toEqual(["/work/已经删掉的目录"]);
	});

	it("坏文件与不是会话头的文件跳过", async () => {
		await writeSession("--a--", "ok.jsonl", "/work/a");
		const folder = join(sessionsDir, "--a--");
		await writeFile(join(folder, "broken.jsonl"), "这不是 JSON\n", "utf8");
		await writeFile(join(folder, "entry.jsonl"), `${JSON.stringify({ type: "message" })}\n`, "utf8");
		await writeFile(join(folder, "nocwd.jsonl"), `${JSON.stringify({ type: "session" })}\n`, "utf8");

		const projects = await scanSessionProjects({ sessionsDir });
		expect(projects).toHaveLength(1);
		expect(projects[0]?.sessionCount).toBe(1);
	});

	it("没有会话文件的目录不产生项目", async () => {
		await mkdir(join(sessionsDir, "--empty--"), { recursive: true });
		await mkdir(join(sessionsDir, "--traces--", "traces"), { recursive: true });
		const projects = await scanSessionProjects({ sessionsDir });
		expect(projects).toEqual([]);
	});

	it("会话根目录不存在时返回空", async () => {
		const projects = await scanSessionProjects({ sessionsDir: join(root, "missing") });
		expect(projects).toEqual([]);
	});

	it("标识由路径派生，同一路径稳定", () => {
		expect(projectIdOf("/work/a")).toBe(projectIdOf("/work/a"));
		expect(projectIdOf("/work/a")).not.toBe(projectIdOf("/work/b"));
	});
});
