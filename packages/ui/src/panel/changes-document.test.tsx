import type { GitStatus } from "@facet/protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangesDocument } from "./changes-document.tsx";

const status: GitStatus = {
	isRepo: true,
	branch: "dev",
	upstream: { name: "origin/dev", ahead: 2, behind: 1 },
	files: [
		{ path: "src/app.ts", status: "modified", added: 12, removed: 3, binary: false },
		{ path: "src/components/Button.tsx", status: "added", added: 64, removed: 0, binary: false },
	],
};

/** 渲染一次变更文档。 */
function render(focusPath: string | undefined): string {
	return renderToStaticMarkup(
		createElement(ChangesDocument, {
			status,
			error: undefined,
			focusPath,
			focusRequestId: 1,
			loadDiff: () => Promise.resolve({ patch: "", truncated: false, binary: false }),
			onRefresh: () => {},
			commits: { isRepo: true, commits: [] },
			commitsLoading: false,
			commitsError: undefined,
		}),
	);
}

describe("变更文档", () => {
	it("顶部给出分支与总增删，文件头保留文件级统计", () => {
		const html = render(undefined);
		expect(html).toContain("dev");
		expect(html).toContain("+76");
		expect(html).toContain("−3");
		expect(html).toContain("app.ts");
		expect(html).toContain("src");
		expect(html).toContain("Button.tsx");
	});

	it("给定位文件时把它标成当前文件", () => {
		const html = render("src/components/Button.tsx");
		expect(html).toContain('data-path="src/components/Button.tsx"');
		expect(html).toContain('data-focused="true"');
	});
});
