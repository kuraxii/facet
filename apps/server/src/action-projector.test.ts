import { describe, expect, it } from "vitest";
import { ActionProjector } from "./action-projector.ts";

const message = {
	role: "assistant",
	content: [],
	provider: "p",
	model: "m",
	usage: {} as never,
	stopReason: "stop" as const,
	timestamp: 1,
};

describe("ActionProjector", () => {
	it("会话级事件投影到会话通道", () => {
		const projector = new ActionProjector("s1");
		const projected = projector.project({
			type: "phase",
			phase: "running",
			maintenance: { kind: "retry", attempt: 1, maxAttempts: 3, delayMs: 2000 },
		});
		expect(projected).toEqual([
			{
				channel: "session:/s1",
				action: {
					type: "session/phase",
					phase: "running",
					maintenance: { kind: "retry", attempt: 1, maxAttempts: 3, delayMs: 2000 },
				},
			},
		]);
	});

	it("扩展初始化与交互状态分别投影到会话通道", () => {
		const projector = new ActionProjector("s1");
		expect(projector.project({ type: "initialized", initialization: { kind: "starting" } })).toEqual([
			{
				channel: "session:/s1",
				action: { type: "session/initialized", initialization: { kind: "starting" } },
			},
		]);
		const ui = {
			prompts: [{ kind: "editor" as const, requestId: "u1", title: "编辑", prefill: "完整内容" }],
		};
		expect(projector.project({ type: "ui", ui })).toEqual([
			{ channel: "session:/s1", action: { type: "session/uiChanged", ui } },
		]);
	});

	it("对话级事件投影到对话通道", () => {
		const projector = new ActionProjector("s1");
		const projected = projector.project({ type: "settled", aborted: false });
		expect(projected).toEqual([{ channel: "chat:/s1", action: { type: "chat/settled", aborted: false } }]);
	});

	it("同一条消息的增量与完成沿用同一标识", () => {
		const projector = new ActionProjector("s1");
		const started = projector.project({ type: "message_start", message: message as never });
		expect(started[0]?.action).toMatchObject({ type: "chat/messageAppended", messageId: "m1" });

		const delta = projector.project({
			type: "message_delta",
			contentIndex: 0,
			kind: "text",
			delta: "hi",
		});
		expect(delta[0]?.action).toMatchObject({
			type: "chat/delta",
			messageId: "m1",
			partIndex: 0,
			delta: "hi",
		});

		const ended = projector.project({ type: "message_end", message: message as never });
		expect(ended[0]?.action).toMatchObject({ type: "chat/messageUpdated", messageId: "m1" });
		expect(projector.currentMessageId).toBeUndefined();
	});

	it("不产生动作的事件返回空数组", () => {
		const projector = new ActionProjector("s1");
		expect(projector.project({ type: "turn_start" })).toEqual([]);
		expect(projector.project({ type: "entry", entryId: "e1", parentId: null, kind: "message" })).toEqual([]);
	});
});
