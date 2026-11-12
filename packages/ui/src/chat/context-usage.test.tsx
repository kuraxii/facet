/**
 * 上下文用量条的渲染：有数值、未知、压缩中三种样子，以及压缩按钮的可用状态。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextUsageBar, formatTokens, usageLabel } from "./ContextUsageBar.tsx";

function render(props: {
	usage: Parameters<typeof ContextUsageBar>[0]["usage"];
	isCompacting?: boolean;
	isRunning?: boolean;
}): string {
	return renderToStaticMarkup(
		createElement(ContextUsageBar, {
			usage: props.usage,
			isCompacting: props.isCompacting ?? false,
			isRunning: props.isRunning ?? false,
			onCompact: () => {},
		}),
	);
}

describe("上下文用量", () => {
	it("token 数按千取整，便于一眼读", () => {
		expect(formatTokens(820)).toBe("820");
		expect(formatTokens(1500)).toBe("1.5k");
		expect(formatTokens(83_400)).toBe("83k");
	});

	it("有数值时写出比例与已用、窗口", () => {
		expect(usageLabel({ tokens: 83_400, contextWindow: 200_000, percent: 41.7 })).toBe(
			"上下文 42% · 83k / 200k",
		);
	});

	it("估不出来时明说未知", () => {
		expect(usageLabel(undefined)).toBe("上下文用量未知");
		expect(usageLabel({ tokens: null, contextWindow: 200_000, percent: null })).toBe("上下文用量未知");
	});

	it("接近上限时给出提醒与填充条", () => {
		const html = render({ usage: { tokens: 180_000, contextWindow: 200_000, percent: 90 } });
		expect(html).toContain("接近上限，可以压缩");
		expect(html).toContain("usage-fill");
	});

	it("用量未知时不画填充条", () => {
		const html = render({ usage: undefined });
		expect(html).toContain("上下文用量未知");
		expect(html).not.toContain("usage-fill");
	});

	it("压缩中显示状态文字，压缩按钮不可点", () => {
		const html = render({ usage: undefined, isCompacting: true });
		expect(html).toContain("正在压缩上下文…");
		expect(html).toMatch(/class="usage-compact"[^>]*disabled/);
	});

	it("运行中不给压缩入口，结束后可以点", () => {
		const running = render({ usage: { tokens: 1000, contextWindow: 200_000, percent: 1 }, isRunning: true });
		expect(running).toMatch(/class="usage-compact"[^>]*disabled/);
		const idle = render({ usage: { tokens: 1000, contextWindow: 200_000, percent: 1 } });
		expect(idle).not.toMatch(/class="usage-compact"[^>]*disabled/);
	});
});
