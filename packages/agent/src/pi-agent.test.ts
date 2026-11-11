import type { SessionEvent } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { PiAgent, type PiAgentContext } from "./pi-agent.ts";

interface FakeRun {
	/** 取会话给的回执回调,用例自己决定何时回执 */
	preflightResult?: (value: "handled" | "queued" | "started") => void;
	streamingBehavior?: "steer" | "followUp";
}

/** 只实现 prompt 会用到的部分,其余字段由构造期的少量调用凑齐。 */
function createAgent(options: { streaming?: boolean; run?: (run: FakeRun) => Promise<void> } = {}) {
	const session = {
		sessionId: "s1",
		sessionFile: "/tmp/s1.jsonl",
		isStreaming: options.streaming ?? false,
		isCompacting: false,
		sessionManager: { getCwd: () => "/tmp" },
		subscribe: () => () => {},
		prompt: async (_text: string, run: FakeRun) => {
			await (options.run?.(run) ?? Promise.resolve());
		},
	} as unknown as PiAgentContext["session"];
	const agent = new PiAgent({
		session,
		modelRuntime: {} as PiAgentContext["modelRuntime"],
		modelFallbackMessage: undefined,
	});
	const events: SessionEvent[] = [];
	agent.subscribe((event) => {
		events.push(event);
	});
	return { agent, events };
}

describe("PiAgent.prompt", () => {
	it("运行一开始就返回,不等整轮结束", async () => {
		let releaseRun!: () => void;
		const runGate = new Promise<void>((resolve) => {
			releaseRun = resolve;
		});
		const { agent } = createAgent({
			run: async (run) => {
				run.preflightResult?.("started");
				await runGate;
			},
		});
		await expect(agent.prompt("你好")).resolves.toBe("started");
		releaseRun();
	});

	it("启动之前的失败回给调用方", async () => {
		const { agent } = createAgent({
			run: async () => {
				throw new Error("No API key for p/m");
			},
		});
		await expect(agent.prompt("你好")).rejects.toThrow("No API key");
	});

	it("运行开始之后的失败转成提示", async () => {
		let failRun!: () => void;
		const failGate = new Promise<void>((_resolve, reject) => {
			failRun = () => reject(new Error("连接中断"));
		});
		const { agent, events } = createAgent({
			run: async (run) => {
				run.preflightResult?.("started");
				await failGate;
			},
		});
		await expect(agent.prompt("你好")).resolves.toBe("started");
		failRun();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(events).toContainEqual({ type: "notice", level: "error", message: "连接中断" });
	});

	it("扩展消费掉输入时按实际去向返回", async () => {
		const { agent } = createAgent({
			run: async (run) => {
				run.preflightResult?.("handled");
			},
		});
		await expect(agent.prompt("/help")).resolves.toBe("handled");
	});

	it("会话正在运行又没有给投递方式时直接拒绝", async () => {
		const { agent } = createAgent({ streaming: true });
		await expect(agent.prompt("你好")).rejects.toThrow("the session is streaming");
	});
});
