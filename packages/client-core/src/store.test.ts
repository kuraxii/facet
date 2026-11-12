import type { ActionFrame, AssistantMessage, Entry, SessionSnapshot, SessionSummary } from "@facet/protocol";
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
		phase: "idle",
		maintenance: undefined,
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
		store.apply(
			frame(sessionChannel, 1, { type: "session/phase", phase: "running", maintenance: undefined }),
		);
		store.apply(frame(chatChannel, 1, { type: "chat/notice", level: "info", message: "hi" }));
		expect(store.sessionView(sessionChannel)?.state.phase).toBe("running");
		expect(store.chatView(chatChannel)?.notices).toHaveLength(1);
		expect(store.sessionView(chatChannel)).toBeUndefined();
	});

	it("阶段与维护动作只落在会话视图上", () => {
		const store = new SessionStore();
		store.ensureSession(sessionChannel);
		store.apply(
			frame(sessionChannel, 1, {
				type: "session/phase",
				phase: "stopping",
				maintenance: {
					kind: "compaction",
					reason: "manual",
					tokensBefore: undefined,
					estimatedTokensAfter: undefined,
				},
			}),
		);
		expect(store.sessionView(sessionChannel)?.state.phase).toBe("stopping");
		expect(store.sessionView(sessionChannel)?.state.maintenance?.kind).toBe("compaction");
		expect(store.chatView(sessionChannel)).toBeUndefined();
	});

	it("重复序号的帧被丢弃", () => {
		const store = new SessionStore();
		store.apply(frame(chatChannel, 1, { type: "chat/notice", level: "info", message: "第一次" }));
		store.apply(frame(chatChannel, 1, { type: "chat/notice", level: "info", message: "重复" }));
		expect(store.chatView(chatChannel)?.notices).toEqual([{ level: "info", message: "第一次" }]);
	});

	it("拒绝帧不进入归约", () => {
		const store = new SessionStore();
		store.ensureChat(chatChannel);
		store.apply({
			type: "action",
			channel: chatChannel,
			serverSeq: 0,
			origin: { clientId: "c", clientSeq: 1 },
			action: { type: "chat/notice", level: "error", message: "不该出现的提示" },
			rejectionReason: "session is running",
		});
		expect(store.chatView(chatChannel)?.notices).toEqual([]);
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
		// 全部类型的条目都进视图，只有 message 条目带消息
		expect(view.items.map((item) => item.id)).toEqual(["e:e1", "e:e2"]);
		expect(view.items.map((item) => item.entry?.kind)).toEqual(["message", "model_change"]);
		expect(view.items[0]?.entry?.id).toBe("e1");
		expect(view.items[1]?.message).toBeUndefined();
		expect(isHistoryMessageId(view.items[0]?.id ?? "")).toBe(true);
	});

	it("实时消息按位置提升为历史消息并记下标识迁移", () => {
		const store = new SessionStore();
		store.ensureChat(chatChannel);
		for (const messageId of ["m1", "m2"]) {
			store.apply({
				type: "action",
				channel: chatChannel,
				serverSeq: messageId === "m1" ? 1 : 2,
				origin: undefined,
				action: { type: "chat/messageAppended", messageId, message: assistant(messageId) },
			});
		}
		const committed: Entry[] = [
			{
				id: "e9",
				parentId: null,
				kind: "message",
				timestamp: "2026-11-08T00:00:00Z",
				message: assistant("m1"),
			},
			{ id: "e10", parentId: "e9", kind: "usage", timestamp: "2026-11-08T00:00:01Z" },
			{
				id: "e11",
				parentId: "e10",
				kind: "message",
				timestamp: "2026-11-08T00:00:02Z",
				message: assistant("m2"),
			},
		];
		expect(store.promote(chatChannel, committed)).toBe(true);
		const view = store.chatView(chatChannel);
		// usage 条目没有实时对应物，但同样留在视图里
		expect(view?.items.map((item) => item.id)).toEqual(["e:e9", "e:e10", "e:e11"]);
		expect(view?.items.map((item) => item.entry?.id)).toEqual(["e9", "e10", "e11"]);
		expect(view?.items.map((item) => item.message === undefined)).toEqual([false, true, false]);
		expect(view?.renames).toEqual({ m1: "e:e9", m2: "e:e11" });
	});

	it("条目数与实时消息不符时不提升", () => {
		const store = new SessionStore();
		store.ensureChat(chatChannel);
		store.apply({
			type: "action",
			channel: chatChannel,
			serverSeq: 1,
			origin: undefined,
			action: { type: "chat/messageAppended", messageId: "m1", message: assistant("一条") },
		});
		const committed: Entry[] = [
			{
				id: "e9",
				parentId: null,
				kind: "message",
				timestamp: "2026-11-08T00:00:00Z",
				message: assistant("一条"),
			},
			{
				id: "e10",
				parentId: "e9",
				kind: "message",
				timestamp: "2026-11-08T00:00:01Z",
				message: assistant("多出来的"),
			},
		];
		expect(store.promote(chatChannel, committed)).toBe(false);
		expect(store.chatView(chatChannel)?.items.map((item) => item.id)).toEqual(["m1"]);
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

describe("会话清单", () => {
	const listChannel = "sessions:/h" as const;

	function summary(path: string, modified: number): SessionSummary {
		return {
			id: path,
			path,
			cwd: "/tmp",
			name: undefined,
			parentSessionPath: undefined,
			created: 1,
			modified,
			messageCount: 1,
			firstMessage: "你好",
		};
	}

	it("收到变化后进清单，按修改时间从新到旧", () => {
		const store = new SessionStore();
		store.apply({
			type: "action",
			channel: listChannel,
			serverSeq: 1,
			origin: undefined,
			action: { type: "sessions/changed", summary: summary("/a/s1.jsonl", 2), busy: false },
		});
		store.apply({
			type: "action",
			channel: listChannel,
			serverSeq: 2,
			origin: undefined,
			action: { type: "sessions/changed", summary: summary("/a/s2.jsonl", 5), busy: true },
		});
		expect(store.sessionList().map((entry) => entry.summary.path)).toEqual(["/a/s2.jsonl", "/a/s1.jsonl"]);
		expect(store.isSessionBusy("/a/s2.jsonl")).toBe(true);
	});

	it("同路径的新摘要覆盖旧的", () => {
		const store = new SessionStore();
		store.apply({
			type: "action",
			channel: listChannel,
			serverSeq: 1,
			origin: undefined,
			action: { type: "sessions/changed", summary: summary("/a/s1.jsonl", 1), busy: false },
		});
		store.apply({
			type: "action",
			channel: listChannel,
			serverSeq: 2,
			origin: undefined,
			action: {
				type: "sessions/changed",
				summary: { ...summary("/a/s1.jsonl", 9), name: "改过" },
				busy: false,
			},
		});
		expect(store.sessionList()).toHaveLength(1);
		expect(store.sessionList()[0]?.summary.name).toBe("改过");
	});

	it("删除后就从清单里消失", () => {
		const store = new SessionStore();
		store.apply({
			type: "action",
			channel: listChannel,
			serverSeq: 1,
			origin: undefined,
			action: { type: "sessions/changed", summary: summary("/a/s1.jsonl", 1), busy: false },
		});
		store.apply({
			type: "action",
			channel: listChannel,
			serverSeq: 2,
			origin: undefined,
			action: { type: "sessions/removed", path: "/a/s1.jsonl" },
		});
		expect(store.sessionList()).toEqual([]);
	});

	it("序号不大于已应用的帧丢掉", () => {
		const store = new SessionStore();
		store.markSessionListSeq(5);
		store.apply({
			type: "action",
			channel: listChannel,
			serverSeq: 5,
			origin: undefined,
			action: { type: "sessions/removed", path: "/a/s1.jsonl" },
		});
		expect(store.sessionListSeq).toBe(5);
	});

	it("完整清单替换掉本地这份", () => {
		const store = new SessionStore();
		store.replaceSessionList([{ summary: summary("/a/s1.jsonl", 1), busy: false }]);
		expect(store.sessionList()).toHaveLength(1);
		store.replaceSessionList([]);
		expect(store.sessionList()).toEqual([]);
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
			entry: undefined,
			message: assistant(""),
			streaming: { 0: { kind: "text" as const, text: "写到一半" } },
			isStreaming: true,
		};
		expect(messageDisplayText(view)).toBe("写到一半");
		expect(messageDisplayText({ ...view, streaming: {} })).toBe("");
	});
});
