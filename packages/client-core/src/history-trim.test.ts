/**
 * 更早历史裁剪的规则。
 *
 * 这一组用例只碰纯函数：裁剪点怎么选、游标怎么回退、工具调用状态与标识迁移怎么跟着修剪。
 */
import type { Entry, Message } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { applyHistoryTrim, type HistoryTrimCut, planHistoryTrim } from "./history-trim.ts";
import type { ChatView, EntryView, ToolCallView } from "./state.ts";

/**
 * 这一组用例自己的水位口径。
 *
 * 真实页大小是客户端的构造参数（应用里是 200），所以水位由调用方传入；纯函数不再自带默认值。
 */
const PAGE_SIZE = 50;
const RETAIN_ENTRIES = PAGE_SIZE * 2;

/** 按这份用例的水位算裁剪点：省得每个用例都写一遍第二个参数。 */
function plan(items: readonly EntryView[], maxEntries = RETAIN_ENTRIES): HistoryTrimCut | undefined {
	return planHistoryTrim(items, maxEntries);
}

/** 用户消息。 */
function user(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1 };
}

/** 带一次工具调用的助手消息。 */
function calling(callId: string): Message {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id: callId, name: "read", arguments: {} }],
		provider: "p",
		model: "m",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			reasoning: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 1,
	};
}

/** 工具结果消息。 */
function result(callId: string): Message {
	return {
		role: "toolResult",
		callId,
		toolName: "read",
		content: [{ type: "text", text: "ok" }],
		isError: false,
		timestamp: 1,
	};
}

/** 一条历史条目视图。 */
function view(id: string, message: Message): EntryView {
	const entry: Entry = {
		id,
		parentId: null,
		kind: "message",
		timestamp: "2026-11-19T00:00:00Z",
		message,
	};
	return { id: `e:${id}`, entry, message, streaming: {}, isStreaming: false };
}

/** 一轮：用户、带调用的助手、工具结果。 */
function turn(index: number): EntryView[] {
	return [
		view(`u${index}`, user(`第 ${index} 问`)),
		view(`a${index}`, calling(`c${index}`)),
		view(`t${index}`, result(`c${index}`)),
	];
}

/** 若干轮的条目。 */
function turns(count: number): EntryView[] {
	const items: EntryView[] = [];
	for (let index = 0; index < count; index += 1) {
		items.push(...turn(index));
	}
	return items;
}

/** 一份对话视图。 */
function chat(items: readonly EntryView[], toolCalls: Record<string, ToolCallView> = {}): ChatView {
	return { channel: "chat:/s1", items, toolCalls, notices: [], renames: {} };
}

/** 取一个必定存在的裁剪点；规则用例里用它省掉判空。 */
function mustCut(items: readonly EntryView[]): HistoryTrimCut {
	const cut = plan(items);
	if (cut === undefined) {
		throw new Error("这一组条目应当有裁剪点");
	}
	return cut;
}

/** 一个工具调用视图。 */
function call(callId: string): ToolCallView {
	return {
		callId,
		toolName: "read",
		input: {},
		output: undefined,
		isError: false,
		isRunning: false,
		durationMs: undefined,
	};
}

