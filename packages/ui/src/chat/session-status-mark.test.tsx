import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SessionStatusBucket } from "./session-status.ts";
import { SessionStatusMark } from "./session-status-mark.tsx";

function render(bucket: SessionStatusBucket): string {
	return renderToStaticMarkup(createElement(SessionStatusMark, { bucket }));
}

describe("会话行状态标记", () => {
	it("运行中画环：轨道 + 弧 + 中心点", () => {
		const html = render("running");
		expect(html).toContain("status-ring-track");
		expect(html).toContain("status-ring-arc");
		expect(html).toContain("status-ring-dot");
	});

	it("弧的虚线按归一化周长给，四分之一圈正好走满一个周期", () => {
		const html = render("running");
		expect(html).toContain('pathLength="100"');
		expect(html).toContain('stroke-dasharray="25 75"');
	});

	it("等待输入画告警图标，不画点", () => {
		const html = render("needs_input");
		expect(html).toContain("<svg");
		expect(html).not.toContain("status-dot");
	});

	it("需要关注、失败是一个点，已完成不画状态标记", () => {
		for (const bucket of ["attention", "failed"] as const) {
			const html = render(bucket);
			expect(html).toContain("status-dot");
			expect(html).not.toContain("status-ring");
		}
		expect(render("done")).toBe("");
	});

	it("槽位固定，状态写在类名与 status 上", () => {
		const html = render("failed");
		expect(html).toContain('class="status-mark is-failed"');
		expect(html).toContain('role="status"');
		expect(html).toContain('aria-label="失败"');
		expect(html).toContain('data-status="failed"');
	});
});
