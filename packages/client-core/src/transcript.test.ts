import type { AssistantMessage, Entry, ToolResultMessage } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { historyMessageId } from "./message-id.ts";
import { createChatView, type MessageView } from "./state.ts";
import { toTranscript } from "./transcript.ts";

function assistant(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
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
		stopReason,
		timestamp: 1,
	};
}

function toolResult(callId: string, text: string, isError = false): ToolResultMessage {
	return {
		role: "toolResult",
		callId,
		toolName: "bash",
		content: [{ type: "text", text }],
		isError,
		timestamp: 2,
	};
}

function viewWith(messages: MessageView[], toolCalls = {}) {
	return { ...createChatView("chat:/s1"), messages, toolCalls };
}

function historyItem(entryId: string, message: MessageView["message"]): MessageView {
	return { id: historyMessageId(entryId), message, streaming: {}, isStreaming: false };
}

describe("toTranscript", () => {
	it("用户消息转成正文段", () => {
		const [item] = toTranscript(
			viewWith([
				historyItem("e1", { role: "user", content: [{ type: "text", text: "你好" }], timestamp: 1 }),
			]),
		);
		expect(item).toMatchObject({ kind: "message", role: "user", entryId: "e1" });
		expect(item?.parts).toEqual([{ kind: "text", partId: "text:0", text: "你好" }]);
	});

	it("历史里的工具结果并回上一条助手消息的工具段", () => {
		const items = toTranscript(
			viewWith([
				historyItem(
					"e1",
					assistant([
						{ type: "text", text: "我先看看" },
						{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } },
						{ type: "text", text: "看完了" },
					]),
				),
				historyItem("e2", toolResult("c1", "a.txt")),
			]),
		);
		expect(items).toHaveLength(1);
		expect(items[0]?.parts).toEqual([
			{ kind: "text", partId: "text:0", text: "我先看看" },
			{
				kind: "toolCall",
				partId: "tool:c1",
				callId: "c1",
				name: "bash",
				input: { command: "ls" },
				status: "done",
				output: "a.txt",
				durationMs: undefined,
			},
			{ kind: "text", partId: "text:2", text: "看完了" },
		]);
	});

	it("工具结果里的结构化信息透传到工具段", () => {
		const patch = "--- a/x.ts\n+++ b/x.ts\n@@\n-old\n+next";
		const items = toTranscript(
			viewWith([
				historyItem("e1", assistant([{ type: "toolCall", id: "c1", name: "edit", arguments: {} }])),
				historyItem("e2", { ...toolResult("c1", "改好了"), details: { patch } }),
			]),
		);
		const part = items[0]?.parts[0];
		expect(part?.kind === "toolCall" ? part.details : undefined).toEqual({ patch });
	});

	it("历史里的工具耗时带到工具段", () => {
		const items = toTranscript(
			viewWith([
				historyItem("e1", assistant([{ type: "toolCall", id: "c1", name: "bash", arguments: {} }])),
				historyItem("e2", { ...toolResult("c1", "完成"), durationMs: 1450 }),
			]),
		);
		const part = items[0]?.parts[0];
		expect(part?.kind === "toolCall" ? part.durationMs : undefined).toBe(1450);
	});

	it("失败的工具结果标成 failed", () => {
		const items = toTranscript(
			viewWith([
				historyItem("e1", assistant([{ type: "toolCall", id: "c1", name: "bash", arguments: {} }])),
				historyItem("e2", toolResult("c1", "拒绝执行", true)),
			]),
		);
		expect(items[0]?.parts[0]).toMatchObject({ status: "failed", output: "拒绝执行" });
	});

	it("实时工具状态并入工具段", () => {
		const items = toTranscript(
			viewWith(
				[
					{
						id: "m1",
						message: assistant([{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } }]),
						streaming: {},
						isStreaming: false,
					},
				],
				{
					c1: {
						callId: "c1",
						toolName: "bash",
						input: { command: "ls" },
						parentCallId: undefined,
						output: undefined,
						isError: false,
						isRunning: true,
						durationMs: undefined,
					},
				},
			),
		);
		expect(items[0]?.parts[0]).toMatchObject({ kind: "toolCall", status: "running" });
	});

	it("没有对应消息的工具调用单独成项", () => {
		const items = toTranscript(
			viewWith([], {
				c9: {
					callId: "c9",
					toolName: "grep",
					input: {},
					parentCallId: undefined,
					output: undefined,
					isError: false,
					isRunning: true,
					durationMs: undefined,
				},
			}),
		);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			kind: "tool",
			id: "tool:c9",
			parts: [{ kind: "toolCall", name: "grep" }],
		});
	});

	it("游离的工具结果不丢弃", () => {
		const items = toTranscript(viewWith([historyItem("e2", toolResult("c404", "找不到调用"))]));
		expect(items).toHaveLength(1);
		expect(items[0]?.parts[0]).toMatchObject({ callId: "c404", output: "找不到调用" });
	});

	it("失败的回合单独成项", () => {
		const failed = { ...assistant([], "error"), errorMessage: "上下文超限" };
		const [item] = toTranscript(viewWith([historyItem("e1", failed)]));
		expect(item).toMatchObject({ kind: "error", parts: [{ kind: "text", text: "上下文超限" }] });
	});

	it("流式期间用累积的增量补正文与思考", () => {
		const items = toTranscript(
			viewWith([
				{
					id: "m1",
					message: assistant([], "pending"),
					streaming: {
						1: { kind: "thinking", text: "想一想" },
						0: { kind: "text", text: "先" },
					},
					isStreaming: true,
				},
			]),
		);
		expect(items[0]?.parts).toEqual([
			{ kind: "text", partId: "text:0", text: "先" },
			{ kind: "thinking", partId: "thinking:1", text: "想一想" },
		]);
		expect(items[0]?.isStreaming).toBe(true);
	});

	it("压缩摘要作为分界项", () => {
		const [item] = toTranscript(
			viewWith([
				historyItem("e1", {
					role: "compactionSummary",
					summary: "前面聊了很多",
					tokensBefore: 100,
					timestamp: 1,
				}),
			]),
		);
		expect(item).toMatchObject({ kind: "compaction", parts: [{ kind: "text", text: "前面聊了很多" }] });
	});

	it("系统消息不进渲染单元", () => {
		const items = toTranscript(
			viewWith([
				historyItem("e0", { role: "system", content: "系统提示", timestamp: 1 }),
				historyItem("e1", { role: "user", content: [{ type: "text", text: "你好" }], timestamp: 2 }),
			]),
		);
		expect(items).toHaveLength(1);
		expect(items[0]?.role).toBe("user");
	});

	it("命令记录拼成一段", () => {
		const [item] = toTranscript(
			viewWith([
				historyItem("e1", {
					role: "bashExecution",
					command: "ls",
					output: "a.txt",
					exitCode: 0,
					cancelled: false,
					truncated: false,
					timestamp: 1,
				}),
			]),
		);
		expect(item?.role).toBe("tool");
		expect(item?.parts).toEqual([{ kind: "text", partId: "text:0", text: "$ ls\na.txt" }]);
	});
});

describe("条目顺序", () => {
	it("历史条目按传入顺序展开,工具结果不另开一项", () => {
		const entries: Entry[] = [
			{
				id: "e1",
				parentId: null,
				kind: "message",
				timestamp: "t1",
				message: assistant([{ type: "toolCall", id: "c1", name: "bash", arguments: {} }]),
			},
			{ id: "e2", parentId: "e1", kind: "message", timestamp: "t2", message: toolResult("c1", "结果") },
			{
				id: "e3",
				parentId: "e2",
				kind: "message",
				timestamp: "t3",
				message: assistant([{ type: "text", text: "完成" }]),
			},
		];
		const view = viewWith(
			entries.map((entry) => historyItem(entry.id, entry.message as MessageView["message"])),
		);
		const items = toTranscript(view);
		expect(items.map((item) => item.entryId)).toEqual(["e1", "e3"]);
		expect(items[1]?.parts).toEqual([{ kind: "text", partId: "text:0", text: "完成" }]);
	});
});
