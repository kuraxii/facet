/**
 * 会话清单推送的测试。
 *
 * 覆盖摘要查找、删除、合并时间片与推送失败不影响其他会话。
 */
import type { Channel, SessionSummary } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { SessionIndex, type SessionIndexSource } from "./session-index.ts";
import { SessionsChannel } from "./sessions-channel.ts";

const URI = "sessions:/h" as Channel;

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		id: "s1",
		path: "/work/a/s1.jsonl",
		cwd: "/work/a",
		name: "会话一",
		parentSessionPath: undefined,
		created: 1,
		modified: 2,
		messageCount: 3,
		firstMessage: "你好",
		...overrides,
	};
}

function source(overrides: Partial<SessionIndexSource> = {}): SessionIndexSource {
	return {
		listSessions: async () => [summary()],
		peekSessionCwd: async () => "/work/a",
		busyFiles: () => [],
		...overrides,
	};
}

/** 收下推送的动作，测试直接断言。 */
function collector() {
	const frames: { channel: string; action: unknown }[] = [];
	const channel = new SessionsChannel(16);
	channel.subscribe(URI, undefined, {
		id: "c1",
		send: (frame) => frames.push({ channel: frame.channel, action: frame.action }),
	});
	return { channel, frames };
}

describe("SessionIndex", () => {
	it("会话变化后推一条摘要", async () => {
		const { channel, frames } = collector();
		const index = new SessionIndex({ channel, uri: URI, source: source(), debounceMs: 0 });
		index.note("/work/a/s1.jsonl");
		await index.flush();
		expect(frames).toEqual([
			{ channel: URI, action: { type: "sessions/changed", summary: summary(), busy: false } },
		]);
	});

	it("主机上正在跑时带上运行标记", async () => {
		const { channel, frames } = collector();
		const index = new SessionIndex({
			channel,
			uri: URI,
			source: source({ busyFiles: () => ["/work/a/s1.jsonl"] }),
			debounceMs: 0,
		});
		index.note("/work/a/s1.jsonl");
		await index.flush();
		expect(frames[0]?.action).toMatchObject({ type: "sessions/changed", busy: true });
	});

	it("文件已经不在了就推删除", async () => {
		const { channel, frames } = collector();
		const index = new SessionIndex({ channel, uri: URI, source: source(), debounceMs: 0 });
		index.note("/work/a/s1.jsonl", "removed");
		await index.flush();
		expect(frames).toEqual([
			{ channel: URI, action: { type: "sessions/removed", path: "/work/a/s1.jsonl" } },
		]);
	});

	it("读不到目录里的摘要时也按删除处理", async () => {
		const { channel, frames } = collector();
		const index = new SessionIndex({
			channel,
			uri: URI,
			source: source({ listSessions: async () => [] }),
			debounceMs: 0,
		});
		index.note("/work/a/s1.jsonl");
		await index.flush();
		expect(frames[0]?.action).toEqual({ type: "sessions/removed", path: "/work/a/s1.jsonl" });
	});

	it("会话文件读不到时按删除处理", async () => {
		const { channel, frames } = collector();
		const index = new SessionIndex({
			channel,
			uri: URI,
			source: source({
				peekSessionCwd: async () => {
					throw new Error("不存在");
				},
			}),
			debounceMs: 0,
		});
		index.note("/work/a/s1.jsonl");
		await index.flush();
		expect(frames[0]?.action).toEqual({ type: "sessions/removed", path: "/work/a/s1.jsonl" });
	});

	it("同一会话在一个时间片里只推一次", async () => {
		const { channel, frames } = collector();
		const index = new SessionIndex({ channel, uri: URI, source: source(), debounceMs: 5 });
		index.note("/work/a/s1.jsonl");
		index.note("/work/a/s1.jsonl");
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(frames).toHaveLength(1);
	});

	it("stop 之后不再推", async () => {
		const { channel, frames } = collector();
		const index = new SessionIndex({ channel, uri: URI, source: source(), debounceMs: 5 });
		index.note("/work/a/s1.jsonl");
		index.stop();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(frames).toHaveLength(0);
	});
});
