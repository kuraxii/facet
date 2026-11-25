/**
 * 会话文件摘要读取的测试。
 *
 * 覆盖头部字段、两段名字扫描、首条用户消息的命中与放弃，以及坏文件的处理。
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeProjectPath } from "./projects.ts";
import {
	readFirstUserMessage,
	readSessionHeader,
	readSessionName,
	readSessionNameFully,
	readSessionSummary,
} from "./session-scan.ts";

const roots: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "facet-scan-"));
	roots.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** 文件大小，读名字要按大小决定扫哪几段。 */
async function sizeOf(file: string): Promise<number> {
	return (await stat(file)).size;
}

/** 一行会话条目，字段与 pi 写的 JSON 一致。 */
function line(value: Record<string, unknown>): string {
	return `${JSON.stringify(value)}\n`;
}

/** 会话文件头。 */
function header(cwd = "/work/a", extra: Record<string, unknown> = {}): string {
	return line({
		type: "session",
		version: 3,
		id: "s1",
		timestamp: "2026-01-01T00:00:00.000Z",
		cwd,
		...extra,
	});
}

/** 一条用户消息，内容按 pi 的块数组写法。 */
function userMessage(text: string): string {
	return line({
		type: "message",
		id: "m1",
		parentId: null,
		timestamp: "2026-01-01T00:00:01.000Z",
		message: { role: "user", content: [{ type: "text", text }] },
	});
}

/** 一条改名记录。 */
function sessionInfo(name: string | undefined): string {
	return line({ type: "session_info", id: `si-${name ?? "clear"}`, parentId: null, name });
}

/** 填充内容，把改名字段推到文件中间或末尾。 */
function filler(bytes: number): string {
	let text = "";
	while (text.length < bytes) {
		text += userMessage(`填充 ${"x".repeat(200)}`);
	}
	return text;
}

describe("readSessionHeader", () => {
	it("取出标识、目录、创建时间与分叉来源", async () => {
		const dir = await tempDir();
		const file = join(dir, "s1.jsonl");
		await writeFile(file, header("/work/a", { parentSession: "/work/parent.jsonl" }), "utf8");
		const parsed = await readSessionHeader(file);
		expect(parsed.id).toBe("s1");
		expect(parsed.cwd).toBe("/work/a");
		expect(parsed.parentSessionPath).toBe("/work/parent.jsonl");
		expect(parsed.created).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
	});

	it("文件不在时抛错", async () => {
		await expect(readSessionHeader("/nonexistent/s1.jsonl")).rejects.toThrow(/does not exist/u);
	});

	it("不是会话文件时抛错", async () => {
		const dir = await tempDir();
		const file = join(dir, "bad.jsonl");
		await writeFile(file, '{"type":"message"}\n', "utf8");
		await expect(readSessionHeader(file)).rejects.toThrow(/Not a session file/u);
	});
});

describe("readSessionName", () => {
	it("名字在开头时能取到", async () => {
		const dir = await tempDir();
		const file = join(dir, "s1.jsonl");
		await writeFile(file, header() + sessionInfo("开头起的名字") + filler(20_000), "utf8");
		expect((await readSessionName(file, await sizeOf(file))).name).toBe("开头起的名字");
	});

	it("名字在末尾时取最后一条", async () => {
		const dir = await tempDir();
		const file = join(dir, "s1.jsonl");
		const body = `${header()}${filler(400_000)}${sessionInfo("先起的名字")}${sessionInfo("后起的名字")}`;
		await writeFile(file, body, "utf8");
		expect((await readSessionName(file, await sizeOf(file))).name).toBe("后起的名字");
	});

	it("最后一条是清空时按没有名字处理", async () => {
		const dir = await tempDir();
		const file = join(dir, "s1.jsonl");
		const body = `${header()}${filler(400_000)}${sessionInfo("名字")}${sessionInfo(undefined)}`;
		await writeFile(file, body, "utf8");
		const found = await readSessionName(file, await sizeOf(file));
		expect(found.name).toBeUndefined();
		expect(found.complete).toBe(true);
	});

	it("文件不在时返回空且不算扫过", async () => {
		const found = await readSessionName("/nonexistent/s1.jsonl", 100);
		expect(found.name).toBeUndefined();
		expect(found.complete).toBe(false);
	});

	it("头尾都扫不到时标为没扫全", async () => {
		const dir = await tempDir();
		const file = join(dir, "s1.jsonl");
		await writeFile(
			file,
			`${header()}${filler(400_000)}${sessionInfo("中段的名字")}${filler(400_000)}`,
			"utf8",
		);
		const found = await readSessionName(file, await sizeOf(file));
		expect(found.name).toBeUndefined();
		expect(found.complete).toBe(false);
		// 整份扫一遍能拿到中段的名字
		expect(await readSessionNameFully(file)).toBe("中段的名字");
	});
});

describe("readFirstUserMessage", () => {
	it("取第一条用户消息的文本", async () => {
		const dir = await tempDir();
		const file = join(dir, "s1.jsonl");
		await writeFile(file, header() + userMessage("看下这个项目") + userMessage("第二条"), "utf8");
		expect(await readFirstUserMessage(file)).toBe("看下这个项目");
	});

	it("没有用户消息时返回空串", async () => {
		const dir = await tempDir();
		const file = join(dir, "s1.jsonl");
		await writeFile(file, header(), "utf8");
		expect(await readFirstUserMessage(file)).toBe("");
	});

	it("文件不存在时返回空串", async () => {
		expect(await readFirstUserMessage("/nonexistent/s1.jsonl")).toBe("");
	});
});

describe("readSessionSummary", () => {
	it("有名字时不再去找首条消息", async () => {
		const dir = await tempDir();
		const file = join(dir, "s1.jsonl");
		await writeFile(file, header() + sessionInfo("会话名") + userMessage("不该被读出来"), "utf8");
		const result = await readSessionSummary(file, { size: await sizeOf(file), mtimeMs: 1_700_000_000_000 });
		const summary = result?.summary;
		expect(summary?.name).toBe("会话名");
		expect(summary?.firstMessage).toBe("");
		expect(summary?.modified).toBe(1_700_000_000_000);
		expect(summary?.cwd).toBe(normalizeProjectPath("/work/a"));
	});

	it("没有名字时用首条消息", async () => {
		const dir = await tempDir();
		const file = join(dir, "s1.jsonl");
		await writeFile(file, header() + userMessage("第一句"), "utf8");
		const summary = (await readSessionSummary(file, { size: await sizeOf(file), mtimeMs: 1 }))?.summary;
		expect(summary?.name).toBeUndefined();
		expect(summary?.firstMessage).toBe("第一句");
	});

	it("不是会话文件时返回空", async () => {
		const dir = await tempDir();
		const file = join(dir, "bad.jsonl");
		await writeFile(file, "not json\n", "utf8");
		expect(await readSessionSummary(file, { size: 10, mtimeMs: 1 })).toBeUndefined();
	});

	it("文件不存在时返回空", async () => {
		const dir = await tempDir();
		await mkdir(join(dir, "x"));
		expect(await readSessionSummary(join(dir, "missing.jsonl"), { size: 0, mtimeMs: 1 })).toBeUndefined();
	});
});
