import type { GitCommit } from "@facet/protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommitTip } from "./commit-tip.tsx";

const commit: GitCommit = {
	sha: "713818e0000000000000000000000000000000aa",
	shortSha: "713818e",
	subject: "换用钴蓝的 f 拓扑标做应用图标",
	body: "旧图标是占位图。",
	authorName: "zjzhu",
	authorEmail: "zjzhu@example.com",
	authorDate: "2026-11-19T00:35:00+08:00",
	stats: { filesChanged: 3, insertions: 46, deletions: 3 },
};

/** 渲染一张提交悬浮卡。 */
function render(webUrl: string | undefined, extra: Partial<GitCommit> = {}): string {
	return renderToStaticMarkup(createElement(CommitTip, { commit: { ...commit, ...extra }, webUrl }));
}

describe("提交悬浮卡", () => {
	it("给出作者、说明、正文、改动规模与短哈希", () => {
		const html = render(undefined);
		expect(html).toContain("zjzhu");
		expect(html).toContain(commit.subject);
		expect(html).toContain(commit.body);
		expect(html).toContain("个文件");
		expect(html).toContain("新增 46 行");
		expect(html).toContain("删除 3 行");
		expect(html).toContain(commit.shortSha);
		expect(html).toContain('aria-label="复制提交哈希"');
	});

	it("有远端时链接到提交页，没有远端时不给链接", () => {
		const linked = render("https://github.com/ocean/facet");
		expect(linked).toContain(`href="https://github.com/ocean/facet/commit/${commit.sha}"`);
		expect(linked).toContain("在 GitHub 上打开");
		expect(render(undefined)).not.toContain("在 GitHub 上打开");
	});

	it("在改动规模下面列出 HEAD、分支与 Tag", () => {
		const html = render(undefined, {
			refs: [
				{ name: "v0.3.0", kind: "tag" },
				{ name: "ui-polish", kind: "branch" },
				{ name: "HEAD", kind: "head" },
			],
		});
		for (const name of ["v0.3.0", "ui-polish", "HEAD"]) {
			expect(html).toContain(name);
		}
		// 顺序固定成 HEAD → 本地分支 → 远端分支 → Tag，与图谱行同一套
		expect(html.indexOf("HEAD")).toBeLessThan(html.indexOf("ui-polish"));
		expect(html.indexOf("ui-polish")).toBeLessThan(html.indexOf("v0.3.0"));
	});

	it("没有引用时整栏不出，不留一条空分隔线", () => {
		expect(render(undefined)).not.toContain("HEAD");
	});
});
