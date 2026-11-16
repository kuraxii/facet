/**
 * 会话清单缓存的测试。
 *
 * 覆盖目录列举、按 cwd 过滤、未变化文件不重读、文件消失后丢弃缓存与并发去重。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionCatalog } from "./session-catalog.ts";

const roots: string[] = [];

async function tempSessions(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "facet-catalog-"));
	roots.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** 写一个会话文件，返回路径。 */
async function writeSession(
	sessionsDir: string,
	group: string,
	name: string,
	options: { cwd?: string; title?: string; text?: string } = {},
): Promise<string> {
	const dir = join(sessionsDir, group);
	await mkdir(dir, { recursive: true });
	const file = join(dir, `${name}.jsonl`);
	const cwd = options.cwd ?? "/work/a";
	const lines = [
		JSON.stringify({ type: "session", version: 3, id: name, timestamp: "2026-01-01T00:00:00.000Z", cwd }),
		JSON.stringify({
			type: "message",
			id: "m1",
			parentId: null,
			message: { role: "user", content: options.text },
		}),
	];
	if (options.title !== undefined) {
		lines.push(JSON.stringify({ type: "session_info", id: "si", parentId: null, name: options.title }));
	}
	await writeFile(file, `${lines.join("\n")}\n`, "utf8");
	return file;
}

