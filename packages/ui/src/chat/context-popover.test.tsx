import type { ContextBreakdown, Message } from "@facet/protocol";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider.tsx";
import { ContextPopover } from "./ContextPopover.tsx";
import { SessionStatsChip } from "./SessionStatsPopover.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: React.ReactElement) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => {
		root.render(<I18nProvider language="zh-CN">{node}</I18nProvider>);
	});
	return {
		container,
		unmount: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
}

describe("ContextPopover", () => {
	it("渲染分类拆解、展开子项、隐藏工具提示与缓存分布", () => {
		const breakdown: ContextBreakdown = {
			contextWindow: 200_000,
			reportedTokens: 20_000,
			reportedPercent: 10,
			estimatedTokens: 20_000,
			categories: [
				{
					id: "system-prompt",
					tokens: 4_000,
					items: [
						{ id: "p1", label: "Preamble", tokens: 1_500 },
						{ id: "p2", label: "Rules", tokens: 2_500 },
					],
				},
				{
					id: "skills",
					tokens: 2_000,
					items: [{ id: "s1", label: "my-skill", tokens: 2_000 }],
				},
				{
					id: "user-messages",
					tokens: 14_000,
					items: [{ id: "u1", label: "User", tokens: 14_000, count: 3 }],
				},
			],
			hiddenTools: ["mcp_hidden"],
			compactions: 1,
			latestRequestUsage: {
				input: 500,
				output: 100,
				cacheRead: 19_500,
				cacheWrite: 0,
				reasoning: 0,
			},
		};
		const onCompact = vi.fn();

		const { container, unmount } = mount(
			createElement(ContextPopover, {
				contextUsage: { tokens: 20_000, contextWindow: 200_000, percent: 10 },
				breakdown,
				isCompacting: false,
				canCompact: true,
				onCompact,
			}),
		);

		expect(container.textContent).toContain("已压缩 1 次");
		expect(container.textContent).toContain("System Prompt (2)");
		expect(container.textContent).toContain("Skills");
		expect(container.textContent).toContain("隐藏声明工具 (1)");
		expect(container.textContent).toContain("缓存复用");

		// 点击展开 Skills 子项
		const skillRow = [...container.querySelectorAll<HTMLButtonElement>("button.ctx-cat-row")].find((btn) =>
			btn.textContent?.includes("Skills"),
		);
		expect(skillRow).toBeDefined();
		act(() => {
			skillRow?.click();
		});
		expect(container.textContent).toContain("my-skill");

		// 点击压缩按钮
		const compactBtn = container.querySelector<HTMLButtonElement>("button.ctx-pop-action");
		act(() => {
			compactBtn?.click();
		});
		expect(onCompact).toHaveBeenCalledTimes(1);
		unmount();
	});
});

describe("SessionStatsChip", () => {
	it("展示最近 tok/s 并在展开时列出速度与累计 Token", () => {
		const messages: Message[] = [
			{
				role: "assistant",
				content: [{ type: "text", text: "done" }],
				provider: "p",
				model: "m",
				usage: {
					input: 200,
					output: 120,
					cacheRead: 800,
					cacheWrite: 0,
					reasoning: 0,
					totalTokens: 1120,
					cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
				},
				stopReason: "stop",
				durationMs: 2_000,
				timestamp: 10,
			},
		];

		const { container, unmount } = mount(
			createElement(SessionStatsChip, {
				messages,
				streamingChars: 0,
				isStreaming: false,
				sessionStats: undefined,
				isOpen: true,
				onToggle: () => {},
			}),
		);

		const chip = container.querySelector<HTMLButtonElement>('button.composer-status-chip[data-chip="stats"]');
		expect(chip).not.toBeNull();
		expect(chip?.hasAttribute("data-tone")).toBe(false);
		expect(chip?.querySelector("svg.lucide-gauge")).not.toBeNull();
		expect(chip?.style.getPropertyValue("--gauge-deg")).toBe("-45deg");
		expect(container.textContent).toContain("60.0 tok/s");
		expect(container.textContent).toContain("会话 Token 与速度");
		expect(container.textContent).toContain("80.0%");
		unmount();
	});
});
