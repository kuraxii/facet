import type { SessionSummary } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import {
	buildInbox,
	collectInboxProjects,
	deriveAttention,
	PROJECT_BADGE_TONE_COUNT,
	projectBadgeTone,
	projectMonogram,
	searchInboxEntries,
	sessionKeyOf,
} from "./inbox-model.ts";

const NOW = 1_700_000_000_000;

function summary(overrides: Partial<SessionSummary> & Pick<SessionSummary, "id" | "path">): SessionSummary {
	return {
		cwd: "D:\\User\\Desktop\\facet",
		name: undefined,
		parentSessionPath: undefined,
		created: NOW - 10_000,
		modified: NOW - 5_000,
		firstMessage: "做点什么",
		...overrides,
	};
}

describe("inbox-model", () => {
	it("projectMonogram 生成 2 字符缩写", () => {
		expect(projectMonogram("facet")).toBe("FA");
		expect(projectMonogram("linx-icp")).toBe("LI");
		expect(projectMonogram("")).toBe("--");
		const tone = projectBadgeTone("facet");
		expect(tone).toBeGreaterThanOrEqual(0);
		expect(tone).toBeLessThan(PROJECT_BADGE_TONE_COUNT);
		expect(projectBadgeTone("facet")).toBe(tone);
	});

	it("聚合多主机未归档与已归档会话，过滤 0 消息空会话，支持离线缓存", () => {
		const localKey = sessionKeyOf("local", "/s/a.jsonl");
		const settledKey = sessionKeyOf("local", "/s/done.jsonl");
		const offlineKey = sessionKeyOf("ssh://laptop", "/remote/b.jsonl");

		const data = buildInbox({
			now: NOW,
			feeds: [
				{
					endpoint: "local",
					hostLabel: "This computer",
					isLocal: true,
					isOnline: true,
					projects: [],
					statuses: new Map([
						["/s/a.jsonl", { activity: "running", pendingInput: 0, seenAt: NOW, settle: undefined }],
					]),
					sessions: [
						summary({ id: "a", path: "/s/a.jsonl", modified: NOW - 1_000 }),
						summary({ id: "done", path: "/s/done.jsonl", firstMessage: "旧任务", modified: NOW - 20_000 }),
						summary({ id: "empty", path: "/s/empty.jsonl", firstMessage: "" }),
					],
				},
			],
			settled: { [settledKey]: NOW - 3_000 },
			offlineCache: [
				{
					key: offlineKey,
					endpoint: "ssh://laptop",
					file: "/remote/b.jsonl",
					hostLabel: "laptop",
					projectName: "clard",
					cwd: "/srv/clard",
					title: "远程断线任务",
					agentId: "pi",
					updatedAt: NOW - 500,
				},
			],
		});

		expect(data.active.map((item) => item.key)).toEqual([offlineKey, localKey]);
		expect(data.active[0]?.hostOnline).toBe(false);
		expect(data.active[0]?.projectMonogram).toBe("CL");
		expect(data.active[0]?.bucket).toBe("done");
		expect(data.active[1]?.attention).toBe("running");
		expect(data.active[1]?.bucket).toBe("running");
		expect(data.active[1]?.projectName).toBe("facet");

		expect(data.settled.map((item) => item.key)).toEqual([settledKey]);
		expect(deriveAttention({ activity: "idle", pendingInput: 1, seenAt: NOW, settle: undefined })).toBe(
			"needs_approval",
		);

		expect(collectInboxProjects(data.active, data.settled).map((p) => p.projectName)).toEqual([
			"clard",
			"facet",
		]);
		const searchAll = searchInboxEntries({
			activeCards: data.active,
			settledItems: data.settled,
			keyword: "",
			limit: 10,
		});
		expect(searchAll.map((item) => item.key)).toEqual([offlineKey, localKey, settledKey]);
		const searchByProj = searchInboxEntries({
			activeCards: data.active,
			settledItems: data.settled,
			keyword: "旧",
			projectFilter: "facet",
			limit: 10,
		});
		expect(searchByProj.map((item) => item.key)).toEqual([settledKey]);
	});
});
