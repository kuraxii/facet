import { describe, expect, it } from "vitest";
import { EventLog } from "./event-log.ts";

function statusEvent(status: "idle" | "running") {
	return { type: "status" as const, status };
}

describe("EventLog", () => {
	it("序号从 1 开始并单调递增", () => {
		const log = new EventLog(8);
		expect(log.append(statusEvent("running")).seq).toBe(1);
		expect(log.append(statusEvent("idle")).seq).toBe(2);
		expect(log.lastSeq).toBe(2);
	});

	it("缺省订阅不补发历史", () => {
		const log = new EventLog(8);
		log.append(statusEvent("running"));
		const result = log.replay(log.lastSeq);
		expect(result.events).toEqual([]);
		expect(result.resync).toBe(false);
	});

	it("按序号补发 since 之后的事件", () => {
		const log = new EventLog(8);
		log.append(statusEvent("running"));
		log.append(statusEvent("idle"));
		const result = log.replay(1);
		expect(result.events.map((item) => item.seq)).toEqual([2]);
		expect(result.resync).toBe(false);
	});

	it("缓冲溢出后标记需要重新同步", () => {
		const log = new EventLog(2);
		log.append(statusEvent("running"));
		log.append(statusEvent("idle"));
		log.append(statusEvent("running"));
		expect(log.oldestSeq).toBe(2);
		const result = log.replay(0);
		expect(result.resync).toBe(true);
		expect(result.events.map((item) => item.seq)).toEqual([2, 3]);
	});

	it("since 超出当前序号时返回空且不标记缺口", () => {
		const log = new EventLog(4);
		log.append(statusEvent("running"));
		const result = log.replay(99);
		expect(result.events).toEqual([]);
		expect(result.resync).toBe(false);
	});
});
