import type { ActionFrame, AssistantMessage, UserMessage } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { reduceChat, reduceSession } from "./reduce.ts";
import { createChatView, createSessionView } from "./state.ts";

function userMessage(text: string): UserMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1 };
}

function assistantMessage(text: string, stopReason: AssistantMessage["stopReason"]): AssistantMessage {
	return {
		role: "assistant",
		content: text.length > 0 ? [{ type: "text", text }] : [],
		provider: "p",
		model: "m",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			reasoning: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 2,
	};
}

const chat = () => createChatView("chat:/s1");
const session = () => createSessionView("session:/s1");

describe("reduceChat", () => {
	it("追加消息并标记流式状态", () => {
		const view = reduceChat(chat(), {
			type: "chat/messageAppended",
			messageId: "m1",
			message: assistantMessage("", "pending"),
		});
		expect(view.messages).toHaveLength(1);
		expect(view.messages[0]?.isStreaming).toBe(true);
	});

	it("按内容块下标累积增量", () => {
		let view = reduceChat(chat(), {
			type: "chat/messageAppended",
			messageId: "m1",
			message: assistantMessage("", "pending"),
		});
		view = reduceChat(view, { type: "chat/delta", messageId: "m1", partIndex: 0, kind: "text", delta: "你" });
		view = reduceChat(view, { type: "chat/delta", messageId: "m1", partIndex: 0, kind: "text", delta: "好" });
		expect(view.messages[0]?.streaming[0]?.text).toBe("你好");
	});

	it("完成事件替换内容并清空增量", () => {
		let view = reduceChat(chat(), {
			type: "chat/messageAppended",
			messageId: "m1",
			message: assistantMessage("", "pending"),
		});
		view = reduceChat(view, { type: "chat/delta", messageId: "m1", partIndex: 0, kind: "text", delta: "你" });
		view = reduceChat(view, {
			type: "chat/messageUpdated",
			messageId: "m1",
			message: assistantMessage("你好", "stop"),
		});
		expect(view.messages[0]?.streaming).toEqual({});
		expect(view.messages[0]?.isStreaming).toBe(false);
		expect(view.messages[0]?.message.role).toBe("assistant");
	});

	it("未知标识的增量不产生变化", () => {
		const base = reduceChat(chat(), {
			type: "chat/messageAppended",
			messageId: "m1",
			message: userMessage("hi"),
		});
		expect(
			reduceChat(base, { type: "chat/delta", messageId: "m9", partIndex: 0, kind: "text", delta: "x" }),
		).toBe(base);
	});

	it("工具调用从开始到结束", () => {
		let view = reduceChat(chat(), {
			type: "chat/toolCallStarted",
			callId: "c1",
			toolName: "bash",
			input: { command: "ls" },
		});
		expect(view.toolCalls.c1?.isRunning).toBe(true);
		view = reduceChat(view, {
			type: "chat/toolCallEnded",
			callId: "c1",
			toolName: "bash",
			output: { content: [{ type: "text", text: "a.txt" }] },
			isError: false,
			durationMs: 12,
		});
		expect(view.toolCalls.c1).toMatchObject({ isRunning: false, durationMs: 12, isError: false });
	});

	it("终局信号清掉运行与重试状态", () => {
		let view = reduceChat(chat(), { type: "chat/turnStarted", text: "hi" });
		view = reduceChat(view, {
			type: "chat/retryStarted",
			attempt: 1,
			maxAttempts: 3,
			delayMs: 500,
			error: "限流",
		});
		view = reduceChat(view, { type: "chat/turnCompleted", willRetry: true });
		expect(view).toMatchObject({ isRunning: false, willRetry: true });
		view = reduceChat(view, { type: "chat/settled", aborted: false });
		expect(view).toMatchObject({ isRunning: false, willRetry: false, retry: undefined });
	});

	it("排队变化两边都记录", () => {
		let view = reduceChat(chat(), { type: "chat/queueChanged", steering: ["a"], followUp: ["b"] });
		view = reduceChat(view, { type: "chat/pendingMessageSet", kind: "queued", text: "c" });
		expect(view.queue).toEqual({ steering: ["a"], followUp: ["b", "c"] });
		view = reduceChat(view, { type: "chat/queueCleared" });
		expect(view.queue).toEqual({ steering: [], followUp: [] });
	});

	it("会话动作对对话视图无影响", () => {
		const base = chat();
		expect(reduceChat(base, { type: "session/status", status: "running" })).toBe(base);
	});

	it("归约不改动入参", () => {
		const base = reduceChat(chat(), {
			type: "chat/messageAppended",
			messageId: "m1",
			message: assistantMessage("", "pending"),
		});
		const before = JSON.stringify(base);
		reduceChat(base, { type: "chat/delta", messageId: "m1", partIndex: 0, kind: "text", delta: "x" });
		expect(JSON.stringify(base)).toBe(before);
	});
});

describe("reduceSession", () => {
	it("状态、模型与思考档位分别更新", () => {
		let view = reduceSession(session(), { type: "session/status", status: "running" });
		view = reduceSession(view, { type: "session/thinkingLevelChanged", level: "high" });
		expect(view.status).toBe("running");
		expect(view.thinkingLevel).toBe("high");
	});

	it("压缩开始与结束", () => {
		let view = reduceSession(session(), { type: "session/compactionStarted", reason: "threshold" });
		expect(view.compaction).toMatchObject({ isRunning: true, reason: "threshold" });
		view = reduceSession(view, {
			type: "session/compactionCompleted",
			reason: "threshold",
			tokensBefore: 100,
			estimatedTokensAfter: 20,
			aborted: false,
			willRetry: false,
			error: undefined,
		});
		expect(view.compaction).toMatchObject({ isRunning: false, tokensBefore: 100, estimatedTokensAfter: 20 });
	});

	it("改名立即生效", () => {
		const view = reduceSession(session(), { type: "session/titleChanged", title: "新名字" });
		expect(view.title).toBe("新名字");
	});

	it("对话动作对会话视图无影响", () => {
		const base = session();
		expect(reduceSession(base, { type: "chat/turnStarted", text: "hi" })).toBe(base);
	});
});

describe("动作帧与视图的配合", () => {
	it("帧里的动作能直接归约", () => {
		const frame: ActionFrame = {
			type: "action",
			channel: "chat:/s1",
			serverSeq: 1,
			origin: undefined,
			action: { type: "chat/notice", level: "info", message: "已连接" },
		};
		expect(reduceChat(chat(), frame.action).notices).toEqual([{ level: "info", message: "已连接" }]);
	});
});
