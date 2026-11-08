import { describe, expect, it } from "vitest";
import { type ApprovalHook, createApprovalExtension, type PiAgent } from "./pi-agent.ts";

type ToolCallHandler = (event: unknown, ctx: unknown) => Promise<unknown>;

function registerFactory(hook: ApprovalHook): Map<string, ToolCallHandler> {
	const handlers = new Map<string, ToolCallHandler>();
	const factory = createApprovalExtension(hook);
	factory({
		on: (name: string, handler: ToolCallHandler) => {
			handlers.set(name, handler);
			return () => {};
		},
	} as never);
	return handlers;
}

function stubAgent(decision: { block?: boolean; reason?: string } | undefined) {
	const calls: unknown[] = [];
	const agent = {
		gateToolCall: async (call: unknown) => {
			calls.push(call);
			return decision;
		},
	};
	return { agent: agent as unknown as PiAgent, calls };
}

describe("createApprovalExtension", () => {
	it("注册 tool_call 处理函数", () => {
		const handlers = registerFactory({});
		expect([...handlers.keys()]).toEqual(["tool_call"]);
	});

	it("把调用信息交给当前 agent 的审批入口", async () => {
		const hook: ApprovalHook = {};
		const handlers = registerFactory(hook);
		const stub = stubAgent({ block: true, reason: "拒绝执行" });
		hook.agent = stub.agent;

		const handler = handlers.get("tool_call");
		if (!handler) {
			throw new Error("tool_call handler missing");
		}
		const result = await handler(
			{
				toolCallId: "call-1",
				toolName: "bash",
				input: { command: "rm -rf /" },
				parentToolCallId: "parent-1",
			},
			{},
		);

		expect(stub.calls).toEqual([
			{ toolCallId: "call-1", parentCallId: "parent-1", toolName: "bash", input: { command: "rm -rf /" } },
		]);
		expect(result).toEqual({ block: true, reason: "拒绝执行" });
	});

	it("未绑定 agent 时放行，返回 undefined", async () => {
		const handlers = registerFactory({});
		const handler = handlers.get("tool_call");
		if (!handler) {
			throw new Error("tool_call handler missing");
		}
		const result = await handler({ toolCallId: "call-1", toolName: "read", input: {} }, {});
		expect(result).toBeUndefined();
	});
});
