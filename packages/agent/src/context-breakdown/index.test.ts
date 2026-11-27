import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { computeContextBreakdown } from "./index.ts";

function makeTool(
	name: string,
	source: "builtin" | "local" | "npm",
	opts: { sourcePath?: string; description?: string } = {},
): ToolInfo {
	const sourceInfo =
		source === "builtin"
			? { path: "", source: "builtin", scope: "temporary" as const, origin: "package" as const }
			: source === "npm"
				? {
						path: opts.sourcePath ?? "mcp-server",
						source: "npm:@acme/mcp-tools",
						scope: "user" as const,
						origin: "package" as const,
					}
				: {
						path: opts.sourcePath ?? "/tmp/ext.ts",
						source: "local",
						scope: "project" as const,
						origin: "top-level" as const,
					};
	return {
		name,
		description: opts.description ?? `${name} tool description`,
		parameters: { type: "object", properties: { path: { type: "string" } } } as never,
		exposure: "model-only",
		sourceInfo,
	};
}

describe("computeContextBreakdown", () => {
	it("首轮前从 live systemPrompt 与活跃工具拆解指令文件、Skills 与三类工具，并剔除 hiddenTools", () => {
		const systemPrompt = [
			"You are a coding assistant.",
			"<tools>\n- read: Read file\n- bash: Run bash\n</tools>",
			"<rules>\n- Be concise\n</rules>",
			'<project_context>\nProject-specific instructions:\n\n<project_instructions path="/home/alice/repo/AGENTS.md">\nFollow rules carefully.\n</project_instructions>\n</project_context>',
			"<skills>\n<available_skills>\n<skill>\n<name>my-skill</name>\n<description>Helpful workflow</description>\n<location>/home/alice/.pi/skills/my-skill/SKILL.md</location>\n</skill>\n</available_skills>\n</skills>",
			"<cwd>\n/home/alice/repo\n</cwd>",
		].join("\n\n");

		const allTools = [
			makeTool("read", "builtin"),
			makeTool("bash", "builtin"),
			makeTool("mcp_search", "npm", { sourcePath: "mcp:search" }),
			makeTool("hidden_mcp", "npm", { sourcePath: "mcp:hidden" }),
			makeTool("custom_ext", "local"),
		];

		const breakdown = computeContextBreakdown({
			messages: [],
			systemPrompt,
			allTools,
			activeToolNames: ["read", "bash", "mcp_search", "hidden_mcp", "custom_ext"],
			systemPromptOptions: {
				cwd: "/home/alice/repo",
				hiddenTools: ["hidden_mcp"],
			},
			reportedUsage: { tokens: null, contextWindow: 200_000, percent: null },
			compactions: 0,
			homeDir: "/home/alice",
		});

		expect(breakdown.contextWindow).toBe(200_000);
		expect(breakdown.reportedTokens).toBeNull();
		expect(breakdown.hiddenTools).toEqual(["hidden_mcp"]);

		const ids = breakdown.categories.map((c) => c.id);
		expect(ids).toEqual([
			"system-prompt",
			"context-files",
			"skills",
			"built-in-tools",
			"custom-tools",
			"mcp-tools",
		]);

		const contextFiles = breakdown.categories.find((c) => c.id === "context-files");
		expect(contextFiles?.items?.[0]?.label).toBe("~/repo/AGENTS.md");

		const skills = breakdown.categories.find((c) => c.id === "skills");
		expect(skills?.items?.[0]?.label).toBe("my-skill");

		const mcpTools = breakdown.categories.find((c) => c.id === "mcp-tools");
		expect(mcpTools?.items?.map((item) => item.label)).toEqual(["mcp_search"]);

		const sum = breakdown.categories.reduce((acc, c) => acc + c.tokens, 0);
		expect(breakdown.estimatedTokens).toBe(sum);
	});

	it("多轮分支回放 SystemMessage、工具输出按工具名聚合、忽略跨模型 thinking 并记录最新缓存用量", () => {
		const messages: AgentMessage[] = [
			{
				role: "system",
				content: "",
				sections: {
					preamble: "You are helpful.",
					skills:
						"<skills>\n<available_skills>\n<skill>\n<name>s1</name>\n<description>desc</description>\n<location>/s1</location>\n</skill>\n</available_skills>\n</skills>",
					cwd: "<cwd>\n/repo\n</cwd>",
				},
				toolsAdded: [{ name: "read", description: "Read", parameters: { type: "object" } as never }],
				timestamp: 1,
			},
			{
				role: "user",
				content: [{ type: "text", text: "Check package.json please" }],
				timestamp: 2,
			},
			{
				role: "assistant",
				provider: "other-provider",
				api: "openai-responses",
				model: "other-model",
				content: [
					{ type: "thinking", thinking: "secret reasoning from previous model that should be ignored" },
					{ type: "text", text: "Let me check." },
					{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "package.json" } },
				],
				usage: {
					input: 500,
					output: 40,
					cacheRead: 200,
					cacheWrite: 0,
					totalTokens: 740,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: 3,
			},
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [{ type: "text", text: '{"name":"facet","version":"0.4.0"}' }],
				isError: false,
				timestamp: 4,
			},
			{
				role: "assistant",
				provider: "anthropic",
				api: "anthropic-messages",
				model: "claude-4",
				content: [
					{ type: "thinking", thinking: "Analyzing the package name and version" },
					{ type: "text", text: "It is facet 0.4.0." },
				],
				usage: {
					input: 120,
					output: 30,
					cacheRead: 800,
					cacheWrite: 50,
					reasoning: 18,
					totalTokens: 1000,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				} as never,
				stopReason: "stop",
				timestamp: 5,
			},
			{
				role: "compactionSummary",
				summary: "Earlier conversation summary",
				tokensBefore: 12000,
				timestamp: 6,
			},
		];

		const breakdown = computeContextBreakdown({
			messages,
			systemPrompt: "stale live prompt should not replace branch state",
			allTools: [makeTool("read", "builtin")],
			activeToolNames: ["read"],
			model: { provider: "anthropic", api: "anthropic-messages", id: "claude-4" },
			reportedUsage: { tokens: 1000, contextWindow: 200_000, percent: 0.5 },
			compactions: 1,
		});

		expect(breakdown.compactions).toBe(1);
		expect(breakdown.reportedTokens).toBe(1000);
		expect(breakdown.latestRequestUsage).toEqual({
			input: 120,
			output: 30,
			cacheRead: 800,
			cacheWrite: 50,
			reasoning: 18,
		});

		const thinking = breakdown.categories.find((c) => c.id === "assistant-thinking");
		// 仅保留当前模型的 thinking（18 / 字符估算最大），不包含 other-model 的 55 字符
		expect(thinking?.items?.[0]?.count).toBe(1);

		const toolOutput = breakdown.categories.find((c) => c.id === "tool-output");
		expect(toolOutput?.items?.[0]?.label).toBe("read");
		expect(toolOutput?.items?.[0]?.count).toBe(1);

		const compacted = breakdown.categories.find((c) => c.id === "compacted-data");
		expect(compacted?.tokens).toBeGreaterThan(0);
	});
});
