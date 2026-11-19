import { describe, expect, it } from "vitest";
import { EventLog, replayAndSubscribe } from "./event-log.ts";

function statusAction(status: "idle" | "running") {
	return { type: "session/phase" as const, phase: status, maintenance: undefined };
}

describe("EventLog", () => {
	it("序号从 1 开始并单调递增", () => {
		const log = new EventLog(8);
		expect(log.append(statusAction("running")).seq).toBe(1);
		expect(log.append(statusAction("idle")).seq).toBe(2);
		expect(log.lastSeq).toBe(2);
	});

	it("缺省订阅不补发历史", () => {
		const log = new EventLog(8);
		log.append(statusAction("running"));
		const result = log.replay(log.lastSeq);
		expect(result.actions).toEqual([]);
		expect(result.resync).toBe(false);
	});

	it("按序号补发 since 之后的动作", () => {
		const log = new EventLog(8);
		log.append(statusAction("running"));
		log.append(statusAction("idle"));
		const result = log.replay(1);
		expect(result.actions.map((item) => item.seq)).toEqual([2]);
		expect(result.resync).toBe(false);
	});

	it("缓冲溢出后标记需要重新同步", () => {
		const log = new EventLog(2);
		log.append(statusAction("running"));
		log.append(statusAction("idle"));
		log.append(statusAction("running"));
		expect(log.oldestSeq).toBe(2);
		const result = log.replay(0);
		expect(result.resync).toBe(true);
		expect(result.actions.map((item) => item.seq)).toEqual([2, 3]);
	});

	it("since 超出当前序号时标记缺口:那份水位不是这条通道的", () => {
		const log = new EventLog(4);
		log.append(statusAction("running"));
		const result = log.replay(99);
		expect(result.actions).toEqual([]);
		expect(result.resync).toBe(true);
	});
});

/** 收帧并记录序号，用来观察投递顺序。 */
function makeSink(seen: number[], onSend?: (seq: number) => void) {
	return {
		send(frame: { serverSeq: number }) {
			seen.push(frame.serverSeq);
			onSend?.(frame.serverSeq);
		},
	};
}

describe("replayAndSubscribe", () => {
	it("补发 since 之后的帧再回到实时，不重不漏", () => {
		const log = new EventLog<string>(8);
		const sinks = new Set<ReturnType<typeof makeSink>>();
		log.append("a");
		log.append("b");
		const seen: number[] = [];
		const result = replayAndSubscribe(
			log,
			sinks,
			makeSink(seen),
			(item) => ({
				serverSeq: item.seq,
			}),
			0,
		);
		expect(seen).toEqual([1, 2]);
		expect(result).toEqual({ seq: 2, resync: false, replayed: 2 });
		expect(sinks.size).toBe(1);

		log.append("c");
		for (const sink of sinks) {
			sink.send({ serverSeq: log.lastSeq });
		}
		expect(seen).toEqual([1, 2, 3]);
	});

	it("缺省 since 不补发历史，只接实时", () => {
		const log = new EventLog<string>(8);
		log.append("a");
		const seen: number[] = [];
		const result = replayAndSubscribe(
			log,
			new Set<ReturnType<typeof makeSink>>(),
			makeSink(seen),
			(item) => ({
				serverSeq: item.seq,
			}),
			undefined,
		);
		expect(seen).toEqual([]);
		expect(result).toEqual({ seq: 1, resync: false, replayed: 0 });
	});

	it("超出缓冲窗口时标记 resync，只补窗口内的帧", () => {
		const log = new EventLog<string>(2);
		log.append("a");
		log.append("b");
		log.append("c");
		const seen: number[] = [];
		const result = replayAndSubscribe(
			log,
			new Set<ReturnType<typeof makeSink>>(),
			makeSink(seen),
			(item) => ({
				serverSeq: item.seq,
			}),
			0,
		);
		expect(seen).toEqual([2, 3]);
		expect(result.resync).toBe(true);
	});

	it("补发期间重入发布的新帧不会丢：sink 先入集再发包", () => {
		const log = new EventLog<string>(8);
		const sinks = new Set<ReturnType<typeof makeSink>>();
		log.append("a");
		const seen: number[] = [];
		// 第一帧投递时模拟一次重入发布：新帧应当落到这个 sink 上，排在补发帧之后
		const sink = makeSink(seen, (seq) => {
			if (seq !== 1) return;
			const item = log.append("b");
			for (const target of sinks) {
				target.send({ serverSeq: item.seq });
			}
		});
		replayAndSubscribe(log, sinks, sink, (item) => ({ serverSeq: item.seq }), 0);
		expect(seen).toEqual([1, 2]);
	});
});
