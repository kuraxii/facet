/**
 * 会话状态到系统通知的换算。
 *
 * 主机的状态推送一轮里要变好几次，这里只挑"状态真的换了"的那一刻交出去，规则见
 * `notification-events.ts`。用例盯的是这几种：新会话不弹、重复推送不弹、收尾换成失败弹、
 * 从没人等变成有人等弹、同一帧两者都有时只弹等人那一条。
 */
import type { SessionStatus } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { collectNotifications, type SignalMap, signalOf } from "./notification-events.ts";

/** 造一份状态，缺省是"空闲、没有收尾、没人等"。 */
function status(overrides: Partial<SessionStatus> = {}): SessionStatus {
	return { activity: "idle", settle: undefined, pendingInput: 0, seenAt: 0, ...overrides };
}

/** 由若干个「文件 → 状态」造判据表。 */
function signals(entries: Record<string, SessionStatus>): SignalMap {
	return new Map(Object.entries(entries).map(([file, value]) => [file, signalOf(value)]));
}

describe("会话状态翻成系统通知", () => {
	it("新出现的会话不弹：它的收尾是旧事", () => {
		const events = collectNotifications(
			new Map(),
			signals({ "a.jsonl": status({ settle: { at: 100, outcome: "completed", message: undefined } }) }),
		);
		expect(events).toEqual([]);
	});

	it("状态没变就不弹，重复推送也只弹一次", () => {
		const before = signals({
			"a.jsonl": status({ settle: { at: 100, outcome: "completed", message: undefined } }),
		});
		const after = signals({
			"a.jsonl": status({ settle: { at: 100, outcome: "completed", message: undefined } }),
		});
		expect(collectNotifications(before, after)).toEqual([]);
	});

	it("一轮正常收尾弹「回复结束」", () => {
		const before = signals({ "a.jsonl": status({ activity: "running" }) });
		const after = signals({
			"a.jsonl": status({ settle: { at: 200, outcome: "completed", message: undefined } }),
		});
		expect(collectNotifications(before, after)).toEqual([{ file: "a.jsonl", kind: "settled" }]);
	});

	it("收尾是失败时弹「出错」", () => {
		const before = signals({ "a.jsonl": status({ activity: "running" }) });
		const after = signals({
			"a.jsonl": status({ settle: { at: 200, outcome: "failed", message: "请求超时" } }),
		});
		expect(collectNotifications(before, after)).toEqual([{ file: "a.jsonl", kind: "failed" }]);
	});

	it("上一轮的收尾换成新的收尾时再弹一次", () => {
		const before = signals({
			"a.jsonl": status({ settle: { at: 100, outcome: "completed", message: undefined } }),
		});
		const after = signals({
			"a.jsonl": status({ settle: { at: 300, outcome: "completed", message: undefined } }),
		});
		expect(collectNotifications(before, after)).toEqual([{ file: "a.jsonl", kind: "settled" }]);
	});

	it("从没人等变成有人等时弹「需要你回答」", () => {
		const before = signals({ "a.jsonl": status({ activity: "running" }) });
		const after = signals({ "a.jsonl": status({ activity: "running", pendingInput: 1 }) });
		expect(collectNotifications(before, after)).toEqual([{ file: "a.jsonl", kind: "needsInput" }]);
	});

	it("已经在等的时候再推一次不重复弹", () => {
		const before = signals({ "a.jsonl": status({ activity: "running", pendingInput: 1 }) });
		const after = signals({ "a.jsonl": status({ activity: "running", pendingInput: 2 }) });
		expect(collectNotifications(before, after)).toEqual([]);
	});

	it("收尾与等人同帧出现时只弹等人那一条", () => {
		const before = signals({ "a.jsonl": status({ activity: "running" }) });
		const after = signals({
			"a.jsonl": status({ pendingInput: 1, settle: { at: 400, outcome: "completed", message: undefined } }),
		});
		expect(collectNotifications(before, after)).toEqual([{ file: "a.jsonl", kind: "needsInput" }]);
	});

	it("用户中止的一轮没有收尾，不弹", () => {
		// 主机不给中止的一轮记 settle：状态从运行态回到空闲，但 settle 仍为空
		const before = signals({ "a.jsonl": status({ activity: "running" }) });
		const after = signals({ "a.jsonl": status() });
		expect(collectNotifications(before, after)).toEqual([]);
	});

	it("多个会话各自变化时逐条给出", () => {
		const before = signals({
			"a.jsonl": status({ activity: "running" }),
			"b.jsonl": status({ activity: "running" }),
		});
		const after = signals({
			"a.jsonl": status({ settle: { at: 500, outcome: "failed", message: "boom" } }),
			"b.jsonl": status({ settle: { at: 600, outcome: "completed", message: undefined } }),
		});
		expect(collectNotifications(before, after)).toEqual([
			{ file: "a.jsonl", kind: "failed" },
			{ file: "b.jsonl", kind: "settled" },
		]);
	});
});