describe("SessionCatalog", () => {
	it("列出全部会话并按修改时间倒序", async () => {
		const sessionsDir = await tempSessions();
		await writeSession(sessionsDir, "--a--", "older", { text: "旧的" });
		await new Promise((resolve) => setTimeout(resolve, 10));
		await writeSession(sessionsDir, "--b--", "newer", { cwd: "/work/b", text: "新的" });
		const catalog = new SessionCatalog({ sessionsDir });
		const sessions = await catalog.list();
		expect(sessions).toHaveLength(2);
		expect(sessions[0]?.id).toBe("newer");
		expect(sessions.map((item) => item.id).sort()).toEqual(["newer", "older"]);
	});

	it("指定 cwd 时只返回该目录的会话", async () => {
		const sessionsDir = await tempSessions();
		await writeSession(sessionsDir, "--a--", "in-a", { cwd: "/work/a" });
		await writeSession(sessionsDir, "--b--", "in-b", { cwd: "/work/b" });
		const catalog = new SessionCatalog({ sessionsDir });
		const sessions = await catalog.list("/work/a");
		expect(sessions.map((item) => item.id)).toEqual(["in-a"]);
	});

	it("文件没变过时复用缓存，不再读盘", async () => {
		const sessionsDir = await tempSessions();
		await writeSession(sessionsDir, "--a--", "s1", { text: "你好" });
		const catalog = new SessionCatalog({ sessionsDir });
		const first = await catalog.summaryOf((await catalog.files())[0] as string);
		// 缓存命中后仍能拿到同一份摘要
		const second = await catalog.summaryOf((await catalog.files())[0] as string);
		expect(second).toBe(first);
		expect(first?.firstMessage).toBe("你好");
	});

	it("文件变了以后重读", async () => {
		const sessionsDir = await tempSessions();
		const file = await writeSession(sessionsDir, "--a--", "s1", { text: "旧内容" });
		const catalog = new SessionCatalog({ sessionsDir });
		const before = await catalog.summaryOf(file);
		await new Promise((resolve) => setTimeout(resolve, 10));
		await writeFile(
			file,
			`${JSON.stringify({ type: "session", version: 3, id: "s1", cwd: "/work/a" })}\n${JSON.stringify({
				type: "message",
				id: "m1",
				parentId: null,
				message: { role: "user", content: "新内容" },
			})}\n`,
			"utf8",
		);
		const after = await catalog.summaryOf(file);
		expect(after?.firstMessage).toBe("新内容");
		expect(after).not.toBe(before);
	});

	it("invalidate 之后重读", async () => {
		const sessionsDir = await tempSessions();
		const file = await writeSession(sessionsDir, "--a--", "s1", { text: "旧内容" });
		const catalog = new SessionCatalog({ sessionsDir });
		const before = await catalog.summaryOf(file);
		await writeFile(file, "文件被截断\n", "utf8");
		catalog.invalidate(file);
		const after = await catalog.summaryOf(file);
		expect(after).toBeUndefined();
		expect(before).toBeDefined();
	});

	it("文件消失后丢弃缓存并返回空", async () => {
		const sessionsDir = await tempSessions();
		const file = await writeSession(sessionsDir, "--a--", "s1", { text: "内容" });
		const catalog = new SessionCatalog({ sessionsDir });
		expect(await catalog.summaryOf(file)).toBeDefined();
		await rm(file);
		expect(await catalog.summaryOf(file)).toBeUndefined();
		expect(await catalog.list()).toEqual([]);
	});

	it("同一个文件同时只读一次", async () => {
		const sessionsDir = await tempSessions();
		const file = await writeSession(sessionsDir, "--a--", "s1", { text: "内容" });
		const catalog = new SessionCatalog({ sessionsDir });
		const [left, right] = await Promise.all([catalog.summaryOf(file), catalog.summaryOf(file)]);
		expect(left).toBe(right);
	});

	it("名字落在中段时由背景补齐", async () => {
		const sessionsDir = await tempSessions();
		const dir = join(sessionsDir, "--a--");
		await mkdir(dir, { recursive: true });
		const filler = `${JSON.stringify({
			type: "message",
			id: "m",
			parentId: null,
			message: { role: "assistant", content: `填充 ${"x".repeat(300)}` },
		})}\n`;
		const body = [
			`${JSON.stringify({ type: "session", version: 3, id: "s1", cwd: "/work/a" })}\n`,
			filler.repeat(1500),
			`${JSON.stringify({ type: "session_info", id: "si", parentId: null, name: "中段的名字" })}\n`,
			filler.repeat(1500),
		];
		await writeFile(join(dir, "s1.jsonl"), `${body.join("")}\n`, "utf8");
		const catalog = new SessionCatalog({ sessionsDir });
		// 头尾两段都够不到名字，先按没有名字列出
		expect((await catalog.list())[0]?.name).toBeUndefined();
		expect((await catalog.fillNames()).map((item) => item.name)).toEqual(["中段的名字"]);
		// 补齐后缓存也跟着改了，再取不会再扫
		expect((await catalog.list())[0]?.name).toBe("中段的名字");
	});

	it("本来就短的会话不会被反复扫", async () => {
		const sessionsDir = await tempSessions();
		await writeSession(sessionsDir, "--a--", "s1", { text: "一句话" });
		const catalog = new SessionCatalog({ sessionsDir });
		await catalog.list();
		expect(await catalog.fillNames()).toEqual([]);
		expect(await catalog.fillNames()).toEqual([]);
	});

	it("文件直接铺在会话目录里时也能列出", async () => {
		const sessionsDir = await tempSessions();
		await writeFile(
			join(sessionsDir, "flat.jsonl"),
			`${JSON.stringify({ type: "session", version: 3, id: "flat", cwd: "/work/a" })}\n${JSON.stringify({
				type: "message",
				id: "m1",
				parentId: null,
				message: { role: "user", content: "平铺的会话" },
			})}\n`,
			"utf8",
		);
		const catalog = new SessionCatalog({ sessionsDir });
		expect((await catalog.list()).map((item) => item.id)).toEqual(["flat"]);
	});

	it("目录不存在时返回空清单", async () => {
		const catalog = new SessionCatalog({ sessionsDir: "/nonexistent/sessions" });
		expect(await catalog.list()).toEqual([]);
	});

	it("坏文件不进清单", async () => {
		const sessionsDir = await tempSessions();
		await mkdir(join(sessionsDir, "--a--"), { recursive: true });
		await writeFile(join(sessionsDir, "--a--", "bad.jsonl"), "not json\n", "utf8");
		const catalog = new SessionCatalog({ sessionsDir });
		expect(await catalog.list()).toEqual([]);
	});
});
