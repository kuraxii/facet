import { describe, expect, it } from "vitest";
import {
	toAgentMessage,
	toAgentMessages,
	toAgentModelInfo,
	toAgentToolOutput,
	toAgentUsage,
} from "./convert.ts";
import { toAgentEvents } from "./events.ts";

type PiMessage = Parameters<typeof toAgentMessage>[0];

function message(value: unknown): PiMessage {
	return value as PiMessage;
}

describe("toAgentMessage", () => {
	it("把带图片的用户消息转成输入块", () => {
		const result = toAgentMessage(
			message({
				role: "user",
				content: [
					{ type: "text", text: "看看这张图" },
					{ type: "image", data: "AAAA", mimeType: "image/png" },
				],
				timestamp: 1700000000000,
			}),
		);

		expect(result).toEqual({
			role: "user",
			content: [
				{ type: "text", text: "看看这张图" },
				{ type: "image", data: "AAAA", mimeType: "image/png" },
			],
			timestamp: 1700000000000,
		});
	});

	it("把字符串内容展开成单个文本块", () => {
		const result = toAgentMessage(message({ role: "user", content: "你好", timestamp: 1 }));

		expect(result).toEqual({ role: "user", content: [{ type: "text", text: "你好" }], timestamp: 1 });
	});

	it("保留助手的思考块与工具调用块，并优先使用响应模型名", () => {
		const result = toAgentMessage(
			message({
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "先读文件", thinkingSignature: "sig" },
					{ type: "text", text: "好的" },
					{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "/tmp/a" } },
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "claude-sonnet-4",
				responseModel: "claude-sonnet-4-20250514",
				usage: {
					input: 10,
					output: 20,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 30,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: 2,
			}),
		);

		expect(result.role).toBe("assistant");
		if (result.role !== "assistant") {
			throw new Error("expected assistant message");
		}
		expect(result.model).toBe("claude-sonnet-4-20250514");
		expect(result.stopReason).toBe("toolUse");
		expect(result.content).toEqual([
			{ type: "thinking", thinking: "先读文件", redacted: false },
			{ type: "text", text: "好的" },
			{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "/tmp/a" } },
		]);
	});

	it("把工具结果转成可序列化的形状", () => {
		const result = toAgentMessage(
			message({
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [{ type: "text", text: "file body" }],
				details: { lines: 12 },
				isError: false,
				timestamp: 3,
			}),
		);

		expect(result).toEqual({
			role: "toolResult",
			callId: "call-1",
			toolName: "read",
			content: [{ type: "text", text: "file body" }],
			details: { lines: 12 },
			isError: false,
			timestamp: 3,
		});
	});

	it("保留命令执行消息的退出码与截断标记", () => {
		const result = toAgentMessage(
			message({
				role: "bashExecution",
				command: "ls",
				output: "a.txt",
				exitCode: 0,
				cancelled: false,
				truncated: true,
				fullOutputPath: "/tmp/pi-bash.log",
				timestamp: 4,
			}),
		);

		expect(result).toEqual({
			role: "bashExecution",
			command: "ls",
			output: "a.txt",
			exitCode: 0,
			cancelled: false,
			truncated: true,
			fullOutputPath: "/tmp/pi-bash.log",
			timestamp: 4,
		});
	});

	it("对未知角色返回占位消息，不抛出错误", () => {
		const result = toAgentMessage(message({ role: "artifact", timestamp: 5 }));

		expect(result).toEqual({ role: "unknown", rawRole: "artifact", timestamp: 5 });
	});

	it("批量转换保持顺序", () => {
		const result = toAgentMessages([
			message({ role: "user", content: "a", timestamp: 1 }),
			message({ role: "user", content: "b", timestamp: 2 }),
		]);

		expect(
			result.map((item) =>
				item.role === "user" ? (item.content[0]?.type === "text" ? item.content[0].text : "") : "",
			),
		).toEqual(["a", "b"]);
	});
});

describe("toAgentModelInfo", () => {
	it("只保留文本与图片两种输入模态", () => {
		const model = toAgentModelInfo({
			id: "claude-sonnet-4",
			name: "Claude Sonnet 4",
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl: "https://api.anthropic.com",
			reasoning: true,
			contextWindow: 200000,
			maxTokens: 16384,
			input: ["text", "image"],
			cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		} as never);

		expect(model).toEqual({
			provider: "anthropic",
			id: "claude-sonnet-4",
			name: "Claude Sonnet 4",
			api: "anthropic-messages",
			reasoning: true,
			contextWindow: 200000,
			maxTokens: 16384,
			input: ["text", "image"],
			cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		});
	});
});

describe("toAgentUsage", () => {
	it("缺少推理用量时补零", () => {
		const usage = toAgentUsage({
			input: 1,
			output: 2,
			cacheRead: 3,
			cacheWrite: 4,
			totalTokens: 10,
			cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
		});

		expect(usage.reasoning).toBe(0);
		expect(usage.totalTokens).toBe(10);
		expect(usage.cost.total).toBe(1);
	});
});

describe("toAgentToolOutput", () => {
	it("过滤掉非文本图片内容", () => {
		const output = toAgentToolOutput({
			content: [
				{ type: "text", text: "ok" },
				{ type: "image", data: "BBBB", mimeType: "image/jpeg" },
			],
			details: { done: true },
		});

		expect(output).toEqual({
			content: [
				{ type: "text", text: "ok" },
				{ type: "image", data: "BBBB", mimeType: "image/jpeg" },
			],
			details: { done: true },
			isError: undefined,
		});
	});
});

describe("toAgentEvents", () => {
	it("把文本增量转成消息增量事件", () => {
		const events = toAgentEvents({
			type: "message_update",
			message: { role: "assistant", timestamp: 1 },
			assistantMessageEvent: { type: "text_delta", contentIndex: 2, delta: "hi", partial: {} },
		} as never);

		expect(events).toEqual([{ type: "message_delta", contentIndex: 2, kind: "text", delta: "hi" }]);
	});

	it("忽略不携带增量的消息更新", () => {
		const events = toAgentEvents({
			type: "message_update",
			message: { role: "assistant", timestamp: 1 },
			assistantMessageEvent: { type: "start", partial: {} },
		} as never);

		expect(events).toEqual([]);
	});

	it("把队列变化转成队列事件", () => {
		const events = toAgentEvents({
			type: "queue_update",
			steering: ["先停下"],
			followUp: ["再说这个"],
		} as never);

		expect(events).toEqual([{ type: "queue", steering: ["先停下"], followUp: ["再说这个"] }]);
	});

	it("把条目追加转成游标事件", () => {
		const events = toAgentEvents({
			type: "entry_appended",
			entry: { type: "message", id: "entry-1", parentId: null, timestamp: "2024-01-01T00:00:00.000Z" },
		} as never);

		expect(events).toEqual([{ type: "entry", entryId: "entry-1", parentId: null, kind: "message" }]);
	});
});
