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
		const projected = projector.project({ type: "status", status: "running" });
		expect(projected).toEqual([
			{ channel: "session:/s1", action: { type: "session/status", status: "running" } },
		]);
	});

	it("对话级事件投影到对话通道", () => {
		const projector = new ActionProjector("s1");
		const projected = projector.project({ type: "run_end", willRetry: false });
		expect(projected).toEqual([
			{ channel: "chat:/s1", action: { type: "chat/turnCompleted", willRetry: false } },
		]);
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
