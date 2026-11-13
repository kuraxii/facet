/**
 * 上下文用量环：数值文案、档位取色、未知时不留假进度。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextRing, formatTokens, usageLabel, usageLevel } from "./ContextRing.tsx";

function render(usage: Parameters<typeof ContextRing>[0]["usage"]): string {
	return renderToStaticMarkup(createElement(ContextRing, { usage }));
}

describe("上下文用量环", () => {
	it("token 数按千取整，便于一眼读", () => {
		expect(formatTokens(820)).toBe("820");
		expect(formatTokens(1500)).toBe("1.5k");
		expect(formatTokens(83_400)).toBe("83k");
	});

	it("有数值时写出比例与已用、窗口", () => {
		expect(usageLabel({ tokens: 83_400, contextWindow: 200_000, percent: 41.7 })).toBe(
			"上下文窗口已使用 42% · 83k / 200k",
		);
	});

	it("估不出来时明说暂无数据", () => {
		expect(usageLabel(undefined)).toBe("上下文窗口：暂无数据");
		expect(usageLabel({ tokens: null, contextWindow: 200_000, percent: null })).toBe("上下文窗口：暂无数据");
	});

	it("按占用分三档取色", () => {
		expect(usageLevel(null)).toBe("normal");
		expect(usageLevel(40)).toBe("normal");
		expect(usageLevel(70)).toBe("warn");
		expect(usageLevel(90)).toBe("warn");
		expect(usageLevel(91)).toBe("danger");
	});

	it("有数值时画两圈：底环与进度", () => {
		const html = render({ tokens: 90_000, contextWindow: 200_000, percent: 45 });
		expect(html.match(/<circle/g) ?? []).toHaveLength(2);
		expect(html).toContain("上下文窗口已使用 45%");
	});

	it("用量未知时只画底环，不把未知画成 0%", () => {
		const html = render(undefined);
		expect(html.match(/<circle/g) ?? []).toHaveLength(1);
		expect(html).toContain("上下文窗口：暂无数据");
	});
});
