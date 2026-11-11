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
		expect(view.items).toHaveLength(1);
		expect(view.items[0]?.isStreaming).toBe(true);
	});

	it("按内容块下标累积增量", () => {
		let view = reduceChat(chat(), {
			type: "chat/messageAppended",
			messageId: "m1",
			message: assistantMessage("", "pending"),
		});
		view = reduceChat(view, { type: "chat/delta", messageId: "m1", partIndex: 0, kind: "text", delta: "你" });
		view = reduceChat(view, { type: "chat/delta", messageId: "m1", partIndex: 0, kind: "text", delta: "好" });
		expect(view.items[0]?.streaming[0]?.text).toBe("你好");
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
		expect(view.items[0]?.streaming).toEqual({});
		expect(view.items[0]?.isStreaming).toBe(false);
		expect(view.items[0]?.message?.role).toBe("assistant");
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

	it("回合终局不改变对话内容", () => {
		const base = chat();
		expect(reduceChat(base, { type: "chat/settled", aborted: true })).toBe(base);
	});

	it("会话动作对对话视图无影响", () => {
		const base = chat();
		expect(reduceChat(base, { type: "session/phase", phase: "running", maintenance: undefined })).toBe(base);
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
	it("阶段、模型与思考档位分别更新", () => {
		let view = reduceSession(session(), { type: "session/phase", phase: "running", maintenance: undefined });
		view = reduceSession(view, { type: "session/thinkingLevelChanged", level: "high" });
		expect(view.state.phase).toBe("running");
		expect(view.state.thinkingLevel).toBe("high");
	});

	it("维护动作独立于阶段", () => {
		let view = reduceSession(session(), {
			type: "session/phase",
			phase: "idle",
			maintenance: { kind: "compaction", reason: "threshold", tokensBefore: 100, estimatedTokensAfter: 20 },
		});
		expect(view.state.phase).toBe("idle");
		expect(view.state.maintenance).toEqual({
			kind: "compaction",
			reason: "threshold",
			tokensBefore: 100,
			estimatedTokensAfter: 20,
		});
		view = reduceSession(view, { type: "session/phase", phase: "running", maintenance: undefined });
		expect(view.state.maintenance).toBeUndefined();
	});

	it("排队内容记在会话视图上", () => {
		const view = reduceSession(session(), { type: "session/queueChanged", steering: ["a"], followUp: ["b"] });
		expect(view.state.queued).toEqual({ steering: ["a"], followUp: ["b"] });
	});

	it("改名立即生效", () => {
		const view = reduceSession(session(), { type: "session/titleChanged", title: "新名字" });
		expect(view.state.title).toBe("新名字");
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

describe("会话模型变化", () => {
	it("换模型时同时更新可选档位", () => {
		const view = reduceSession(session(), {
			type: "session/modelChanged",
			model: undefined,
			availableThinkingLevels: ["off", "medium"],
		});
		expect(view.state.availableThinkingLevels).toEqual(["off", "medium"]);
		expect(view.state.model).toBeUndefined();
	});

	it("换档位不动模型与可选档位", () => {
		const base = reduceSession(session(), {
			type: "session/modelChanged",
			model: undefined,
			availableThinkingLevels: ["off", "high"],
		});
		const view = reduceSession(base, { type: "session/thinkingLevelChanged", level: "high" });
		expect(view.state.thinkingLevel).toBe("high");
		expect(view.state.availableThinkingLevels).toEqual(["off", "high"]);
	});
});
