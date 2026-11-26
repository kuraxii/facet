/**
 * 对话导航的测试。
 *
 * 覆盖条目提取、当前位置判定、靠近指针的放大，以及悬浮意图的延迟与路过判定。
 */
import type { TranscriptItem } from "@facet/client-core";
import { describe, expect, it } from "vitest";
import {
	activeOutlineIndex,
	createOutlineHoverIntent,
	OUTLINE_MAGNIFY_RADIUS,
	outlinePrompts,
	outlineTickMagnification,
} from "./chat-outline.ts";

/** 造一条消息单元，只填导航用得到的字段。 */
function message(
	role: "user" | "assistant",
	text: string,
	options: { id?: string; entryId?: string } = {},
): TranscriptItem {
	return {
		kind: "message",
		id: options.id ?? `v:${text}`,
		entryId: options.entryId,
		role,
		stopReason: undefined,
		parts: [{ kind: "text", partId: "text:0", text }],
		isStreaming: false,
		startedAt: undefined,
		endedAt: undefined,
	};
}

describe("outlinePrompts", () => {
	it("只取用户消息，按出现顺序排列", () => {
		const prompts = outlinePrompts([
			message("user", "第一问", { entryId: "e1" }),
			message("assistant", "回答"),
			message("user", "第二问", { entryId: "e2" }),
		]);
		expect(prompts.map((prompt) => prompt.key)).toEqual(["e1", "e2"]);
		expect(prompts.map((prompt) => prompt.preview)).toEqual(["第一问", "第二问"]);
	});

	it("没有条目 id 的实时消息用视图标识顶上", () => {
		const prompts = outlinePrompts([message("user", "刚发的", { id: "live:1" })]);
		expect(prompts[0]?.key).toBe("live:1");
	});

	it("预览压成一行并截断过长内容", () => {
		const long = `第一行\n\n${"很长的内容".repeat(40)}`;
		const prompts = outlinePrompts([message("user", long, { entryId: "e1" })]);
		expect(prompts[0]?.preview.startsWith("第一行 很长的内容")).toBe(true);
		expect(prompts[0]?.preview.length).toBeLessThanOrEqual(121);
		expect(prompts[0]?.preview.endsWith("…")).toBe(true);
	});

	it("没有正文时给一条占位说明", () => {
		const prompts = outlinePrompts([message("user", "   ", { entryId: "e1" })]);
		expect(prompts[0]?.preview).toBe("第 1 条消息");
	});

	it("没有用户消息时为空", () => {
		expect(outlinePrompts([message("assistant", "只有回答")])).toEqual([]);
	});
});

describe("activeOutlineIndex", () => {
	/** 用一组固定偏移造一个 `topOf`，并记下被问到的次数 */
	function tops(list: readonly (number | undefined)[]) {
		const asked: number[] = [];
		const topOf = (index: number): number | undefined => {
			asked.push(index);
			return list[index];
		};
		return { asked, count: list.length, topOf };
	}

	it("取最后一个越过视口上沿的条目", () => {
		const a = tops([-400, -120, 60, 300]);
		expect(activeOutlineIndex(a.count, a.topOf, 32)).toBe(1);
		const b = tops([-400, -120, 30, 300]);
		expect(activeOutlineIndex(b.count, b.topOf, 32)).toBe(2);
	});

	it("都还在上沿以下时取第一条", () => {
		const a = tops([80, 200]);
		expect(activeOutlineIndex(a.count, a.topOf, 32)).toBe(0);
	});

	it("没有条目时为空", () => {
		const a = tops([]);
		expect(activeOutlineIndex(a.count, a.topOf, 32)).toBeNull();
	});

	it("量不到位置时为空，不默认成第一条", () => {
		// 面板刚挂上、行的位置还没量出来时全是无穷：这时候落第一项，切会话就会看见高亮从顶上闪过去
		const a = tops([Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]);
		expect(activeOutlineIndex(a.count, a.topOf, 32)).toBeNull();
		const b = tops([Number.NaN, 90]);
		expect(activeOutlineIndex(b.count, b.topOf, 32)).toBe(0);
	});

	it("尾部缺失的条目不参与判定", () => {
		const a = tops([-400, -120, undefined, undefined]);
		expect(activeOutlineIndex(a.count, a.topOf, 32)).toBe(1);
	});

	it("中间有缺口时退回线性扫描，结果与逐条比较一致", () => {
		const a = tops([-400, undefined, -120, 300]);
		expect(activeOutlineIndex(a.count, a.topOf, 32)).toBe(2);
		const b = tops([undefined, -120, 60]);
		expect(activeOutlineIndex(b.count, b.topOf, 5)).toBe(1);
	});

	it("长会话里二分结果与线性扫描一致，且量位置的次数远少于条目数", () => {
		// 200+ 条：不能为了算一次高亮把每条消息都读一遍布局
		const list = Array.from({ length: 260 }, (_, index) => index * 40 - 4000);
		const reference = (viewportTop: number): number => {
			let active = 0;
			let hasPosition = false;
			for (let index = 0; index < list.length; index += 1) {
				const top = list[index];
				if (top === undefined || !Number.isFinite(top)) {
					continue;
				}
				hasPosition = true;
				if (top <= viewportTop) {
					active = index;
				}
			}
			return hasPosition ? active : 0;
		};
		for (const viewportTop of [-5000, -4001, -4000, -3999, 0, 32, 1000, 6360, 6361, 9000]) {
			const a = tops(list);
			expect(activeOutlineIndex(a.count, a.topOf, viewportTop)).toBe(reference(viewportTop));
			expect(a.asked.length).toBeLessThanOrEqual(Math.ceil(Math.log2(list.length)) + 3);
		}
	});
});

