import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { SessionEvent } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { ExtensionUi } from "./extension-ui.ts";
import { PiAgent, type PiAgentContext } from "./pi-agent.ts";

interface FakeRun {
	/** 取会话给的回执回调,用例自己决定何时回执 */
	preflightResult?: (value: "handled" | "queued" | "started") => void;
	streamingBehavior?: "steer" | "followUp";
}

interface FakeAgentOptions {
	context?: Pick<PiAgentContext, "ui" | "initialize">;
	streaming?: boolean;
	run?: (run: FakeRun) => Promise<void>;
	/** 中止的等待,用例自己决定何时结束 */
	abort?: () => Promise<void>;
	/** 回退时走的分支跳转,用例按需给出结果 */
	navigateTree?: (entryId: string) => Promise<{ cancelled: boolean; editorText?: string }>;
}

/** 只实现用到的部分,其余字段由构造期的少量调用凑齐。 */
function createAgent(options: FakeAgentOptions = {}) {
	let listener: ((event: unknown) => void) | undefined;
	const session = {
		sessionId: "s1",
		sessionFile: "/tmp/s1.jsonl",
		isStreaming: options.streaming ?? false,
		isCompacting: false,
		sessionManager: { getCwd: () => "/tmp" },
		subscribe: (next: (event: unknown) => void) => {
			listener = next;
			return () => {
				listener = undefined;
			};
		},
		prompt: async (_text: string, run: FakeRun) => {
			await (options.run?.(run) ?? Promise.resolve());
		},
		dispose: () => {},
		abort: options.abort ?? (async () => {}),
		navigateTree: options.navigateTree ?? (async () => ({ cancelled: false })),
	} as unknown as PiAgentContext["session"];
	const agent = new PiAgent({
		...options.context,
		session,
		modelRuntime: {} as PiAgentContext["modelRuntime"],
		modelFallbackMessage: undefined,
	});
	const events: SessionEvent[] = [];
	agent.subscribe((event) => {
		events.push(event);
	});
	/** 把一条 pi 事件喂给 agent,模拟 pi 侧推进 */
	const emitToAgent = (event: Record<string, unknown>): void => {
		listener?.(event);
	};
	return { agent, events, emitToAgent };
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

	it("启动失败回到空闲", async () => {
		const { agent } = createAgent({
			run: async () => {
				throw new Error("No API key for p/m");
			},
		});
		await expect(agent.prompt("你好")).rejects.toThrow("No API key");
		expect(agent.currentPhase).toBe("idle");
	});
});

describe("扩展初始化", () => {
	it("初始化只执行一次，等待交互期间会话保持忙碌", async () => {
		const ui = new ExtensionUi({} as ExtensionUIContext);
		let calls = 0;
		const { agent, events } = createAgent({
			context: {
				ui,
				initialize: async () => {
					calls += 1;
					await ui.context.input("启动输入");
				},
			},
		});
		expect(agent.isBusy).toBe(true);
		const first = agent.initialize();
		expect(agent.initialize()).toBe(first);
		const id = ui.snapshot().prompts[0]?.requestId ?? "";
		expect(agent.respondUi(id, { kind: "input", value: "内容" })).toBe(true);
		await first;
		expect(calls).toBe(1);
		expect(agent.isBusy).toBe(false);
		expect(events).toContainEqual({ type: "initialized", initialization: { kind: "ready" } });
		agent.dispose();
	});

	it("初始化错误发布具体原因并清理未完成的 UI", async () => {
		const ui = new ExtensionUi({} as ExtensionUIContext);
		let input: Promise<string | undefined> | undefined;
		const { agent, events } = createAgent({
			context: {
				ui,
				initialize: async () => {
					input = ui.context.input("启动输入");
					throw new Error("资源不可读");
				},
			},
		});
		await expect(agent.initialize()).rejects.toThrow("资源不可读");
		await expect(agent.initialize()).rejects.toThrow("资源不可读");
		await expect(input).resolves.toBeUndefined();
		expect(ui.snapshot().prompts).toEqual([]);
		expect(agent.isBusy).toBe(false);
		expect(events).toContainEqual({
			type: "initialized",
			initialization: { kind: "failed", message: "资源不可读" },
		});
		agent.dispose();
	});

	it("释放期间解除启动询问，不再发布就绪事件", async () => {
		const ui = new ExtensionUi({} as ExtensionUIContext);
		const { agent, events } = createAgent({
			context: {
				ui,
				initialize: async () => {
					await ui.context.input("启动输入");
				},
			},
		});
		const initializing = agent.initialize();
		agent.dispose();
		await initializing;
		expect(events.filter((event) => event.type === "initialized")).toEqual([]);
		expect(() => agent.respondUi("u1", { kind: "cancel" })).toThrow("disposed");
	});

	it("运行期间执行扩展命令保留运行阶段", async () => {
		const { agent, emitToAgent } = createAgent({
			streaming: true,
			run: async (run) => {
				run.preflightResult?.("handled");
			},
		});
		emitToAgent({ type: "agent_start" });
		await expect(agent.prompt("/ask", { streamingBehavior: "steer" })).resolves.toBe("handled");
		expect(agent.currentPhase).toBe("running");
	});

	it("input hook 等待时的停止会在模型运行开始前再次传递", async () => {
		const ui = new ExtensionUi({} as ExtensionUIContext);
		let aborts = 0;
		const { agent } = createAgent({
			context: { ui },
			abort: async () => {
				aborts += 1;
			},
			run: async (run) => {
				await ui.context.input("输入处理");
				run.preflightResult?.("started");
			},
		});
		const running = agent.prompt("内容");
		await Promise.resolve();
		await agent.abort();
		await running;
		expect(aborts).toBe(2);
		agent.dispose();
	});
});

