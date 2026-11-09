import type { TranscriptItem } from "@facet/client-core";
import { describe, expect, it } from "vitest";
import { groupRows, metaSummary } from "./group.ts";

function item(overrides: Partial<TranscriptItem> & Pick<TranscriptItem, "id" | "role">): TranscriptItem {
	return { kind: "message", entryId: undefined, parts: [], isStreaming: false, ...overrides };
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
		expect(rows.map((row) => row.kind)).toEqual(["user", "meta", "assistant"]);
		expect(rows[1]?.items.map((entry) => entry.id)).toEqual(["m2", "m3"]);
		expect(rows[1]?.thinkingCount).toBe(1);
		expect(rows[1]?.toolCount).toBe(1);
		expect(rows[1]?.durationMs).toBe(120);
		const meta = rows[1];
		expect(meta).toBeDefined();
		expect(metaSummary(meta as (typeof rows)[number])).toBe("思考 1 段 · 工具 1 次 · 120 毫秒");
	});

	it("正文是过程行的边界", () => {
		const rows = groupRows([
			item({ id: "m1", role: "user", parts: [text("text:0", "问")] }),
			item({ id: "m2", role: "assistant", parts: [thinking("thinking:0", "想")] }),
			item({ id: "m3", role: "assistant", parts: [text("text:0", "答")] }),
			item({ id: "m4", role: "assistant", parts: [thinking("thinking:0", "再想")] }),
			item({ id: "m5", role: "assistant", parts: [text("text:0", "再答")] }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["user", "meta", "assistant", "meta", "assistant"]);
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

	it("带补丁的工具在过程行之后追加文件改动行", () => {
		const patch = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1 +1 @@", "-old", "+next", "+more"].join("\n");
		const rows = groupRows([
			item({ id: "m1", role: "assistant", parts: [tool("tool:c1", "c1", 40, { patch })] }),
			item({ id: "m2", role: "assistant", parts: [text("text:0", "改好了")] }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["meta", "diff", "assistant"]);
		expect(rows[1]?.id).toBe("diff:c1");
		expect(rows[1]?.diffs[0]?.files).toEqual(["src/a.ts"]);
		expect(rows[1]?.diffs[0]?.added).toBe(2);
		expect(rows[1]?.diffs[0]?.removed).toBe(1);
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
		expect(rows.map((row) => row.kind)).toEqual(["assistant", "diff"]);
		expect(rows[0]?.toolCount).toBe(1);
	});

	it("用户行带分叉目标,其余行不带", () => {
		const rows = groupRows([
			item({ id: "e:u1", role: "user", parts: [text("text:0", "问")] }),
			item({ id: "m2", role: "assistant", parts: [text("text:0", "答")] }),
		]);
		expect(rows[0]?.forkTarget).toBe("e:u1");
		expect(rows[1]?.forkTarget).toBeUndefined();
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
