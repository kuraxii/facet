import { DEFAULT_ACP_CAPABILITIES, PI_AGENT_CAPABILITIES, type SessionSummary } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import {
	backendIdOf,
	capabilitiesOf,
	filterSessionsByBackend,
	groupConfigChoices,
	parseCommandArgs,
	resolveBackendSelection,
} from "./backend-model.ts";

describe("多后端纯逻辑辅助函数", () => {
	it("按 backendId 隔离侧栏会话，未标记默认归入 pi", () => {
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
				backendId: "antigravity",
				path: "acp://antigravity/2",
				cwd: "/w",
				name: undefined,
				parentSessionPath: undefined,
				created: 2,
				modified: 3,
				firstMessage: "a",
			},
		];
		expect(backendIdOf(sessions[0] ?? { backendId: undefined })).toBe("pi");
		expect(filterSessionsByBackend(sessions, "pi").map((s) => s.id)).toEqual(["1"]);
		expect(filterSessionsByBackend(sessions, "antigravity").map((s) => s.id)).toEqual(["2"]);
	});

	it("后端选择不存在时回退到 pi，能力缺省返回 Pi 完整能力", () => {
		const backends = [
			{ id: "pi", kind: "pi" as const, name: "Pi", available: true, enabled: true },
			{ id: "antigravity", kind: "acp" as const, name: "Antigravity", available: false, enabled: true },
		];
		expect(resolveBackendSelection(backends, "antigravity")).toBe("antigravity");
		expect(resolveBackendSelection(backends, "removed")).toBe("pi");
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
