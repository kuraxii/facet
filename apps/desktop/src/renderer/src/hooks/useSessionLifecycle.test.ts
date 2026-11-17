/**
 * 启动时挑哪个会话。
 *
 * 纯函数：先看启动目录里最近更新的一条，一条都没有时退回全部会话里最近的一条。
 */
import type { SessionSummary } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { pickStartupSession } from "./useSessionLifecycle.ts";

function summary(path: string, cwd: string, modified: number): SessionSummary {
	return {
		id: path,
		path,
		cwd,
		name: undefined,
		parentSessionPath: undefined,
		created: 1,
		modified,
		firstMessage: "",
	};
}

describe("pickStartupSession", () => {
	it("优先启动目录里最近更新的一条", () => {
		const pool = [
			summary("/w/a1.jsonl", "/w", 3),
			summary("/w/a2.jsonl", "/w", 9),
			summary("/o/b.jsonl", "/o", 20),
		];
		expect(pickStartupSession(pool, "/w")?.path).toBe("/w/a2.jsonl");
	});

	it("启动目录里没有会话时取全部里最近的一条", () => {
		const pool = [summary("/o/b.jsonl", "/o", 20), summary("/o/c.jsonl", "/o", 7)];
		expect(pickStartupSession(pool, "/w")?.path).toBe("/o/b.jsonl");
	});

	it("一个会话都没有时为空", () => {
		expect(pickStartupSession([], "/w")).toBeUndefined();
	});

	it("目录尾部的斜杠不影响归属", () => {
		const pool = [summary("/w/a.jsonl", "/w/", 1), summary("/o/b.jsonl", "/o", 5)];
		expect(pickStartupSession(pool, "/w")?.path).toBe("/w/a.jsonl");
	});
});
