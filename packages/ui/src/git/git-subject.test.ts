import { describe, expect, it } from "vitest";
import { splitCommitSubject } from "./git-subject.ts";

describe("splitCommitSubject", () => {
	it("拆分带作用域的常规提交前缀", () => {
		expect(splitCommitSubject("feat(ui): 设置页加终端分节")).toEqual({
			prefix: "feat(ui): ",
			body: "设置页加终端分节",
		});
		expect(splitCommitSubject("fix(agent+server): 路径按规则收口")).toEqual({
			prefix: "fix(agent+server): ",
			body: "路径按规则收口",
		});
	});

	it("拆分不带作用域或带破坏性标记的常规提交前缀", () => {
		expect(splitCommitSubject("docs: 记录帧预算的测量口径")).toEqual({
			prefix: "docs: ",
			body: "记录帧预算的测量口径",
		});
		expect(splitCommitSubject("feat!: 移除旧配置键")).toEqual({
			prefix: "feat!: ",
			body: "移除旧配置键",
		});
	});

	it("带空格的普通句子冒号不被误拆成前缀", () => {
		expect(splitCommitSubject("Merge branch 'main' into dev")).toEqual({
			prefix: undefined,
			body: "Merge branch 'main' into dev",
		});
		expect(splitCommitSubject("Fix bug: handle empty input")).toEqual({
			prefix: undefined,
			body: "Fix bug: handle empty input",
		});
	});

	it("只有前缀没有正文时不拆分", () => {
		expect(splitCommitSubject("chore:   ")).toEqual({
			prefix: undefined,
			body: "chore:   ",
		});
	});
});
