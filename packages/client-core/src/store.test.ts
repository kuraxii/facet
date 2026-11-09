import type { ActionFrame, AssistantMessage, Entry, SessionSnapshot } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { isHistoryMessageId } from "./message-id.ts";
import type { ChannelGap } from "./store.ts";
import { messageDisplayText, messageText, SessionStore } from "./store.ts";

const sessionChannel = "session:/s1" as const;
const chatChannel = "chat:/s1" as const;

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
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
		stopReason: "stop",
		timestamp: 1,
	};
}

function _snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
	return {
		id: "s1",
		file: "/tmp/s1.jsonl",
		cwd: "/tmp",
		name: "测试会话",
		status: "idle",
		model: undefined,
		thinkingLevel: "medium",
		availableThinkingLevels: ["low", "medium", "high"],
		activeToolNames: ["bash"],
		queued: { steering: [], followUp: [] },
		contextUsage: undefined,
		stats: {
			sessionId: "s1",
			sessionFile: "/tmp/s1.jsonl",
			userMessages: 0,
			assistantMessages: 0,
			toolCalls: 0,
			toolResults: 0,
			totalMessages: 0,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			cost: 0,
			contextUsage: undefined,
		},
		modelFallbackMessage: undefined,
		...overrides,
	};
}

function frame(
	channel: typeof sessionChannel | typeof chatChannel,
	serverSeq: number,
	action: ActionFrame["action"],
): ActionFrame {
	return { type: "action", channel, serverSeq, origin: undefined, action };
}

describe("SessionStore", () => {
	it("按通道种类分派到各自的视图", () => {
		const store = new SessionStore();
		store.apply(frame(sessionChannel, 1, { type: "session/status", status: "running" }));
		store.apply(frame(chatChannel, 1, { type: "chat/turnStarted", text: "hi" }));
		expect(store.sessionView(sessionChannel)?.status).toBe("running");
		expect(store.chatView(chatChannel)?.isRunning).toBe(true);
		expect(store.sessionView(chatChannel)).toBeUndefined();
	});

	it("重复序号的帧被丢弃", () => {
		const store = new SessionStore();
		store.apply(frame(chatChannel, 1, { type: "chat/notice", level: "info", message: "第一次" }));
		store.apply(frame(chatChannel, 1, { type: "chat/notice", level: "info", message: "重复" }));
		expect(store.chatView(chatChannel)?.notices).toEqual([{ level: "info", message: "第一次" }]);
	});

	it("序号跳跃时报出缺口并照常应用", () => {
		const store = new SessionStore();
		const gaps: ChannelGap[] = [];
		store.onGap((gap) => gaps.push(gap));
		store.apply(frame(chatChannel, 1, { type: "chat/turnStarted", text: "hi" }));
		store.apply(frame(chatChannel, 5, { type: "chat/notice", level: "warning", message: "跳号" }));
		expect(gaps).toEqual([{ channel: chatChannel, expected: 2, received: 5 }]);
		expect(store.chatView(chatChannel)?.notices).toHaveLength(1);
	});

	it("订阅返回的序号成为基线", () => {
		const store = new SessionStore();
		const gaps: ChannelGap[] = [];
		store.onGap((gap) => gaps.push(gap));
		store.markSeq(chatChannel, 4);
		store.apply(frame(chatChannel, 5, { type: "chat/turnStarted", text: "hi" }));
		expect(gaps).toEqual([]);
	});

	it("历史条目投影成消息并带前缀标识", () => {
		const store = new SessionStore();
		const entries: Entry[] = [
			{
				id: "e1",
				parentId: null,
				kind: "message",
				timestamp: "2026-11-08T00:00:00Z",
				message: assistant("旧的"),
			},
			{ id: "e2", parentId: "e1", kind: "model_change", timestamp: "2026-11-08T00:00:01Z" },
		];
		const view = store.replaceChat(chatChannel, entries);
		expect(view.messages).toHaveLength(1);
		expect(view.messages[0]?.id).toBe("e:e1");
		expect(isHistoryMessageId(view.messages[0]?.id ?? "")).toBe(true);
	});

	it("视图变化时通知订阅者并递增版本", () => {
		const store = new SessionStore();
		const versions: number[] = [];
		const stop = store.subscribe((version) => versions.push(version));
		store.apply(frame(chatChannel, 1, { type: "chat/turnStarted", text: "hi" }));
		store.apply(frame(chatChannel, 2, { type: "chat/settled", aborted: false }));
		expect(versions.length).toBe(2);
		expect(store.getVersion()).toBe(2);
		stop();
		store.apply(frame(chatChannel, 3, { type: "chat/turnStarted", text: "再来" }));
		expect(versions.length).toBe(2);
	});

	it("drop 清掉通道状态", () => {
		const store = new SessionStore();
		store.apply(frame(chatChannel, 1, { type: "chat/turnStarted", text: "hi" }));
		store.drop(chatChannel);
		expect(store.chatView(chatChannel)).toBeUndefined();
	});

	it("成对给出会话与对话通道", () => {
		expect(SessionStore.channelsFor("s1")).toEqual({ session: "session:/s1", chat: "chat:/s1" });
	});
});

describe("文本提取", () => {
	it("按角色取纯文本", () => {
		expect(messageText(assistant("回复"))).toBe("回复");
		expect(messageText({ role: "user", content: [{ type: "text", text: "问题" }], timestamp: 1 })).toBe(
			"问题",
		);
		expect(messageText({ role: "system", content: "提示词", timestamp: 1 })).toBe("提示词");
		expect(
			messageText({
				role: "bashExecution",
				command: "ls",
				output: "a.txt",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				timestamp: 1,
			}),
		).toBe("a.txt");
	});

	it("流式期间优先用增量", () => {
		const view = {
			id: "m1",
			message: assistant(""),
			streaming: { 0: { kind: "text" as const, text: "写到一半" } },
			isStreaming: true,
		};
		expect(messageDisplayText(view)).toBe("写到一半");
		expect(messageDisplayText({ ...view, streaming: {} })).toBe("");
	});
});
