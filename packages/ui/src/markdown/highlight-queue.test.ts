// @vitest-environment node
import { describe, expect, it } from "vitest";
import { pendingHighlights, scheduleHighlight } from "./highlight-queue.ts";

/** 等队列跑完：一次空闲只跑一块，所以要多等几个宏任务。 */
async function drain(rounds = 8): Promise<void> {
	for (let round = 0; round < rounds; round += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

describe("高亮排期", () => {
	it("排进来的任务不会在调用栈里立刻跑", async () => {
		const ran: string[] = [];
		scheduleHighlight(() => ran.push("a"));
		expect(ran).toEqual([]);
		await drain();
		expect(ran).toEqual(["a"]);
		expect(pendingHighlights()).toBe(0);
	});

	it("先来先跑，一次空闲只跑一块", async () => {
		const ran: number[] = [];
		for (const index of [1, 2, 3]) {
			scheduleHighlight(() => ran.push(index));
		}
		// 第一次宏任务只该跑掉最前面那一块
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(ran).toEqual([1]);
		await drain();
		expect(ran).toEqual([1, 2, 3]);
	});

	it("取消之后任务不再跑，也不会留在队列里空转", async () => {
		const ran: string[] = [];
		const cancel = scheduleHighlight(() => ran.push("gone"));
		cancel();
		expect(pendingHighlights()).toBeLessThanOrEqual(1);
		await drain();
		expect(ran).toEqual([]);
		expect(pendingHighlights()).toBe(0);
	});

	it("取消之后再正常排的任务照常跑", async () => {
		const ran: string[] = [];
		const cancel = scheduleHighlight(() => ran.push("first"));
		cancel();
		scheduleHighlight(() => ran.push("second"));
		await drain();
		expect(ran).toEqual(["second"]);
	});

	it("流式期间反复取消重排也不会把队列撑大", async () => {
		const ran: number[] = [];
		for (let index = 0; index < 50; index += 1) {
			const cancel = scheduleHighlight(() => ran.push(index));
			cancel();
		}
		expect(pendingHighlights()).toBe(0);
		await drain();
		expect(ran).toEqual([]);
	});
});