describe("outlineTickMagnification", () => {
	it("指针所在的位置为 1，半径之外为 0", () => {
		expect(outlineTickMagnification(0)).toBe(1);
		expect(outlineTickMagnification(OUTLINE_MAGNIFY_RADIUS)).toBe(0);
		expect(outlineTickMagnification(OUTLINE_MAGNIFY_RADIUS + 5)).toBe(0);
	});

	it("按距离单调减小且两端平滑", () => {
		const scale = [0, 1, 2, 3].map((distance) => outlineTickMagnification(distance));
		expect(scale[0]).toBeGreaterThan(scale[1] ?? 0);
		expect(scale[1]).toBeGreaterThan(scale[2] ?? 0);
		expect(scale[2]).toBeGreaterThan(0);
		expect(scale[3]).toBe(0);
		// 靠近半径时衰减到接近 0，没有突然的折角
		expect(outlineTickMagnification(OUTLINE_MAGNIFY_RADIUS - 0.01)).toBeLessThan(0.01);
	});
});

describe("createOutlineHoverIntent", () => {
	/** 建一个可以手动推进的计时器。 */
	function createHarness() {
		const scheduled: { callback: () => void; delay: number }[] = [];
		const activated: (number | null)[] = [];
		const intent = createOutlineHoverIntent({
			activate: (index) => activated.push(index),
			schedule: (callback, delay) => {
				scheduled.push({ callback, delay });
				return scheduled.length;
			},
			cancel: () => undefined,
		});
		return { intent, scheduled, activated, flush: () => scheduled.at(-1)?.callback() };
	}

	it("第一次进入要等一会儿才展开预览", () => {
		const { intent, scheduled, activated, flush } = createHarness();
		intent.pointAt(2);
		expect(activated).toEqual([]);
		expect(scheduled).toHaveLength(1);
		expect(scheduled[0]?.delay).toBeGreaterThan(0);
		flush();
		expect(activated).toEqual([2]);
	});

	it("展开之后换一条立即生效", () => {
		const { intent, activated, flush } = createHarness();
		intent.pointAt(2);
		flush();
		intent.pointAt(4);
		expect(activated).toEqual([2, 4]);
	});

	it("横向快速掠过只算路过，不展开", () => {
		const { intent, activated, flush } = createHarness();
		intent.enter({ x: 0, y: 0 });
		intent.move({ x: 10, y: 1 });
		flush();
		expect(activated).toEqual([]);
	});

	it("移开之后收起", () => {
		const { intent, activated, flush } = createHarness();
		intent.pointAt(1);
		flush();
		intent.leave();
		expect(activated).toEqual([1, null]);
	});
});

describe("给出上一帧结果时的探查次数", () => {
	/** 造一个"第 i 条顶边 = i * 100"的正文，并记录被问了几次 */
	function ladder(count: number) {
		const asked: number[] = [];
		const topOf = (index: number): number => {
			asked.push(index);
			return index * 100;
		};
		return { count, topOf, asked };
	}

	it("连续滚动时只问两条就够", () => {
		const { count, topOf, asked } = ladder(105);
		// 视口上沿在 4200：第 42 条已越过、第 43 条还没
		expect(activeOutlineIndex(count, topOf, 4200, 42)).toBe(42);
		expect(asked.length).toBeLessThanOrEqual(2);
	});

	it("上一帧结果不对时落回二分，结果仍然正确", () => {
		const { count, topOf } = ladder(105);
		expect(activeOutlineIndex(count, topOf, 4200, 3)).toBe(42);
		expect(activeOutlineIndex(count, topOf, 4200, 100)).toBe(42);
	});

	it("没有上一帧结果时还是老行为", () => {
		const { count, topOf, asked } = ladder(105);
		expect(activeOutlineIndex(count, topOf, 4200, null)).toBe(42);
		expect(asked.length).toBeGreaterThan(2);
	});
});
