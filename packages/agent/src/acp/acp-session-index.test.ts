import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeAcpLocator } from "@facet/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AcpSessionIndex } from "./acp-session-index.ts";

describe("ACP 轻量会话索引", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "facet-acp-idx-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("支持写入、按目录与后端筛选、改名和删除", async () => {
		const index = new AcpSessionIndex(dir);
		await index.upsert({
			agentId: "antigravity",
			externalSessionId: "s1",
			cwd: "/work/a",
			modified: 100,
			firstMessage: "分析日志",
		});
		await index.upsert({
			agentId: "claude",
			externalSessionId: "s2",
			cwd: "/work/b",
			modified: 200,
			firstMessage: "重构模块",
		});

		expect(index.list().map((item) => item.id)).toEqual(["s2", "s1"]);
		expect(index.list("/work/a").map((item) => item.id)).toEqual(["s1"]);
		expect(index.list(undefined, "antigravity").map((item) => item.id)).toEqual(["s1"]);

		const locator = makeAcpLocator("antigravity", "s1");
		const renamed = await index.rename(locator, "Antigravity 会话");
		expect(renamed?.name).toBe("Antigravity 会话");

		// 重新实例化后也能从磁盘读回
		const reloaded = new AcpSessionIndex(dir);
		expect(reloaded.summaryOf(locator)?.name).toBe("Antigravity 会话");

		expect(await reloaded.remove(locator)).toBe(true);
		expect(reloaded.list(undefined, "antigravity")).toEqual([]);
	});
});
