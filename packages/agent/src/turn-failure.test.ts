import type { Message } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { turnFailure } from "./events.ts";

/** 一条助手消息，按需覆盖结果字段。 */
function assistant(overrides: Partial<Message>): Message {
	return {
		role: "assistant",
		content: [],
		provider: "anthropic",
		model: "claude",
		usage: { inputTokens: 0, outputTokens: 0 },
		stopReason: "stop",
		timestamp: 1,
		...overrides,
	} as Message;
}

describe("turnFailure", () => {
	it("正常收尾不算失败", () => {
		expect(turnFailure(assistant({ stopReason: "stop" }))).toBeUndefined();
	});

	it("输出被截断不算失败", () => {
		expect(turnFailure(assistant({ stopReason: "length" }))).toBeUndefined();
	});

	it("用户中止不算失败", () => {
		expect(turnFailure(assistant({ stopReason: "aborted" }))).toBeUndefined();
	});

	it("以错误收尾时取错误说明", () => {
		const failure = turnFailure(assistant({ stopReason: "error", errorMessage: "连接被拒绝" }));
		expect(failure).toBe("连接被拒绝");
	});

	it("有错误但没有说明时给一句兜底", () => {
		expect(turnFailure(assistant({ stopReason: "error" }))).toBe("模型请求失败");
	});

	it("工具结果不是助手消息，不参与判定", () => {
		const tool: Message = {
			role: "toolResult",
			callId: "c1",
			toolName: "bash",
			content: [],
			isError: true,
			timestamp: 1,
		} as Message;
		expect(turnFailure(tool)).toBeUndefined();
	});
});
