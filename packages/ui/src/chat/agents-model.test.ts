import { DEFAULT_ACP_CAPABILITIES, PI_AGENT_CAPABILITIES, type SessionSummary } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import {
	agentIdOf,
	capabilitiesOf,
	filterSessionsByAgent,
	groupConfigChoices,
	parseCommandArgs,
	resolveAgentSelection,
} from "./agents-model.ts";

describe("多后端纯逻辑辅助函数", () => {
	it("按 agentId 隔离侧栏会话，未标记默认归入 pi", () => {
		const sessions: SessionSummary[] = [
			{
				id: "1",
				path: "/a.jsonl",
				cwd: "/w",
				name: undefined,
				parentSessionPath: undefined,
				created: 1,
				modified: 2,
				firstMessage: "p",
			},
			{
				id: "2",
				agentId: "antigravity",
				path: "acp://antigravity/2",
				cwd: "/w",
				name: undefined,
				parentSessionPath: undefined,
				created: 2,
				modified: 3,
				firstMessage: "a",
			},
		];
		expect(agentIdOf(sessions[0] ?? { agentId: undefined })).toBe("pi");
		expect(filterSessionsByAgent(sessions, "pi").map((s) => s.id)).toEqual(["1"]);
		expect(filterSessionsByAgent(sessions, "antigravity").map((s) => s.id)).toEqual(["2"]);
	});

	it("后端选择不存在时回退到 pi，能力缺省返回 Pi 完整能力", () => {
		const agents = [
			{ id: "pi", kind: "pi" as const, name: "Pi", available: true, enabled: true },
			{ id: "antigravity", kind: "acp" as const, name: "Antigravity", available: false, enabled: true },
		];
		expect(resolveAgentSelection(agents, "antigravity")).toBe("antigravity");
		expect(resolveAgentSelection(agents, "removed")).toBe("pi");
		expect(capabilitiesOf(undefined)).toEqual(PI_AGENT_CAPABILITIES);
		expect(capabilitiesOf(DEFAULT_ACP_CAPABILITIES).configStyle).toBe("acp");
	});

	it("参数拆分与配置候选项分组", () => {
		expect(parseCommandArgs("  acp  --verbose  ")).toEqual(["acp", "--verbose"]);
		expect(
			groupConfigChoices([
				{ value: "m1", name: "M1", group: "Google" },
				{ value: "m2", name: "M2", group: "Google" },
				{ value: "m3", name: "M3" },
			]),
		).toEqual([
			[
				"Google",
				[
					{ value: "m1", name: "M1", group: "Google" },
					{ value: "m2", name: "M2", group: "Google" },
				],
			],
			[undefined, [{ value: "m3", name: "M3" }]],
		]);
	});
});
