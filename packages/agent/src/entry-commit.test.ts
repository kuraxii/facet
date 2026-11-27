import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { collectCommittedEntries } from "./entry-commit.ts";

function messageEntry(id: string, parentId: string | null, message: Record<string, unknown>): SessionEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2026-11-27T00:00:00Z",
		message,
	} as unknown as SessionEntry;
}

describe("collectCommittedEntries", () => {
	it("从边界之后截取新增条目并按消息引用回填 messageSeq", () => {
		const userRaw = { role: "user", content: "hi", timestamp: 1 };
		const assistantRaw = {
			role: "assistant",
			content: [],
			provider: "p",
			model: "m",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		};
		const oldEntry = messageEntry("e1", null, { role: "user", content: "old", timestamp: 0 });
		const newUser = messageEntry("e2", "e1", userRaw);
		const usage = {
			type: "usage",
			id: "e3",
			parentId: "e2",
			timestamp: "2026-11-27T00:00:01Z",
			kind: "turn",
			provider: "p",
			model: "m",
			usage: {},
		} as unknown as SessionEntry;
		const newAssistant = messageEntry("e4", "e3", assistantRaw);

		const started = new WeakMap<object, number>();
		started.set(userRaw, 1);
		started.set(assistantRaw, 2);

		const result = collectCommittedEntries([oldEntry, newUser, usage, newAssistant], "e1", started, []);
		expect(
			result.map((item) => ({ id: item.entry.id, kind: item.entry.kind, seq: item.messageSeq })),
		).toEqual([
			{ id: "e2", kind: "message", seq: 1 },
			{ id: "e3", kind: "usage", seq: undefined },
			{ id: "e4", kind: "message", seq: 2 },
		]);
		expect(started.has(userRaw)).toBe(false);
		expect(started.has(assistantRaw)).toBe(false);
	});

	it("找不到边界时不重复吐出历史条目", () => {
		const e1 = messageEntry("e1", null, { role: "user", content: "old", timestamp: 0 });
		expect(collectCommittedEntries([e1], "missing", new WeakMap(), [])).toEqual([]);
	});
});
