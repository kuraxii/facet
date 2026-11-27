import { agent, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { AcpAgentProfile, SessionEvent } from "@facet/protocol";
import { describe, expect, it, vi } from "vitest";
import { AcpAgent } from "./acp-agent.ts";

const TEST_PROFILE: AcpAgentProfile = {
	id: "antigravity",
	name: "Antigravity",
	command: "agy",
	args: ["acp"],
	enabled: true,
	builtIn: true,
	loginHint: "agy acp --login",
};

describe("AcpAgent 进程内契约验证", () => {
	it("完整跑通初始化、流式回合、权限审批与动态配置切换", async () => {
		let cancelled = false;
		const app = agent({ name: "mock-agy" })
			.onRequest("initialize", () => ({
				protocolVersion: PROTOCOL_VERSION,
				agentCapabilities: {
					loadSession: true,
					promptCapabilities: { image: true },
				},
			}))
			.onRequest("session/new", () => ({
				sessionId: "ext-1",
				modes: {
					currentModeId: "default",
					availableModes: [
						{ id: "default", name: "Default" },
						{ id: "plan", name: "Plan" },
					],
				},
				configOptions: [
					{
						type: "select",
						id: "model",
						name: "Model",
						category: "model",
						currentValue: "gemini-2.5",
						options: [
							{ value: "gemini-2.5", name: "Gemini 2.5" },
							{ value: "claude-sonnet", name: "Claude Sonnet" },
						],
					},
				],
			}))
			.onRequest("session/set_mode", () => ({}))
			.onRequest("session/set_config_option", ({ params }) => ({
				configOptions: [
					{
						type: "select",
						id: params.configId,
						name: "Model",
						category: "model",
						currentValue: String(params.value),
						options: [
							{ value: "gemini-2.5", name: "Gemini 2.5" },
							{ value: "claude-sonnet", name: "Claude Sonnet" },
						],
					},
				],
			}))
			.onRequest("session/prompt", async ({ client, params }) => {
				const perm = await client.request("session/request_permission", {
					sessionId: params.sessionId,
					toolCall: { toolCallId: "tc1", title: "Write test.ts", kind: "edit" },
					options: [
						{ optionId: "allow_once", name: "Allow", kind: "allow_once" },
						{ optionId: "reject_once", name: "Reject", kind: "reject_once" },
					],
				});
				if (perm.outcome.outcome === "selected" && perm.outcome.optionId === "allow_once") {
					await client.notify("session/update", {
						sessionId: params.sessionId,
						update: {
							sessionUpdate: "agent_message_chunk",
							content: { type: "text", text: "已写入" },
						},
					});
				}
				return { stopReason: cancelled ? "cancelled" : "end_turn" };
			})
			.onNotification("session/cancel", () => {
				cancelled = true;
			});

		const indexed: unknown[] = [];
		const events: SessionEvent[] = [];
		const acpAgent = new AcpAgent({
			id: "local-1",
			profile: TEST_PROFILE,
			cwd: "/work/demo",
			transport: { kind: "in_process", app, profile: TEST_PROFILE, cwd: "/work/demo" },
			onIndexSync: (info) => indexed.push(info),
		});
		acpAgent.subscribe((evt) => events.push(evt));

		await acpAgent.initialize();
		expect(acpAgent.sessionExternalId).toBe("ext-1");
		expect(acpAgent.capabilities).toMatchObject({
			configStyle: "acp",
			supportsHistoryLoad: true,
			supportsImages: true,
			canFork: false,
			canRevert: false,
		});
		expect(acpAgent.snapshot().acpMode?.currentModeId).toBe("default");
		expect(indexed).toHaveLength(1);

		await acpAgent.setAcpMode("plan");
		expect(acpAgent.snapshot().acpMode?.currentModeId).toBe("plan");

		await acpAgent.setAcpConfigOption("model", "claude-sonnet");
		expect(acpAgent.snapshot().acpConfigOptions?.[0]?.currentValue).toBe("claude-sonnet");

		const turnPromise = acpAgent.prompt("修改文件");
		await vi.waitFor(() => {
			expect(acpAgent.snapshot().extensionUi?.prompts).toHaveLength(1);
		});
		const prompt = acpAgent.snapshot().extensionUi?.prompts[0];
		if (prompt === undefined) {
			throw new Error("Expected permission prompt");
		}
		expect(acpAgent.respondUi(prompt.requestId, { kind: "select", value: "Allow" })).toBe(true);

		expect(await turnPromise).toBe("started");
		expect(events.some((e) => e.type === "settled" && !e.aborted)).toBe(true);
		expect(acpAgent.entryPage(undefined, 10).entries.map((e) => e.message?.role)).toEqual([
			"user",
			"assistant",
		]);
		acpAgent.dispose();
	});

	it("打开已有会话时通过 session/load 回放历史而不发射重复实时流", async () => {
		const app = agent()
			.onRequest("initialize", () => ({
				protocolVersion: PROTOCOL_VERSION,
				agentCapabilities: { loadSession: true },
			}))
			.onRequest("session/load", async ({ client, params }) => {
				await client.notify("session/update", {
					sessionId: params.sessionId,
					update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "旧问题" } },
				});
				await client.notify("session/update", {
					sessionId: params.sessionId,
					update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "旧回答" } },
				});
				return {};
			});

		const events: SessionEvent[] = [];
		const acpAgent = new AcpAgent({
			id: "ext-old",
			profile: TEST_PROFILE,
			cwd: "/work/demo",
			externalSessionId: "ext-old",
			transport: { kind: "in_process", app, profile: TEST_PROFILE, cwd: "/work/demo" },
		});
		acpAgent.subscribe((evt) => events.push(evt));

		await acpAgent.initialize();
		expect(events.some((e) => e.type === "message_start")).toBe(false);
		expect(acpAgent.entryPage(undefined, 10).entries).toHaveLength(2);
		acpAgent.dispose();
	});
});
