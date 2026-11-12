/**
 * 会话清单通道的测试：多个端订阅同一份，断线按序号补齐，缺口报 resync。
 */
import type { Channel, SessionSummary } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { SessionsChannel } from "./sessions-channel.ts";

const URI = "sessions:/h" as Channel;

function summary(path: string): SessionSummary {
	return {
		id: path,
		path,
		cwd: "/work/a",
		name: undefined,
		parentSessionPath: undefined,
		created: 1,
		modified: 1,
		messageCount: 1,
		firstMessage: "你好",
	};
}

describe("SessionsChannel", () => {
	it("订阅之后收到实时变化，两个端拿到同一份", () => {
		const channel = new SessionsChannel(8);
		const first: unknown[] = [];
		const second: unknown[] = [];
		channel.subscribe(URI, undefined, { id: "c1", send: (frame) => first.push(frame.action) });
		channel.subscribe(URI, undefined, { id: "c2", send: (frame) => second.push(frame.action) });
		channel.publish(URI, { type: "sessions/changed", summary: summary("/a/s1.jsonl"), busy: false });
		expect(first).toEqual(second);
		expect(first).toHaveLength(1);
	});

	it("带 since 订阅时补发之后的变化", () => {
		const channel = new SessionsChannel(8);
		const seen: unknown[] = [];
		channel.subscribe(URI, undefined, { id: "c1", send: (frame) => seen.push(frame.action) });
		channel.publish(URI, { type: "sessions/removed", path: "/a/s1.jsonl" });
		const late: unknown[] = [];
		const result = channel.subscribe(URI, 0, { id: "c2", send: (frame) => late.push(frame.action) });
		expect(result.resync).toBe(false);
		expect(late).toHaveLength(1);
	});

	it("缺口超出缓冲时报 resync", () => {
		const channel = new SessionsChannel(1);
		channel.publish(URI, { type: "sessions/removed", path: "/a/s1.jsonl" });
		channel.publish(URI, { type: "sessions/removed", path: "/a/s2.jsonl" });
		const result = channel.subscribe(URI, 0, { id: "c1", send: () => {} });
		expect(result.resync).toBe(true);
	});

	it("退订之后不再收到", () => {
		const channel = new SessionsChannel(8);
		const seen: unknown[] = [];
		const sink = { id: "c1", send: (frame: { action: unknown }) => seen.push(frame.action) };
		channel.subscribe(URI, undefined, sink);
		channel.unsubscribe(sink);
		channel.publish(URI, { type: "sessions/removed", path: "/a/s1.jsonl" });
		expect(seen).toHaveLength(0);
	});

	it("clear 之后一个订阅者都不剩", () => {
		const channel = new SessionsChannel(8);
		const seen: unknown[] = [];
		channel.subscribe(URI, undefined, { id: "c1", send: (frame) => seen.push(frame.action) });
		channel.clear();
		channel.publish(URI, { type: "sessions/removed", path: "/a/s1.jsonl" });
		expect(seen).toHaveLength(0);
	});
});
