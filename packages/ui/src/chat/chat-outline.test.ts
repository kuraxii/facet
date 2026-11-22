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
	it("取最后一个越过视口上沿的条目", () => {
		expect(activeOutlineIndex([-400, -120, 60, 300], 32)).toBe(1);
		expect(activeOutlineIndex([-400, -120, 30, 300], 32)).toBe(2);
	});

	it("都还在上沿以下时取第一条", () => {
		expect(activeOutlineIndex([80, 200], 32)).toBe(0);
	});

	it("没有条目时为空", () => {
		expect(activeOutlineIndex([], 32)).toBeNull();
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