describe("阶段与维护动作", () => {
	it("发出消息即进入 starting,pi 开始运行后转 running,收尾转 idle", async () => {
		const { agent, events, emitToAgent } = createAgent({
			run: async (run) => {
				run.preflightResult?.("started");
			},
		});
		await agent.prompt("你好");
		expect(agent.currentPhase).toBe("starting");
		emitToAgent({ type: "agent_start" });
		expect(agent.currentPhase).toBe("running");
		emitToAgent({ type: "agent_settled", aborted: false });
		expect(agent.currentPhase).toBe("idle");
		expect(events.filter((event) => event.type === "phase")).toEqual([
			{ type: "phase", phase: "starting", maintenance: undefined },
			{ type: "phase", phase: "running", maintenance: undefined },
			{ type: "phase", phase: "idle", maintenance: undefined },
		]);
	});

	it("被扩展消费的输入不留下 starting", async () => {
		const { agent } = createAgent({
			run: async (run) => {
				run.preflightResult?.("handled");
			},
		});
		await agent.prompt("/help");
		expect(agent.currentPhase).toBe("idle");
	});

	it("压缩与重试记在维护动作上,结束时清掉", () => {
		const { agent, emitToAgent } = createAgent();
		emitToAgent({ type: "compaction_start", reason: "threshold" });
		expect(agent.currentMaintenance).toEqual({
			kind: "compaction",
			reason: "threshold",
			tokensBefore: undefined,
			estimatedTokensAfter: undefined,
		});
		emitToAgent({ type: "compaction_end", reason: "threshold", aborted: false, willRetry: false });
		expect(agent.currentMaintenance).toBeUndefined();
		emitToAgent({ type: "auto_retry_start", attempt: 2, maxAttempts: 3, delayMs: 500 });
		expect(agent.currentMaintenance).toEqual({ kind: "retry", attempt: 2, maxAttempts: 3, delayMs: 500 });
		emitToAgent({ type: "auto_retry_end", success: true, attempt: 2 });
		expect(agent.currentMaintenance).toBeUndefined();
	});

	it("摘要请求重试期间保持压缩动作，收到结束事件才清除", () => {
		const { agent, emitToAgent } = createAgent();
		emitToAgent({ type: "compaction_start", reason: "manual" });
		emitToAgent({ type: "summarization_retry_scheduled", attempt: 1, maxAttempts: 3, delayMs: 1000 });
		expect(agent.currentMaintenance?.kind).toBe("compaction");
		emitToAgent({
			type: "summarization_retry_attempt_start",
			source: "compaction",
			reason: "manual",
			willRetry: false,
		});
		expect(agent.currentMaintenance?.kind).toBe("compaction");
		emitToAgent({ type: "summarization_retry_finished" });
		expect(agent.currentMaintenance?.kind).toBe("compaction");
		emitToAgent({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false });
		expect(agent.currentMaintenance).toBeUndefined();
	});

	it("分支摘要重试使用 SDK 给出的等待时长", () => {
		const { agent, emitToAgent } = createAgent();
		emitToAgent({ type: "summarization_retry_scheduled", attempt: 2, maxAttempts: 3, delayMs: 1500 });
		expect(agent.currentMaintenance).toEqual({ kind: "retry", attempt: 2, maxAttempts: 3, delayMs: 1500 });
		emitToAgent({ type: "summarization_retry_finished" });
		expect(agent.currentMaintenance).toBeUndefined();
	});

	it("维护动作期间算忙,空闲回收不会动手", () => {
		const { agent, emitToAgent } = createAgent();
		expect(agent.isBusy).toBe(false);
		emitToAgent({ type: "compaction_start", reason: "manual" });
		expect(agent.isBusy).toBe(true);
		emitToAgent({ type: "compaction_end", reason: "manual", aborted: true, willRetry: false });
		expect(agent.isBusy).toBe(false);
	});

	it("中止期间进入 stopping,pi 收尾后回到 idle", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { agent, emitToAgent } = createAgent({ abort: () => gate });
		emitToAgent({ type: "agent_start" });
		const aborting = agent.abort();
		await Promise.resolve();
		expect(agent.currentPhase).toBe("stopping");
		release();
		await aborting;
		expect(agent.currentPhase).toBe("idle");
	});

	it("没有运行时的中止不改动阶段", async () => {
		const { agent } = createAgent();
		await agent.abort();
		expect(agent.currentPhase).toBe("idle");
	});
});

describe("PiAgent.revertTo", () => {
	it("返回这条消息的文本,供界面放回输入框", async () => {
		const { agent } = createAgent({
			navigateTree: async (entryId) => ({ cancelled: false, editorText: `回退到 ${entryId}` }),
		});
		await expect(agent.revertTo("e3")).resolves.toBe("回退到 e3");
	});

	it("扩展取消回退时报错", async () => {
		const { agent } = createAgent({ navigateTree: async () => ({ cancelled: true }) });
		await expect(agent.revertTo("e3")).rejects.toThrow("回退被取消");
	});
});
