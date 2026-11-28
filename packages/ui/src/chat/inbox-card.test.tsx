import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider.tsx";
import { InboxCard } from "./InboxCard.tsx";
import type { SidebarTaskCard } from "./inbox-model.ts";

function makeCard(overrides: Partial<SidebarTaskCard>): SidebarTaskCard {
	return {
		key: "local::/a.jsonl",
		endpoint: "local",
		file: "/a.jsonl",
		hostLabel: "This computer",
		isLocal: true,
		hostOnline: true,
		projectName: "facet",
		projectMonogram: "FA",
		cwd: "/work/facet",
		title: "测试任务",
		agentId: "pi",
		attention: "idle",
		bucket: "done",
		updatedAt: 1_700_000_000_000,
		timeText: "2m",
		...overrides,
	};
}

function renderCard(overrides: Partial<SidebarTaskCard>): string {
	return renderToStaticMarkup(
		<I18nProvider language="zh-CN">
			<InboxCard
				card={makeCard(overrides)}
				isActive={false}
				onSelect={() => undefined}
				onSettle={() => undefined}
				onContextMenu={() => undefined}
			/>
		</I18nProvider>,
	);
}

describe("InboxCard 状态与 Settle 切换", () => {
	it("有活跃状态时仅显示原版状态标记，不渲染时间与 Settle 按钮", () => {
		for (const bucket of ["running", "needs_input", "attention", "failed"] as const) {
			const html = renderCard({ bucket });
			expect(html).toContain(`status-mark is-${bucket}`);
			expect(html).not.toContain("inbox-time");
			expect(html).not.toContain("inbox-settle-btn");
		}
	});

	it("done 状态不渲染状态标记，显示时间并保留悬停 Settle 按钮", () => {
		const html = renderCard({ bucket: "done" });
		expect(html).not.toContain("status-mark");
		expect(html).toContain("inbox-time");
		expect(html).toContain("inbox-settle-btn");
	});
});
