import { describe, expect, it } from "vitest";
import {
	AcpStreamBuilder,
	normalizeAcpSessionState,
	permissionPromptFromAcp,
	toAcpConfigOptions,
} from "./acp-events.ts";
import { ANTIGRAVITY_ACP_ADAPTER } from "./antigravity-adapter.ts";

describe("ACP 纯函数事件与配置转换", () => {
	it("session/load 重放时累积 Entry 而不输出实时事件", () => {
		const builder = new AcpStreamBuilder("antigravity");
		expect(
			builder.applyUpdate(
				{ sessionUpdate: "user_message_chunk", content: { type: "text", text: "你好" } },
				{ replay: true, timestamp: 1000 },
			),
		).toEqual([]);
		expect(
			builder.applyUpdate(
				{ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "思考中" } },
				{ replay: true, timestamp: 1001 },
			),
		).toEqual([]);
		expect(
			builder.applyUpdate(
				{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "答复" } },
				{ replay: true, timestamp: 1002 },
			),
		).toEqual([]);
		expect(builder.finishTurn({ replay: true, timestamp: 1003 })).toEqual([]);

		expect(builder.entries).toHaveLength(2);
		expect(builder.entries[0]?.message).toMatchObject({
			role: "user",
			content: [{ type: "text", text: "你好" }],
		});
		expect(builder.entries[1]?.message).toMatchObject({
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "思考中", redacted: false },
				{ type: "text", text: "答复" },
			],
		});
		expect(builder.firstUserText()).toBe("你好");
	});

	it("实时流输出 message_start / message_delta / tool 事件及收尾条目", () => {
		const builder = new AcpStreamBuilder("antigravity");
		const startEvents = builder.applyUpdate(
			{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "第一段" } },
			{ replay: false, timestamp: 2000 },
		);
		expect(startEvents.map((e) => e.type)).toEqual(["message_start", "message_delta"]);

		const toolEvents = builder.applyUpdate(
			{
				sessionUpdate: "tool_call",
				toolCallId: "tc-1",
				title: "Read file",
				kind: "read",
				status: "in_progress",
			},
			{ replay: false, timestamp: 2001 },
		);
		expect(toolEvents).toEqual([
			{ type: "tool_start", callId: "tc-1", toolName: "Read file", input: { title: "Read file" } },
		]);

		const updateEvents = builder.applyUpdate(
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "tc-1",
				status: "completed",
				content: [{ type: "content", content: { type: "text", text: "file body" } }],
			},
			{ replay: false, timestamp: 2002 },
		);
		expect(updateEvents[0]).toMatchObject({
			type: "tool_end",
			callId: "tc-1",
			isError: false,
			output: { content: [{ type: "text", text: "file body" }] },
		});

		const finishEvents = builder.finishTurn({ replay: false, timestamp: 2003 });
		expect(finishEvents.map((e) => e.type)).toEqual([
			"message_end",
			"entry_committed",
			"entry_committed",
			"turn_end",
		]);
	});

	it("转换分组配置项与权限选择提示", () => {
		const configs = toAcpConfigOptions([
			{
				type: "select",
				id: "model",
				name: "Model",
				category: "model",
				currentValue: "gemini-2.5-pro",
				options: [
					{
						group: "g1",
						name: "Google",
						options: [{ value: "gemini-2.5-pro", name: "Gemini 2.5 Pro" }],
					},
				],
			},
		]);
		expect(configs).toEqual([
			{
				id: "model",
				name: "Model",
				category: "model",
				currentValue: "gemini-2.5-pro",
				options: [{ value: "gemini-2.5-pro", name: "Gemini 2.5 Pro", group: "Google" }],
			},
		]);

		const perm = permissionPromptFromAcp("req-1", {
			sessionId: "s1",
			toolCall: { toolCallId: "t1", title: "Run rm -rf", kind: "execute" },
			options: [
				{ optionId: "allow", name: "Allow once", kind: "allow_once" },
				{ optionId: "deny", name: "Deny", kind: "reject_once" },
			],
		});
		expect(perm.prompt).toEqual({
			requestId: "req-1",
			title: "[execute] Run rm -rf",
			kind: "select",
			options: ["Allow once", "Deny"],
		});
		expect(perm.labelToOptionId.get("Allow once")).toBe("allow");
	});

	it("归一化 mode 与 configOptions，并在 Antigravity 下映射 t3code 权限语义", () => {
		const normalized = normalizeAcpSessionState(
			{
				currentModeId: "default",
				availableModes: [
					{ id: "default", name: "Default" },
					{ id: "accept-edits", name: "Accept edits" },
					{ id: "auto", name: "Auto" },
					{ id: "plan", name: "Plan" },
				],
			},
			[
				{
					type: "select",
					id: "model",
					name: "Model",
					category: "model",
					currentValue: "gemini-2.5",
					options: [{ value: "gemini-2.5", name: "Gemini 2.5" }],
				},
				{
					type: "select",
					id: "mode-opt",
					name: "Mode",
					category: "mode",
					currentValue: "default",
					options: [{ value: "default", name: "Default" }],
				},
			],
			ANTIGRAVITY_ACP_ADAPTER.toCanonicalModeId,
		);
		expect(normalized.modeConfigId).toBe("mode-opt");
		expect(normalized.configOptions.map((item) => item.id)).toEqual(["model"]);
		expect(normalized.mode).toEqual({
			currentModeId: "supervised",
			availableModes: [
				{ id: "read-only", name: "Read only" },
				{ id: "supervised", name: "Supervised" },
				{ id: "auto-accept-edits", name: "Auto-accept edits" },
				{ id: "auto", name: "Auto" },
				{ id: "full-access", name: "Full access" },
			],
		});

		// 当仅通过 configOptions 下发 mode 时，也能归一化出 mode
		const fromConfigOnly = normalizeAcpSessionState(
			undefined,
			[
				{
					type: "select",
					id: "mode",
					name: "Mode",
					category: "mode",
					currentValue: "accept-edits",
					options: [{ value: "accept-edits", name: "Accept edits" }],
				},
			],
			ANTIGRAVITY_ACP_ADAPTER.toCanonicalModeId,
		);
		expect(fromConfigOnly.mode).toEqual({
			currentModeId: "auto-accept-edits",
			availableModes: [
				{ id: "auto-accept-edits", name: "Auto-accept edits" },
				{ id: "full-access", name: "Full access" },
			],
		});
		expect(fromConfigOnly.configOptions).toEqual([]);
	});

	it("Antigravity 适配器实现通用 5 档语义与权限策略", () => {
		expect(ANTIGRAVITY_ACP_ADAPTER.toWireModeId("full-access")).toBe("default");
		expect(ANTIGRAVITY_ACP_ADAPTER.toWireModeId("auto-accept-edits")).toBe("accept-edits");
		expect(ANTIGRAVITY_ACP_ADAPTER.toWireModeId("read-only")).toBe("plan");

		const editReq = {
			sessionId: "s1",
			toolCall: { toolCallId: "t1", kind: "edit" as const },
			options: [{ optionId: "allow_once", name: "Allow", kind: "allow_once" as const }],
		};
		const execReq = {
			sessionId: "s1",
			toolCall: { toolCallId: "t2", kind: "execute" as const },
			options: [{ optionId: "allow_once", name: "Allow", kind: "allow_once" as const }],
		};

		expect(ANTIGRAVITY_ACP_ADAPTER.decidePermission(editReq, "supervised")).toBe("ask");
		expect(ANTIGRAVITY_ACP_ADAPTER.decidePermission(editReq, "auto-accept-edits")).toBe("allow");
		expect(ANTIGRAVITY_ACP_ADAPTER.decidePermission(execReq, "auto-accept-edits")).toBe("ask");
		expect(ANTIGRAVITY_ACP_ADAPTER.decidePermission(execReq, "auto")).toBe("ask");
		expect(ANTIGRAVITY_ACP_ADAPTER.decidePermission(execReq, "full-access")).toBe("allow");
		expect(ANTIGRAVITY_ACP_ADAPTER.decidePermission(editReq, "read-only")).toBe("deny");
	});
});