describe("planHistoryTrim", () => {
	it("两页水位之内不裁", () => {
		expect(plan(turns(10))).toBeUndefined();
	});

	it("刚过水位时裁到整轮的起点，保留区不少于两页", () => {
		const items = turns(40); // 120 条
		const cut = plan(items);
		expect(cut).toBeDefined();
		expect(cut?.cutViewId).toBe(items[cut?.cutIndex ?? 0]?.id);
		// 裁剪点落在用户消息上：一轮不被劈开
		expect(items[cut?.cutIndex ?? 0]?.message?.role).toBe("user");
		expect(items.length - (cut?.cutIndex ?? 0)).toBeGreaterThanOrEqual(RETAIN_ENTRIES);
		// 不多留一整轮：再往前一轮就低于水位了
		expect(items.length - (cut?.cutIndex ?? 0) - 3).toBeLessThan(RETAIN_ENTRIES);
	});

	it("游标取保留区首条的条目 id", () => {
		const items = turns(40);
		const cut = plan(items);
		const kept = items[cut?.cutIndex ?? 0];
		expect(cut?.olderCursor).toBe(kept?.entry?.id);
		expect(cut?.olderCursor).not.toContain("e:");
	});

	it("同一份条目再算一次结果相同，重复裁不会改变结果", () => {
		const items = turns(40);
		const first = mustCut(items);
		expect(plan(items)).toEqual(first);
		const once = applyHistoryTrim(chat(items), first);
		expect(applyHistoryTrim(once, first).items).toEqual(once.items);
		// 反复裁到收敛为止：每一轮仍然对齐整轮，终态不再有可裁的点
		let current = once;
		for (let round = 0; round < 3; round += 1) {
			const next = plan(current.items);
			if (next === undefined) {
				break;
			}
			current = applyHistoryTrim(current, next);
		}
		expect(plan(current.items)).toBeUndefined();
		expect(current.items.length).toBeGreaterThanOrEqual(RETAIN_ENTRIES - 1);
	});

	it("水的另一端没有整轮可对齐时向前找，不硬切在条目中间", () => {
		// 前 60 条是没有轮的孤儿条目，后面接着 30 整轮
		const items = [
			...Array.from({ length: 60 }, (_, index) => view(`x${index}`, calling(`c${index}`))),
			...turns(30),
		];
		const cut = plan(items);
		expect(cut).toBeDefined();
		expect(items[cut?.cutIndex ?? 0]?.message?.role).toBe("user");
	});

	it("一条用户消息都没有时不裁", () => {
		const items = Array.from({ length: 200 }, (_, index) => view(`a${index}`, calling(`c${index}`)));
		expect(plan(items)).toBeUndefined();
	});

	it("流式写入中的那条不当裁剪点", () => {
		const items = turns(40);
		const target = items.length - PAGE_SIZE * 2;
		// 正好把水位那条改成"用户消息但仍在写"
		const streaming = items[target + 1];
		const patched = items.map((item, index) =>
			index === target + 1 && streaming !== undefined ? { ...streaming, isStreaming: true } : item,
		);
		const cut = plan(patched);
		expect(cut?.cutIndex).not.toBe(target + 1);
	});
});

describe("applyHistoryTrim", () => {
	it("只留保留区，游标之外的工具调用与标识迁移一起被清掉", () => {
		const items = turns(40);
		const cut = mustCut(items);
		const before = chat(items, {
			c0: call("c0"),
			c39: call("c39"),
		});
		const renames = { live1: items[0]?.id ?? "", live2: items[items.length - 1]?.id ?? "" };
		const after = applyHistoryTrim({ ...before, renames }, cut);
		expect(after.items).toEqual(items.slice(cut.cutIndex));
		expect(after.items.length).toBeLessThan(items.length);
		// 被裁掉那一轮的工具调用不再留着，否则会以孤立卡片出现在对话末尾
		expect(Object.keys(after.toolCalls)).toEqual(["c39"]);
		expect(after.renames).toEqual({ live2: items[items.length - 1]?.id });
	});

	it("保留区仍然引用到的工具调用不动", () => {
		const items = turns(40);
		const cut = mustCut(items);
		const keptCallId = items[cut.cutIndex]?.message?.role === "user" ? `c${cut.cutIndex / 3}` : "";
		const after = applyHistoryTrim(chat(items, { [keptCallId]: call(keptCallId) }), cut);
		expect(after.toolCalls[keptCallId]).toBeDefined();
	});

	it("越界的裁剪点只当没裁", () => {
		const items = turns(3);
		const after = applyHistoryTrim(chat(items), {
			cutIndex: 0,
			cutViewId: "e:u0",
			olderCursor: "u0",
		});
		expect(after.items).toHaveLength(items.length);
	});
});
