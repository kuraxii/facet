import type { GitStatus } from "@facet/protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangesPane } from "./changes-pane.tsx";

/** 渲染一次变更页。 */
function render(status: GitStatus | undefined, error?: string): string {
	return renderToStaticMarkup(
		createElement(ChangesPane, {
			status,
			isLoading: false,
			error,
			onRefresh: () => {},
			commits: { isRepo: true, commits: [] },
			commitsLoading: false,
			commitsError: undefined,
		}),
	);
}

describe("变更页", () => {
	it("不是 git 仓库时给出说明", () => {
		const html = render({ isRepo: false, files: [] });
		expect(html).toContain("不是 Git 仓库");
		expect(html).toContain("刷新改动");
	});

	it("工作树干净时给出说明", () => {
		expect(render({ isRepo: true, branch: "main", files: [] })).toContain("工作树干净");
	});

	it("按目录分组列出文件与增删行数", () => {
		const html = render({
			isRepo: true,
			branch: "dev",
			upstream: { name: "origin/dev", ahead: 2, behind: 1 },
			files: [
				{ path: "src/app.ts", status: "modified", added: 12, removed: 3, binary: false },
				{ path: "src/新.ts", status: "untracked", added: 4, removed: 0, binary: false },
				{ path: "logo.png", status: "modified", added: 0, removed: 0, binary: true },
			],
		});
		expect(html).toContain("dev");
		expect(html).toContain("↑2 ↓1");
		expect(html).toContain("src");
		expect(html).toContain("app.ts");
		expect(html).toContain("+12");
		expect(html).toContain("−3");
		expect(html).toContain("二进制");
		expect(html).not.toContain(">M<");
	});

	it("取状态失败时给出原因与重试", () => {
		const html = render(undefined, "git 超时");
		expect(html).toContain("git 超时");
		expect(html).toContain("重试");
	});

	it("文件行把完整路径放在悬停标题里", () => {
		const html = render({
			isRepo: true,
			branch: "dev",
			files: [{ path: "src/app.ts", status: "modified", added: 1, removed: 0, binary: false }],
		});
		expect(html).toContain('title="src/app.ts"');
	});
});
