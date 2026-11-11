import type { TranscriptItem } from "@facet/client-core";
import { describe, expect, it } from "vitest";
import { groupRows, metaSummary } from "./group.ts";

function item(overrides: Partial<TranscriptItem> & Pick<TranscriptItem, "id" | "role">): TranscriptItem {
	return {
		kind: "message",
		entryId: undefined,
		stopReason: undefined,
		parts: [],
		isStreaming: false,
		startedAt: undefined,
		endedAt: undefined,
		...overrides,
	};
}

function text(partId: string, value: string) {
	return { kind: "text" as const, partId, text: value };
}

function thinking(partId: string, value: string) {
	return { kind: "thinking" as const, partId, text: value };
}

function tool(partId: string, callId: string, durationMs?: number, details?: unknown) {
	return {
		kind: "toolCall" as const,
		partId,
		callId,
		name: "read",
		input: undefined,
		status: "done" as const,
		output: undefined,
		durationMs,
		details,
	};
}

describe("分行", () => {
	it("连续的无正文消息合成一个过程行", () => {
		const rows = groupRows([
			item({ id: "m1", role: "user", parts: [text("text:0", "看一下")] }),
			item({ id: "m2", role: "assistant", parts: [thinking("thinking:0", "先读文件")] }),
			item({ id: "m3", role: "assistant", parts: [tool("tool:c1", "c1", 120)] }),
			item({ id: "m4", role: "assistant", parts: [text("text:0", "看完了")] }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["user", "meta", "assistant", "fork"]);
		expect(rows[1]?.items.map((entry) => entry.id)).toEqual(["m2", "m3"]);
		expect(rows[1]?.thinkingCount).toBe(1);
		expect(rows[1]?.toolCount).toBe(1);
		expect(rows[1]?.toolCount).toBe(1);
		// 没有时间戳就算不出这一轮的工作时长,摘要留空
		expect(metaSummary(rows[1] as (typeof rows)[number])).toBe("");
	});

	it("过程行说的是这一轮的工作时长,不是工具耗时之和", () => {
		const rows = groupRows([
			item({ id: "m1", role: "user", parts: [text("text:0", "改一下")], startedAt: 1_000, endedAt: 1_000 }),
			item({
				id: "m2",
				role: "assistant",
				parts: [thinking("thinking:0", "想"), tool("tool:c1", "c1", 120)],
				startedAt: 1_000,
				endedAt: 1_400,
			}),
			item({
				id: "m3",
				role: "assistant",
				parts: [text("text:1", "好了")],
				startedAt: 1_600,
				endedAt: 1_800,
			}),
		]);
		expect(rows[1]?.durationMs).toBe(800);
		expect(metaSummary(rows[1] as (typeof rows)[number])).toBe("工作 800 毫秒");
	});

	it("没有答复时按已见到的最后时间算", () => {
		const rows = groupRows([
			item({ id: "m1", role: "user", parts: [text("text:0", "问")], startedAt: 1_000, endedAt: 1_000 }),
			item({ id: "m2", role: "assistant", parts: [tool("tool:c1", "c1")], startedAt: 1_000, endedAt: 2_500 }),
		]);
		expect(rows[1]?.durationMs).toBe(1_500);
	});

	it("下一轮重新计时", () => {
		const rows = groupRows([
			item({ id: "m1", role: "user", parts: [text("text:0", "问")], startedAt: 1_000, endedAt: 1_000 }),
			item({ id: "m2", role: "assistant", parts: [text("text:0", "答")], startedAt: 1_000, endedAt: 2_000 }),
			item({ id: "m3", role: "user", parts: [text("text:0", "再问")], startedAt: 9_000, endedAt: 9_000 }),
			item({
				id: "m4",
				role: "assistant",
				parts: [tool("tool:c1", "c1")],
				startedAt: 9_000,
				endedAt: 9_400,
			}),
			item({
				id: "m5",
				role: "assistant",
				parts: [text("text:0", "再答")],
				startedAt: 9_400,
				endedAt: 9_500,
			}),
		]);
		expect(rows[3]?.durationMs).toBe(500);
	});

	it("正文是过程行的边界", () => {
		const rows = groupRows([
			item({ id: "m1", role: "user", parts: [text("text:0", "问")] }),
			item({ id: "m2", role: "assistant", parts: [thinking("thinking:0", "想")] }),
			item({ id: "m3", role: "assistant", parts: [text("text:0", "答")] }),
			item({ id: "m4", role: "assistant", parts: [thinking("thinking:0", "再想")] }),
			item({ id: "m5", role: "assistant", parts: [text("text:0", "再答")] }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["user", "meta", "assistant", "meta", "assistant", "fork"]);
		expect(rows[2]?.id).toBe("m3");
		expect(rows[4]?.id).toBe("m5");
	});

	it("行标识取组内首项,流式追加时不变", () => {
		const before = groupRows([
			item({ id: "m1", role: "user", parts: [text("text:0", "问")] }),
			item({ id: "m2", role: "assistant", parts: [thinking("thinking:0", "想")], isStreaming: true }),
		]);
		const after = groupRows([
			item({ id: "m1", role: "user", parts: [text("text:0", "问")] }),
			item({ id: "m2", role: "assistant", parts: [thinking("thinking:0", "想")], isStreaming: true }),
			item({ id: "m3", role: "assistant", parts: [tool("tool:c1", "c1")], isStreaming: true }),
		]);
		expect(before[1]?.id).toBe("m2");
		expect(after[1]?.id).toBe("m2");
		expect(after[1]?.isStreaming).toBe(true);
	});

	it("文件改动行排在正文之后", () => {
		const patch = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1 +1 @@", "-old", "+next", "+more"].join("\n");
		const rows = groupRows([
			item({ id: "m1", role: "assistant", parts: [tool("tool:c1", "c1", 40, { patch })] }),
			item({ id: "m2", role: "assistant", parts: [text("text:0", "改好了")] }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["meta", "assistant", "diff", "fork"]);
		expect(rows[2]?.id).toBe("diff:c1");
		expect(rows[2]?.diffs[0]?.files).toEqual(["src/a.ts"]);
		expect(rows[2]?.diffs[0]?.added).toBe(2);
		expect(rows[2]?.diffs[0]?.removed).toBe(1);
	});

	it("没有正文的回合,改动行跟在过程行之后收尾", () => {
		const patch = ["--- a/b.ts", "+++ b/b.ts", "@@", "-x", "+y"].join("\n");
		const rows = groupRows([
			item({ id: "m1", role: "user", parts: [text("text:0", "改一下")] }),
			item({ id: "m2", role: "assistant", parts: [tool("tool:c1", "c1", 5, { patch })] }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["user", "meta", "diff", "fork"]);
	});

	it("下一轮开始时先收尾上一轮未显示完的改动行", () => {
		const patch = ["--- a/c.ts", "+++ b/c.ts", "@@", "-x", "+y"].join("\n");
		const rows = groupRows([
			item({ id: "m1", role: "assistant", parts: [tool("tool:c1", "c1", 5, { patch })] }),
			item({ id: "m2", role: "user", parts: [text("text:0", "再来")] }),
			item({ id: "m3", role: "assistant", parts: [text("text:0", "好")] }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["meta", "diff", "user", "assistant", "fork"]);
	});

	it("带正文的答复携带工具时,改动行排在答复行之后", () => {
		const patch = ["--- a/b.ts", "+++ b/b.ts", "@@", "-x", "+y"].join("\n");
		const rows = groupRows([
			item({
				id: "m1",
				role: "assistant",
				parts: [text("text:0", "改好了"), tool("tool:c1", "c1", 10, { patch })],
			}),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["assistant", "diff", "fork"]);
		expect(rows[0]?.toolCount).toBe(1);
	});

	it("每一轮末尾各有一个分叉点", () => {
		const rows = groupRows([
			item({ id: "e:u1", entryId: "u1", role: "user", parts: [text("text:0", "问")] }),
			item({ id: "e:a1", entryId: "a1", role: "assistant", parts: [text("text:0", "答")] }),
			item({ id: "e:u2", entryId: "u2", role: "user", parts: [text("text:0", "再问")] }),
			item({ id: "e:a2", entryId: "a2", role: "assistant", parts: [text("text:0", "再答")] }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["user", "assistant", "fork", "user", "assistant", "fork"]);
		// 第一轮的分叉点是下一轮开始处,也就是 fork 行之前的那个 user 条目的前一条
		expect(rows[2]?.fork).toEqual({ beforeEntryId: "u2", needsSettle: false });
		expect(rows[5]?.fork).toEqual({ beforeEntryId: undefined, needsSettle: true });
		expect(rows[2]?.id).toBe("fork:e:u2");
		expect(rows[5]?.id).toBe("fork:end");
	});

	it("下一轮的起始条目还没有定位时不放分叉点", () => {
		const rows = groupRows([
			item({ id: "e:u1", entryId: "u1", role: "user", parts: [text("text:0", "问")] }),
			item({ id: "e:a1", entryId: "a1", role: "assistant", parts: [text("text:0", "答")] }),
			item({ id: "m3", role: "user", parts: [text("text:0", "刚发出的")] }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["user", "assistant", "user", "fork"]);
	});

	it("分界项与系统提示各成一行说明", () => {
		const rows = groupRows([
			item({ id: "c1", role: undefined, kind: "compaction", parts: [text("text:0", "摘要")] }),
			item({ id: "s1", role: "system", parts: [text("text:0", "模型已切换")] }),
			item({ id: "b1", role: undefined, kind: "branch", parts: [text("text:0", "分支")] }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["divider", "divider", "divider"]);
	});

	it("没有内容的过程不进面板", () => {
		const rows = groupRows([item({ id: "m1", role: "assistant", parts: [] })]);
		expect(rows).toEqual([]);
	});
});

describe("思考段的归属", () => {
	it("这一轮没有过程时,思考留在答复行里", () => {
		const rows = groupRows([
			item({ id: "m1", role: "user", parts: [text("text:0", "问")] }),
			item({ id: "m2", role: "assistant", parts: [thinking("thinking:0", "想"), text("text:1", "答")] }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["user", "assistant", "fork"]);
		expect(rows[1]?.items[0]?.parts.map((part) => part.kind)).toEqual(["thinking", "text"]);
		expect(rows[1]?.thinkingCount).toBe(1);
	});

	it("这一轮有过程时,答复行里的思考并进过程行", () => {
		const rows = groupRows([
			item({ id: "m1", role: "user", parts: [text("text:0", "改一下")] }),
			item({
				id: "m2",
				role: "assistant",
				parts: [thinking("thinking:0", "先看看"), tool("tool:c1", "c1", 20)],
			}),
			item({
				id: "m3",
				role: "assistant",
				parts: [thinking("thinking:0", "改好了"), text("text:1", "完成")],
			}),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["user", "meta", "assistant", "fork"]);
		expect(rows[1]?.thinkingCount).toBe(2);
		expect(rows[1]?.toolCount).toBe(1);
		expect(rows[2]?.items[0]?.parts.map((part) => part.kind)).toEqual(["text"]);
		expect(rows[2]?.thinkingCount).toBe(0);
	});

	it("并入过程后答复行的工具调用仍留在答复行", () => {
		const rows = groupRows([
			item({ id: "m1", role: "assistant", parts: [thinking("thinking:0", "想")] }),
			item({
				id: "m2",
				role: "assistant",
				parts: [thinking("thinking:0", "再想"), text("text:1", "答"), tool("tool:c2", "c2", 5)],
			}),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["meta", "assistant", "fork"]);
		expect(rows[1]?.items[0]?.parts.map((part) => part.kind)).toEqual(["text", "toolCall"]);
	});

	it("下一轮重新判断,不受上一轮影响", () => {
		const rows = groupRows([
			item({ id: "m1", role: "assistant", parts: [tool("tool:c1", "c1", 5)] }),
			item({ id: "m2", role: "assistant", parts: [text("text:0", "答")] }),
			item({ id: "m3", role: "user", parts: [text("text:0", "再问")] }),
			item({ id: "m4", role: "assistant", parts: [thinking("thinking:0", "想"), text("text:1", "再答")] }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["meta", "assistant", "user", "assistant", "fork"]);
		expect(rows[3]?.thinkingCount).toBe(1);
	});
});

describe("工作时长", () => {
	it("运行中由界面自己计时", () => {
		const rows = groupRows([
			item({ id: "m1", role: "user", parts: [text("text:0", "问")], startedAt: 1_000, endedAt: 1_000 }),
			item({
				id: "m2",
				role: "assistant",
				parts: [tool("tool:c1", "c1")],
				isStreaming: true,
				startedAt: 1_000,
				endedAt: 1_000,
			}),
		]);
		const meta = rows[1] as (typeof rows)[number];
		expect(meta.startedAt).toBe(1_000);
		expect(metaSummary(meta, 4_500)).toBe("工作 3.5 秒");
	});

	it("结束后用设备记录的起止时间,不再随时间走", () => {
		const rows = groupRows([
			item({ id: "m1", role: "user", parts: [text("text:0", "问")], startedAt: 1_000, endedAt: 1_000 }),
			item({ id: "m2", role: "assistant", parts: [tool("tool:c1", "c1")], startedAt: 1_000, endedAt: 3_000 }),
			item({ id: "m3", role: "assistant", parts: [text("text:0", "答")], startedAt: 3_000, endedAt: 4_000 }),
		]);
		const meta = rows[1] as (typeof rows)[number];
		expect(meta.durationMs).toBe(3_000);
		expect(metaSummary(meta, 99_000)).toBe("工作 3.0 秒");
	});
});
