/**
 * 发送闸门。
 *
 * 慢回执期间输入区看起来仍然「有内容、可以发」，连点与长按回车都靠这一道同步占位挡住。
 * 用例按四件事写：同一个键只放一个人、结束就解锁、有在途发送时不开始、键之间互不牵连。
 */
import { describe, expect, it } from "vitest";
import { createSendGate } from "./send-gate.ts";

/** 一份闸门 + 它最近一次上报的编码集合。 */
function harness(options: { hasPendingSend?: () => boolean } = {}) {
	let pending = options.hasPendingSend ?? (() => false);
	let latest: ReadonlySet<string> = new Set();
	const gate = createSendGate({
		hasPendingSend: () => pending(),
		onChange: (encoding) => {
			latest = encoding;
		},
	});
	return {
		gate,
		/** 上报过的编码集合 */
		get encoding(): ReadonlySet<string> {
			return latest;
		},
		/** 模拟主机回执到达（或断线重连）之后在途状态的变化 */
		setPendingSend(next: boolean) {
			pending = () => next;
		},
	};
}

describe("发送闸门", () => {
	it("同一个草稿连点两次只放第一次进去", () => {
		const { gate } = harness();
		const first = gate.begin("/w/a.jsonl");
		expect(first).toBeDefined();
		expect(gate.begin("/w/a.jsonl")).toBeUndefined();
		expect(gate.isEncoding("/w/a.jsonl")).toBe(true);
	});

	it("编码与派发结束后立刻解锁，可以再发", () => {
		const h = harness();
		const ticket = h.gate.begin("/w/a.jsonl");
		expect([...h.encoding]).toEqual(["/w/a.jsonl"]);
		ticket?.close();
		expect([...h.encoding]).toEqual([]);
		expect(h.gate.isEncoding("/w/a.jsonl")).toBe(false);
		expect(h.gate.begin("/w/a.jsonl")).toBeDefined();
	});

	it("票据重复关闭只解一次，不会把后来那次的占位放掉", () => {
		const { gate } = harness();
		const first = gate.begin("/w/a.jsonl");
		first?.close();
		const second = gate.begin("/w/a.jsonl");
		first?.close();
		expect(second).toBeDefined();
		expect(gate.isEncoding("/w/a.jsonl")).toBe(true);
	});

	it("本端有待确认的发送时不开始", () => {
		const { gate, setPendingSend } = harness({ hasPendingSend: () => true });
		expect(gate.begin("/w/a.jsonl")).toBeUndefined();
		// 回执到达之后立刻能再发
		setPendingSend(false);
		expect(gate.begin("/w/a.jsonl")).toBeDefined();
	});

	it("会话之间互不牵连：A 在等回执时 B 仍然发得出去", () => {
		const { gate } = harness();
		const ticket = gate.begin("/w/a.jsonl");
		expect(ticket).toBeDefined();
		// A 在编码，B 是另一条草稿：B 不受影响
		expect(gate.begin("/w/b.jsonl")).toBeDefined();
		// 当前激活的会话换成 B 之后，A 的在途状态也读不出来（由 client 按会话给），B 照常
		expect(gate.isEncoding("/w/a.jsonl")).toBe(true);
	});

	it("上报的集合每次都是一份新副本", () => {
		const h = harness();
		const before = h.encoding;
		h.gate.begin("/w/a.jsonl")?.close();
		expect(h.encoding).not.toBe(before);
		expect([...before]).toEqual([]);
	});

	it("慢回执期间连点只跑一次编码与一次派发", async () => {
		const { gate, setPendingSend } = harness();
		let encoded = 0;
		let dispatched = 0;
		/** 一次点击：占位成功才编码并派发，结束后解锁 */
		const click = () => {
			const ticket = gate.begin("/w/a.jsonl");
			if (ticket === undefined) {
				return undefined;
			}
			return (async () => {
				try {
					// 图片编码是异步的：这里故意让它在回执之前悬着
					encoded += 1;
					await Promise.resolve();
					dispatched += 1;
					// 派发之后主机的回执还没到：这期间在途状态由 client 那边保持为真
					setPendingSend(true);
				} finally {
					ticket.close();
				}
			})();
		};

		const first = click();
		// 同一帧里的第二、第三下：不占位，什么都不做
		expect(click()).toBeUndefined();
		expect(click()).toBeUndefined();
		await first;
		expect([encoded, dispatched]).toEqual([1, 1]);

		// 回执到达后可以接着发下一条
		setPendingSend(false);
		await click();
		expect([encoded, dispatched]).toEqual([2, 2]);
	});
});
